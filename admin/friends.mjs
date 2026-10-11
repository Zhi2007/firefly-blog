/**
 * 友链管理（数据源：`src/config/friends.json`）
 *
 * 为什么单独抽一个 JSON：友链原来硬编码在 `src/config/friendsConfig.ts` 里，
 * 面板要增删改就得改写 TS 源码，改错一个引号整站就构建不出来。
 * 现在数据放 JSON、`friendsConfig.ts` 只负责 import，面板只管读写 JSON。
 *
 * 本模块只依赖 Node 内置模块，风格与 `nav.mjs` 一致：
 *   handleFriends()       GET 读列表 / POST 做 add|update|delete|move|toggle
 *   handleFriendsFetch()  POST 抓取目标站点，猜标题 / 简介 / 图标
 *
 * 写入安全模式（照抄公告 / 歌单那套）：先快照 → 结构校验 → 写文件 → 读回校验 → 不一致回滚。
 */

import dns from "node:dns/promises";
import fs from "node:fs/promises";
import path from "node:path";

// ── 常量 ────────────────────────────────────────────────────────────────────
/** 友链数据文件（相对仓库根目录），同时也是管理面板可编辑的 JSON 之一 */
export const FRIENDS_FILE = "src/config/friends.json";
/** 友链头像的落盘目录（相对仓库根目录） */
export const FRIENDS_PUBLIC_DIR = "public/friends";

const MAX_ITEMS = 200;
const MAX_TITLE_CHARS = 60;
const MAX_DESC_CHARS = 120;
const MAX_TAGS = 4;
const MAX_TAG_CHARS = 12;
const MIN_WEIGHT = -999;
const MAX_WEIGHT = 999;

const ICON_MIN_BYTES = 100;
const ICON_MAX_BYTES = 400 * 1024;

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 3 * 1024 * 1024;
const FETCH_MAX_REDIRECTS = 5;

// 不少站点会拒绝 Node 默认的 UA（直接 403 / 返回验证页），所以伪装成常见浏览器
const BROWSER_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── 小工具 ──────────────────────────────────────────────────────────────────

/** 按「码点」数字符：一个 emoji 算 1 个字，而不是 JS 默认的 2 */
function charCount(text) {
	return [...String(text ?? "")].length;
}

/** 截断用于提示文案的文本，避免把一整页内容塞进错误信息 */
function truncate(text, limit = 40) {
	const value = String(text ?? "").trim();
	return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

async function exists(target) {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

function escapeRegExp(text) {
	return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 抛一个带 HTTP 状态码的错误（默认 400 = 用户输入问题） */
function fail(message, status = 400) {
	const error = new Error(message);
	error.status = status;
	return error;
}

// ── 校验 ────────────────────────────────────────────────────────────────────

/**
 * 清洗并校验单条友链。
 * 任何不合法都抛带中文说明的 Error（调用方转成 400）。
 * 返回字段顺序固定，写进 JSON 后 diff 干净。
 */
export function sanitizeFriend(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("友链条目必须是一个对象");
	}

	const title = String(raw.title ?? "").trim();
	if (!title) throw new Error("站名不能为空");
	if (charCount(title) > MAX_TITLE_CHARS) {
		throw new Error(`站名太长（${charCount(title)} 字，上限 ${MAX_TITLE_CHARS} 字）：${truncate(title, 20)}`);
	}

	const siteurl = String(raw.siteurl ?? "").trim();
	if (!siteurl) throw new Error("站点链接不能为空");
	let parsedUrl;
	try {
		parsedUrl = new URL(siteurl);
	} catch {
		throw new Error(`站点链接不是合法网址：${siteurl}`);
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error(`站点链接只允许 http / https：${siteurl}`);
	}

	const desc = String(raw.desc ?? "").trim();
	if (charCount(desc) > MAX_DESC_CHARS) {
		throw new Error(`简介太长（${charCount(desc)} 字，上限 ${MAX_DESC_CHARS} 字）：${truncate(desc, 20)}`);
	}

	const imgurl = String(raw.imgurl ?? "").trim();
	if (!imgurl) throw new Error("头像不能为空（填站内路径 /friends/xxx.png 或图片直链）");
	if (!/^https?:\/\//i.test(imgurl) && !(imgurl.startsWith("/") && !imgurl.startsWith("//"))) {
		throw new Error(`头像只允许站内绝对路径（/friends/xxx.png）或 http(s) 图片直链：${imgurl}`);
	}

	const rawTags = raw.tags === undefined || raw.tags === null ? [] : raw.tags;
	if (!Array.isArray(rawTags)) throw new Error("标签必须是字符串数组，例如 [\"友链\"]");
	if (rawTags.length > MAX_TAGS) {
		throw new Error(`标签最多 ${MAX_TAGS} 个（收到 ${rawTags.length} 个）`);
	}
	const tags = [];
	for (const entry of rawTags) {
		if (typeof entry !== "string") throw new Error("标签必须是字符串");
		const tag = entry.trim();
		if (!tag) continue;
		if (charCount(tag) > MAX_TAG_CHARS) {
			throw new Error(`标签太长（${charCount(tag)} 字，上限 ${MAX_TAG_CHARS} 字）：${truncate(tag, 20)}`);
		}
		if (!tags.includes(tag)) tags.push(tag);
	}

	const rawWeight = raw.weight === undefined || raw.weight === null || raw.weight === "" ? 0 : raw.weight;
	const weight = Number(rawWeight);
	if (!Number.isInteger(weight)) throw new Error(`权重必须是整数（-999 ~ 999）：${rawWeight}`);
	if (weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
		throw new Error(`权重必须在 ${MIN_WEIGHT} ~ ${MAX_WEIGHT} 之间：${weight}`);
	}

	const rawEnabled = raw.enabled === undefined || raw.enabled === null ? true : raw.enabled;
	if (typeof rawEnabled !== "boolean") throw new Error("「是否显示」必须是 true / false");

	return { title, imgurl, desc, siteurl, tags, weight, enabled: rawEnabled };
}

/** 清洗整张列表：逐条校验 + 总数上限 */
export function sanitizeFriends(input) {
	if (!Array.isArray(input)) throw new Error("友链数据必须是数组");
	if (input.length > MAX_ITEMS) {
		throw new Error(`友链总数最多 ${MAX_ITEMS} 条（收到 ${input.length} 条）`);
	}
	return input.map((item) => sanitizeFriend(item));
}

// ── 写 src/config/friends.json ──────────────────────────────────────────────

// 与仓库 Biome 配置（biome.json）的默认值对齐：
// printWidth 默认 80，indentWidth 默认 2，缩进用 tab（量宽度时一个 tab 记 2 列）。
// 对齐的目的是「面板写出来的文件 = pnpm format 的结果」，否则每次保存都会带出一整页格式 diff。
const JSON_LINE_WIDTH = 80;
const JSON_TAB_WIDTH = 2;

/** 按 Biome 的口径量一行有多宽（tab 按 indentWidth 计） */
function displayWidth(text) {
	let width = 0;
	for (const ch of text) width += ch === "\t" ? JSON_TAB_WIDTH : 1;
	return width;
}

/**
 * 单行渲染（Biome 的内联风格：对象花括号里留空格，数组方括号里不留）。
 * 遇到无法单行表达的内容返回 null，交给调用方展开。
 */
function inlineJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		const parts = value.map((item) => inlineJson(item));
		if (parts.some((part) => part === null)) return null;
		return `[${parts.join(", ")}]`;
	}
	const entries = Object.entries(value);
	if (entries.length === 0) return "{}";
	const parts = [];
	for (const [key, item] of entries) {
		const rendered = inlineJson(item);
		if (rendered === null) return null;
		parts.push(`${JSON.stringify(key)}: ${rendered}`);
	}
	return `{ ${parts.join(", ")} }`;
}

