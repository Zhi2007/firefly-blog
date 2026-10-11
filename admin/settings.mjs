/**
 * 面板可编辑的站点设置（白名单 + 安全写入）
 *
 * 为什么不用"直接改 TS 源码"：TS 文件改坏会直接导致构建失败。
 * 这里的做法是：
 *   1. 只允许修改 SETTINGS_DEFS 白名单里的字段，类型/范围/枚举都校验
 *   2. 每次写入前先把原文件快照到 admin-backups/（可一键恢复）
 *   3. 写完后**回读校验**：把刚写的值再解析一遍，和目标不一致就立刻回滚并报错
 *
 * 这样即使正则匹配到了意料之外的位置，也不会留下坏文件。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 字段定义：
 *   id      面板用的键（如 "site.title"）
 *   file    相对仓库根目录的文件
 *   key     文件里的字段名
 *   type    string | number | boolean | enum
 *   within  可选：字段所在的嵌套块名（如 themeColor / pages）
 *   label   面板显示名
 */
export const SETTINGS_DEFS = [
	{ id: "site.title", file: "src/config/siteConfig.ts", key: "title", type: "string", label: "站点标题" },
	{ id: "site.subtitle", file: "src/config/siteConfig.ts", key: "subtitle", type: "string", label: "站点副标题" },
	{ id: "site.description", file: "src/config/siteConfig.ts", key: "description", type: "string", label: "站点描述（SEO / OG）" },
	{ id: "site.keywords", file: "src/config/siteConfig.ts", key: "keywords", type: "stringlist", label: "关键词（逗号分隔，会写成数组）" },
	{ id: "site.site_url", file: "src/config/siteConfig.ts", key: "site_url", type: "string", label: "站点 URL（主域）" },
	{ id: "site.startDate", file: "src/config/siteConfig.ts", key: "siteStartDate", type: "string", label: "建站日期（时间进度用）" },
	{ id: "site.pageWidth", file: "src/config/siteConfig.ts", key: "pageWidth", type: "number", min: 50, max: 200, label: "页面宽度（rem，50-200）" },
	{ id: "site.contentWidth", file: "src/config/siteConfig.ts", key: "contentWidth", type: "number", min: 600, max: 2400, label: "主内容区最大宽度（px，≥1280px 屏幕生效）" },
	{ id: "site.contentWidthVw", file: "src/config/siteConfig.ts", key: "contentWidthVw", type: "number", min: 60, max: 100, label: "主内容区占屏比例（%，自适应屏宽）" },
	{ id: "navbar.title", file: "src/config/siteConfig.ts", key: "title", within: "navbar", type: "string", label: "导航栏标题" },
	{ id: "theme.hue", file: "src/config/siteConfig.ts", key: "hue", within: "themeColor", type: "number", min: 0, max: 360, label: "主题色相（0-360）" },
	{ id: "theme.defaultMode", file: "src/config/siteConfig.ts", key: "defaultMode", within: "themeColor", type: "enum", values: ["light", "dark", "system"], label: "默认明暗模式" },
	{ id: "card.border", file: "src/config/siteConfig.ts", key: "border", within: "card", type: "boolean", label: "卡片边框与阴影" },
	{ id: "card.followTheme", file: "src/config/siteConfig.ts", key: "followTheme", within: "card", type: "boolean", label: "卡片风格跟随主题色" },
	{ id: "profile.name", file: "src/config/profileConfig.ts", key: "name", type: "string", label: "博主名字" },
	{ id: "profile.bio", file: "src/config/profileConfig.ts", key: "bio", type: "string", label: "个人签名" },
	{ id: "profile.avatar", file: "src/config/profileConfig.ts", key: "avatar", type: "string", label: "头像路径" },
	{ id: "wallpaper.mode", file: "src/config/backgroundWallpaper.ts", key: "mode", type: "enum", values: ["banner", "fullscreen", "overlay", "none"], label: "壁纸模式" },
	{ id: "wallpaper.dimOpacity", file: "src/config/backgroundWallpaper.ts", key: "dimOpacity", within: "common", type: "number", min: 0, max: 1, label: "壁纸遮罩暗度（0-1）" },
	{ id: "wallpaper.title", file: "src/config/backgroundWallpaper.ts", key: "title", within: "homeText", type: "string", label: "主页横幅主标题" },
	{
		id: "banner.subtitles",
		file: "src/config/backgroundWallpaper.ts",
		key: "subtitle",
		within: "homeText",
		type: "stringlist",
		label: "首页横幅副标题（每行一条）",
	},
	{ id: "display.enable", file: "src/config/displaySettingsConfig.ts", key: "enable", type: "boolean", label: "显示设置面板（🎨 按钮；整个关掉最省资源）" },
	{ id: "display.wallpaperModeSwitchable", file: "src/config/displaySettingsConfig.ts", key: "wallpaperModeSwitchable", type: "boolean", label: "允许访客切换壁纸模式（开启会让每页多约 33KB JS）" },
	{ id: "display.themeColorSwitchable", file: "src/config/displaySettingsConfig.ts", key: "themeColorSwitchable", type: "boolean", label: "允许访客切换主题色" },
	{ id: "display.sakuraSwitchable", file: "src/config/displaySettingsConfig.ts", key: "sakuraSwitchable", type: "boolean", label: "允许访客切换樱花特效" },

	// ── 性能相关：关掉最耗 GPU 的特效（作者实测核显占用高时优先调这些） ──────────
	// 注意：这里只能写 spineModelConfig。pioConfig.ts 的 live2dWidgetConfig 块用当前 findBlock 够不到
		// （正则 \b[^{}]*?\{ 会跨行匹配到过宽区间，写入器因"块内有 2 处 enable"而拒绝），
		// 早先误标成 perf.live2d 的开关其实读写的是 spineModelConfig，故按其真实语义如实命名。
		{ id: "perf.spine", file: "src/config/pioConfig.ts", key: "enable", within: "spineModelConfig", type: "boolean", label: "性能 · Spine 看板娘（pioConfig.ts 的 spineModelConfig.enable）" },
	{ id: "perf.wavesDesktop", file: "src/config/backgroundWallpaper.ts", key: "desktop", within: ["waves", "enable"], type: "boolean", label: "性能 · 水波纹动画（桌面端，主题注明会影响性能）" },
	{ id: "perf.wavesMobile", file: "src/config/backgroundWallpaper.ts", key: "mobile", within: ["waves", "enable"], type: "boolean", label: "性能 · 水波纹动画（移动端）" },
	{ id: "perf.gradientDesktop", file: "src/config/backgroundWallpaper.ts", key: "desktop", within: ["gradient", "enable"], type: "boolean", label: "性能 · 底部渐变过渡（桌面端，纯 CSS 开销小）" },
	{ id: "perf.gradientMobile", file: "src/config/backgroundWallpaper.ts", key: "mobile", within: ["gradient", "enable"], type: "boolean", label: "性能 · 底部渐变过渡（移动端）" },
	{ id: "perf.blurRampDesktop", file: "src/config/backgroundWallpaper.ts", key: "desktop", within: "blurRamp", type: "boolean", label: "性能 · 全屏模糊渐变（桌面端，整屏模糊很耗 GPU）" },
	{ id: "perf.blurRampMobile", file: "src/config/backgroundWallpaper.ts", key: "mobile", within: "blurRamp", type: "boolean", label: "性能 · 全屏模糊渐变（移动端）" },
	{ id: "perf.carousel", file: "src/config/backgroundWallpaper.ts", key: "enable", within: "carousel", type: "boolean", label: "性能 · 壁纸轮播（会周期性切换整屏大图）" },
];

