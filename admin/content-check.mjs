/**
 * 文章 frontmatter 的两层校验（零依赖：只用 node: 内置模块）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 为什么要有这个文件（一条硬约束 + 一次真实事故）
 * ══════════════════════════════════════════════════════════════════════════
 * 事故：面板发了一篇 `published: "2026-10-11"`（多了一对引号）的文章，YAML 把它当字符串，
 * 而 `src/content.config.ts` 的 schema 要 Date → CI 立刻红：
 *     published: Expected type `"date"`, received `"string"`
 * 体检当时没校验 frontmatter，坏数据被推上去了。
 *
 * 硬约束：**不许另写一套平行 schema**。
 *   手抄 `content.config.ts` 的字段名/类型一定会漂移，所以这里分两层，各管各的：
 *
 *   ① content-schema（真实来源，唯一权威）
 *      直接跑仓库里真实的 `astro build`（`node node_modules/astro/bin/astro.mjs build`），
 *      用真实 schema 校验真实文件，再把 Astro 的报错翻译成中文。
 *      「哪个字段、期望什么类型、实际什么类型」全部**取自 Astro 的输出**，本文件不复制任何 schema。
 *
 *   ② content-frontmatter（YAML 层，秒级预检）
 *      只查「不依赖 schema 的通用坑」：引号把日期变成字符串、日期不是 ISO / 日历上不存在、
 *      `tags` 写成字符串、frontmatter 缺失或 YAML 语法坏、缺 `title`/`published`。
 *      它**不**枚举 schema 里的字段，也**不**断言某字段该是什么类型 —— 那些一律由 ① 说了算。
 *      （下面 RULES 一节每条规则都注明了「这条为什么不需要知道 schema」。）
 *
 * 构建产物写哪：`--outDir .astro/doctor-build`。这样**不会动 `dist/`**（`dist/` 是
 * `pnpm build` 的产物，含 pagefind 索引与字体子集，不该被体检的一次临时构建覆盖）。
 * `.astro/` 本来就在 .gitignore 里。
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 一次构建的命运：超时（毫秒）。可用 ADMIN_DOCTOR_BUILD_TIMEOUT_MS 覆盖。 */
const DEFAULT_BUILD_TIMEOUT_MS = 90_000;
/** 构建输出写到哪（相对仓库根）。不写 dist/，见文件头说明。 */
const BUILD_OUT_DIR = ".astro/doctor-build";
/** frontmatter 体检最多列几条（避免刷屏；其余用 truncated 计数提示） */
const MAX_FRONTMATTER_DETAILS = 20;
/** schema 体检最多列几条 */
const MAX_SCHEMA_DETAILS = 8;
/** 兜底展示构建输出尾部多少行（没解析出结构化错误时） */
const OUTPUT_TAIL_LINES = 15;
/** 单次构建最多保留多少字符输出（防止病态输出吃内存） */
const MAX_CAPTURED_BYTES = 2 * 1024 * 1024;
/** 缓存构建结果的进程内槽位（按仓库 + 输入指纹） */
let buildCache = null;

/* ══════════════════════════════════════════════════════════════════════════
 * 一、通用小工具
 * ══════════════════════════════════════════════════════════════════════════ */

const isBlank = (line) => /^\s*$/.test(line);
const isComment = (line) => /^\s*#/.test(line);
/** 仓库内相对路径：一律正斜杠，面板与文档都按这个口径显示 */
const toRepoPath = (repoRoot, abs) => path.relative(repoRoot, abs).split(path.sep).join("/");

/** 把问题统一成面板能渲染的结构：{ level, file, field, text } */
function problem(level, file, field, text) {
	return { level, file, field, text };
}

function existsFile(repoRoot, rel) {
	try {
		return fs.statSync(path.join(repoRoot, rel)).isFile();
	} catch {
		return false;
	}
}

/**
 * 递归列出 `src/content/posts` 下的 .md/.mdx（真实的 readdir，跳过依赖/产物目录）。
 * doctor 已经有自己的 walk，那边会把列表传进来；这个函数是给独立测试/脚本用的。
 */
export function listPostFiles(repoRoot, dir = "src/content/posts") {
	const out = [];
	const walk = (abs, rel, depth) => {
		if (depth > 6) return;
		let entries;
		try {
			entries = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const childAbs = path.join(abs, entry.name);
			const childRel = `${rel}/${entry.name}`;
			if (entry.isDirectory()) walk(childAbs, childRel, depth + 1);
			else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) out.push(childRel);
		}
	};
	walk(path.join(repoRoot, dir), dir, 0);
	return out.sort();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 二、frontmatter 结构扫描（YAML 层，只看「这一段能不能被 YAML 读懂」）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 切出 frontmatter 正文。
 * 真实规则（与 Astro 一致）：文件必须以 `---` 开头，且后面有一行单独的 `---`（或 `...`）收尾。
 */
export function splitFrontmatter(text) {
	const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const lines = clean.split(/\r?\n/);
	if (lines.length === 0 || lines[0].trim() !== "---") {
		return { ok: false, reason: "missing", body: [] };
	}
	for (let i = 1; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "---" || trimmed === "...") return { ok: true, body: lines.slice(1, i) };
	}
	return { ok: false, reason: "unterminated", body: lines.slice(1) };
}

