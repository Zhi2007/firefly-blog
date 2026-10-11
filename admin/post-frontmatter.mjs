/**
 * 文章 frontmatter 的**读写共用模型**（零依赖 / 纯函数 / 不碰磁盘）。
 *
 * 为什么需要它（真实事故，修了两次）：
 *   面板保存文章时，旧的 `stringifyPost()` 把整个 frontmatter 用一串模板字符串重写：
 *
 *     `${k}: ${typeof v === "string" ? `"${v}"` : v}`
 *
 *   —— 它对**每个字符串值无条件加引号**。日期在表单里就是一个字符串（`<input type="date">`
 *   给的是 `"2026-10-11"`），于是写出 `published: "2026-10-11"`；YAML 里加了引号就是字符串，
 *   而 `src/content.config.ts` 的 `posts.published` 是 `z.date()` → CI 立刻红：
 *   `published: Expected type "date", received "string"`。
 *
 *   顺带还有两个副作用（同样是实测出来的）：
 *     1. 提交上来的 frontmatter 只有表单里那 9 个字段，`lang` / `comment` / `series` /
 *        `author` / 自定义字段**全部被删掉**（保存一次正文就丢数据）；
 *     2. 块列表 `tags:`（`- 测试`）被读成空字符串，再写回去就变成了 `tags: []`。
 *
 * 现在的做法是**外科式改写**：只在「值真的变了」时替换那一行（连同它的续行），
 * 其余行（注释、字段顺序、引号风格、块标量、面板不认识的字段）逐字节原样保留。
 * 日期字段额外规范化成**不带引号**的 `YYYY-MM-DD`（这也顺手修好了历史坏数据）。
 *
 * 行模型复用 `content-check.mjs` 的 `scanMapping` / `readScalar`：体检（只读）与保存（写入）
 * 对「什么算一个字段、哪些行属于它」必须是同一个定义，否则两边会各说各话。
 */

import { readScalar, scanMapping, splitFrontmatter } from "./content-check.mjs";

/** 面板表单会写盘的字段，顺序即「新建文章」时的写出顺序（与仓库里现有文章一致） */
export const MANAGED_FIELDS = [
	{ key: "title", kind: "string" },
	{ key: "published", kind: "date" },
	{ key: "description", kind: "string" },
	{ key: "tags", kind: "string-list" },
	{ key: "category", kind: "string" },
	{ key: "image", kind: "string" },
	{ key: "password", kind: "string" },
	{ key: "pinned", kind: "boolean" },
	{ key: "draft", kind: "boolean" },
];

/**
 * 日期性质的字段：schema 里是 `z.date()`，**只能**写成不带引号的 YAML 时间戳。
 * `published` 由表单提供；`updated` 表单里没有，但也必须保证「不因为保存而变成字符串」。
 */
export const DATE_FIELDS = ["published", "updated"];

const KIND_BY_KEY = new Map(MANAGED_FIELDS.map((f) => [f.key, f.kind]));

/** 写入前的校验失败：带 status，server.mjs 的 publicErrorText 会原样回给用户（不落盘） */
export class FrontmatterWriteError extends Error {
	constructor(message) {
		super(message);
		this.name = "FrontmatterWriteError";
		this.status = 400;
	}
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** YAML 时间戳：`2026-10-11T10:30:00+08:00` / `2026-10-11 10:30:00` 等 */
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})[Tt ].+$/;
const today = () => new Date().toISOString().slice(0, 10);

/** 日期在日历上真的存在吗（`2026-13-45` 会被 YAML 静默滚成别的日子） */
function isRealDate(text) {
	if (!DATE_ONLY_RE.test(text)) return false;
	const [y, m, d] = text.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return (
		dt.getUTCFullYear() === y &&
		dt.getUTCMonth() === m - 1 &&
		dt.getUTCDate() === d
	);
}