/**
 * 生成 friends.json 的文本：tab 缩进、UTF-8、末尾换行，且与 `biome format` 的结果一致。
 * 规则很简单：能塞进 80 列就单行，塞不下就展开（数组一行一项）。
 */
export function stringifyFriendsJson(items) {
	// 整张表能塞进一行就一行（空数组、单条短友链都属于这种）
	const whole = inlineJson(items);
	if (whole !== null && displayWidth(whole) <= JSON_LINE_WIDTH) return `${whole}\n`;

	const lines = ["["];
	items.forEach((item, index) => {
		const itemTail = index === items.length - 1 ? "" : ",";
		const itemInline = inlineJson(item);
		if (itemInline !== null && displayWidth(`\t${itemInline}${itemTail}`) <= JSON_LINE_WIDTH) {
			lines.push(`\t${itemInline}${itemTail}`);
			return;
		}
		lines.push("\t{");
		const entries = Object.entries(item);
		entries.forEach(([key, value], entryIndex) => {
			const tail = entryIndex === entries.length - 1 ? "" : ",";
			const prefix = `\t\t${JSON.stringify(key)}: `;
			const valueInline = inlineJson(value);
			if (valueInline !== null && displayWidth(prefix + valueInline + tail) <= JSON_LINE_WIDTH) {
				lines.push(prefix + valueInline + tail);
				return;
			}
			if (Array.isArray(value)) {
				lines.push(`${prefix}[`);
				value.forEach((entry, i) =>
					lines.push(`\t\t\t${inlineJson(entry) ?? JSON.stringify(entry)}${i === value.length - 1 ? "" : ","}`),
				);
				lines.push(`\t\t]${tail}`);
				return;
			}
			// 友链字段都是扁平结构，走不到这里；留个兜底避免生成非法 JSON
			lines.push(prefix + JSON.stringify(value) + tail);
		});
		lines.push(`\t}${itemTail}`);
	});
	lines.push("]");
	return `${lines.join("\n")}\n`;
}

/** 读列表；文件不存在 / 不是数组都直接报错，不做「猜一个默认值」的兜底 */
export async function readFriends(repoRoot) {
	const abs = path.join(repoRoot, FRIENDS_FILE);
	let text;
	try {
		text = await fs.readFile(abs, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") throw fail(`找不到友链数据文件：${FRIENDS_FILE}`, 500);
		throw error;
	}
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw fail(`${FRIENDS_FILE} 不是合法 JSON：${error?.message ?? error}`, 500);
	}
	if (!Array.isArray(value)) throw fail(`${FRIENDS_FILE} 的内容必须是数组`, 500);
	return value;
}

/**
 * 写列表：快照 → 写入（tab 缩进 / UTF-8 / 末尾换行）→ 读回校验 → 不一致回滚。
 * @returns 快照信息（可能是 null，例如文件全新）
 */
export async function writeFriendsJson(repoRoot, items, snapshotBefore, reason) {
	const abs = path.join(repoRoot, FRIENDS_FILE);
	// 先把「写之前的原文」留在内存里：读回校验失败时要原样写回去，
	// 这比依赖快照目录更可靠（快照可能因为体积上限被跳过）。
	const previous = await fs.readFile(abs, "utf8").catch(() => null);

	let snapshot = null;
	if (snapshotBefore) snapshot = await snapshotBefore(FRIENDS_FILE, reason || "保存友链");

	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, stringifyFriendsJson(items), "utf8");

	try {
		const verified = JSON.parse(await fs.readFile(abs, "utf8"));
		if (!Array.isArray(verified) || verified.length !== items.length) {
			throw new Error(`条数不一致（期望 ${items.length}，读回 ${Array.isArray(verified) ? verified.length : "非数组"}）`);
		}
		for (let i = 0; i < items.length; i++) {
			if (JSON.stringify(verified[i]) !== JSON.stringify(items[i])) {
				throw new Error(`第 ${i + 1} 条内容不一致（${truncate(verified[i]?.title ?? "", 20)}）`);
			}
		}
	} catch (error) {
		if (previous === null) await fs.rm(abs, { force: true }).catch(() => {});
		else await fs.writeFile(abs, previous, "utf8").catch(() => {});
		throw fail(`写入后读回校验失败，已回滚到写入前的版本：${error?.message ?? error}`, 500);
	}

	return snapshot;
}