/**
 * 读一个标量。返回：
 *   { kind: "plain"|"quoted"|"empty", text, quote? } | { kind: "unterminated-quote", quote }
 *   | { kind: "trailing", text }  —— 引号闭合后还有别的内容（YAML 会报错）
 * 只在「值以引号开头」时才按引号处理：`title: it's ok` 里的撇号不是引号。
 */
function readScalar(rawValue) {
	const trimmed = rawValue.trim();
	if (trimmed === "") return { kind: "empty", text: "" };
	const quote = trimmed[0];
	if (quote === '"' || quote === "'") {
		let end = -1;
		for (let i = 1; i < trimmed.length; i++) {
			if (trimmed[i] !== quote) continue;
			if (quote === "'" && trimmed[i + 1] === "'") {
				i++;
				continue;
			}
			if (quote === '"' && trimmed[i - 1] === "\\") continue;
			end = i;
			break;
		}
		if (end < 0) return { kind: "unterminated-quote", quote };
		const after = trimmed.slice(end + 1).trim();
		if (after !== "" && !after.startsWith("#")) return { kind: "trailing", text: trimmed.slice(1, end) };
		return { kind: "quoted", quote, text: trimmed.slice(1, end) };
	}
	// 普通标量：行尾 ` #注释` 不算值的一部分（YAML 里注释必须前面有空白）
	const hash = /(^|\s)#/.exec(trimmed);
	const plain = (hash ? trimmed.slice(0, hash.index) : trimmed).trim();
	return { kind: "plain", text: plain };
}

/**
 * 扫描 frontmatter 顶层 `key: value`。
 * 返回 { entries, broken, blockLines }：
 *   entries  = [{ key, line, scalar, valueText, continuation }]
 *   broken   = [{ line, text, why: "tab"|"no-colon" }]
 *   blockLines = 块标量（`|` / `>`）占用的行号集合 —— 那些行里的 `[` 或引号都不算 YAML 语法
 */
