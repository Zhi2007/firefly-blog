/**
 * 本地体检：只读检查仓库里的常见隐患。
 *
 * 两种用法：
 *   1. 管理面板「体检」页：把结果列出来给作者看
 *   2. 发布前把关：哪怕只发现 error 级问题，也先拦住 push（可用 force 跳过）
 *
 * 设计原则：任何一项检查抛异常都不会影响其它检查；所有检查都不修改文件。
 *
 * 返回结构：
 *   { ok: boolean, checkedAt: string, counts: { error, warn, ok }, checks: [check] }
 *   check = { id, title, level: "error"|"warn"|"ok", summary, details: string[] }
 */

import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".astro", "admin-backups"]);

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

function check(id, title, run) {
	try {
		return { id, title, ...run() };
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
		check("json", "JSON / JSONC 数据文件合法性", () => {
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
		check("playlist", "歌单引用的音频/封面/歌词文件", () => {
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
		check("announcements", "公告数据完整性", () => {
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

	// ── 4. 文章 frontmatter 与配图 ─────────────────────────────────────────
	checks.push(
		check("posts", "文章 frontmatter 与配图", () => {
			const postsDir = "src/content/posts";
			const problems = [];
			const slugs = new Map();
			let count = 0;
			for (const rel of files.filter((f) => f.startsWith(`${postsDir}/`) && /\.mdx?$/.test(f))) {
				count++;
				const text = readText(repoRoot, rel);
				const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
				if (!fm) {
					problems.push(`${rel} 缺少 frontmatter（--- 开头的那段）`);
					continue;
				}
				const body = fm[1];
				if (!/^\s*title\s*:/m.test(body)) problems.push(`${rel} 缺少 title`);
				if (!/^\s*published\s*:/m.test(body)) problems.push(`${rel} 缺少 published`);
				const dateMatch = /^\s*published\s*:\s*["']?([^"'\n]+)/m.exec(body);
				if (dateMatch && !/^\d{4}-\d{2}-\d{2}/.test(dateMatch[1].trim())) {
					problems.push(`${rel} 的 published 不是 YYYY-MM-DD：${dateMatch[1].trim()}`);
				}
				const slug = path.basename(rel).replace(/\.mdx?$/, "");
				if (slugs.has(slug)) problems.push(`文章 slug 重复：${slug}`);
				slugs.set(slug, rel);
				const img = /^\s*image\s*:\s*["']?([^"'\n]+)/m.exec(body);
				if (img) {
					const value = img[1].trim();
					if (!/^https?:/i.test(value)) {
						const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), value));
						if (!exists(repoRoot, target)) problems.push(`${rel} 的封面图不存在：${value}`);
					}
				}
			}
			return problems.length
				? { level: "error", summary: `${problems.length} 篇文章有问题`, details: problems }
				: { level: "ok", summary: `${count} 篇文章 frontmatter 与配图正常`, details: [] };
		}),
	);

	// ── 5. 站内链接 ────────────────────────────────────────────────────────
	checks.push(
		check("links", "正文里的站内链接", () => {
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

	// ── 6. 体积异常的大文件 ────────────────────────────────────────────────
	checks.push(
		check("bigfiles", "异常大的文件（影响部署与国内加载）", () => {
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

	// ── 7. 疑似密钥泄漏 ────────────────────────────────────────────────────
	checks.push(
		check("secrets", "疑似密钥 / 令牌泄漏", () => {
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

	// ── 8. 配置之间的自相矛盾 ──────────────────────────────────────────────
	checks.push(
		check("configs", "配置项之间的一致性", () => {
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

	// ── 9. 工作区与远端状态 ────────────────────────────────────────────────
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
