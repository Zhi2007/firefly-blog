#!/usr/bin/env node
/**
 * check-docs-sync.mjs —— 文档漂移检查器（零依赖 / 只读 / 不联网 / 不执行被测代码）
 *
 * 为什么需要它：
 *   给站点加了新功能，却忘了同步「管理面板 + 文档」，文档就开始说谎 ——
 *   下一个 agent 按旧文档去改代码，就会改错地方。附录 E 是人工清单，
 *   本脚本是机器兜底：从**代码**里算出事实（路由数 / 页签数 / 配置数 /
 *   字段数 / 构建步骤 / 发布白名单 / CSP），再和文档里的声明逐项比对。
 *
 * 用法：
 *   node scripts/check-docs-sync.mjs                # 检查默认文档 docs/PROJECT-CONTEXT.md
 *   node scripts/check-docs-sync.mjs --doc <path>   # 检查另一份文档（相对仓库根或绝对路径）
 *
 * 退出码：
 *   0 = 全部一致（⚠️ 跳过项不算失败）
 *   1 = 至少一项不一致（❌）
 *   2 = 参数错误 / 文档读不到
 *
 * 输出约定：
 *   ✅ 一致；❌ 不一致（附「代码里是 X，文档里写的是 Y，请更新 <文件:行号>」）；
 *   ⚠️ 文档里找不到该声明 → 跳过，不算失败，但计入「未覆盖」汇总。
 *
 * 本脚本只读仓库文件；除 stdout / stderr 之外不产生任何副作用。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOC = "docs/PROJECT-CONTEXT.md";

/* ── 命令行参数 ─────────────────────────────────────────────────────────── */

function parseArgs(argv) {
	const opts = { doc: DEFAULT_DOC, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--doc") {
			opts.doc = argv[i + 1];
			i++;
		} else if (arg.startsWith("--doc=")) {
			opts.doc = arg.slice("--doc=".length);
		} else if (arg === "--help" || arg === "-h") {
			opts.help = true;
		} else {
			throw new Error(`未知参数：${arg}（可用：--doc <路径>）`);
		}
	}
	if (!opts.help && !opts.doc) throw new Error("--doc 后面缺少路径");
	return opts;
}

/* ── 通用小工具 ─────────────────────────────────────────────────────────── */

const unique = (list) => [...new Set(list)];
const sorted = (list) => [...list].sort();
const sameList = (a, b) =>
	a.length === b.length && a.every((v, i) => v === b[i]);
/** list 里有、other 里没有的项（差集；参数顺序不能反，各处已注明方向） */
const notIn = (list, other) => list.filter((v) => !other.includes(v));
const bufferOf = (text) => Buffer.from(text, "utf8");

function readText(relPath) {
	return fs.readFileSync(path.resolve(ROOT, relPath), "utf8");
}

function resolveDocPath(docPath) {
	return path.isAbsolute(docPath) ? docPath : path.resolve(ROOT, docPath);
}

/**
 * 取某章节的正文行（从 startRe 命中的那一行，到下一个二/三级标题之前）。
 * 找不到章节返回 null；调用方打印 ⚠️ 跳过，而不是崩溃。
 */
function sectionRegion(lines, startRe) {
	let from = -1;
	for (let i = 0; i < lines.length; i++) {
		if (startRe.test(lines[i])) {
			from = i;
			break;
		}
	}
	if (from < 0) return null;
	let to = lines.length;
	for (let i = from + 1; i < lines.length; i++) {
		if (/^#{2,3} /.test(lines[i])) {
			to = i;
			break;
		}
	}
	return { lines: lines.slice(from, to), offset: from };
}

/**
 * 在整篇文档里找一条「数字声明」。措辞变了就找不到 → 返回 null（外层打 ⚠️）。
 */
function findNumberClaim(lines, re) {
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(re);
		if (m) return { value: Number(m[1]), line: i + 1, text: lines[i].trim() };
	}
	return null;
}

/**
 * 取 region 里与 index 最相关的 fenced code block。
 * index 落在某个代码块内 → 取那一块；否则取它之后的第一个代码块。
 */