function scanMapping(bodyLines) {
	const entries = [];
	const broken = [];
	const blockLines = new Set();
	const keyLines = new Map();
	let i = 0;
	while (i < bodyLines.length) {
		const raw = bodyLines[i];
		const line = i + 2; // frontmatter 正文的第 0 行 = 文件第 2 行
		if (isBlank(raw) || isComment(raw)) {
			i++;
			continue;
		}
		if (/^\s*\t/.test(raw) || /^\t/.test(raw)) {
			// Tab 缩进：YAML 一定会报错。但仍然按顶格 key 解析一次 ——
			// 否则「title 用了 Tab」会被误报成「缺少 title」，噪声会掩盖真正的原因。
			broken.push({ line, text: raw, why: "tab" });
			const tabMatch = /^([^\s:#][^:]*?)\s*:(.*)$/.exec(raw.trim());
			if (tabMatch) {
				const key = tabMatch[1].trim();
				if (keyLines.has(key)) keyLines.get(key).push(line);
				else keyLines.set(key, [line]);
				entries.push({
					key,
					line,
					scalar: readScalar(tabMatch[2]),
					valueText: tabMatch[2].trim(),
					continuation: [],
				});
			}
			i++;
			continue;
		}
		if (/^\s/.test(raw)) {
			i++; // 缩进行（列表项 / 嵌套）由它所属的 key 判断
			continue;
		}
		const match = /^([^\s:#][^:]*?)\s*:(.*)$/.exec(raw);
		if (!match) {
			broken.push({ line, text: raw, why: "no-colon" });
			i++;
			continue;
		}
		const key = match[1].trim();
		const rawValue = match[2];
		if (keyLines.has(key)) keyLines.get(key).push(line);
		else keyLines.set(key, [line]);
		i++;
		// 收集「属于这个 key 的后续行」：缩进行或空行，直到下一个顶格行
		const continuation = [];
		const isBlockScalar = /^\s*[|>][+-]?\d?\s*(#.*)?$/.test(rawValue);
		while (i < bodyLines.length && (isBlank(bodyLines[i]) || /^\s/.test(bodyLines[i]))) {
			if (isBlockScalar) blockLines.add(i + 2);
			continuation.push(bodyLines[i]);
			i++;
		}
		entries.push({
			key,
			line,
			scalar: readScalar(rawValue),
			valueText: rawValue.trim(),
			continuation,
		});
	}
	const duplicates = [];
	for (const [key, lines] of keyLines) {
		if (lines.length > 1) duplicates.push({ key, lines });
	}
	return { entries, broken, blockLines, duplicates };
}

/** 去掉注释行与块标量内容，留下真正参与 YAML 语法判定的文本 */
function syntaxText(bodyLines, blockLines) {
	return bodyLines
		.map((line, index) => {
			const lineNo = index + 2;
			if (blockLines.has(lineNo)) return "";
			if (isComment(line)) return "";
			return line;
		})
		.join("\n");
}

/** 数一串文本里未加引号的 [] {} 是否配平；返回 { open, close, name } 或 null */
function unbalancedFlow(text) {
	const pairs = [
		{ open: "[", close: "]", name: "方括号 [ ]" },
		{ open: "{", close: "}", name: "花括号 { }" },
	];
	for (const { open, close, name } of pairs) {
		let depth = 0;
		for (const char of text) {
			if (char === open) depth++;
			else if (char === close) depth--;
		}
		if (depth !== 0) return { name, delta: depth };
	}
	return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 三、RULES：不依赖 schema 的通用坑
 *     每条都注明「为什么不需要知道 schema」——这是「不写平行 schema」的证明
 * ══════════════════════════════════════════════════════════════════════════ */

/** YYYY-MM-DD，或带秒的时间戳（和 YAML 时间戳一致；只写 HH:MM 会被 YAML 当字符串） */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE =
	/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/;

/** 日期在日历上真的存在吗（2026-13-45 / 2026-02-30 都是假的） */
function isValidCalendarDate(text) {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
	if (!m) return false;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const probe = new Date(Date.UTC(year, month - 1, day));
	return (
		probe.getUTCFullYear() === year &&
		probe.getUTCMonth() === month - 1 &&
		probe.getUTCDate() === day
	);
}

/** 值看起来是一个（不带引号的）日期写法吗 */
const looksLikeDate = (text) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text);

/** 值是不是「纯数字字符串」 */
const looksNumeric = (text) => /^-?\d+(?:\.\d+)?$/.test(text);

/**
 * 日期字段的写法检查（published / updated）。
 * 为什么不需要知道 schema：`published: "2026-10-11"` 在**任何** schema 下都是「字符串」，
 * 而「日期字段被写成字符串」这一条已经由真实构建证明会报 Expected type "date"；
 * 这里只是把同一个坑提前到秒级发现，并给出「怎么改」。
 */
function checkDateField(problems, rel, entry, timeOnly) {
	const { key, line, scalar } = entry;
	if (scalar.kind === "unterminated-quote") {
		problems.push(
			problem("error", rel, key, `第 ${line} 行的引号没有闭合，YAML 解析会失败；请补上配对的引号。`),
		);
		return;
	}
	if (scalar.kind === "quoted") {
		problems.push(
			problem(
				"error",
				rel,
				key,
				`第 ${line} 行：${key} 被引号包住了（现在是字符串 "${scalar.text}"）。YAML 不会把它当日期，而 schema 要日期 —— 构建会报：${key}: Expected type "date", received "string"。改法：去掉引号，写成 ${key}: ${scalar.text.replace(/["']/g, "") || "2026-10-11"}。`,
			),
		);
		return;
	}
	if (scalar.kind !== "plain" && scalar.kind !== "empty") return;
	const value = scalar.text;
	if (!value) {
		problems.push(
			problem("error", rel, key, `第 ${line} 行：${key} 后面没有值（YAML 里是 null），构建会报类型不符；请写上日期，例如 ${key}: 2026-10-11。`),
		);
		return;
	}
	if (DATE_ONLY_RE.test(value) || DATE_TIME_RE.test(value)) {
		// 写法对；再看日历（构建对 2026-13-45 会静默变成别的日期，所以这里比构建更严一点）
		if (!isValidCalendarDate(value)) {
			problems.push(
				problem(
					"error",
					rel,
					key,
					`第 ${line} 行：${key} 的日期在日历上不存在（${value}）。YAML 会把它悄悄算成别的日子，文章日期就不是你写的那个了；请改成真实日期，例如 ${key}: 2026-10-11。`,
				),
			);
		}
		return;
	}
	if (looksLikeDate(value) || timeOnly) {
		problems.push(
			problem(
				"error",
				rel,
				key,
				`第 ${line} 行：${key} 必须是 YYYY-MM-DD（不加引号），现在是 ${value}。改法：写成 ${key}: 2026-10-11；确实要写时间的话必须带秒和时区，例如 ${key}: 2026-10-11T10:30:00+08:00。`,
			),
		);
		return;
	}
	problems.push(
		problem(
			"error",
			rel,
			key,
			`第 ${line} 行：${key} 看起来不是日期（${value}）；请写成 YYYY-MM-DD，例如 ${key}: 2026-10-11。`,
		),
	);
}

/**
 * `tags` 是不是列表。
 * 为什么不需要知道 schema：`tags: 虚拟机, VMware` 在 YAML 里就是**一个字符串**，
 * 逗号不会被拆成列表；这一条已被真实构建证明会报 Expected type "array", received "string"。
 * 我们只判断「这个值是不是 YAML 列表写法」，不关心 schema 里还有哪些字段。
 */
function checkTagsField(problems, rel, entry) {
	const { key, line, scalar, continuation } = entry;
	if (scalar.kind === "unterminated-quote") return; // 上面结构检查已经报过了
	if (scalar.kind === "quoted") {
		problems.push(
			problem(
				"error",
				rel,
				key,
				`第 ${line} 行：${key} 被写成了一个字符串（${scalar.text}），而它需要的是列表；改法：${key}: [${scalar.text}]（不要加引号）。`,
			),
		);
		return;
	}
	if (scalar.kind === "plain" && scalar.text.startsWith("[")) {
		// 行内列表：括号配平就通过；不配平由上面的「方括号不配对」统一报，这里不重复报成「写成了字符串」
		return;
	}
	if (scalar.kind === "empty" || (scalar.kind === "plain" && scalar.text === "")) {
		// `tags:` 后面还可以跟缩进的 `- 项目`，那才是合法的块列表
		if (continuation.some((l) => /^\s*-\s*\S/.test(l))) return;
		problems.push(
			problem(
				"error",
				rel,
				key,
				`第 ${line} 行：${key} 后面没有值（YAML 里是 null），构建会报类型不符；改法：写成 ${key}: []，或者用列表写：\n  ${key}:\n    - 标签一。`,
			),
		);
		return;
	}
	if (scalar.kind === "plain") {
		const list = scalar.text
			.split(/[,，]/)
			.map((t) => t.trim())
			.filter(Boolean)
			.join(", ");
		problems.push(
			problem(
				"error",
				rel,
				key,
				`第 ${line} 行：${key} 被写成了字符串「${scalar.text}」，逗号不会被拆成多个标签；改法：${key}: [${list}]（方括号 + 英文逗号）。`,
			),
		);
	}
}

/** 引号把值变成字符串（除日期字段外的通用提醒，warning 级：不阻断发布） */
function checkQuotedScalars(problems, rel, entries) {
	for (const entry of entries) {
		if (entry.key === "published" || entry.key === "updated") continue; // 上面按 error 处理
		const { key, line, scalar } = entry;
		if (scalar.kind !== "quoted") continue;
		if (looksNumeric(scalar.text)) {
			problems.push(
				problem(
					"warn",
					rel,
					key,
					`第 ${line} 行：${key} 的值用引号包住了数字（"${scalar.text}"），YAML 里这是字符串；如果这个字段是数字，构建会报 Expected type "number", received "string"。要数字就去掉引号。`,
				),
			);
		} else if (looksLikeDate(scalar.text)) {
			problems.push(
				problem(
					"warn",
					rel,
					key,
					`第 ${line} 行：${key} 的值是带引号的日期（"${scalar.text}"），YAML 里这是字符串而不是日期；如果这个字段要日期，去掉引号。`,
				),
			);
		}
	}
}

/**
 * 单篇文章的 frontmatter 体检。
 * 返回 [{ level: "error"|"warn", file, field, text }]，file 是仓库内相对路径。
 */
export function lintPostFrontmatter(rel, text) {
	const problems = [];
	const push = (level, field, msg) => problems.push(problem(level, rel, field, msg));
	const fm = splitFrontmatter(text);
	if (!fm.ok) {
		if (fm.reason === "missing") {
			push(
				"error",
				"frontmatter",
				"文件第一行不是 ---，整段 frontmatter 不存在（YAML 与 schema 都无从校验）；请照现有文章补：第一行 ---、中间是 key: value、最后一行 ---。",
			);
		} else {
			push(
				"error",
				"frontmatter",
				"frontmatter 没有结束的 --- 分隔线（第 1 行是 ---，后面再没出现过单独的 ---），YAML 解析会直接失败；请在 frontmatter 末尾补一行 ---。",
			);
		}
		return problems;
	}

	const { entries, broken, blockLines, duplicates } = scanMapping(fm.body);

	// ── 结构性错误（这些一定会让 YAML 解析失败） ──────────────────────────
	// 「不是 key: value」的行如果只有一两行，逐条报；多到 3 行以上通常是
	// frontmatter 少了结尾的 ---（把正文整段吞进来了），这时候逐行刷屏毫无价值 ——
	// 折成一条说清「最可能的原因 + 头几行」，作者才知道该看哪里。
	const noColon = broken.filter((item) => item.why === "no-colon");
	const tabLines = broken.filter((item) => item.why === "tab");
	if (noColon.length >= 3) {
		push(
			"error",
			"frontmatter",
			`frontmatter 里有 ${noColon.length} 行不是 key: value 形式（第 ${noColon
				.slice(0, 3)
				.map((item) => item.line)
				.join("、")} 行…），YAML 无法解析。最常见的原因：少了结尾的 ---（frontmatter 把正文整段吞进来了）。请确认 frontmatter 只有 key: value，并以单独一行的 --- 收尾。`,
		);
	} else {
		for (const item of noColon) {
			push(
				"error",
				"",
				`第 ${item.line} 行不是 key: value 形式（找不到冒号）：${item.text.trim().slice(0, 60)}；YAML 会解析失败，请检查这一行是不是漏了冒号。`,
			);
		}
	}
	for (const item of tabLines) {
		push("error", "", `第 ${item.line} 行用 Tab 缩进，YAML 不允许 Tab；请改成空格缩进。`);
	}
	for (const dup of duplicates) {
		push(
			"error",
			dup.key,
			`${dup.key} 出现了 ${dup.lines.length} 次（第 ${dup.lines.join("、")} 行），YAML 会报 duplicated mapping key；请删掉多余的那一行。`,
		);
	}
	for (const entry of entries) {
		if (entry.scalar.kind === "unterminated-quote") {
			push(
				"error",
				entry.key,
				`第 ${entry.line} 行：${entry.key} 的引号没有闭合，YAML 解析会失败；请在行尾补上配对的引号。`,
			);
		} else if (entry.scalar.kind === "trailing") {
			push(
				"error",
				entry.key,
				`第 ${entry.line} 行：${entry.key} 的引号闭合后还有多余内容，YAML 会解析失败；请把多余内容删掉或改用引号包住整段。`,
			);
		}
	}
	const flow = unbalancedFlow(syntaxText(fm.body, blockLines));
	if (flow) {
		push(
			"error",
			"",
			`frontmatter 里的${flow.name}数量不配对（${flow.delta > 0 ? "少" : "多"} ${Math.abs(flow.delta)} 个），YAML 会报 flow collection 解析失败；常见于 tags: [a, b 少写右括号。`,
		);
	}

	// ── 通用坑（不依赖 schema，见 RULES 一节） ────────────────────────────
	const byKey = new Map(entries.map((entry) => [entry.key, entry]));
	if (!byKey.has("title")) {
		push("error", "title", "缺少 title 字段（这一项是必填，构建会报 required）；请补 title: 文章标题。");
	}
	if (!byKey.has("published")) {
		push("error", "published", "缺少 published 字段（这一项是必填，构建会报 required）；请补 published: 2026-10-11（不加引号）。");
	}
	for (const key of ["published", "updated"]) {
		const entry = byKey.get(key);
		if (!entry) continue;
		const timeOnly = entry.scalar.kind === "plain" && /^\d{2}:\d{2}/.test(entry.scalar.text);
		checkDateField(problems, rel, entry, timeOnly);
	}
	const tags = byKey.get("tags");
	if (tags) checkTagsField(problems, rel, tags);
	checkQuotedScalars(problems, rel, entries);

	return problems;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 四、content-frontmatter：遍历文章 → YAML 层体检（+ 配图 / slug 重复）
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 组装 `content-frontmatter` 检查项。
 * @param repoRoot 仓库根
 * @param files    仓库内相对路径列表（doctor 的 walk 结果；不传就自己 readdir）
 */
export function buildFrontmatterCheck(repoRoot, files) {
	const list = (files ?? listPostFiles(repoRoot)).filter(
		(rel) => rel.startsWith("src/content/posts/") && /\.mdx?$/i.test(rel),
	);
	const problems = [];
	const slugs = new Map();
	for (const rel of list) {
		let text;
		try {
			text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
		} catch (error) {
			problems.push(problem("error", rel, "", `读不到这个文件：${error?.message ?? error}`));
			continue;
		}
		problems.push(...lintPostFrontmatter(rel, text));

		// 配图与 slug：跟着 frontmatter 一起看，属于「同一篇内容是否自洽」
		const fm = splitFrontmatter(text);
		if (fm.ok) {
			const found = /^\s*image\s*:\s*["']?([^"'\n]+?)\s*["']?\s*$/m.exec(fm.body.join("\n"));
			const image = found?.[1]?.trim();
			if (image && !/^https?:/i.test(image)) {
				const target = path.posix.normalize(
					path.posix.join(path.posix.dirname(rel), image.replace(/^\.\//, "./")),
				);
				if (!existsFile(repoRoot, target)) {
					problems.push(
						problem(
							"error",
							rel,
							"image",
							`封面图不存在：${image}（按文章所在目录解析成 ${target}）；请把图片放进 src/content/posts/images/ 并改成 ./images/文件名。`,
						),
					);
				}
			}
		}
		const slug = path.basename(rel).replace(/\.mdx?$/i, "");
		if (slugs.has(slug)) {
			problems.push(
				problem(
					"error",
					rel,
					"",
					`文章 slug（文件名）与 ${slugs.get(slug)} 重复：两篇文章会互相覆盖；请改掉其中一个文件名。`,
				),
			);
		}
		slugs.set(slug, rel);
	}

	const errors = problems.filter((item) => item.level === "error");
	const warns = problems.filter((item) => item.level === "warn");
	const truncated = Math.max(0, errors.length + warns.length - MAX_FRONTMATTER_DETAILS);
	const details = [...errors, ...warns].slice(0, MAX_FRONTMATTER_DETAILS);
	const level = errors.length > 0 ? "error" : warns.length > 0 ? "warn" : "ok";
	const summary =
		level === "ok"
			? `${list.length} 篇文章的 frontmatter / 配图 / 文件名都正常（YAML 层速查）`
			: `${errors.length} 处错误${warns.length ? ` + ${warns.length} 处提醒` : ""}，涉及 ${new Set(problems.map((p) => p.file)).size} 个文件`;
	return { level, summary, details, truncated };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 五、content-schema：跑真实构建，把 Astro 的报错翻译成中文
 * ══════════════════════════════════════════════════════════════════════════ */

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const stripAnsi = (text) => String(text ?? "").replace(ANSI_RE, "");
/** Astro / Vite 的普通日志行（`21:21:34 [vite] Re-optimizing…`）——它们不是错误，别混进错误清单 */
const LOG_LINE_RE = /^\d{1,2}:\d{2}:\d{2}\s/;
/** 看起来像错误描述的句子（没有文件定位时用它过滤日志噪声） */
const ERRORISH_RE =
	/error|invalid|cannot|can not|unexpected|duplicated|missed|not found|failed|missing|unknown|must be|expected type|does not match|is not allowed/i;

/** 路径 → 仓库内相对路径；不在仓库内就原样返回（例如 node_modules 里的栈帧） */
function relativeIfInside(repoRoot, filePath) {
	const abs = path.resolve(filePath);
	const rel = path.relative(repoRoot, abs);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return abs.split(path.sep).join("/");
	return rel.split(path.sep).join("/");
}

/**
 * js-yaml 的报错原文 → 中文。只翻译最常见的那几条（其余原样带出来，方便搜索）。
 * 这里翻译的是「YAML 语法」层面的通用消息，与 schema 无关。
 */
const YAML_MESSAGES = [
	[/missed comma between flow collection entries/i, "流式列表/对象里少了逗号或右括号（例如 tags: [a, b 少了 ]）"],
	[/duplicated mapping key/i, "字段重复了：YAML 不允许同一个 key 出现两次"],
	[/bad indentation of a mapping entry/i, "缩进不对：同级字段要对齐，子项要缩进"],
	[/unexpected end of the stream within a flow collection/i, "列表 / 对象没有闭合（少写 ] 或 }）"],
	[/end of the stream or a document separator is expected/i, "YAML 结构不完整（常见原因：用了 Tab 缩进，或 frontmatter 少了结尾的 ---）"],
	[/can not read a block mapping entry/i, "读不出这一行（常见原因：用了 Tab 缩进，或 frontmatter 少了结尾的 ---）"],
	[/a multiline key may not be an implicit key/i, "key 被写成了多行（常见原因：frontmatter 少了结尾的 ---）"],
];

function translateYamlMessage(head) {
	for (const [re, zh] of YAML_MESSAGES) {
		if (re.test(head)) return `${zh}。Astro 原文：${head}`;
	}
	return head;
}

/**
 * 从 `astro build` 的输出里抠出「哪个文件、哪个字段、期望什么、实际什么」。
 * Astro 的输出形态（2026-10 实测，astro 7.3.2）：
 *   schema 不符：`[InvalidContentEntryDataError] posts → <slug> data does not match collection schema.`
 *                + `  published**: **published: Expected type `"date"`, received `"string"``
 *                + `  Location:\n    <绝对路径>:0:0`
 *   YAML 坏    ：`duplicated mapping key` / `missed comma between flow collection entries`
 *                + `  Location:\n    <绝对路径>:<行>:<列>`
 * 这里只是**读**它的输出，不复制任何 schema 知识。
 */
export function parseContentBuildErrors(output, repoRoot) {
	const lines = stripAnsi(output).split(/\r?\n/);
	/** 按「顶格非空行 = 一条错误开头」切成块 */
	const blocks = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (isBlank(line)) continue;
		const isTopLevel = !/^\s/.test(line) || /^\[[A-Za-z]+Error\]/.test(line.trim());
		if (isTopLevel || blocks.length === 0) {
			blocks.push({ head: line.trim(), body: [] });
			continue;
		}
		blocks[blocks.length - 1].body.push(line);
	}

	const fields = [];
	const generic = [];
	for (const block of blocks) {
		const all = [block.head, ...block.body];
		// Location: 下一行是 `路径:行:列`
		let file = "";
		let atLine = "";
		for (let i = 0; i < all.length; i++) {
			const inline = /^\s*Location:\s*(\S.*)$/.exec(all[i]);
			if (inline) {
				[file, atLine] = splitLocation(inline[1]);
				break;
			}
			if (/^\s*Location:\s*$/.test(all[i])) {
				const next = all.slice(i + 1).find((l) => !isBlank(l)) ?? "";
				[file, atLine] = splitLocation(next);
				break;
			}
		}
		const rel = file ? relativeIfInside(repoRoot, file) : "";
		const entry = /^\[[A-Za-z]+Error\]\s*(?<collection>[^\s→]+)\s*→\s*(?<id>[^\s]+)\s/.exec(block.head);
		const where = entry ? `${entry.groups.collection} 集合里的 ${entry.groups.id}` : "";

		let matched = 0;
		for (const line of all) {
			const at = line.indexOf("Expected type");
			if (at < 0) continue;
			const expected = /Expected type\s*`"?([^"`]*)`?/.exec(line)?.[1]?.trim() ?? "";
			const received = /received\s*`"?([^"`]*)`?/.exec(line)?.[1]?.trim() ?? "";
			const fieldName = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+|\[\d+\])*)/.exec(
				line.slice(0, at),
			)?.[1];
			fields.push({
				file: rel,
				field: fieldName ?? "",
				expected,
				received,
				atLine,
				text: `期望 ${expected || "?"}，实际是 ${received || "?"}${where && !fieldName ? `（${where}）` : ""}。${adviceFor(expected, received)}`,
			});
			matched++;
		}
		if (matched === 0) {
			// 没有文件定位、又不像错误描述的行（vite 日志、chunk 体积提示…）不是错误，丢掉；
			// 真正的「一堆日志但没有文件定位」由 summary 里的 tail 兜底展示。
			if (!rel && (LOG_LINE_RE.test(block.head) || !ERRORISH_RE.test(block.head))) continue;
			generic.push({
				file: rel,
				atLine,
				text: `${where ? `${where}：` : ""}${translateYamlMessage(block.head)}`,
			});
		}
	}
	return { fields, generic };
}

function splitLocation(text) {
	const m = /^(.*?)(?::(\d+):(\d+))?\s*$/.exec(text.trim());
	if (!m) return [text.trim(), ""];
	return [m[1], m[2] ? `${m[2]}:${m[3]}` : ""];
}

/** 「怎么改」：只根据 Astro 报的「期望类型」，不查任何 schema 表 */
function adviceFor(expected, received) {
	const exp = String(expected).toLowerCase();
	const rec = String(received).toLowerCase();
	if (exp.includes("date")) {
		return "改法：日期写成不带引号的 YYYY-MM-DD，例如 2026-10-11（加引号会变成字符串，就是这次 CI 报错的原因）。";
	}
	if (exp.includes("array")) {
		return "改法：写成 YAML 列表，例如 tags: [标签一, 标签二]（逗号分隔的一串字不会被拆开）。";
	}
	if (exp.includes("boolean")) {
		return "改法：布尔值不加引号，写 true 或 false。";
	}
	if (exp.includes("number")) {
		return "改法：数字不加引号，例如 seriesOrder: 2。";
	}
	if (rec.includes("undefined")) {
		return "改法：这个字段是必填，补上它（字段名与类型以 src/content.config.ts 为准）。";
	}
	return "改法：按 src/content.config.ts 的 schema 改这个字段（该文件是唯一依据，本检查不复制它的字段表）。";
}

/** 输入指纹：src/ + 几个根配置文件的内容特征（大小 + mtime）。变了就重新构建。 */
export function contentBuildFingerprint(repoRoot) {
	const hash = createHash("sha256");
	let count = 0;
	const addFile = (abs) => {
		try {
			const stat = fs.statSync(abs);
			hash.update(`${toRepoPath(repoRoot, abs)}:${stat.size}:${stat.mtimeMs}\n`);
			count++;
		} catch {
			/* 文件不存在：忽略 */
		}
	};
	const walk = (abs, depth) => {
		if (depth > 12) return;
		let entries;
		try {
			entries = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const child = path.join(abs, entry.name);
			if (entry.isDirectory()) walk(child, depth + 1);
			else if (entry.isFile()) addFile(child);
		}
	};
	walk(path.join(repoRoot, "src"), 0);
	for (const rel of [
		"astro.config.mjs",
		"package.json",
		"tsconfig.json",
		"svelte.config.js",
		"postcss.config.mjs",
	]) {
		addFile(path.join(repoRoot, rel));
	}
	return `${count}:${hash.digest("hex")}`;
}

/** 真的去跑构建；返回原始结果（不判断好坏） */
function runAstroBuild(repoRoot, timeoutMs) {
	const astroBin = path.join(repoRoot, "node_modules", "astro", "bin", "astro.mjs");
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(
				process.execPath,
				[astroBin, "build", "--outDir", BUILD_OUT_DIR],
				{
					cwd: repoRoot,
					// NO_COLOR：错误文本里不要 ANSI 转义，解析与展示都干净
					env: {
						...process.env,
						ASTRO_TELEMETRY_DISABLED: "1",
						NO_COLOR: "1",
						FORCE_COLOR: "0",
					},
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				},
			);
		} catch (error) {
			resolve({ spawnError: error, stdout: "", stderr: "", code: null, timedOut: false });
			return;
		}
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const collect = (chunk, keep) => {
			const text = chunk.toString("utf8");
			if (keep.length >= MAX_CAPTURED_BYTES) return keep;
			return keep + text.slice(0, MAX_CAPTURED_BYTES - keep.length);
		};
		child.stdout?.on("data", (chunk) => {
			stdout = collect(chunk, stdout);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = collect(chunk, stderr);
		});
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGTERM");
			} catch {
				/* 已经退出 */
			}
			// 有些子进程不吃 SIGTERM：3 秒后强杀，避免体检卡死
			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					/* 已经退出 */
				}
			}, 3000).unref?.();
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ spawnError: error, stdout, stderr, code: null, timedOut });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ spawnError: null, stdout, stderr, code, signal, timedOut });
		});
	});
}