/** 页面开关（siteConfig 顶部 resolvePageToggles({...})），键从文件里动态读出，保持与主题同步 */
export const PAGE_PREFIX = "pages.";
/** 页面开关写在哪个文件的哪个块里（面板要靠它显示「这一项会被写进哪里」） */
export const PAGE_FILE = "src/config/siteConfig.ts";
export const PAGE_BLOCK = "resolvePageToggles";

const STRING_RE = /^"(?:[^"\\]|\\.)*"$/;

/** 字符串字面量（支持转义字符） */
const STRING_ALT = `"(?:[^"\\\\]|\\\\.)*"`;

/**
 * 数组字面量，允许跨行。
 * 为什么不用 `\[[^\]]*\]`：主题里 homeText.subtitle 是**每行一个字符串的多行数组**，
 * 单行正则完全匹配不到，面板就永远读不出、也写不进。
 * 为什么不用 `\[[\s\S]*?\]`：只要数组里某个字符串本身带 `]`（例如 "结尾 ] 这样"），
 * 惰性匹配会提前收口，截出半截字面量。
 * 这里的负字符类排除了 `]` `"` `\`，所以 `]` 只可能作为数组结尾被消费 ——
 * 天然只会匹配到**最近的一个闭合方括号**，落在字符串里的 `]` 会被字符串分支吃掉。
 */