/** 取一个时间戳的「日」部分；不是时间戳就返回 null */
function dayPart(text) {
	if (DATE_ONLY_RE.test(text)) return text;
	const m = TIMESTAMP_RE.exec(text);
	return m ? m[1] : null;
}

/* ── 读：把 frontmatter 文本解成字段值（供表单回填 + 保存时比较） ───────────── */

/** 双引号 / 单引号标量的**内容**还原：`\"` `\\` `\n`（双引号）与 `''`（单引号） */
function unescapeInner(text, quote) {
	if (quote === "'") return text.replace(/''/g, "'");
	try {
		return JSON.parse(`"${text}"`);
	} catch {
		return text; // YAML 有而 JSON 没有的转义（`\e` 等）：无法还原就原样返回
	}
}

/** 去掉一层引号，并还原转义（用于「值包着引号」的普通标量） */
function unquote(text) {
	const trimmed = text.trim();
	if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed.endsWith('"')) {
		return unescapeInner(trimmed.slice(1, -1), '"');
	}
	if (trimmed.length >= 2 && trimmed[0] === "'" && trimmed.endsWith("'")) {
		return unescapeInner(trimmed.slice(1, -1), "'");
	}
	return trimmed;
}

/** 行内列表 `[a, "b", c]` → 字符串数组；括号不配平 / 引号未闭合 → null（无法解析） */
function parseFlowList(text) {
	const trimmed = text.trim();
	if (!trimmed.startsWith("[")) return null;
	if (!trimmed.endsWith("]")) return null;
	const inner = trimmed.slice(1, -1);
	const items = [];
	let current = "";
	let quote = null;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (quote) {
			current += ch;
			if (ch === "\\" && quote === '"') {
				current += inner[i + 1] ?? "";
				i++;
			} else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === ",") {
			items.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	if (quote) return null; // 引号没闭合
	items.push(current);
	return items.map((item) => unquote(item)).filter((item) => item !== "");
}

/** 块标量（`description: |` / `>`）：按 YAML 语义拼回字符串（比较时还会折叠空白） */
function readBlockScalar(indicator, lines) {
	const nonEmpty = lines.filter((line) => line.trim() !== "");
	if (nonEmpty.length === 0) return "";
	const indent = Math.min(
		...nonEmpty.map((line) => /^\s*/.exec(line)[0].length),
	);
	const dedented = nonEmpty.map((line) => line.slice(indent));
	const text = indicator.startsWith(">")
		? dedented.map((line) => line.trim()).join(" ")
		: dedented.join("\n");
	const chomp = indicator.includes("-")
		? "strip"
		: indicator.includes("+")
			? "keep"
			: "clip";
	return chomp === "keep" ? `${text}\n` : `${text.replace(/\n+$/, "")}\n`;
}

/**
 * 读一个 entry（`scanMapping` 的产物）的值。
 * 返回 string | string[] | boolean | null（null = 这个写法我读不懂 → 保存时按表单的值重写）
 */
export function readEntryValue(entry) {
	const { scalar, continuation } = entry;
	if (scalar.kind === "quoted")
		return unescapeInner(scalar.text, scalar.quote ?? '"');
	if (scalar.kind === "unterminated-quote" || scalar.kind === "trailing")
		return null;
	const text = scalar.text ?? "";
	if (text.startsWith("|") || text.startsWith(">"))
		return readBlockScalar(text, continuation);
	if (text === "") {
		// `key:` 后面什么都没有：可能是块列表，也可能真的是 null
		const items = continuation.filter((line) => /^\s*-\s/.test(line));
		if (items.length > 0) {
			const parsed = [];
			for (const line of items) {
				const nested = readScalar(line.replace(/^\s*-\s*/, ""));
				if (nested.kind === "unterminated-quote" || nested.kind === "trailing")
					return null;
				parsed.push(
					nested.kind === "quoted"
						? unescapeInner(nested.text, nested.quote ?? '"')
						: (nested.text ?? ""),
				);
			}
			return parsed.filter((item) => item !== "");
		}
		return continuation.some((line) => line.trim() !== "") ? null : "";
	}
	if (text.startsWith("[")) return parseFlowList(text);
	if (text === "true") return true;
	if (text === "false") return false;
	if (text === "null" || text === "~") return "";
	return unquote(text);
}

/** 这个 entry 是不是块标量写法（`|` / `>`）—— 那种写法要按「折叠空白后比较」来避免误改 */
function isBlockScalarEntry(entry) {
	return entry.scalar.kind === "plain" && /^[|>]/.test(entry.scalar.text ?? "");
}

/** 空白归一：只用于块标量的比较（`>` 折叠 / 缩进 / 换行都不算「用户改了值」） */
const normalizeWs = (text) => String(text).replace(/\s+/g, " ").trim();

/**
 * 解析整份文件的 frontmatter → 普通对象（与 `scanMapping` 同一套行模型）。
 * 供 server.mjs 的 `parseFrontmatter()` 兜底分支与「保存时比较」共用。
 * 读不懂的字段值为 null；同名 key 取**最后一个**（YAML 的实际取值语义，重复键由体检报错）。
 *
 * @returns {{ values: Record<string, unknown>, ok: boolean, reason?: string }}
 */
export function readFrontmatterValues(raw) {
	const split = splitFrontmatter(String(raw ?? ""));
	if (!split.ok) return { values: {}, ok: false, reason: split.reason };
	const { entries } = scanMapping(split.body);
	const values = {};
	for (const entry of entries) {
		const value = readEntryValue(entry);
		values[entry.key] = value === null ? undefined : value;
	}
	return { values, ok: true };
}

/* ── 写：YAML 标量怎么排 ─────────────────────────────────────────────────── */

/** 会被 YAML 读成非字符串的写法（数字 / 布尔 / null / 时间戳 / 0x 0o / 六十进制）—— 字符串要加引号 */
const TYPED_SCALAR_RE = new RegExp(
	[
		"^(?:~|[Nn]ull|NULL)$",
		"^(?:[Tt]rue|TRUE|[Ff]alse|FALSE|[Yy]es|YES|[Nn]o|NO|[Oo]n|ON|[Oo]ff|OFF)$",
		"^[-+]?(?:\\d[\\d_]*(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?$",
		"^[-+]?0[xXoObB][0-9a-fA-F_]+$",
		"^[-+]?\\d[\\d_]*(?::\\d+)+$",
		"^[-+]?\\.(?:inf|Inf|INF|nan|NaN|NAN)$",
		"^\\d{4}-\\d{1,2}-\\d{1,2}(?:[Tt ].*)?$",
	].join("|"),
);

/**
 * 一个字符串要不要加引号？
 * 规则保守但**只影响风格**：加引号在 YAML 里语义不变，不加引号却可能被读成数字 / 布尔 / 时间戳，
 * 或者含 `: ` / ` #` 时直接语法出错。仓库里现有文章的普通中文（含 `：`、`、`、`——`）不加引号。
 */
export function needsQuote(text) {
	if (text === "") return true;
	if (/^\s|\s$/.test(text)) return true;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: 控制字符必须加引号才能安全落盘
	if (/[\n\r\t\x00-\x1f\x7f]/.test(text)) return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
	if (text.includes(": ") || text.endsWith(":")) return true;
	if (/(^|\s)#/.test(text)) return true;
	return TYPED_SCALAR_RE.test(text);
}

/** 字符串 → 可安全落盘的 YAML 标量 */
export function formatScalar(text) {
	const value = String(text);
	// JSON.stringify 的双引号转义与 YAML 双引号基本一致（\n \t \" \\ \uXXXX 都通用）
	return needsQuote(value) ? JSON.stringify(value) : value;
}

/** 给定字段的「期望值」：字符串 / 字符串数组 / 布尔 / 日期（裸 YYYY-MM-DD，绝不能加引号） */
function formatValue(kind, value) {
	// 日期是 schema 里的 `z.date()`：加了引号 YAML 就当字符串 → 构建直接失败。
	// 所以这里**刻意**绕开 formatScalar（它对「像日期的字符串」是要加引号的，那是对的，因为那是字符串字段）。
	if (kind === "date") return String(value);
	if (kind === "boolean") return value === true ? "true" : "false";
	if (kind === "string-list")
		return `[${value.map((item) => formatScalar(item)).join(", ")}]`;
	return formatScalar(value);
}

/**
 * 把表单提交的 frontmatter 规范化成「面板管理的字段 → 期望值」。
 * 空字符串 / 空数组 / 未勾选的布尔 → null（表示「这个字段不该存在」）。
 * 这里做两处硬校验（都在写盘之前，失败就 400 不落盘）：`title` 不能为空、`published` 必须是真实日期。
 */
function normalizeManaged(frontmatter, baseValues) {
	const out = new Map();
	for (const { key, kind } of MANAGED_FIELDS) {
		const raw = frontmatter?.[key];
		if (kind === "date") {
			if (key !== "published") continue; // updated 等字段不由表单提供
			let value = String(raw ?? "").trim();
			if (value === "") {
				// 表单里日期被清空：沿用文件里原来的日期，没有才用今天（不允许写出空日期）
				const fromFile = dayPart(String(baseValues?.published ?? ""));
				value = fromFile ?? today();
			}
			if (!isRealDate(value)) {
				throw new FrontmatterWriteError(
					`published 必须是 YYYY-MM-DD（例如 2026-10-11），不能带引号、也不能是「${String(raw ?? "")}」；` +
						'日期被引号包住时 YAML 会当字符串，构建会报 published: Expected type "date", received "string"。',
				);
			}
			out.set(key, value);
			continue;
		}
		if (kind === "boolean") {
			out.set(key, raw === true ? true : null);
			continue;
		}
		if (kind === "string-list") {
			const list = (
				Array.isArray(raw) ? raw : raw ? String(raw).split(",") : []
			)
				.map((item) => String(item).trim())
				.filter(Boolean);
			out.set(key, list.length > 0 ? list : null);
			continue;
		}
		const text = String(raw ?? "").trim();
		// title 是 schema 里的必填字段（`z.string()`，没有 default）：空着就 400，
		// 而不是写出一个「缺 title」的文件让用户在发布时才发现（面板前端也拦了这一条）
		if (key === "title" && text === "") {
			throw new FrontmatterWriteError(
				"title 不能为空：schema 里 title 是必填字段，缺了构建会报 required。",
			);
		}
		out.set(key, text === "" ? null : text);
	}
	return out;
}

/* ── 写：组装整份文件 ───────────────────────────────────────────────────── */

/**
 * 组装要写入 `src/content/posts/<slug>.md` 的完整内容。
 *
 * @param {object} input
 * @param {string|null} input.baseRaw 目标文件**当前**的原文（不存在传 null / ""）：外科式改写的基准
 * @param {object} input.frontmatter 表单提交的 frontmatter
 * @param {string} input.body        表单提交的正文
 * @returns {string}
 * @throws {FrontmatterWriteError} 日期不合法
 */
export function composePostFile({ baseRaw, frontmatter, body }) {
	const split = baseRaw ? splitFrontmatter(String(baseRaw)) : { ok: false };
	const baseValues = split.ok ? readFrontmatterValues(baseRaw).values : {};
	const desired = normalizeManaged(frontmatter ?? {}, baseValues);
	const bodyText = String(body ?? "").replace(/^\s*\n/, "");

	if (!split.ok) {
		// 没有可用的 frontmatter：整块新建（顺序 = MANAGED_FIELDS）
		const lines = [];
		for (const { key, kind } of MANAGED_FIELDS) {
			const value = desired.get(key);
			if (value === null || value === undefined) continue;
			lines.push(`${key}: ${formatValue(kind, value)}`);
		}
		return `---\n${lines.join("\n")}\n---\n\n${bodyText}`;
	}

	const bodyLines = split.body;
	const { entries } = scanMapping(bodyLines);
	// 同名 key 取最后一个（YAML 实际取值语义）；更早的重复行**原样留着**，不替用户删行
	const lastEntryByKey = new Map();
	for (const entry of entries) lastEntryByKey.set(entry.key, entry);

	/** 需要整段替换/删除的行号（0 基，相对 bodyLines） */
	const replaced = new Map(); // index → string[]（空数组 = 删除）
	const consumed = new Set();
	for (const [key, entry] of lastEntryByKey) {
		const kind = KIND_BY_KEY.get(key);
		const isDateField = DATE_FIELDS.includes(key);
		if (kind === undefined && !isDateField) continue; // 面板不管的字段：原样保留
		const start = entry.line - 2;
		const length = 1 + entry.continuation.length;
		const current = readEntryValue(entry);
		const value = desired.get(key);

		// ① 面板不管的日期字段（updated）：只修「被引号包住的合法日期」，别的一律不动
		if (kind === undefined) {
			const scalar = entry.scalar;
			const text = scalar.text ?? "";
			if (scalar.kind === "quoted" && isRealDate(text)) {
				replaced.set(start, [`${key}: ${text}`]);
				for (let i = 0; i < length; i++) consumed.add(start + i);
			}
			continue;
		}

		// ② 日期字段：不带引号的 YYYY-MM-DD 原样保留；同一天的时间戳不降级；其余重写
		if (kind === "date") {
			const scalar = entry.scalar;
			const plain = scalar.kind === "plain" ? scalar.text : "";
			const canonical = plain === value && isRealDate(plain);
			const sameDay = dayPart(plain) === value;
			if (!canonical && !sameDay) {
				replaced.set(start, [`${key}: ${formatValue("date", value)}`]);
				for (let i = 0; i < length; i++) consumed.add(start + i);
			}
			continue;
		}

		// ③ 普通字段：值没变就逐字节保留（含引号风格 / 块标量 / 块列表）
		if (valueKept(entry, kind, current, value)) continue;
		let next = null;
		if (value !== null && value !== undefined)
			next = [`${key}: ${formatValue(kind, value)}`];
		replaced.set(start, next ?? []);
		for (let i = 0; i < length; i++) consumed.add(start + i);
	}

	const outLines = [];
	for (const [index, line] of bodyLines.entries()) {
		const replacement = replaced.get(index);
		if (replacement) outLines.push(...replacement);
		else if (!consumed.has(index)) outLines.push(line);
	}
	// 文件里没有的字段：按 MANAGED_FIELDS 顺序补在末尾（不重排用户已有的行）
	const presentKeys = new Set(entries.map((entry) => entry.key));
	for (const { key, kind } of MANAGED_FIELDS) {
		const value = desired.get(key);
		if (value === null || value === undefined) continue;
		if (presentKeys.has(key)) continue;
		outLines.push(`${key}: ${formatValue(kind, value)}`);
	}

	return `---\n${outLines.join("\n")}\n---\n\n${bodyText}`;
}

/** 「这个字段的值和表单给的一样吗」——一样就整段保留，连引号风格都不动 */
function valueKept(entry, kind, current, value) {
	if (current === null) return false; // 读不懂的写法：按表单重写
	if (value === null || value === undefined) {
		// 表单里是空值：文件里也是空值才保留（`image: ""`、`tags: []`、`draft: false` 都算）
		if (kind === "boolean") return current === false;
		if (kind === "string-list")
			return Array.isArray(current) && current.length === 0;
		return current === "";
	}
	if (kind === "boolean") return current === true;
	if (kind === "string-list")
		return (
			Array.isArray(current) && current.join("\u0000") === value.join("\u0000")
		);
	if (typeof current !== "string") return false;
	if (isBlockScalarEntry(entry))
		return normalizeWs(current) === normalizeWs(value);
	return current === value;
}