/** 输出尾部若干行（非空行），兜底展示 */
function tailLines(text, count = OUTPUT_TAIL_LINES) {
	return stripAnsi(text)
		.split(/\r?\n/)
		.filter((line) => !isBlank(line))
		.slice(-count);
}

/** 把构建结果整理成检查项（details 里带 file/field，前端用路径徽章渲染） */
function summarizeBuildResult(repoRoot, result, elapsedMs) {
	const output = `${result.stdout}\n${result.stderr}`;
	const { fields, generic } = parseContentBuildErrors(output, repoRoot);
	// `Location: <路径>:0:0` 是 Astro 对「整个条目」的定位（不是具体某一行）→ 不显示「第 0:0 行」
	const linePrefix = (atLine) => {
		const line = String(atLine ?? "").split(":")[0];
		return /^[1-9]\d*$/.test(line) ? `第 ${line} 行 ` : "";
	};
	const details = [];
	for (const item of fields) {
		details.push({
			file: item.file,
			field: item.field,
			text: `${linePrefix(item.atLine)}${item.text}`,
		});
	}
	for (const item of generic) {
		details.push({
			file: item.file,
			field: "",
			text: `${linePrefix(item.atLine)}${item.text}`,
		});
	}
	const total = details.length;
	const capped = details.slice(0, MAX_SCHEMA_DETAILS);
	return {
		total,
		details: capped,
		// 分类（错误在不在仓库文件里）必须看全量，不能只看前 N 条
		allDetails: details,
		truncated: Math.max(0, total - capped.length),
		tail: tailLines(output),
		hasStructured: total > 0,
	};
}