const ARRAY_ALT = `\\[(?:[^\\]"\\\\]|\\\\.|${STRING_ALT})*\\]`;

const LITERAL_ALT = `(${STRING_ALT}|-?\\d+(?:\\.\\d+)?|true|false|${ARRAY_ALT})`;

function escapeForTs(value) {
	return JSON.stringify(String(value));
}

function literalFor(def, value) {
	switch (def.type) {
		case "string":
			if (typeof value !== "string") throw new Error(`${def.label} 必须是字符串`);
			if (value.length > 2000) throw new Error(`${def.label} 太长（上限 2000 字符）`);
			return escapeForTs(value);
		case "stringlist": {
			// 面板有两种输入形态，这里都要能吃下：
			//   1. 多行文本域（含换行）→ 每行一条。这时**不按逗号切**，
			//      否则「代码、音乐，还有一点生活」这种文案里的「，」会被当成分隔符切碎。
			//   2. 单行输入框（无换行）→ 沿用原来的逗号分隔（中英文逗号都算）。
			const raw = Array.isArray(value) ? null : String(value ?? "");
			const parts = raw === null
				? value
				: /[\r\n]/.test(raw)
					? raw.split(/[\r\n]+/)
					: raw.split(/[,，]/);
			const list = parts.map((v) => String(v).trim()).filter(Boolean);
			if (list.length === 0) throw new Error(`${def.label} 不能为空`);
			if (list.length > 30) throw new Error(`${def.label} 最多 30 项`);
			for (const item of list) {
				if (item.length > 60) throw new Error(`${def.label} 里单项过长：${item.slice(0, 20)}…`);
			}
			return JSON.stringify(list);
		}
		case "number": {
			const num = Number(value);
			if (!Number.isFinite(num)) throw new Error(`${def.label} 必须是数字`);
			if (def.min !== undefined && num < def.min) throw new Error(`${def.label} 不能小于 ${def.min}`);
			if (def.max !== undefined && num > def.max) throw new Error(`${def.label} 不能大于 ${def.max}`);
			return String(num);
		}
		case "boolean":
			if (typeof value === "boolean") return String(value);
			if (value === "true" || value === "false") return value;
			throw new Error(`${def.label} 必须是 true / false`);
		case "enum": {
			if (!def.values.includes(value)) {
				throw new Error(`${def.label} 只能是：${def.values.join(" / ")}`);
			}
			return escapeForTs(value);
		}
		default:
			throw new Error(`未知字段类型：${def.type}`);
	}
}

/**
 * 找到配置块，返回 [start, end]（含首尾花括号）。
 * blockPath 可以是单个块名，也可以是**路径数组**（如 ["fullscreen","blurRamp","enable"]），
 * 逐层深入后返回最内层块的坐标（相对最初传入的文本），这样 within 就能定位深层嵌套字段。
 */
function findBlock(text, blockPath) {
	const names = Array.isArray(blockPath) ? blockPath : [blockPath];
	let scope = text;
	let base = 0;
	let span = null;
	for (const name of names) {
		const startRe = new RegExp(`\\b${name}\\b[^{}]*?\\{`, "m");
		const match = startRe.exec(scope);
		if (!match) return null;
		const braceIdx = match.index + match[0].length - 1; // 指向 "{"
		let depth = 0;
		let end = -1;
		for (let i = braceIdx; i < scope.length; i++) {
			const ch = scope[i];
			if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end < 0) return null;
		span = [base + braceIdx, base + end + 1];
		scope = scope.slice(braceIdx, end + 1); // 进入这一层继续找
		base += braceIdx;
	}
	return span;
}

/**
 * 在文本里定位某个字段的字面量。
 * 返回 { literal, index, start, end }：
 *   index 是整段匹配（含 key 与冒号）的起点，start/end 是字面量本身的起止。
 * index 很关键：改写前后它必须一致，用来确认"改的是同一处"。
 */
function findLiteralMatch(text, def) {
	const pattern = new RegExp(`(?:^|[\\s{,])${def.key}\\s*:\\s*${LITERAL_ALT}`);
	const match = pattern.exec(text);
	if (!match) return null;
	const literal = match[1];
	const start = match.index + match[0].length - literal.length;
	return { literal, index: match.index, start, end: start + literal.length };
}

/** 从一段文本里取出某个字段的原始字面量（字符串带引号） */
function extractLiteral(text, def) {
	const hit = findLiteralMatch(text, def);
	return hit ? hit.literal : null;
}