/** 条目序号校验：必须是 [0, length) 内的整数 */
function requireIndex(value, length) {
	const index = Number(value);
	if (!Number.isInteger(index)) throw new Error(`条目序号必须是整数：${value}`);
	if (index < 0 || index >= length) throw new Error(`条目序号越界：${index}（当前共 ${length} 条）`);
	return index;
}

// ── 路由入口：/api/friends ─────────────────────────────────────────────────

/**
 * GET  → { items: [...] }
 * POST → { action: "add"|"update"|"delete"|"move"|"toggle", ... } 返回 { ok, items, message, backup }
 */
export async function handleFriends({ repoRoot, method = "GET", body, snapshotBefore } = {}) {
	try {
		if (method === "GET") {
			return { status: 200, payload: { items: await readFriends(repoRoot) } };
		}
		if (method !== "POST") {
			return { status: 405, payload: { error: "请用 GET 或 POST 调用 /api/friends" } };
		}

		const action = String(body?.action ?? "").trim();
		const items = await readFriends(repoRoot);
		let next;
		let message;

		switch (action) {
			case "add": {
				if (items.length + 1 > MAX_ITEMS) {
					throw new Error(`友链总数上限 ${MAX_ITEMS} 条（当前 ${items.length} 条），请先删掉一些`);
				}
				const item = sanitizeFriend(body.item);
				next = [...items, item];
				message = `已新增友链「${item.title}」`;
				break;
			}
			case "update": {
				const index = requireIndex(body.index, items.length);
				next = [...items];
				// 局部更新：只覆盖前端真正提交的字段，其余保留
				next[index] = sanitizeFriend({ ...items[index], ...(body.item || {}) });
				message = `已更新友链「${next[index].title}」`;
				break;
			}
			case "delete": {
				const index = requireIndex(body.index, items.length);
				message = `已删除友链「${truncate(items[index]?.title ?? "", 20)}」`;
				next = items.filter((_, i) => i !== index);
				break;
			}
			case "move": {
				const index = requireIndex(body.index, items.length);
				const direction = String(body.direction ?? "").trim();
				if (direction !== "up" && direction !== "down") throw new Error("排序方向只能是 up（上移）或 down（下移）");
				const target = direction === "up" ? index - 1 : index + 1;
				if (target < 0 || target >= items.length) {
					throw new Error(direction === "up" ? "这条已经在最前面了" : "这条已经在最后面了");
				}
				next = [...items];
				[next[index], next[target]] = [next[target], next[index]];
				message = `已${direction === "up" ? "上移" : "下移"}「${truncate(next[target]?.title ?? "", 20)}」`;
				break;
			}
			case "toggle": {
				const index = requireIndex(body.index, items.length);
				next = [...items];
				const enabled = body.enabled === undefined ? !next[index].enabled : body.enabled === true;
				next[index] = sanitizeFriend({ ...next[index], enabled });
				message = `已${next[index].enabled ? "启用" : "停用"}「${truncate(next[index].title, 20)}」`;
				break;
			}
			default:
				throw new Error(
					`不支持的操作：${action || "(空)"}（可选 add / update / delete / move / toggle）`,
				);
		}

		// 改完之后整张表再校验一遍：防止历史遗留的脏数据被顺手写回去
		const sanitized = sanitizeFriends(next);
		const snapshot = await writeFriendsJson(repoRoot, sanitized, snapshotBefore, `友链：${action}`);

		return {
			status: 200,
			payload: {
				ok: true,
				items: sanitized,
				backup: snapshot?.id ?? null,
				message: `${message}；已保存，去「发布」页推送即可上线`,
			},
		};
	} catch (error) {
		return { status: error?.status ?? 400, payload: { ok: false, error: error?.message ?? String(error) } };
	}
}

// ── SSRF 防护 ───────────────────────────────────────────────────────────────
//
// 目标：挡住「面板被诱导去抓本机 / 内网」这类请求（本机可能跑着别的服务）。
// 做法是「尽力而为」的白名单式黑名单，**不是完整的安全边界**，局限见文件末尾说明。

/** 把 "127.1" / "0x7f.0.0.1" / "0177.0.0.1" / "2130706433" 这类写法统一成 32 位整数 */
function parseIPv4Loose(host) {
	const parts = String(host).split(".");
	if (parts.length === 0 || parts.length > 4) return null;
	const nums = [];
	for (const part of parts) {
		let value;
		if (/^0x[0-9a-f]+$/i.test(part)) value = Number.parseInt(part.slice(2), 16);
		else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part.slice(1), 8);
		else if (/^\d+$/.test(part)) value = Number.parseInt(part, 10);
		else return null;
		if (!Number.isFinite(value) || value < 0) return null;
		nums.push(value);
	}
	// inet_aton 规则：最后一段占满剩余的字节（127.1 == 127.0.0.1）
	const last = nums.pop();
	const remaining = 4 - nums.length;
	const maxLast = 256 ** remaining;
	if (last >= maxLast) return null;
	let value = 0;
	for (const n of nums) {
		if (n > 255) return null;
		value = value * 256 + n;
	}
	return (value * maxLast + last) >>> 0;
}

