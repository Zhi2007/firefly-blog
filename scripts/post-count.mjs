#!/usr/bin/env node
/**
 * post-count.mjs —— 「已发布文章数」的唯一维护入口（零依赖 / 不联网 / 默认幂等）
 *
 * 为什么需要它：
 *   docs/PROJECT-CONTEXT.md 里把「已发布文章数」写死在了三处（§1.3 关键事实表、
 *   §2.3 目录树、§3.2 当前内容实况，其中 §3.2 还列了全部文件名）。每加一篇文章
 *   就要手工改两个数字 + 一份清单，忘了文档就开始说谎，而 `pnpm check-docs`
 *   原本也查不到这一条。
 *
 *   本脚本把这件事变机械动作：事实只从 `src/content/posts` 里数（draft 为 true 的不算），
 *   文档里的三处声明由它写入 / 校验。
 *
 * 用法：
 *   node scripts/post-count.mjs            # 就地修正文档；没变化就不写盘（幂等）
 *   node scripts/post-count.mjs --check    # 只校验不写盘；不一致退出码 1
 *
 * 调用方（一处实现，四处复用）：
 *   - package.json 的 `pnpm posts:count`
 *   - admin/server.mjs 的 /api/save-post、/api/delete-post（保存成功后 best-effort 刷新）
 *   - scripts/new-post.js（脚手架生成文件后刷新）
 *   - scripts/check-docs-sync.mjs（只借 scanPublishedPosts() 取事实，自己比对）
 *
 * 设计约束：
 *   - 只认 `src/content/posts` 下的 `.md` / `.mdx`，与 src/content.config.ts 的 loader 同口径；
 *   - `draft: true` 不计入「已发布」，与站点列表一致；
 *   - 三处声明的正则在找不到 / 命中多次时**不猜**：报 problem 并以退出码 1 结束，
 *     避免把文档改坏；
 *   - 只在「数字或清单真的变了」时落盘，因此不会因为跨天而反复改日期。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
export const POSTS_REL = "src/content/posts";
export const DOC_REL = "docs/PROJECT-CONTEXT.md";

/* ── 事实：数文章 ───────────────────────────────────────────────────────── */

/** 递归列出 posts 目录下的 .md / .mdx（跳过点文件与被忽略的目录） */
function walkPosts(dir, out) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "images" || entry.name.startsWith(".")) continue;
			walkPosts(abs, out);
		} else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
			out.push(abs);
		}
	}
	return out;
}

/** 只读 frontmatter 里有没有 `draft: true`（不解析 YAML，够用且不会误判正文） */
function isDraft(text) {
	if (!text.startsWith("---")) return false;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return false;
	return /^\s*draft:\s*true\s*$/m.test(text.slice(3, end));
}

/**
 * 数出「已发布文章」。
 * @returns {{ count: number, files: string[], slugs: string[], drafts: string[] }}
 *   files 带扩展名、按文件名排序（写进文档的就是它）；slugs 是去掉扩展名的相对路径。
 */
export function scanPublishedPosts(postsDir) {
	const abs = walkPosts(postsDir, []);
	const published = [];
	const drafts = [];
	for (const file of abs) {
		const rel = path.relative(postsDir, file).split(path.sep).join("/");
		const text = fs.readFileSync(file, "utf8");
		if (isDraft(text)) {
			drafts.push(rel);
		} else {
			published.push(rel);
		}
	}
	published.sort();
	drafts.sort();
	return {
		count: published.length,
		files: published.slice(),
		slugs: published.map((rel) => rel.replace(/\.mdx?$/i, "")),
		drafts,
	};
}

/* ── 文档里的三处声明 ───────────────────────────────────────────────────── */

/** §1.3 关键事实表：`| 已发布文章 | 6 篇 | \`src/content/posts/*.md\` 实测（…） |` */
const RE_TABLE =
	/(\| 已发布文章 \| )(\d+)( 篇 \| `src\/content\/posts\/\*\.md` 实测（)([^）]*)(）)/;
/** §2.3 目录树：`# ③ 内容：posts/（6 篇 + images/）、spec/（…` */
const RE_TREE = /(posts\/（)(\d+)( 篇 \+ images\/）)/;
/** §3.2 当前内容实况：`\`posts/\` 6 篇（\`a.md\`、\`b.md\`）+ \`images/\`` */
const RE_LIST = /(`posts\/` )(\d+)( 篇（)([^）]*)(）\+ `images\/`)/;

const sameList = (a, b) =>
	a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * 读出文档里当前写的三个数字与文件名清单。缺声明时返回 problems，调用方不写盘。
 */