/** 数一数字段在同一段文本里出现了几次（用来挡住"匹配到意外位置"） */
function countLiteralMatches(text, def) {
	const pattern = new RegExp(`(?:^|[\\s{,])${def.key}\\s*:\\s*${LITERAL_ALT}`, "g");
	let count = 0;
	while (pattern.exec(text) !== null) count++;
	return count;
}

/** 取出字段所在的作用域：有 within 就只看那个配置块，否则看全文 */
function scopeOf(text, def) {
	if (!def.within) return { block: null, scope: text };
	const block = findBlock(text, def.within);
	if (!block) return { block: null, scope: null };
	return { block, scope: text.slice(block[0], block[1]) };
}

/**
 * 替换作用域里某字段的字面量，并在返回前做两道"改对了地方"的校验：
 *   1. 字段在作用域里必须存在；带 within 时还要求**只出现一次**（出现两次说明正则可能挑错目标，宁可不改）
 *   2. 改写后重新定位，匹配起点必须与改写前完全一致，且取到的字面量正是刚写进去的那个
 * 这两条挡住的正是"正则匹配到意料之外的位置"：校验不过直接抛错，不会落到磁盘上。
 * @returns 改写后的作用域文本
 */
function replaceLiteralChecked(scope, def, literal, rel) {
	const where = `${def.within ? `${def.within}.` : ""}${def.key}`;
	const total = countLiteralMatches(scope, def);
	if (total === 0) throw new Error(`${rel} 的 ${where} 没找到，已放弃修改`);
	if (def.within && total > 1) {
		throw new Error(`${rel} 的 ${def.within} 里有 ${total} 处 ${def.key}，无法确定改哪一处，已放弃修改`);
	}

	const before = findLiteralMatch(scope, def);
	const next = scope.slice(0, before.start) + literal + scope.slice(before.end);
	const after = findLiteralMatch(next, def);
	if (!after || after.literal !== literal || after.index !== before.index) {
		throw new Error(`${rel} 的 ${where} 改写位置校验失败（正则可能匹配到了意外位置），已放弃修改`);
	}
	return next;
}

/** 去掉数组/对象里字符串外的尾随逗号（TS 允许尾随逗号，JSON.parse 不允许） */
function stripTrailingCommas(text) {
	let out = "";
	let quote = null;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			out += ch;
			if (ch === "\\") {
				out += text[i + 1] ?? "";
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === ",") {
			// 往后跳过空白，如果下一个字符是 ] 或 }，说明这是尾随逗号，丢掉它
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j])) j++;
			if (text[j] === "]" || text[j] === "}") continue;
		}
		out += ch;
	}
	return out;
}

/**
 * 解析配置里的数组字面量。
 * 主题源码里的数组通常写成多行 + 尾随逗号（例如 homeText.subtitle），
 * 直接 JSON.parse 会失败，所以先按"字符串外"的规则去掉尾随逗号再解析。
 */
function parseArrayLiteral(literal) {
	for (const candidate of [literal, stripTrailingCommas(literal)]) {
		try {
			const value = JSON.parse(candidate);
			if (Array.isArray(value)) return value;
		} catch {
			// 换下一种写法继续试
		}
	}
	return undefined;
}

/**
 * 统计"结构性"的花括号 / 方括号：跳过注释与字符串内容。
 * 为什么不直接 `match(/\{/g)`：文案里出现 `]` 之类符号时会被误判成结构变化；
 * 只统计语法层面的括号，既能挡住正则改坏结构，也不会被字符串内容干扰。
 */
function countStructure(text) {
	const count = { "{": 0, "}": 0, "[": 0, "]": 0 };
	let i = 0;
	let quote = null; // 当前所在字符串的定界符：' " `
	while (i < text.length) {
		const ch = text[i];
		const next = text[i + 1];
		if (quote) {
			if (ch === "\\") {
				i += 2;
				continue;
			}
			if (ch === quote) quote = null;
			i++;
			continue;
		}
		// 注释（先于引号判断，避免注释里的撇号被当成字符串开头）
		if (ch === "/" && next === "/") {
			const end = text.indexOf("\n", i);
			i = end === -1 ? text.length : end;
			continue;
		}
		if (ch === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 2;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			i++;
			continue;
		}
		if (ch in count) count[ch]++;
		i++;
	}
	return count;
}

function unquote(literal) {
	if (literal === null || literal === undefined) return undefined;
	if (literal === "true") return true;
	if (literal === "false") return false;
	if (literal.startsWith("[")) return parseArrayLiteral(literal);
	if (STRING_RE.test(literal)) {
		try {
			return JSON.parse(literal);
		} catch {
			return literal.slice(1, -1);
		}
	}
	const num = Number(literal);
	return Number.isFinite(num) ? num : literal;
}