function intToDotted(value) {
	return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

/** 内网 / 保留 / 组播 / 回环等不该被面板访问的 IPv4 段 */
function isPrivateIPv4(value) {
	const a = (value >>> 24) & 255;
	const b = (value >>> 16) & 255;
	if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8、10/8、回环
	if (a === 169 && b === 254) return true; // 链路本地（含云元数据 169.254.169.254）
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
	if (a === 192 && b === 168) return true; // 192.168/16
	if (a === 192 && b === 0) return true; // 192.0.0/24、192.0.2/24（协议保留 / 文档）
	if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 基准测试
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
	if (a >= 224) return true; // 组播 + 保留 + 广播
	return false;
}

/** 把 IPv6 展开成 8 个 16 位数字；解析失败返回 null */
function expandIpv6(input) {
	let text = String(input).toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
	// 内嵌 IPv4（::ffff:127.0.0.1）
	const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
	if (embedded) {
		const value = parseIPv4Loose(embedded[1]);
		if (value === null) return null;
		text = `${text.slice(0, embedded.index)}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	if (halves.length === 1 && head.length !== 8) return null;
	const fill = 8 - head.length - tail.length;
	if (fill < 0) return null;
	const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
	if (groups.length !== 8) return null;
	const out = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
		out.push(Number.parseInt(group, 16));
	}
	return out;
}

/** IPv6 里的本机 / 内网 / 映射地址 */
function isPrivateIpv6(host) {
	const g = expandIpv6(host);
	if (!g) return false;
	const allZero = g.every((n) => n === 0);
	if (allZero) return true; // ::
	if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
	if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地地址
	if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
	if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 组播
	// IPv4 映射 / 兼容（::ffff:127.0.0.1、::127.0.0.1）
	if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) {
		return isPrivateIPv4(((g[6] << 16) | g[7]) >>> 0);
	}
	// 6to4（2002:V4V4::/16）里嵌着 IPv4
	if (g[0] === 0x2002) return isPrivateIPv4(((g[1] << 16) | g[2]) >>> 0);
	return false;
}

/**
 * 主机名是不是「本机 / 内网」。
 * 覆盖：localhost、.local/.internal、IPv4 各种等价写法、IPv6 回环与内网段。
 */
export function isPrivateHostname(rawHost) {
	const host = String(rawHost ?? "").trim().toLowerCase().replace(/\.$/, "");
	if (!host) return true;
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
	if (host.includes(":") || host.startsWith("[")) return isPrivateIpv6(host);
	const v4 = parseIPv4Loose(host);
	if (v4 !== null) return isPrivateIPv4(v4);
	return false;
}

/** 只允许 http / https，且主机不能是本机 / 内网 */
export function validateFetchUrl(rawUrl) {
	const text = String(rawUrl ?? "").trim();
	if (!text) throw new Error("请填写要抓取的网址");
	let parsed;
	try {
		parsed = new URL(text);
	} catch {
		throw new Error(`网址不合法：${truncate(text, 80)}（要带 http:// 或 https://）`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`只允许抓取 http / https 网址（收到 ${parsed.protocol}）`);
	}
	if (isPrivateHostname(parsed.hostname)) {
		throw new Error(`出于安全考虑，不允许抓取本机 / 内网地址：${parsed.hostname}`);
	}
	return parsed;
}

/**
 * 额外做一次 DNS 解析，挡住「公网域名解析到 127.0.0.1」这种绕过。
 * 说明：这里到真正发起请求之间仍存在 DNS 重绑定窗口，属于「尽力而为」的加固。
 */
async function assertPublicAddress(hostname) {
	if (isPrivateHostname(hostname)) {
		throw new Error(`出于安全考虑，不允许访问本机 / 内网地址：${hostname}`);
	}
	const isLiteral = parseIPv4Loose(hostname) !== null || expandIpv6(hostname) !== null;
	if (isLiteral) return;
	let records;
	try {
		records = await dns.lookup(hostname, { all: true });
	} catch (error) {
		throw new Error(`域名解析失败：${hostname}（${error?.code || error?.message || error}）`);
	}
	const bad = records.find((record) => isPrivateHostname(record.address));
	if (bad) throw new Error(`域名 ${hostname} 解析到了内网地址 ${bad.address}，已拒绝访问`);
}

// ── 抓取（联网）─────────────────────────────────────────────────────────────

async function drain(res) {
	try {
		await res.body?.cancel();
	} catch {
		// 忽略：只是把没读完的响应体丢掉
	}
}

/** 按上限读响应体，超限直接放弃（防止把内存吃满） */
async function readCapped(res, max) {
	const chunks = [];
	let size = 0;
	for await (const chunk of res.body) {
		size += chunk.length;
		if (size > max) {
			await drain(res);
			throw new Error(`页面太大（超过 ${Math.round(max / 1024 / 1024)} MB），已停止抓取`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/**
 * 抓一个网页：手动跟随重定向（每一跳都重新做 SSRF 检查），15 秒超时，3 MB 上限。
 * @returns { url: URL, contentType: string, buffer: Buffer, warnings: string[] }
 */
export async function fetchPage(startUrl) {
	let current = startUrl;
	const warnings = [];
	for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
		await assertPublicAddress(current.hostname);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			let res;
			try {
				res = await fetch(current, {
					redirect: "manual",
					signal: controller.signal,
					headers: {
						"user-agent": BROWSER_UA,
						accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
						"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
					},
				});
			} catch (error) {
				const code = error?.cause?.code || error?.code || "";
				if (error?.name === "AbortError" || error?.name === "TimeoutError") {
					throw new Error(`抓取超时（${FETCH_TIMEOUT_MS / 1000} 秒无响应）：${current.href}`);
				}
				throw new Error(`抓取失败：${code || error?.message || error}`);
			}

			// 重定向：只认 Location，下一跳重新过一遍守卫
			if (res.status >= 300 && res.status < 400) {
				const location = res.headers.get("location");
				await drain(res);
				if (!location) throw new Error(`对方返回 ${res.status} 跳转但没有 Location 头`);
				let next;
				try {
					next = new URL(location, current);
				} catch {
					throw new Error(`跳转地址不合法：${truncate(location, 80)}`);
				}
				if (next.protocol !== "http:" && next.protocol !== "https:") {
					throw new Error(`跳转到了不允许的协议：${next.protocol}`);
				}
				if (isPrivateHostname(next.hostname)) {
					throw new Error(`跳转指向本机 / 内网地址，已拒绝：${next.hostname}`);
				}
				warnings.push(`页面发生跳转（${res.status}），最终地址：${next.href}`);
				current = next;
				continue;
			}

			if (!res.ok) {
				await drain(res);
				throw new Error(`对方返回 HTTP ${res.status}`);
			}

			const contentType = res.headers.get("content-type") || "";
			const buffer = await readCapped(res, FETCH_MAX_BYTES);
			return { url: current, contentType, buffer, warnings };
		} finally {
			clearTimeout(timer);
		}
	}
	throw new Error(`跳转次数过多（超过 ${FETCH_MAX_REDIRECTS} 次），已放弃`);
}

// ── 解码 ────────────────────────────────────────────────────────────────────

// 常见 charset 别名 → TextDecoder 认识的标签。
// gb2312 是 gbk 的子集，直接用 gbk 解码更稳；gb18030 是超集，单独保留。
const CHARSET_ALIASES = {
	gb2312: "gbk",
	"gb2312-80": "gbk",
	gbk: "gbk",
	"x-gbk": "gbk",
	cp936: "gbk",
	ms936: "gbk",
	gb18030: "gb18030",
	big5: "big5",
	big5hkscs: "big5",
	"big5-hkscs": "big5",
	utf8: "utf-8",
	"utf-8": "utf-8",
	"utf-8-sig": "utf-8",
	ascii: "utf-8",
	"us-ascii": "utf-8",
	latin1: "windows-1252",
	"iso-8859-1": "windows-1252",
	"iso8859-1": "windows-1252",
	"windows-1252": "windows-1252",
	"iso-8859-15": "iso-8859-15",
	sjis: "shift_jis",
	shift_jis: "shift_jis",
	"shift-jis": "shift_jis",
	"euc-jp": "euc-jp",
	eucjp: "euc-jp",
	"euc-kr": "euc-kr",
	euckr: "euc-kr",
};

function normalizeCharset(label) {
	const text = String(label ?? "").trim().toLowerCase().replace(/^["']|["']$/g, "");
	return CHARSET_ALIASES[text] ?? text;
}

/**
 * 按网页自己声明的 charset 判断编码。
 * 顺序：<meta charset> → <meta http-equiv content="…charset=…"> → HTTP 头 → utf-8。
 * 只看开头 4KB：中文站的声明一般都在 <head> 最前面，也避免把正文里的假 meta 当真。
 */
export function detectCharset(buffer, contentTypeHeader = "") {
	const head = buffer.subarray(0, 4096).toString("latin1");
	const metaCharset = /<meta[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9_\-:.]+)/i.exec(head);
	if (metaCharset) return normalizeCharset(metaCharset[1]);
	const httpEquiv = /<meta[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_\-:.]+)/i.exec(head);
	if (httpEquiv) return normalizeCharset(httpEquiv[1]);
	const fromHeader = /charset\s*=\s*["']?\s*([a-z0-9_\-:.]+)/i.exec(String(contentTypeHeader || ""));
	if (fromHeader) return normalizeCharset(fromHeader[1]);
	return "utf-8";
}

/**
 * 按网页声明的编码解码成字符串。
 * 不按声明解码，中文站（gb2312/gbk/gb18030）会整页乱码。
 */
export function decodeHtml(buffer, contentTypeHeader = "") {
	const declared = detectCharset(buffer, contentTypeHeader);
	for (const label of [declared, "utf-8"]) {
		try {
			return { text: new TextDecoder(label).decode(buffer), charset: label };
		} catch {
			// 不认识的编码名 → 退回 utf-8 再试
		}
	}
	return { text: buffer.toString("utf8"), charset: "utf-8" };
}

// 常见命名实体（HTML4 全集里挑了实际会用到的）
const NAMED_ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
	iexcl: "¡",
	cent: "¢",
	pound: "£",
	curren: "¤",
	yen: "¥",
	brvbar: "¦",
	sect: "§",
	uml: "¨",
	copy: "©",
	ordf: "ª",
	laquo: "«",
	not: "¬",
	shy: "\u00ad",
	reg: "®",
	macr: "¯",
	deg: "°",
	plusmn: "±",
	sup2: "²",
	sup3: "³",
	acute: "´",
	micro: "µ",
	para: "¶",
	middot: "·",
	cedil: "¸",
	sup1: "¹",
	ordm: "º",
	raquo: "»",
	frac14: "¼",
	frac12: "½",
	frac34: "¾",
	iquest: "¿",
	times: "×",
	divide: "÷",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	sbquo: "‚",
	ldquo: "“",
	rdquo: "”",
	bdquo: "„",
	dagger: "†",
	Dagger: "‡",
	bull: "•",
	hellip: "…",
	permil: "‰",
	prime: "′",
	Prime: "″",
	lsaquo: "‹",
	rsaquo: "›",
	oline: "‾",
	frasl: "⁄",
	euro: "€",
	trade: "™",
	larr: "←",
	uarr: "↑",
	rarr: "→",
	darr: "↓",
	harr: "↔",
	crarr: "↵",
	lArr: "⇐",
	uArr: "⇑",
	rArr: "⇒",
	dArr: "⇓",
	hArr: "⇔",
	forall: "∀",
	part: "∂",
	exist: "∃",
	empty: "∅",
	nabla: "∇",
	isin: "∈",
	notin: "∉",
	ni: "∋",
	prod: "∏",
	sum: "∑",
	minus: "−",
	lowast: "∗",
	radic: "√",
	prop: "∝",
	infin: "∞",
	ang: "∠",
	and: "∧",
	or: "∨",
	cap: "∩",
	cup: "∪",
	int: "∫",
	there4: "∴",
	sim: "∼",
	cong: "≅",
	asymp: "≈",
	ne: "≠",
	equiv: "≡",
	le: "≤",
	ge: "≥",
	sub: "⊂",
	sup: "⊃",
	nsub: "⊄",
	sube: "⊆",
	supe: "⊇",
	oplus: "⊕",
	otimes: "⊗",
	perp: "⊥",
	sdot: "⋅",
	lceil: "⌈",
	rceil: "⌉",
	lfloor: "⌊",
	rfloor: "⌋",
	lang: "〈",
	rang: "〉",
	loz: "◊",
	spades: "♠",
	clubs: "♣",
	hearts: "♥",
	diams: "♦",
	ensp: "\u2002",
	emsp: "\u2003",
	thinsp: "\u2009",
	zwnj: "\u200c",
	zwj: "\u200d",
	lrm: "\u200e",
	rlm: "\u200f",
	OElig: "Œ",
	oelig: "œ",
	Scaron: "Š",
	scaron: "š",
	Yuml: "Ÿ",
	circ: "ˆ",
	tilde: "˜",
};

function codePointToChar(code) {
	if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
	if (code >= 0xd800 && code <= 0xdfff) return "";
	return String.fromCodePoint(code);
}

/** 解 HTML 实体：`&amp;`、数字实体 `&#12345;`、十六进制 `&#x1F600;` 都支持 */
export function decodeHtmlEntities(input) {
	if (!input) return "";
	return String(input)
		.replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, hex) => codePointToChar(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);?/g, (_, dec) => codePointToChar(Number.parseInt(dec, 10)))
		.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, name) =>
			Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match,
		);
}

