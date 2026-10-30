/**
 * 本地体检：只读检查仓库里的常见隐患。
 *
 * 两种用法：
 *   1. 管理面板「体检」页：把结果列出来给作者看
 *   2. 发布前把关：哪怕只发现 error 级问题，也先拦住 push（可用 force 跳过）
 *
 * 设计原则：
 *   · 任何一项检查抛异常都不会影响其它检查；
 *   · 检查本身不写仓库内容（唯一例外：`content-schema` 会跑一次真实 `astro build`，
 *     产物写到 `.astro/doctor-build/`，不碰 `dist/`，见 admin/content-check.mjs 的文件头）；
 *   · 文章 frontmatter 相关的检查全部委托给 admin/content-check.mjs（两层：YAML 速查 + 真实构建）。
 *
 * 返回结构：
 *   { ok: boolean, checkedAt: string, counts: { error, warn, ok }, checks: [check] }
 *   check = { id, title, level: "error"|"warn"|"ok", summary, details: [detail], truncated? }
 *   detail = string（老检查项）或 { file, field, text }（前端用路径徽章渲染 file）
 *
 * 体检项（内置 9 项）：json / playlist / announcements / content-frontmatter /
 * content-schema / links / bigfiles / secrets / configs；面板另外传入 gitInfo，
 * 于是面板页上是 10 项（含「Git 工作区状态」）。
 */

import fs from "node:fs";
import path from "node:path";
import { buildContentSchemaCheck, buildFrontmatterCheck } from "./content-check.mjs";

// logs/ 必须跳过：它只留在本机（.gitignore 已忽略），里面除运行日志外还有启动器
// 的 Chrome profile（logs/admin-browser-profile-chrome），那是 Chromium 自己的数据目录：
//   · 里面有 JSON Lines 格式的 *.json（如 FirstPartySetsPreloaded/**/sets.json），
//     JSON.parse 必然失败 → json 项报 error → publish() 直接拦住发布（2026-10-30 实际踩到，
//     「新增公告/文章后点发布，面板提示体检发现 1 个必须先修的问题」）；
//   · 还有 30 MB+ 的模型/缓存文件，bigfiles 项会对这些永远不会被提交的文件误报。
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".astro", "admin-backups", "logs"]);

/** 递归列出仓库里的文件（跳过依赖/产物目录） */
function walk(dir, repoRoot, out = [], depth = 0) {
	if (depth > 8) return out;
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, repoRoot, out, depth + 1);
		else if (entry.isFile()) out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
	}
	return out;
}