/**
 * 组装 `content-schema` 检查项（async：要等构建）。
 *
 * 分级与理由：
 *   ok      —— 构建成功（真实 schema 认可当前所有内容）
 *   error   —— 构建失败，且能定位到仓库里的文件（文章 frontmatter / 代码出错，CI 一定也会红）
 *   warn    —— 跑不起来（没装依赖 / 超时 / 输出里定位不到仓库文件）→ **不阻断发布**，
 *              但明确告诉你「这一次没校验到」，绝不静默通过
 *
 * 结果可复用：同一次进程内按「输入指纹」缓存；文件没变就直接复用，不再构建。
 */
export async function buildContentSchemaCheck(repoRoot, options = {}) {
	const timeoutMs =
		Number(options.buildTimeoutMs ?? process.env.ADMIN_DOCTOR_BUILD_TIMEOUT_MS) ||
		DEFAULT_BUILD_TIMEOUT_MS;
	const astroBin = path.join(repoRoot, "node_modules", "astro", "bin", "astro.mjs");
	if (!fs.existsSync(astroBin)) {
		return {
			level: "warn",
			summary: "本地没有安装依赖，这一次没法用真实构建校验文章（找不到 node_modules/astro）",
			details: [
				{
					file: "",
					field: "",
					text: "改法：在仓库根跑一次 pnpm install（或双击 重建依赖.cmd），再点「开始体检」。这一项不阻断发布，但这次 frontmatter 没被真实 schema 校验过。",
				},
			],
			truncated: 0,
			build: { skipped: "no-astro", elapsedMs: 0 },
		};
	}

	const fingerprint = contentBuildFingerprint(repoRoot);
	if (
		buildCache &&
		buildCache.repoRoot === repoRoot &&
		buildCache.fingerprint === fingerprint &&
		options.noBuildCache !== true
	) {
		const ageSeconds = Math.round((Date.now() - buildCache.at) / 1000);
		return {
			...buildCache.value,
			summary: `${buildCache.value.summary}（复用 ${ageSeconds} 秒前的构建结果；文件没变就不重复构建）`,
			build: { ...(buildCache.value.build ?? {}), cached: true, elapsedMs: 0, ageMs: Date.now() - buildCache.at },
		};
	}

	const started = Date.now();
	const result = await runAstroBuild(repoRoot, timeoutMs);
	const elapsedMs = Date.now() - started;
	const value = summarizeBuildResult(repoRoot, result, elapsedMs);

	const finish = (check) => {
		buildCache = { repoRoot, fingerprint, at: Date.now(), value: check };
		return check;
	};

	if (result.spawnError) {
		return finish({
			level: "warn",
			summary: `跑不起来真实构建（${result.spawnError.message ?? result.spawnError}），这一次没有校验到 schema`,
			details: [
				{
					file: "",
					field: "",
					text: "这一项不阻断发布。排查方向：node_modules 是否完整（重建依赖.cmd / pnpm install）、Node 版本是否 >= 22。",
				},
			],
			truncated: 0,
			build: { status: null, elapsedMs, spawnError: true },
		});
	}

	if (result.timedOut) {
		return finish({
			level: "warn",
			summary: `astro build 超过 ${Math.round(timeoutMs / 1000)} 秒仍未结束，已终止；这一次没有校验到 schema`,
			details: [
				{
					file: "",
					field: "",
					text: `这一项不阻断发布。想放宽：设环境变量 ADMIN_DOCTOR_BUILD_TIMEOUT_MS（毫秒）后重启面板；想先看 YAML 层的问题，看上面「文章 frontmatter（YAML 速查）」那一项。`,
				},
			],
			truncated: 0,
			build: { status: null, elapsedMs, timedOut: true },
		});
	}

	if (result.code === 0) {
		const pages = /(\d+)\s+page\(s\) built/.exec(stripAnsi(result.stdout))?.[1];
		return finish({
			level: "ok",
			summary: `真实构建通过（astro build 用 src/content.config.ts 的实际 schema 校验了全部内容${pages ? `，${pages} 页` : ""}，${(elapsedMs / 1000).toFixed(1)} 秒）`,
			details: [],
			truncated: 0,
			build: { status: 0, elapsedMs },
		});
	}

	// 构建失败：能定位到仓库里的文件 → error（阻断发布）；定位不到 → warn（不阻断，但要说明）
	const attributable = value.allDetails.filter(
		(item) => item.file && !item.file.includes("node_modules"),
	);
	if (attributable.length > 0) {
		const files = [...new Set(attributable.map((item) => item.file))];
		return finish({
			level: "error",
			summary: `真实构建失败（astro 报 ${value.total || attributable.length} 处问题，涉及 ${files.length} 个文件）—— 推送后 CI 也会红`,
			details: value.details,
			truncated: value.truncated,
			build: { status: result.code, elapsedMs },
		});
	}

	return finish({
		level: "warn",
		summary: "astro build 失败，但报错里定位不到仓库内的文件（可能是依赖/网络问题）—— 不阻断发布",
		details: [
			...value.details,
			...value.tail.map((line) => ({ file: "", field: "", text: line })),
		].slice(0, MAX_SCHEMA_DETAILS),
		truncated: Math.max(0, value.details.length + value.tail.length - MAX_SCHEMA_DETAILS),
		build: { status: result.code, elapsedMs, unattributed: true },
	});
}

/** 测试用：清掉进程内构建缓存 */
export function resetContentBuildCache() {
	buildCache = null;
}