// ── HTML 解析 ───────────────────────────────────────────────────────────────

/** 解析标签里的属性（属性顺序无所谓，这正是「content 在 name 前面」也能认出来的原因） */
function parseAttributes(tag) {
	const attrs = {};
	const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
	let match;
	while ((match = re.exec(tag)) !== null) {
		attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
	}
	return attrs;
}

/** 收集所有 <meta>：property / name 两种写法都收，同名以第一条为准 */
function collectMeta(html) {
	const map = new Map();
	for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
		const attrs = parseAttributes(tag);
		if (attrs.content === undefined) continue;
		for (const key of [attrs.property, attrs.name]) {
			if (!key) continue;
			const lower = key.toLowerCase();
			if (!map.has(lower)) map.set(lower, attrs.content);
		}
	}
	return map;
}

/** 形如 site.seo.description / {{ x }} / ${x} 的未渲染模板变量 */
const TEMPLATE_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){1,5}$/;
const TEMPLATE_KEYWORDS = new Set([
	"title", "description", "desc", "keywords", "keyword", "name", "url", "link", "image", "img",
	"icon", "content", "summary", "seo", "site", "page", "post", "config", "text", "excerpt",
	"abstract", "og", "twitter", "meta", "data", "props", "item", "locale", "lang", "author",
]);