function readText(repoRoot, rel) {
	return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function exists(repoRoot, rel) {
	try {
		return fs.statSync(path.join(repoRoot, rel)).isFile();
	} catch {
		return false;
	}
}

/**
 * 跑一项检查。
 * 检查可以返回普通对象，也可以返回 Promise（`content-schema` 要等真实构建），
 * 所以这里是 async 的：让 run() 结果先 await 再展开，Promise 不会被当成空对象吞掉。
 */
async function check(id, title, run) {
	try {
		return { id, title, ...(await run()) };
	} catch (error) {
		return {
			id,
			title,
			level: "warn",
			summary: `检查本身出错（不影响其它检查）：${error?.message ?? error}`,
			details: [],
		};
	}
}

export async function runDoctor(repoRoot, options = {}) {
	const files = walk(repoRoot, repoRoot);
	const checks = [];

	// ── 1. JSON / JSONC 合法性 ─────────────────────────────────────────────
	checks.push(
		await check("json", "JSON / JSONC 数据文件合法性", () => {
			const bad = [];
			let total = 0;
			for (const rel of files) {
				if (!/\.(json|jsonc)$/.test(rel)) continue;
				total++;
				const text = readText(repoRoot, rel);
				const stripped = rel.endsWith(".jsonc") ? text.replace(/^\s*\/\/.*$/gm, "") : text;
				try {
					JSON.parse(stripped);
				} catch (error) {
					bad.push(`${rel} → ${error.message}`);
				}
			}
			return bad.length
				? { level: "error", summary: `${bad.length} 个文件解析失败`, details: bad }
				: { level: "ok", summary: `${total} 个 JSON 文件全部合法`, details: [] };
		}),
	);

	// ── 2. 歌单引用的文件是否都在 ──────────────────────────────────────────
	checks.push(
		await check("playlist", "歌单引用的音频/封面/歌词文件", () => {
			const rel = "src/config/music-playlist.json";
			if (!exists(repoRoot, rel)) return { level: "warn", summary: "找不到歌单文件", details: [] };
			const songs = JSON.parse(readText(repoRoot, rel));
			const missing = [];
			for (const song of songs) {
				for (const key of ["url", "cover", "lrc"]) {
					const value = song?.[key];
					if (!value || /^https?:/i.test(value)) continue;
					const clean = decodeURIComponent(String(value).split("?")[0]).replace(/^\.?\//, "");
					if (!exists(repoRoot, path.join("public", clean))) {
						missing.push(`${song.name || "(未命名)"} 的 ${key}：${value}`);
					}
				}
			}
			return missing.length
				? { level: "error", summary: `${missing.length} 处引用指向不存在的文件`, details: missing }
				: { level: "ok", summary: `${songs.length} 首歌的音频/封面/歌词都在`, details: [] };
		}),
	);

	// ── 3. 公告数据 ────────────────────────────────────────────────────────
	checks.push(
		await check("announcements", "公告数据完整性", () => {
			const rel = "src/config/announcements.json";
			if (!exists(repoRoot, rel)) return { level: "warn", summary: "找不到公告数据文件", details: [] };
			const items = JSON.parse(readText(repoRoot, rel));
			const problems = [];
			let pinned = 0;
			for (const [i, item] of items.entries()) {
				const where = `第 ${i + 1} 条（${item?.id ?? "无 id"}）`;
				if (!item?.id) problems.push(`${where} 缺少 id`);
				else if (!/^[A-Za-z0-9._-]+$/.test(item.id)) problems.push(`${where} 的 id 含非法字符`);
				if (!item?.title) problems.push(`${where} 缺少标题`);
				if (!item?.content) problems.push(`${where} 缺少正文`);
				if (item?.published && !/^\d{4}-\d{2}-\d{2}/.test(String(item.published))) {
					problems.push(`${where} 的日期格式不是 YYYY-MM-DD：${item.published}`);
				}
				if (item?.pinned) pinned++;
			}
			if (pinned > 1) problems.push(`固定公告只能有一条，现在有 ${pinned} 条`);
			if (items.length > 0 && pinned === 0) problems.push("一条固定公告都没有，首访弹窗会没有内容");
			return problems.length
				? { level: "error", summary: `${problems.length} 处公告数据问题`, details: problems }
				: { level: "ok", summary: `${items.length} 条公告正常（固定 ${pinned} 条）`, details: [] };
		}),
	);

	// ── 4. 文章 frontmatter（YAML 层速查，秒级） ───────────────────────────
	// 只查「不依赖 schema 的通用坑」：引号把日期变成字符串、日期不是 ISO / 日历上不存在、
	// tags 写成字符串、frontmatter 缺失或 YAML 语法坏、缺 title/published、配图与文件名重复。
	// 为什么这里**不**校验「有哪些字段、字段是什么类型」：那是 schema，手抄一份必然漂移 ——
	// 字段与类型的唯一权威是下面第 5 项的真实构建（详见 admin/content-check.mjs 文件头）。
	checks.push(
		await check("content-frontmatter", "文章 frontmatter（YAML 速查）", () =>
			buildFrontmatterCheck(repoRoot, files),
		),
	);

	// ── 5. 文章 schema（真实构建校验） ─────────────────────────────────────
	// 真实来源 = 仓库里真实的 src/content.config.ts：跑一次 `astro build`，
	// 把 Astro 的报错（文件 + 字段 + 期望类型 + 实际类型）翻译成中文 + 怎么改。
	// 跑不起来（没装依赖 / 超时）只给 warning，不阻断发布；跑起来但失败才是 error。
	checks.push(
		await check("content-schema", "文章 schema（真实构建校验）", () =>
			buildContentSchemaCheck(repoRoot, {
				buildTimeoutMs: options.contentBuildTimeoutMs,
				noBuildCache: options.noContentBuildCache,
			}),
		),
	);

	// ── 6. 站内链接 ────────────────────────────────────────────────────────
	checks.push(
		await check("links", "正文里的站内链接", () => {
			const distDir = path.join(repoRoot, "dist");
			const hasDist = fs.existsSync(distDir);
			const dynamic = [
				/^\/posts\/[^/]+\/?$/,
				/^\/tags\/[^/]+\/?$/,
				/^\/categories\/[^/]+\/?$/,
				/^\/page\/\d+\/?$/,
				/^\/blog\//,
				/^\/archive\/?$/,
				/^\/rss\/?/,
				/^\/atom\/?/,
				/^\/sitemap/,
				/^\/search\/?$/,
			];
			const missing = [];
			let linkCount = 0;
			for (const rel of files.filter((f) => /^src\/content\/.*\.mdx?$/.test(f))) {
				// 先去掉围栏代码块与行内代码，避免把 Markdown 示例里的占位路径当成真链接
				const text = readText(repoRoot, rel)
					.replace(/```[\s\S]*?```/g, "")
					.replace(/`[^`\n]*`/g, "");
				for (const m of text.matchAll(/\]\((\/[^)\s]*)\)/g)) {
					const href = m[1].split("#")[0].split("?")[0];
					if (!href || href === "/") continue;
					linkCount++;
					if (dynamic.some((re) => re.test(href))) continue;
					const clean = href.replace(/^\//, "").replace(/\/$/, "");
					const candidates = [
						path.join("dist", clean, "index.html"),
						path.join("dist", `${clean}.html`),
						path.join("public", clean),
					];
					const found = hasDist
						? candidates.some((c) => exists(repoRoot, c))
						: exists(repoRoot, path.join("public", clean));
					if (!found) missing.push(`${rel} → ${href}`);
				}
			}
			if (missing.length) {
				return {
					level: "warn",
					summary: `${missing.length} 个站内链接找不到对应页面（共检查 ${linkCount} 个）`,
					details: missing,
				};
			}
			return { level: "ok", summary: `检查了 ${linkCount} 个站内链接，全部有对应页面`, details: [] };
		}),
	);

	// ── 7. 体积异常的大文件 ────────────────────────────────────────────────
	checks.push(
		await check("bigfiles", "异常大的文件（影响部署与国内加载）", () => {
			const big = [];
			for (const rel of files) {
				let size = 0;
				try {
					size = fs.statSync(path.join(repoRoot, rel)).size;
				} catch {
					continue;
				}
				// 阈值放宽到 8 MB：压缩后的音乐单曲多在 5～6 MB，属正常范围
				if (size > 8 * 1024 * 1024) big.push(`${(size / 1024 / 1024).toFixed(1)} MB  ${rel}`);
			}
			big.sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
			return big.length
				? { level: "warn", summary: `${big.length} 个文件超过 8 MB`, details: big.slice(0, 20) }
				: { level: "ok", summary: "没有超过 8 MB 的文件", details: [] };
		}),
	);

	// ── 8. 疑似密钥泄漏 ────────────────────────────────────────────────────
	checks.push(
		await check("secrets", "疑似密钥 / 令牌泄漏", () => {
			const patterns = [
				[/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
				[/sk-[A-Za-z0-9]{20,}/, "OpenAI 风格密钥"],
				[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "私钥文件内容"],
				[/CLOUDFLARE_API_TOKEN\s*=\s*["']?[A-Za-z0-9_-]{20,}/, "Cloudflare API Token"],
				[/AKIA[0-9A-Z]{16}/, "AWS Access Key"],
			];
			const hits = [];
			for (const rel of files) {
				if (!/\.(ts|js|mjs|cjs|json|jsonc|ya?ml|md|html|txt|env|sh|cmd|bat)$/i.test(rel)) continue;
				if (/^(admin\/README|public\/\.well-known\/security\.txt)/.test(rel)) continue;
				let text = "";
				try {
					text = readText(repoRoot, rel);
				} catch {
					continue;
				}
				for (const [re, label] of patterns) {
					if (re.test(text)) hits.push(`${rel} 里出现疑似 ${label}`);
				}
			}
			return hits.length
				? { level: "error", summary: `发现 ${hits.length} 处疑似密钥`, details: hits }
				: { level: "ok", summary: "没有发现被提交的密钥 / 令牌", details: [] };
		}),
	);

	// ── 9. 配置之间的自相矛盾 ──────────────────────────────────────────────
	checks.push(
		await check("configs", "配置项之间的一致性", () => {
			const problems = [];
			const bg = "src/config/backgroundWallpaper.ts";
			if (exists(repoRoot, bg)) {
				const text = readText(repoRoot, bg);
				const playerEnable = /playerEnable\s*:\s*(true|false)/.exec(text)?.[1];
				const hasPlayerUrl = /^\s*playerUrl\s*:\s*["']/m.test(text);
				if (playerEnable === "false" && hasPlayerUrl) {
					problems.push("backgroundWallpaper.ts：playerEnable 为 false，但仍留着 playerUrl（容易误解，建议注释掉）");
				}
				if (playerEnable === "true" && !hasPlayerUrl) {
					problems.push("backgroundWallpaper.ts：playerEnable 为 true 但没有 playerUrl，播放按钮点了会报错");
				}
			}
			const ds = "src/config/displaySettingsConfig.ts";
			if (exists(repoRoot, ds)) {
				const text = readText(repoRoot, ds);
				if (/enable\s*:\s*true/.test(text) && /wallpaperModeSwitchable\s*:\s*true/.test(text)) {
					problems.push("displaySettingsConfig.ts：开着壁纸模式切换会让每页多约 33 KB JS（作者注释里的提醒，非错误）");
				}
			}
			const site = "src/config/siteConfig.ts";
			if (exists(repoRoot, site)) {
				const text = readText(repoRoot, site);
				const siteUrl = /site_url\s*:\s*["']([^"']+)["']/.exec(text)?.[1] ?? "";
				if (siteUrl && !/^https:\/\//.test(siteUrl)) problems.push(`siteConfig.ts：site_url 不是 https 开头：${siteUrl}`);
			}
			const errors = problems.filter((p) => !p.includes("非错误"));
			return errors.length
				? { level: "warn", summary: `${errors.length} 处配置不一致`, details: problems }
				: { level: "ok", summary: "主要配置项之间没有矛盾", details: problems };
		}),
	);

	// ── 10. 工作区与远端状态 ───────────────────────────────────────────────
	if (typeof options.gitInfo === "function") {
		const info = await options.gitInfo();
		checks.push({
			id: "git",
			title: "Git 工作区状态",
			level: info?.dirty || info?.behind ? "warn" : "ok",
			summary: info
				? `${info.dirty ? `${info.files?.length ?? 0} 处未提交` : "工作区干净"}·待推送 ${info.ahead ?? 0}·落后 ${info.behind ?? 0}`
				: "取不到 Git 状态",
			// changed 是结构化的 { code, path }（server.mjs 的 repoInfo）；
			// 早期这里读的是 info.files 里的字符串的 f.status / f.file，结果所有详情都渲染成
			// “undefined undefined” —— 文件路径必须如实显示，所以改用它。
			details: info?.dirty
				? (info.changed ?? []).map((f) => `${f.code ?? ""} ${f.path ?? ""}`.trim())
				: [],
		});
	}

	const counts = { error: 0, warn: 0, ok: 0 };
	for (const item of checks) counts[item.level] = (counts[item.level] ?? 0) + 1;
	return {
		ok: counts.error === 0,
		checkedAt: new Date().toISOString(),
		counts,
		checks,
	};
}