function fencedLines(region, index) {
	const blocks = [];
	let open = -1;
	for (let i = 0; i < region.lines.length; i++) {
		if (/^\s*```/.test(region.lines[i])) {
			if (open < 0) {
				open = i;
			} else {
				blocks.push({ open, close: i });
				open = -1;
			}
		}
	}
	if (blocks.length === 0) return null;
	const inside = blocks.find((b) => index >= b.open && index <= b.close);
	const after = blocks.find((b) => b.open > index);
	const hit = inside ?? after ?? blocks[0];
	return {
		lines: region.lines.slice(hit.open + 1, hit.close),
		line: region.offset + hit.open + 1,
	};
}

/* ── 报告收集 ───────────────────────────────────────────────────────────── */

function createReporter(docLabel) {
	const checks = [];
	let current = null;
	const api = {
		checks,
		start(id, title) {
			current = { id, title, lines: [], pass: 0, fail: 0, skip: 0 };
			checks.push(current);
		},
		info(msg) {
			current.lines.push(`  · ${msg}`);
		},
		/** 只提示、不计入任何计数（用于「机器判不了、但值得人看一眼」的语义线索） */
		hint(msg) {
			current.lines.push(`  ℹ️ ${msg}`);
		},
		ok(msg) {
			current.lines.push(`  ✅ ${msg}`);
			current.pass++;
		},
		bad(msg) {
			current.lines.push(`  ❌ ${msg}`);
			current.fail++;
		},
		warn(msg) {
			current.lines.push(`  ⚠️ ${msg}`);
			current.skip++;
		},
		/** 代码事实 vs 文档声明的通用比较 */
		compare(label, actual, claim, hint, equals = (a, b) => a === b) {
			if (!claim) {
				api.warn(`未找到声明，跳过：${label}（${hint}）`);
				return;
			}
			if (equals(actual, claim.value)) {
				api.ok(`${label} = ${String(claim.value)}（文档第 ${claim.line} 行）`);
			} else {
				api.bad(
					`${label}：代码里是 ${String(actual)}，文档里写的是 ${String(claim.value)}，请更新 ${docLabel}:${claim.line}（${hint}）`,
				);
			}
		},
	};
	return api;
}

/* ── 代码侧事实提取（唯一事实来源） ─────────────────────────────────────── */

function codeRoutes() {
	const src = readText("admin/server.mjs");
	const cases = unique(
		[...src.matchAll(/case\s+"(\/api\/[^"]+)"/g)].map((m) => m[1]),
	);
	const preSwitch = unique(
		[...src.matchAll(/(?:route|pathname)\s*===\s*"(\/api\/[^"]+)"/g)].map(
			(m) => m[1],
		),
	);
	const paths = sorted(unique([...cases, ...preSwitch]));
	const nonApiCases = unique(
		[...src.matchAll(/case\s+"(\/[^"]*)"/g)]
			.map((m) => m[1])
			.filter((p) => !p.startsWith("/api/")),
	);
	return {
		caseCount: cases.length,
		preSwitch,
		total: paths.length,
		paths,
		nonApiCases,
	};
}

function codeTabs() {
	const html = readText("admin/index.html");
	return sorted(
		unique([...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1])),
	);
}

function codeConfigFiles() {
	const dir = path.resolve(ROOT, "src/config");
	const files = sorted(
		fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()),
	);
	return {
		all: files,
		configTs: files.filter((f) => f.endsWith("Config.ts")),
		ts: files.filter((f) => f.endsWith(".ts")),
	};
}

function codeSettings() {
	const src = readText("admin/settings.mjs");
	const start = src.indexOf("export const SETTINGS_DEFS");
	if (start < 0) return null;
	const end = src.indexOf("\n];", start);
	if (end < 0) return null;
	const block = src.slice(start, end);
	const ids = [...block.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
	return {
		ids: sorted(unique(ids)),
		rawCount: ids.length,
		line: src.slice(0, start).split(/\r?\n/).length,
	};
}

function codePostFields() {
	const src = readText("src/content.config.ts");
	const anchor = src.indexOf("const postsCollection");
	if (anchor < 0) return null;
	const schemaStart = src.indexOf("schema: z.object({", anchor);
	if (schemaStart < 0) return null;
	const bodyStart = src.indexOf("{", schemaStart) + 1;
	const schemaEnd = src.indexOf("}),", bodyStart);
	if (schemaEnd < 0) return null;
	const block = src.slice(bodyStart, schemaEnd);
	return sorted(
		unique(
			[...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(
				(m) => m[1],
			),
		),
	);
}

function codeBuildSteps() {
	const pkg = JSON.parse(readText("package.json"));
	const build = pkg?.scripts?.build;
	if (typeof build !== "string") return null;
	return build
		.split("&&")
		.map((s) => s.trim())
		.filter(Boolean);
}

function codePublishScope() {
	const src = readText("admin/publish-scope.mjs");
	const start = src.indexOf("export const PUBLISH_SCOPE");
	if (start < 0) return null;
	const end = src.indexOf("];", start);
	if (end < 0) return null;
	return [...src.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function codeCsp() {
	const worker = readText("worker/index.mjs");
	const workerMatch = worker.match(/"content-security-policy":\s*"([^"]*)"/);
	const headers = readText("public/_headers");
	const headersMatch = headers.match(
		/^[ \t]*Content-Security-Policy:[ \t]*(.+)$/m,
	);
	return {
		worker: workerMatch ? workerMatch[1] : null,
		workerLine: workerMatch
			? worker.slice(0, workerMatch.index).split(/\r?\n/).length
			: -1,
		headers: headersMatch ? headersMatch[1].trim() : null,
		headersLine: headersMatch
			? headers.slice(0, headersMatch.index).split(/\r?\n/).length
			: -1,
	};
}

/* ── 八项检查 ───────────────────────────────────────────────────────────── */

function checkRoutes(r, lines, docLabel) {
	const facts = codeRoutes();
	r.info(
		`代码事实：switch 内 ${facts.caseCount} 条 + switch 外前置 ${facts.preSwitch.length} 条（${facts.preSwitch.join("、") || "无"}）= 唯一 ${facts.total} 条；非 /api 的 case：${facts.nonApiCases.join("、") || "无"}`,
	);

	r.compare(
		"§1.3「/api/* 路由数」",
		facts.total,
		findNumberClaim(lines, /^\|\s*`\/api\/\*`\s*路由数\s*\|\s*\*\*(\d+)\*\*/),
		"§1.3 关键事实表",
	);
	r.compare(
		"§9.3 标题声明的条数",
		facts.total,
		findNumberClaim(lines, /^###\s*9\.3[^\n]*（(\d+)\s*条/),
		"§9.3 标题",
	);

	const region = sectionRegion(lines, /^###\s*9\.3/);
	if (!region) {
		r.warn("未找到声明，跳过：§9.3 路由表（章节标题变了？）");
		return;
	}
	const docPaths = unique(
		region.lines
			.map((l) => l.match(/^\|\s*(?:\d+|—)\s*\|\s*`(\/[^`]+)`/))
			.filter(Boolean)
			.map((m) => m[1])
			.filter((p) => p.startsWith("/api/")),
	);
	r.compare(
		"§9.3 路由表行数",
		facts.total,
		{ value: docPaths.length, line: region.offset + 1 },
		"§9.3 表格",
	);
	// docMissing = 代码里有、文档表里没有；docExtra = 文档表里有、代码里没有
	const docMissing = notIn(facts.paths, docPaths);
	const docExtra = notIn(docPaths, facts.paths);
	if (docMissing.length === 0 && docExtra.length === 0) {
		r.ok(`§9.3 表格逐行与代码一致（${docPaths.length} 条路由集合相同）`);
	}
	if (docMissing.length > 0) {
		r.bad(
			`§9.3 表格缺少代码里存在的路由：${docMissing.join("、")}，请补到 ${docLabel}:${region.offset + 1} 起的路由表`,
		);
	}
	if (docExtra.length > 0) {
		r.bad(
			`§9.3 表格多出代码里不存在的路由：${docExtra.join("、")}，请从 ${docLabel}:${region.offset + 1} 起的路由表删除`,
		);
	}
}

function checkTabs(r, lines, docLabel) {
	const tabs = codeTabs();
	r.info(
		`代码事实：admin/index.html 的 data-tab 去重后 ${tabs.length} 个（${tabs.join("、")}）`,
	);

	r.compare(
		"§1.3「面板页签数」",
		tabs.length,
		findNumberClaim(lines, /^\|\s*面板页签数\s*\|\s*\*\*(\d+)\s*个?\*\*/),
		"§1.3 关键事实表",
	);
	r.compare(
		"§9.4 标题声明的个数",
		tabs.length,
		findNumberClaim(lines, /^###\s*9\.4[^\n]*（(\d+)\s*个/),
		"§9.4 标题",
	);

	const region = sectionRegion(lines, /^###\s*9\.4/);
	if (!region) {
		r.warn("未找到声明，跳过：§9.4 页签清单");
		return;
	}
	const docTabs = unique(
		region.lines
			.map((l) => l.match(/^\|\s*\d+\s*\|[^|]*\|\s*`([a-z][a-z0-9-]*)`/))
			.filter(Boolean)
			.map((m) => m[1]),
	);
	r.compare(
		"§9.4 页签行数",
		tabs.length,
		{ value: docTabs.length, line: region.offset + 1 },
		"§9.4 表格",
	);
	const docMissing = notIn(tabs, docTabs);
	const docExtra = notIn(docTabs, tabs);
	if (docMissing.length === 0 && docExtra.length === 0) {
		r.ok(`§9.4 表格 data-tab 与代码一致（${docTabs.join("、")}）`);
	}
	if (docMissing.length > 0) {
		r.bad(
			`§9.4 表格缺少代码里的页签：${docMissing.join("、")}，请补到 ${docLabel}:${region.offset + 1}`,
		);
	}
	if (docExtra.length > 0) {
		r.bad(
			`§9.4 表格多出不存在的页签：${docExtra.join("、")}，请从 ${docLabel}:${region.offset + 1} 删除`,
		);
	}
}

function checkConfigFiles(r, lines, docLabel) {
	const facts = codeConfigFiles();
	r.info(
		`代码事实：src/config 下 *Config.ts ${facts.configTs.length} 个、.ts ${facts.ts.length} 个、文件共 ${facts.all.length} 个`,
	);

	r.compare(
		"§4.1「*Config.ts」",
		facts.configTs.length,
		findNumberClaim(lines, /^\|\s*`\*Config\.ts`\s*\|\s*\*\*(\d+)\*\*/),
		"§4.1 口径表",
	);
	r.compare(
		"§4.1「目录下全部 .ts」",
		facts.ts.length,
		findNumberClaim(lines, /^\|\s*目录下全部\s*`\.ts`\s*\|\s*\*\*(\d+)\*\*/),
		"§4.1 口径表",
	);
	r.compare(
		"§4.1「目录下全部文件」",
		facts.all.length,
		findNumberClaim(lines, /^\|\s*目录下全部文件\s*\|\s*\*\*(\d+)\*\*/),
		"§4.1 口径表",
	);
	r.compare(
		"§2.3 目录树里的「配置区（N 个文件）」",
		facts.all.length,
		findNumberClaim(lines, /配置区（(\d+)\s*个文件/),
		"§2.3 目录树",
	);

	const region = sectionRegion(lines, /^###\s*4\.2/);
	if (!region) {
		r.warn("未找到声明，跳过：§4.2 配置表");
		return;
	}
	const docFiles = unique(
		region.lines
			.map((l) => l.match(/^\|\s*`([A-Za-z0-9_]+Config\.ts)`/))
			.filter(Boolean)
			.map((m) => m[1]),
	);
	r.compare(
		"§4.2 表格行数（*Config.ts）",
		facts.configTs.length,
		{ value: docFiles.length, line: region.offset + 1 },
		"§4.2 表格",
	);
	const docMissing = notIn(sorted(facts.configTs), sorted(docFiles));
	const docExtra = notIn(sorted(docFiles), sorted(facts.configTs));
	if (docMissing.length === 0 && docExtra.length === 0) {
		r.ok(`§4.2 表格逐行覆盖全部 ${docFiles.length} 个 *Config.ts`);
	}
	if (docMissing.length > 0) {
		r.bad(
			`§4.2 表格缺少这些配置文件：${docMissing.join("、")}，请补到 ${docLabel}:${region.offset + 1} 起的表格`,
		);
	}
	if (docExtra.length > 0) {
		r.bad(
			`§4.2 表格里的文件已不存在：${docExtra.join("、")}，请从 ${docLabel}:${region.offset + 1} 起的表格删除`,
		);
	}
}

function checkSettings(r, lines, docLabel) {
	const facts = codeSettings();
	if (!facts) {
		r.warn("未找到声明，跳过：admin/settings.mjs 里解析不出 SETTINGS_DEFS");
		return;
	}
	r.info(
		`代码事实：SETTINGS_DEFS ${facts.rawCount} 条（去重后 ${facts.ids.length} 个 id），数组起始 admin/settings.mjs:${facts.line}`,
	);

	r.compare(
		"§4.1「面板『站点设置』可视化字段」条数",
		facts.rawCount,
		findNumberClaim(
			lines,
			/^\|\s*面板「站点设置」可视化字段\s*\|\s*\*\*(\d+)\s*条/,
		),
		"§4.1 口径表",
	);
	r.compare(
		"§9.4「站点设置」页签声明的条数",
		facts.rawCount,
		findNumberClaim(lines, /^\|\s*8\s*\|\s*站点设置\s*\|.*?(\d+)\s*条/),
		"§9.4 表格",
	);
	r.compare(
		"§2.3 目录树注释里的 SETTINGS_DEFS 条数",
		facts.rawCount,
		findNumberClaim(
			lines,
			/settings\.mjs\s+#[^\n]*（(\d+)\s*条 SETTINGS_DEFS）/,
		),
		"§2.3 目录树",
	);

	// 文档里提到的设置 id 必须真实存在。只扫「快问快答」附录：那里写的是**当前用法**，
	// 不含 §4.4 那种「历史缺陷记录」里的旧 id（旧 id 保留是有意为之）。
	const region = sectionRegion(lines, /^##\s*附录 A/);
	if (!region) {
		r.warn("未找到声明，跳过：附录 A 的设置 id 存在性校验（章节标题变了？）");
		return;
	}
	const pattern =
		/`((?:site|navbar|theme|card|profile|wallpaper|banner|display|perf)\.[A-Za-z0-9_]+)`/g;
	const ids = unique(
		region.lines.flatMap((l) => [...l.matchAll(pattern)].map((m) => m[1])),
	);
	const unknown = ids.filter((id) => !facts.ids.includes(id));
	if (ids.length === 0) {
		r.warn("未找到声明，跳过：附录 A 里没有可核对的设置 id");
	} else if (unknown.length === 0) {
		r.ok(
			`附录 A 提到的 ${ids.length} 个设置 id 都真实存在（${ids.join("、")}）`,
		);
	} else {
		r.bad(
			`附录 A 提到但 SETTINGS_DEFS 里不存在的设置 id：${unknown.join("、")}，请更新 ${docLabel}:${region.offset + 1}（或核对 admin/settings.mjs）`,
		);
	}

	// 非失败提示：整篇文档里提到、但 SETTINGS_DEFS 已不存在的设置 id。
	// §4.4 / §13.6 那种「历史缺陷记录」会有意保留旧 id，所以这里只提示、不算失败。
	const allIds = unique(
		lines.flatMap((l) =>
			[
				...l.matchAll(
					/`((?:site|navbar|theme|card|profile|wallpaper|banner|display|perf)\.[A-Za-z0-9_]+)`/g,
				),
			].map((m) => m[1]),
		),
	);
	const stale = allIds.filter((id) => !facts.ids.includes(id));
	if (stale.length > 0) {
		r.hint(
			`提示（不计失败）：文档里还提到 ${stale.length} 个 SETTINGS_DEFS 里已不存在的设置 id：${stale.join("、")} —— 若那是「历史缺陷记录」可以保留，若是当前用法请更新文档。`,
		);
	} else {
		r.ok("整篇文档提到的设置 id 都真实存在（没有残留的旧 id）");
	}
}

function checkPostFields(r, lines, docLabel) {
	const facts = codePostFields();
	if (!facts) {
		r.warn("未找到声明，跳过：从 src/content.config.ts 解析不出 posts schema");
		return;
	}
	r.info(
		`代码事实：posts schema 字段 ${facts.length} 个（${facts.join("、")}）`,
	);

	r.compare(
		"附录 C.3 声明的字段数",
		facts.length,
		findNumberClaim(lines, /本文\s*3\.3\s*节列出\s*\*\*(\d+)\s*个字段\*\*/),
		"附录 C.3",
	);

	const region = sectionRegion(lines, /^###\s*3\.3/);
	if (!region) {
		r.warn("未找到声明，跳过：§3.3 posts frontmatter 表");
		return;
	}
	const docFields = unique(
		region.lines
			.map((l) => l.match(/^\|\s*\d+\s*\|\s*`([A-Za-z_][A-Za-z0-9_]*)`/))
			.filter(Boolean)
			.map((m) => m[1]),
	);
	r.compare(
		"§3.3 表格行数",
		facts.length,
		{ value: docFields.length, line: region.offset + 1 },
		"§3.3 表格",
	);
	const docMissing = notIn(facts, sorted(docFields));
	const docExtra = notIn(sorted(docFields), facts);
	if (docMissing.length === 0 && docExtra.length === 0) {
		r.ok(`§3.3 表格逐行覆盖全部 ${docFields.length} 个字段`);
	}
	if (docMissing.length > 0) {
		r.bad(
			`§3.3 表格缺少 schema 里的字段：${docMissing.join("、")}，请补到 ${docLabel}:${region.offset + 1} 起的表格`,
		);
	}
	if (docExtra.length > 0) {
		r.bad(
			`§3.3 表格里的字段已不在 schema 里：${docExtra.join("、")}，请从 ${docLabel}:${region.offset + 1} 起的表格删除`,
		);
	}
}

function checkBuildSteps(r, lines, docLabel) {
	const steps = codeBuildSteps();
	if (!steps) {
		r.warn("未找到声明，跳过：package.json 里没有 scripts.build");
		return;
	}
	r.info(
		`代码事实：package.json 的 build 有 ${steps.length} 步 —— ${steps.join(" → ")}`,
	);

	r.compare(
		"§1.3「构建命令」声明的步数",
		steps.length,
		findNumberClaim(lines, /`pnpm build`\s*→\s*(\d+)\s*步流水线/),
		"§1.3 关键事实表",
	);
	r.compare(
		"§11.2 声明的步数",
		steps.length,
		findNumberClaim(
			lines,
			/`pnpm build`（`package\.json:\d+`，(\d+)\s*步链路）/,
		),
		"§11.2 门禁表",
	);

	// CLAUDE.md 同样写着构建链路（上游文件，本任务不改它，但必须对得上）。
	try {
		const claude = readText("CLAUDE.md").split(/\r?\n/);
		r.compare(
			"CLAUDE.md 命令表声明的步数",
			steps.length,
			findNumberClaim(claude, /`pnpm build`\s*\|\s*(\d+)\s*steps?/),
			"CLAUDE.md 的 Commands 表",
		);
		r.compare(
			"CLAUDE.md「Multi-step」声明的步数",
			steps.length,
			findNumberClaim(claude, /Multi-step（(\d+)\s*步/),
			"CLAUDE.md 的 Build Pipeline",
		);
	} catch {
		r.warn("未找到声明，跳过：CLAUDE.md 读取失败");
	}

	const region = sectionRegion(lines, /^###\s*11\.2/);
	if (!region) {
		r.warn("未找到声明，跳过：§11.2 的构建链路代码块");
		return;
	}
	const anchor = region.lines.findIndex((l) => /完整链路/.test(l));
	const block = fencedLines(region, anchor < 0 ? 0 : anchor);
	if (!block) {
		r.warn("未找到声明，跳过：§11.2 里没有 fenced 代码块");
		return;
	}
	const docSteps = block.lines
		.map((l) => l.split("#")[0].trim())
		.filter((l) => l.length > 0);
	r.compare(
		"§11.2 代码块步数",
		steps.length,
		{ value: docSteps.length, line: block.line },
		"§11.2 代码块",
	);
	if (sameList(steps, docSteps)) {
		r.ok(
			`§11.2 代码块的 ${docSteps.length} 步与 package.json 逐条一致（顺序也一致）`,
		);
	} else {
		for (let i = 0; i < Math.max(steps.length, docSteps.length); i++) {
			if (steps[i] !== docSteps[i]) {
				r.bad(
					`§11.2 第 ${i + 1} 步不一致：代码里是 \`${steps[i] ?? "（无）"}\`，文档里写的是 \`${docSteps[i] ?? "（无）"}\`，请更新 ${docLabel}:${block.line} 起（§11.2 构建链路）`,
				);
				break;
			}
		}
	}
}

function checkPublishScope(r, lines, docLabel) {
	const facts = codePublishScope();
	if (!facts) {
		r.warn(
			"未找到声明，跳过：admin/publish-scope.mjs 里解析不出 PUBLISH_SCOPE",
		);
		return;
	}
	r.info(
		`代码事实：PUBLISH_SCOPE ${facts.length} 条前缀 —— ${facts.join("、")}`,
	);

	const region = sectionRegion(lines, /^###\s*10\.3/);
	if (!region) {
		r.warn("未找到声明，跳过：§10.3 PUBLISH_SCOPE 代码块");
		return;
	}
	const anchor = region.lines.findIndex((l) =>
		/export const PUBLISH_SCOPE/.test(l),
	);
	const block = fencedLines(region, anchor < 0 ? 0 : anchor);
	if (!block) {
		r.warn("未找到声明，跳过：§10.3 里没有 fenced 代码块");
		return;
	}
	const docScopes = unique(
		block.lines
			.map((l) => l.match(/^\s*"([^"]+)"/))
			.filter(Boolean)
			.map((m) => m[1]),
	);
	r.compare(
		"§10.3 代码块条数",
		facts.length,
		{ value: docScopes.length, line: block.line },
		"§10.3 代码块",
	);
	const docMissing = notIn(facts, docScopes);
	const docExtra = notIn(docScopes, facts);
	if (docMissing.length === 0 && docExtra.length === 0) {
		r.ok(
			`§10.3 代码块与 admin/publish-scope.mjs 逐条一致（${docScopes.join("、")}）`,
		);
	}
	if (docMissing.length > 0) {
		r.bad(
			`§10.3 代码块缺少代码里的前缀：${docMissing.join("、")}，请补到 ${docLabel}:${block.line} 起（§10.3）`,
		);
	}
	if (docExtra.length > 0) {
		r.bad(
			`§10.3 代码块多出代码里不存在的前缀：${docExtra.join("、")}，请从 ${docLabel}:${block.line} 起（§10.3）删除`,
		);
	}
}

function checkCsp(r, lines, docLabel) {
	const facts = codeCsp();
	if (!facts.worker || !facts.headers) {
		r.warn(
			"未找到声明，跳过：worker/index.mjs 或 public/_headers 里解析不出 CSP",
		);
		return;
	}
	r.info(
		`代码事实：worker/index.mjs:${facts.workerLine} 的 CSP ${facts.worker.length} 字符，public/_headers:${facts.headersLine} 的 CSP ${facts.headers.length} 字符`,
	);

	if (bufferOf(facts.worker).equals(bufferOf(facts.headers))) {
		r.ok(
			`worker/index.mjs:${facts.workerLine} 与 public/_headers:${facts.headersLine} 的 CSP 逐字节一致（${facts.worker.length} 字符）`,
		);
	} else {
		let firstDiff = 0;
		for (
			let i = 0;
			i < Math.max(facts.worker.length, facts.headers.length);
			i++
		) {
			if (facts.worker[i] !== facts.headers[i]) {
				firstDiff = i;
				break;
			}
		}
		r.bad(
			`两份 CSP 不一致，第一处差异在第 ${firstDiff + 1} 个字符：worker 里是 \`${facts.worker.slice(firstDiff, firstDiff + 24)}\`，_headers 里是 \`${facts.headers.slice(firstDiff, firstDiff + 24)}\`，请让 public/_headers:${facts.headersLine} 与 worker/index.mjs:${facts.workerLine} 逐字节一致（worker 那份才实际生效）`,
		);
	}

	const region = sectionRegion(lines, /^###\s*6\.4/);
	if (!region) {
		r.warn("未找到声明，跳过：§6.4 的 CSP 全文代码块");
	} else {
		const block = fencedLines(region, 0);
		if (!block) {
			r.warn("未找到声明，跳过：§6.4 里没有 fenced 代码块");
		} else {
			const docCsp = block.lines.join("\n").trim();
			if (bufferOf(docCsp).equals(bufferOf(facts.worker))) {
				r.ok(
					`§6.4 正文里的 CSP 全文与代码逐字节一致（${facts.worker.length} 字符）`,
				);
			} else {
				r.bad(
					`§6.4 正文里的 CSP 与 worker/index.mjs 不一致（文档 ${docCsp.length} 字符 / 代码 ${facts.worker.length} 字符），请用 worker/index.mjs:${facts.workerLine} 的值覆盖 ${docLabel}:${block.line} 起的代码块`,
				);
			}
		}
	}

	r.compare(
		"§5.2 区域声明的 CSP 字符数",
		facts.worker.length,
		findNumberClaim(
			lines,
			/两份 CSP 目前\*\*逐字节一致\*\*（实测都是\s*(\d+)\s*字符/,
		),
		"§5.2 / §6.4 交叉引用处",
	);
	r.compare(
		"§6.4 开头声明的 CSP 字符数",
		facts.worker.length,
		findNumberClaim(lines, /与之\*\*完全一致\*\*，实测两者都是\s*(\d+)\s*字符/),
		"§6.4 开头",
	);
	r.compare(
		"§13.2 声明的 CSP 字符数",
		facts.worker.length,
		findNumberClaim(lines, /都是\s*\*\*(\d+)\s*字符\*\*且逐字节相同/),
		"§13.2 已确认清单",
	);

	if (facts.worker.includes("esm.sh")) {
		r.bad(
			"worker/index.mjs 的 CSP 里又出现了 esm.sh；若确实要放行，请同步更新 §6.4 的逐条说明与 public/_headers（当年漏放行导致评论区整体打不开，见 §12.6）",
		);
	} else {
		r.ok("CSP 里没有 esm.sh（与 §6.4「已从 CSP 移除」的说明一致）");
	}
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`参数错误：${err.message}`);
		process.exit(2);
	}
	if (opts.help) {
		console.log("用法：node scripts/check-docs-sync.mjs [--doc <文档路径>]");
		console.log(`   默认文档：${DEFAULT_DOC}`);
		console.log("退出码：0 = 一致；1 = 有不一致；2 = 参数错误");
		process.exit(0);
	}

	const docLabel = opts.doc;
	const docPath = resolveDocPath(opts.doc);

	console.log("════════ 文档漂移检查（代码 = 事实来源） ════════");
	console.log(`代码根：${ROOT}`);
	console.log(`文档  ：${docLabel}`);

	let lines;
	try {
		lines = fs.readFileSync(docPath, "utf8").split(/\r?\n/);
	} catch (err) {
		console.error(`读取文档失败：${docPath}\n${err.message}`);
		process.exit(2);
	}

	const r = createReporter(docLabel);
	const tasks = [
		["1/8", "/api/* 路由数量（admin/server.mjs ↔ §1.3 / §9.3）", checkRoutes],
		["2/8", "面板页签数量（admin/index.html ↔ §1.3 / §9.4）", checkTabs],
		["3/8", "src/config 文件与 §4.1 / §4.2 表格", checkConfigFiles],
		[
			"4/8",
			"站点设置条目（admin/settings.mjs ↔ §4.1 / §9.4 / 附录 A）",
			checkSettings,
		],
		[
			"5/8",
			"posts frontmatter 字段（src/content.config.ts ↔ §3.3 / 附录 C.3）",
			checkPostFields,
		],
		[
			"6/8",
			"构建步骤（package.json ↔ §1.3 / §11.2 / CLAUDE.md）",
			checkBuildSteps,
		],
		["7/8", "发布白名单（admin/publish-scope.mjs ↔ §10.3）", checkPublishScope],
		[
			"8/8",
			"CSP 一致性（worker/index.mjs ↔ public/_headers / §6.4）",
			checkCsp,
		],
	];
	for (const [id, title, fn] of tasks) {
		r.start(id, title);
		fn(r, lines, docLabel);
	}

	let pass = 0;
	let bad = 0;
	let skip = 0;
	for (const c of r.checks) {
		pass += c.pass;
		bad += c.fail;
		skip += c.skip;
		const mark = c.fail > 0 ? "❌" : c.skip > 0 ? "⚠️" : "✅";
		console.log(`\n── [${c.id}] ${mark} ${c.title} ──`);
		for (const line of c.lines) console.log(line);
	}

	console.log("\n════════ 汇总 ════════");
	console.log(
		`检查项：${r.checks.length} 组；断言：✅ ${pass} 通过 / ❌ ${bad} 失败 / ⚠️ ${skip} 未找到声明（跳过）`,
	);
	if (bad > 0) {
		console.log(
			"结果：❌ 文档与代码不一致 —— 请按上面的行号更新文档（附录 E 有「加什么 → 必须同步哪里」清单）",
		);
		console.log("退出码：1");
	} else {
		console.log("结果：✅ 文档里的数字与清单和代码一致");
		console.log("退出码：0");
	}
	if (skip > 0) {
		console.log(
			`\n⚠️ 有 ${skip} 项没在文档里找到对应声明（上面的 ⚠️ 行）：要么文档改了措辞（请更新锚点），要么这条声明被删了（补回去，或从检查器里去掉）。`,
		);
	}
	console.log(
		"\nℹ️ 覆盖不到的部分（脚本只比数字与清单，语义漂移仍要人读文档）：",
	);
	console.log(
		"   · 说明性文字是否仍然成立（数字没变、含义变了）；「该怎么做」的步骤是否还正确",
	);
	console.log(
		"   · README.md / admin/README.md / AGENTS.md 的正文（只覆盖了 CLAUDE.md 的构建步骤数）",
	);
	console.log(
		"   · 配置字段的语义与面板开关的实际行为（例如 SETTINGS_DEFS 的 within 指向了哪个配置块）",
	);
	console.log(
		"   · 面板「写盘 / 写前快照」列、POST_BODY_FIELDS 登记、缓存规则（worker 与 _headers 的 Cache-Control）",
	);
	console.log(
		"   · CSP 指令是否「该放行的都放行了」——脚本只能保证三处副本逐字节一致",
	);
	console.log(
		"   · 新功能是否**应该**有面板入口 / 是否应纳入 PUBLISH_SCOPE（设计判断）",
	);

	process.exit(bad > 0 ? 1 : 0);
}

main();