/** 判断一段文本是不是「模板还没渲染」的占位符 */
export function isTemplateValue(text) {
	const value = String(text ?? "").trim();
	if (!value) return false;
	if (/\{\{[^}]*\}\}|\$\{[^}]*\}|<%[^%]*%>|\{%[^%]*%\}/.test(value)) return true;
	if (!TEMPLATE_PATH_RE.test(value)) return false;
	const segments = value.split(".");
	// 3 段以上基本可以断定是模板路径；2 段则要求末段是常见的模板字段名，
	// 这样 astro.build / node.js 这类正常文本不会被误杀。
	if (segments.length >= 3) return true;
	return TEMPLATE_KEYWORDS.has(segments[segments.length - 1].toLowerCase());
}

// 防爬 / 人机验证页的标题特征：这些不是站名，别当标题存进配置
const BLOCKED_PAGE_PATTERNS = [
	/verify yourself/i,
	/checking your browser/i,
	/just a moment/i,
	/attention required/i,
	/enable javascript and cookies/i,
	/please wait while we verify/i,
	/ddos protection by/i,
	/please turn javascript on/i,
	/one more step/i,
	/are you a human/i,
];

/** 是不是防爬 / 人机验证页的文案 */
export function isBlockedPageText(text) {
	const value = String(text ?? "");
	return BLOCKED_PAGE_PATTERNS.some((re) => re.test(value));
}

function cleanText(raw) {
	return decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
}

/** 从候选里挑第一个「能用」的文本，用不了的原因写进 warnings */
function pickText(candidates, label, warnings) {
	for (const raw of candidates) {
		const text = cleanText(raw);
		if (!text) continue;
		if (isTemplateValue(text)) {
			warnings.push(`页面里的${label}是未渲染的模板变量（${truncate(text, 40)}），已忽略，请手动填写`);
			continue;
		}
		if (isBlockedPageText(text)) {
			warnings.push(`页面返回的是防爬 / 验证页（${truncate(text, 40)}），没有可用的${label}，请手动填写`);
			continue;
		}
		return text;
	}
	return "";
}

/** 相对路径按最终 URL 解析成绝对地址；非 http(s) 一律丢弃 */
function resolveAssetUrl(href, base) {
	const text = String(href ?? "").trim();
	if (!text) return "";
	try {
		const url = new URL(text, base);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		return url.href;
	} catch {
		return "";
	}
}

/**
 * 图标候选顺序：apple-touch-icon → link[rel~=icon] → og:image
 * meta 必须由调用方（本次请求的 parseFriendPage）显式传进来：
 * 之前用的是模块级缓存，两个并发的 /api/friends-fetch 会互相覆盖，
 * 后果是 A 站点拿到 B 站点的 og:image（图标张冠李戴）。
 */