export function readDocClaims(text) {
	const table = text.match(RE_TABLE);
	const tree = text.match(RE_TREE);
	const list = text.match(RE_LIST);
	const problems = [];
	if (!table)
		problems.push(
			"§1.3「已发布文章」那一行（`| 已发布文章 | N 篇 | …实测（…） |`）",
		);
	if (!tree) problems.push("§2.3 目录树里的 `posts/（N 篇 + images/）`");
	if (!list) problems.push("§3.2 的 `posts/ N 篇（清单）+ images/`");
	const listFiles = list
		? [...list[4].matchAll(/`([^`]+)`/g)].map((m) => m[1])
		: [];
	return {
		tableCount: table ? Number(table[2]) : null,
		treeCount: tree ? Number(tree[2]) : null,
		listCount: list ? Number(list[2]) : null,
		listFiles,
		problems,
	};
}

function today() {
	const now = new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 按事实重写文档里的三处声明（纯函数，不改文件）。
 * @returns {{ text: string, changed: string[], uptodate: boolean, problems: string[] }}
 */
export function patchDocText(text, facts, date = today()) {
	const claims = readDocClaims(text);
	if (claims.problems.length > 0) {
		return { text, changed: [], uptodate: false, problems: claims.problems };
	}
	const tableStale = claims.tableCount !== facts.count;
	const treeStale = claims.treeCount !== facts.count;
	const listStale =
		claims.listCount !== facts.count ||
		!sameList(claims.listFiles, facts.files);
	if (!tableStale && !treeStale && !listStale) {
		return { text, changed: [], uptodate: true, problems: [] };
	}

	// 只在真的过期时才写：数字 + 清单 + 核对日期一起刷新（漏一处就还是说谎）
	const next = text
		.replace(
			RE_TABLE,
			(_m, head, _n, mid, _old, tail) =>
				`${head}${facts.count}${mid}${date}；\`pnpm posts:count\` 自动维护${tail}`,
		)
		.replace(RE_TREE, (_m, head, _n, tail) => `${head}${facts.count}${tail}`)
		.replace(
			RE_LIST,
			(_m, head, _n, mid, _old, tail) =>
				`${head}${facts.count}${mid}${facts.files.map((f) => `\`${f}\``).join("、")}${tail}`,
		);

	const changed = [];
	if (tableStale) changed.push("§1.3 关键事实表");
	if (treeStale) changed.push("§2.3 目录树");
	if (listStale) changed.push("§3.2 当前内容实况");
	return { text: next, changed, uptodate: false, problems: [] };
}

/* ── 对外主函数 ─────────────────────────────────────────────────────────── */

/**
 * 数一遍文章，并把文档里的三处声明对齐。
 * @param {{ root?: string, docRel?: string, postsRel?: string, write?: boolean, date?: string }} [opts]
 * @returns {{ ok: boolean, count: number, files: string[], changed: string[], written: boolean, problems: string[] }}
 */
export function syncPostCountDoc(opts = {}) {
	const root = opts.root ?? DEFAULT_ROOT;
	const postsDir = path.resolve(root, opts.postsRel ?? POSTS_REL);
	const docPath = path.resolve(root, opts.docRel ?? DOC_REL);
	const write = opts.write !== false;
	const facts = scanPublishedPosts(postsDir);
	const text = fs.readFileSync(docPath, "utf8");
	const patched = patchDocText(text, facts, opts.date);
	if (patched.problems.length > 0) {
		return {
			ok: false,
			count: facts.count,
			files: facts.files,
			changed: [],
			written: false,
			problems: patched.problems,
		};
	}
	const needsWrite = patched.text !== text;
	if (write && needsWrite) fs.writeFileSync(docPath, patched.text, "utf8");
	return {
		ok: true,
		count: facts.count,
		files: facts.files,
		changed: patched.changed,
		written: write && needsWrite,
		problems: [],
	};
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

function main(argv) {
	const check = argv.includes("--check");
	const result = syncPostCountDoc({ write: !check });
	console.log("════════ 已发布文章数（src/content/posts） ════════");
	console.log(
		`代码事实：${result.count} 篇 —— ${result.files.join("、") || "（空）"}`,
	);
	if (result.problems.length > 0) {
		console.error("\n❌ 文档里有声明找不到，未做任何修改：");
		for (const problem of result.problems) console.error(`   · ${problem}`);
		console.error(
			`\n请先按 ${DOC_REL} 里现有写法修正这些位置（脚本不猜格式），再重跑本命令。`,
		);
		return 1;
	}
	if (result.changed.length === 0) {
		console.log("✅ 文档里的三处声明与代码一致（§1.3 / §2.3 / §3.2）");
		return 0;
	}
	if (check) {
		console.error("\n❌ 文档已过期：");
		for (const where of result.changed) console.error(`   · ${where}`);
		console.error("\n修法：`pnpm posts:count`（会就地改成上面的篇数与清单）");
		return 1;
	}
	console.log(`\n✅ 已更新：${result.changed.join("、")}`);
	console.log(`   当前篇数：${result.count}；清单：${result.files.join("、")}`);
	return 0;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exit(main(process.argv.slice(2)));
}