/** 读取当前设置值（面板表单用），返回 { id: value } */
export function readSettings(repoRoot) {
	const values = {};
	const cache = new Map();
	const textOf = (rel) => {
		if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8"));
		return cache.get(rel);
	};
	for (const def of SETTINGS_DEFS) {
		let text;
		try {
			text = textOf(def.file);
		} catch {
			continue;
		}
		let scope = text;
		if (def.within) {
			const block = findBlock(text, def.within);
			if (!block) continue;
			scope = text.slice(block[0], block[1]);
		}
		const literal = extractLiteral(scope, def);
		if (literal !== null) values[def.id] = unquote(literal);
	}

	// 页面开关：从 siteConfig 顶部的 resolvePageToggles({...}) 里逐个读出
	try {
		const text = textOf("src/config/siteConfig.ts");
		const block = findBlock(text, PAGE_BLOCK);
		if (block) {
			const scope = text.slice(block[0], block[1]);
			for (const m of scope.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)/g)) {
				values[`${PAGE_PREFIX}${m[1]}`] = m[2] === "true";
			}
		}
	} catch {
		// 读不到就跳过
	}

	return values;
}

/**
 * 写入设置。
 * @param repoRoot 仓库根目录
 * @param patch    { "site.title": "新标题", ... }
 * @param snapshot 可选：(relPath) => Promise<void>，在改写文件前做快照
 * @returns { changed: string[], values: object }
 */
export async function applySettings(repoRoot, patch, snapshot) {
	if (!patch || typeof patch !== "object") throw new Error("设置数据格式不对");

	const byFile = new Map();
	for (const [id, rawValue] of Object.entries(patch)) {
		let def;
		let key;

		if (id.startsWith(PAGE_PREFIX)) {
			key = id.slice(PAGE_PREFIX.length);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`页面开关名字不合法：${key}`);
			def = {
				id,
				file: "src/config/siteConfig.ts",
				key,
				within: PAGE_BLOCK,
				type: "boolean",
				label: `页面开关 ${key}`,
			};
		} else {
			def = SETTINGS_DEFS.find((d) => d.id === id);
			if (!def) throw new Error(`不允许修改的设置项：${id}`);
		}

		const literal = literalFor(def, rawValue);
		if (!byFile.has(def.file)) byFile.set(def.file, []);
		byFile.get(def.file).push({ def, literal });
	}

	const changed = [];
	for (const [rel, edits] of byFile) {
		const full = path.join(repoRoot, rel);
		const original = await fs.promises.readFile(full, "utf8");
		let next = original;

		for (const { def, literal } of edits) {
			const { block, scope } = scopeOf(next, def);
			if (scope === null) throw new Error(`${rel} 里找不到 ${def.within} 配置块`);
			const replaced = replaceLiteralChecked(scope, def, literal, rel);
			next = block ? next.slice(0, block[0]) + replaced + next.slice(block[1]) : replaced;
		}

		if (next === original) continue;

		// 轻量语法体检：花括号/方括号的**结构**数量必须与原文一致。
		// 这里数的是字符串与注释之外的括号（countStructure），
		// 所以「副标题文案里带 ] 」不会被误判，而真正的结构破坏一定挡得住。
		const structBefore = countStructure(original);
		const structAfter = countStructure(next);
		for (const ch of ["{", "}", "[", "]"]) {
			if (structAfter[ch] !== structBefore[ch]) {
				throw new Error(
					`${rel} 改写后 ${ch} 数量不一致（原文 ${structBefore[ch]}，现在 ${structAfter[ch]}），已放弃修改（可能是正则匹配到了意外位置）`,
				);
			}
		}

		if (snapshot) await snapshot(rel);
		await fs.promises.writeFile(full, next, "utf8");

		// 回读校验：逐个确认写入的值能被重新解析出来且一致
		const after = await fs.promises.readFile(full, "utf8");
		for (const { def, literal } of edits) {
			let scope = after;
			if (def.within) {
				const block = findBlock(after, def.within);
				scope = block ? after.slice(block[0], block[1]) : "";
			}
			const got = extractLiteral(scope, def);
			if (got !== literal) {
				await fs.promises.writeFile(full, original, "utf8");
				throw new Error(`${rel} 写入校验失败（${def.key}: 期望 ${literal}，实际 ${got}），已回滚`);
			}
			changed.push(def.id);
		}
	}

	return { changed, values: readSettings(repoRoot) };
}