function extractIconUrl(html, base, meta) {
	const links = [];
	for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
		const attrs = parseAttributes(tag);
		if (!attrs.href) continue;
		links.push({
			rel: String(attrs.rel || "").toLowerCase().split(/\s+/).filter(Boolean),
			href: attrs.href,
			type: String(attrs.type || ""),
		});
	}
	const apple = links.find(
		(link) => link.rel.includes("apple-touch-icon") || link.rel.includes("apple-touch-icon-precomposed"),
	);
	if (apple) return resolveAssetUrl(apple.href, base);

	const icons = links.filter((link) => link.rel.includes("icon"));
	if (icons.length > 0) {
		// 有多个时优先 svg / png（比 .ico 清晰），否则用第一个
		const preferred =
			icons.find((link) => /svg|png/i.test(link.type) || /\.svg|\.png/i.test(link.href)) || icons[0];
		return resolveAssetUrl(preferred.href, base);
	}

	const ogImage = meta.get("og:image") || meta.get("og:image:url") || meta.get("og:image:secure_url");
	return ogImage ? resolveAssetUrl(ogImage, base) : "";
}

/** 去掉 script/style 后的可见文本长度，用来判断「是不是 JS 动态渲染的空壳页」 */
function visibleTextLength(html) {
	return html
		.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&[a-zA-Z#0-9]+;/g, " ")
		.replace(/\s+/g, " ")
		.trim().length;
}

/**
 * 解析一个友链候选页：标题、简介、图标。
 * 纯函数、不联网，方便用本地 fixture 做测试。
 * @returns { title, desc, iconUrl, warnings }
 */
export function parseFriendPage(html, baseUrl) {
	const warnings = [];
	const source = String(html ?? "");
	// 先去注释与脚本/样式：否则 JS 里的字符串会被当成正文，甚至影响「正文很短」的判断
	const cleaned = source
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

	// 本次解析独立的 meta 表：不能放在模块级，否则并发的两次 /api/friends-fetch 会互相串
	const meta = collectMeta(cleaned);
	const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned);

	// 标题：og:title → <title>
	const title = pickText(
		[meta.get("og:title"), meta.get("twitter:title"), titleTag?.[1]],
		"标题",
		warnings,
	);
	// 简介：og:description → meta[name=description] → twitter:description
	const desc = pickText(
		[
			meta.get("og:description"),
			meta.get("description"),
			meta.get("twitter:description"),
		],
		"简介",
		warnings,
	);

	const base = baseUrl ? new URL(baseUrl) : undefined;
	const iconUrl = extractIconUrl(cleaned, base, meta);

	const textLength = visibleTextLength(cleaned);
	const looksBlocked = isBlockedPageText(title) || isBlockedPageText(meta.get("og:title") || "");
	if (!desc && (textLength < 200 || looksBlocked)) {
		warnings.push("页面没有可用的静态介绍（正文很短，可能是 JS 动态渲染或防爬页），请手动填写简介");
	}
	if (!title) warnings.push("页面没有可用的静态标题，请手动填写站名");
	if (!iconUrl) {
		warnings.push("没有在页面里找到图标（apple-touch-icon / link icon / og:image 都没有），请手动填写头像");
	}

	return { title, desc, iconUrl, warnings };
}

// ── 图标落盘 ────────────────────────────────────────────────────────────────

/**
 * 按**文件头字节**判断真实图片类型（绝不只看扩展名）。
 * @returns { ext, mime } 或 null
 */
export function sniffImageType(buffer) {
	if (!buffer || buffer.length < 4) return null;
	const b = buffer;
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
	const magic6 = b.subarray(0, 6).toString("latin1");
	if (magic6 === "GIF87a" || magic6 === "GIF89a") return { ext: "gif", mime: "image/gif" };
	if (
		b.length >= 12 &&
		b.subarray(0, 4).toString("latin1") === "RIFF" &&
		b.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return { ext: "webp", mime: "image/webp" };
	}
	if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return { ext: "ico", mime: "image/x-icon" };
	if (looksLikeSvg(buffer)) return { ext: "svg", mime: "image/svg+xml" };
	return null;
}

/** SVG 是文本格式，没有魔数：跳过 BOM / XML 声明 / 注释 / DOCTYPE 后必须直接是 <svg */
function looksLikeSvg(buffer) {
	let head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
	for (let i = 0; i < 4; i++) {
		const before = head;
		head = head.replace(/^<\?xml[\s\S]*?\?>\s*/i, "");
		head = head.replace(/^<!--[\s\S]*?-->\s*/, "");
		head = head.replace(/^<!DOCTYPE[^>]*>\s*/i, "");
		if (head === before) break;
	}
	return /^<svg[\s>]/i.test(head);
}

/** 域名 → 文件名 slug（`www.bdgroup-lab.com` → `bdgroup-lab-com`，与现有图标命名一致） */
export function hostSlug(hostname) {
	const text = String(hostname ?? "")
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/:\d+$/, "")
		.replace(/^www\./, "");
	const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
	return slug || "site";
}

/**
 * 把图标字节存到 `public/friends/<域名slug>-<N>.<ext>`。
 * 文件名里的 N 从 1 开始找空位；**绝不覆盖已有文件**（写入用 wx 标志，并发下也不会盖掉别人）。
 */
export async function storeIcon(repoRoot, buffer, hostname) {
	const type = sniffImageType(buffer);
	if (!type) throw new Error("抓到的不是真实图片（按文件头判断不是 png / jpeg / gif / webp / ico / svg）");
	if (buffer.length < ICON_MIN_BYTES) {
		throw new Error(`图标太小（${buffer.length} 字节，至少要 ${ICON_MIN_BYTES} 字节）`);
	}
	if (buffer.length > ICON_MAX_BYTES) {
		throw new Error(`图标太大（${Math.round(buffer.length / 1024)} KB，上限 ${ICON_MAX_BYTES / 1024} KB）`);
	}

	const dir = path.join(repoRoot, FRIENDS_PUBLIC_DIR);
	await fs.mkdir(dir, { recursive: true });
	const slug = hostSlug(hostname);
	const used = new Set();
	const pattern = new RegExp(`^${escapeRegExp(slug)}-(\\d+)\\.[a-z0-9]+$`, "i");
	for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const match = pattern.exec(entry.name);
		if (match) used.add(Number(match[1]));
	}

	for (let n = 1; n <= 999; n++) {
		if (used.has(n)) continue;
		const name = `${slug}-${n}.${type.ext}`;
		const target = path.join(dir, name);
		try {
			// wx = 文件已存在就报错，绝不覆盖
			await fs.writeFile(target, buffer, { flag: "wx" });
		} catch (error) {
			if (error?.code === "EEXIST") continue;
			throw error;
		}
		return { path: `/friends/${name}`, name, bytes: buffer.length, ext: type.ext, mime: type.mime };
	}
	throw new Error(`同名图标太多（${slug}-1 … ${slug}-999 都被占用了），请先清理 public/friends/`);
}

/**
 * 下载图标（同样过一遍 SSRF 守卫，因为图标常挂在 CDN 上、主机可能与页面不同）。
 *
 * 为什么**不用** fetch 的 `redirect:"follow"`：
 *   跟随重定向意味着那一发请求**已经打到**最终主机上了，事后拿 res.url 再看一眼只能把响应丢掉，
 *   挡不住已经发生的 SSRF（内网服务已经收到请求、可能已经产生副作用）。
 *   改成手动跟随（`redirect:"manual"`）：每一跳都先校验 Location 的协议与主机，再决定要不要请求。
 */
async function downloadIcon(repoRoot, iconUrl, pageUrl) {
	const requested = validateFetchUrl(iconUrl);
	await assertPublicAddress(requested.hostname);
	let current = requested;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
			let res;
			try {
				res = await fetch(current, {
					redirect: "manual",
					signal: controller.signal,
					headers: {
						"user-agent": BROWSER_UA,
						accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
						referer: pageUrl.href,
					},
				});
			} catch (error) {
				if (error?.name === "AbortError" || error?.name === "TimeoutError") {
					throw new Error(`图标下载超时（${FETCH_TIMEOUT_MS / 1000} 秒）`);
				}
				throw new Error(`图标下载失败：${error?.cause?.code || error?.message || error}`);
			}

			// 跳转：先校验，再请求下一跳（校验不通过就直接断在这里）
			if (res.status >= 300 && res.status < 400) {
				const location = res.headers.get("location");
				await drain(res);
				if (!location) throw new Error(`图标地址返回 ${res.status} 跳转但没有 Location 头`);
				let next;
				try {
					next = new URL(location, current);
				} catch {
					throw new Error(`图标跳转地址不合法：${truncate(location, 80)}`);
				}
				if (next.protocol !== "http:" && next.protocol !== "https:") {
					throw new Error(`图标跳转到了不允许的协议：${next.protocol}`);
				}
				if (isPrivateHostname(next.hostname)) {
					throw new Error(`图标跳转到了内网地址：${next.hostname}，已拒绝下载`);
				}
				// 每一跳都重新解析一次域名（防「公网域名解析到内网」这类绕过）
				await assertPublicAddress(next.hostname);
				current = next;
				continue;
			}

			if (!res.ok) {
				await drain(res);
				throw new Error(`图标地址返回 HTTP ${res.status}`);
			}
			const buffer = await readCapped(res, ICON_MAX_BYTES + 1);
			// 文件名仍然按「页面里写的那个图标主机」取，跟随 CDN 跳转后命名保持一致
			return await storeIcon(repoRoot, buffer, requested.hostname);
		}
		throw new Error(`图标跳转次数过多（超过 ${FETCH_MAX_REDIRECTS} 次），已放弃`);
	} finally {
		clearTimeout(timer);
	}
}

// ── 路由入口：/api/friends-fetch ──────────────────────────────────────────

/**
 * POST { url } → { ok, url, title, desc, iconUrl, iconPath, warnings }
 * 只做「抓取 + 落盘图标 + 给建议」，不写 friends.json —— 必须由人在表单里确认后再保存。
 */
export async function handleFriendsFetch({ repoRoot, body } = {}) {
	let parsed;
	try {
		parsed = validateFetchUrl(body?.url);
	} catch (error) {
		return { status: error?.status ?? 400, payload: { ok: false, error: error?.message ?? String(error), warnings: [] } };
	}

	let page;
	try {
		page = await fetchPage(parsed);
	} catch (error) {
		return { status: 502, payload: { ok: false, error: error?.message ?? String(error), warnings: [] } };
	}

	// 关键：按网页自己声明的编码解码，否则中文站（gb2312/gbk/gb18030）整页乱码
	const { text: html, charset } = decodeHtml(page.buffer, page.contentType);
	const result = parseFriendPage(html, page.url.href);
	const warnings = [...page.warnings, ...result.warnings];
	if (charset !== "utf-8") warnings.push(`页面声明编码为 ${charset}，已按该编码解码`);

	let iconPath = "";
	if (result.iconUrl) {
		try {
			const stored = await downloadIcon(repoRoot, result.iconUrl, page.url);
			iconPath = stored.path;
		} catch (error) {
			warnings.push(`图标没能落盘（${error?.message ?? error}），头像暂时填图标网址，也可以手动改成站内路径`);
		}
	}

	return {
		status: 200,
		payload: {
			ok: true,
			url: page.url.href,
			charset,
			title: result.title,
			desc: result.desc,
			iconUrl: result.iconUrl,
			iconPath,
			warnings,
		},
	};
}

/**
 * 已知局限（写在这里是因为它们决定了这个模块「能防到什么程度」）：
 * 1. 只做「主机名 + DNS 解析结果」的判断，不是完整的安全边界；
 *    我们到真正发请求之间仍存在 DNS 重绑定（TOCTOU）窗口。
 * 2. 不检查目标端口以外的服务语义（例如公网地址上的 6379 端口）。
 * 3. 不做 IPv6 完整前缀表，只覆盖回环 / 唯一本地 / 链路本地 / 组播 / 映射地址。
 * 4. 不跟随 meta refresh / JS 跳转（只认 HTTP 3xx Location）。
 */
