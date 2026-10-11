#!/usr/bin/env node
/**
 * 栀海博客 · 本地管理后台
 *
 * 一个零依赖的本地服务：在浏览器里管理文章、媒体、配置，并能一键构建/发布。
 * 只监听 127.0.0.1，不会暴露到公网；每次启动会生成一次性访问令牌，防止其他网页恶意调用。
 *
 * 用法：
 *   node admin/server.mjs            # 启动并自动打开浏览器
 *   node admin/server.mjs --port=8899 --no-open
 */

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAudioMeta, mimeToExt, plainLyricsToLrc } from "./audio-meta.mjs";
import { createSnapshot, listSnapshots, restoreSnapshot } from "./backups.mjs";
import { runDoctor } from "./doctor.mjs";
import { SETTINGS_DEFS, applySettings, readSettings } from "./settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const UI_FILE = path.join(__dirname, "index.html");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
	const hit = args.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const PORT = Number(argValue("port", process.env.ADMIN_PORT || 8799));
const AUTO_OPEN = !args.includes("--no-open");
const DRY_RUN_PUBLISH = process.env.ADMIN_PUBLISH_DRY_RUN === "1";
const TOKEN = randomBytes(16).toString("hex");

// ── 可编辑的配置文件白名单（相对仓库根目录） ────────────────────────────────
const CONFIG_FILES = [
	"src/config/siteConfig.ts",
	"src/config/backgroundWallpaper.ts",
	"src/config/navBarConfig.ts",
	"src/config/profileConfig.ts",
	"src/config/sidebarConfig.ts",
	"src/config/announcementConfig.ts",
	"src/config/announcements.json",
	"src/config/music-playlist.json",
	"src/config/commentConfig.ts",
	"src/config/analyticsConfig.ts",
	"src/config/effectsConfig.ts",
	"src/config/musicConfig.ts",
	"src/config/pioConfig.ts",
	"src/config/FooterConfig.html",
];

// ── 可上传的媒体目录 ────────────────────────────────────────────────────────
const MEDIA_DIRS = {
	"post-images": "src/content/posts/images",
	music: "public/assets/music",
	"music-cover": "public/assets/music/cover",
	"music-lrc": "public/assets/music/lrc",
	avatar: "public/assets/images",
};

const POSTS_DIR = "src/content/posts";

// 各媒体目录对应的「怎么在文章/配置里引用它」
const MEDIA_URL_PREFIX = {
	"post-images": "./images/", // 文章 frontmatter 里是相对文章文件的路径
	music: "/assets/music/",
	"music-cover": "/assets/music/cover/",
	"music-lrc": "/assets/music/lrc/",
	avatar: "/assets/images/",
};

function mediaUrl(dirKey, name) {
	return `${MEDIA_URL_PREFIX[dirKey] ?? "/"}${name}`;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;

// 上传类型白名单：只允许真正的图片/音频/歌词，避免把 .html / .svg（可带脚本）传进站点目录
const UPLOAD_EXT = {
	"post-images": /\.(png|jpe?g|webp|avif|gif)$/i,
	music: AUDIO_EXT,
	"music-cover": /\.(png|jpe?g|webp|avif|gif)$/i,
	"music-lrc": /\.lrc$/i,
	avatar: /\.(png|jpe?g|webp|avif|gif)$/i,
};

/**
 * 从上传的音频里提取封面与歌词并落盘，返回可直接写进歌单的路径。
 * 有时间戳的歌词直接写成 .lrc；纯文本歌词返回给前端，由前端补上音频时长后再生成。
 */
async function extractAndStoreAudio(buffer, audioFileName) {
	const base = path.basename(audioFileName).replace(/\.[^.]+$/, "");
	const meta = extractAudioMeta(buffer);
	let cover = null;
	let lrc = null;

	if (meta.cover && meta.cover.data?.length > 0) {
		const coverName = `${base}.${mimeToExt(meta.cover.mime)}`;
		await fs.mkdir(safeResolve("public/assets/music/cover"), { recursive: true });
		await fs.writeFile(
			safeResolve(`public/assets/music/cover/${coverName}`),
			meta.cover.data,
		);
		cover = `/assets/music/cover/${coverName}`;
	}

	if (meta.lyrics && meta.lyrics.kind === "synced" && meta.lyrics.text.trim()) {
		const lrcName = `${base}.lrc`;
		await fs.mkdir(safeResolve("public/assets/music/lrc"), { recursive: true });
		await fs.writeFile(
			safeResolve(`public/assets/music/lrc/${lrcName}`),
			meta.lyrics.text,
			"utf-8",
		);
		lrc = `/assets/music/lrc/${lrcName}`;
	}

	return {
		audioFormat: meta.format,
		extractedTitle: meta.title || "",
		extractedArtist: meta.artist || "",
		cover,
		lrc,
		plainLyrics:
			meta.lyrics && meta.lyrics.kind === "plain" ? meta.lyrics.text : null,
	};
}

// ── 后台直接维护的数据文件 ──────────────────────────────────────────────────
// 公告与歌单单独存 JSON，由 Admin 读写，避免去改写 TS 源码（改错了会直接构建失败）
const DATA_FILES = {
	announcements: "src/config/announcements.json",
	playlist: "src/config/music-playlist.json",
};

async function readJsonData(key) {
	const text = await fs.readFile(safeResolve(DATA_FILES[key]), "utf-8");
	const value = JSON.parse(text);
	return Array.isArray(value) ? value : [];
}

async function writeJsonData(key, value) {
	await snapshotBefore(DATA_FILES[key], `保存 ${key}`);
	// 制表符缩进，和仓库里其它 JSON 保持一致
	await fs.writeFile(
		safeResolve(DATA_FILES[key]),
		`${JSON.stringify(value, null, "\t")}\n`,
		"utf-8",
	);
}

/** 清洗公告数据：校验必填字段、只允许一条固定公告 */
function sanitizeAnnouncements(input) {
	if (!Array.isArray(input)) throw new Error("公告数据必须是数组");
	let pinned = 0;
	const items = input.map((raw) => {
		const id = String(raw?.id ?? "").trim();
		const title = String(raw?.title ?? "").trim();
		const content = String(raw?.content ?? "").trim();
		if (!id || !title || !content) throw new Error("每条公告都需要「id / 标题 / 正文」");
		if (!/^[A-Za-z0-9._-]+$/.test(id)) {
			throw new Error(`公告 id 只能包含字母、数字、点、下划线、连字符：${id}`);
		}
		const item = { id, title, published: String(raw?.published ?? "").trim() || new Date().toISOString().slice(0, 10) };
		const version = String(raw?.version ?? "").trim();
		if (version) item.version = version;
		if (raw?.pinned) {
			pinned += 1;
			item.pinned = true;
		}
		const type = String(raw?.type ?? "").trim();
		if (type) item.type = type;
		item.content = content;
		const links = (Array.isArray(raw?.links) ? raw.links : [])
			.filter((l) => l && String(l.text ?? "").trim() && String(l.url ?? "").trim())
			.map((l) => ({
				text: String(l.text).trim(),
				url: String(l.url).trim(),
				...(l.external ? { external: true } : {}),
			}));
		if (links.length > 0) item.links = links;
		return item;
	});
	if (pinned > 1) throw new Error(`固定公告只能有一条，当前勾选了 ${pinned} 条`);
	return items;
}

/** 清洗歌单数据：名称与链接必填 */
function sanitizePlaylist(input) {
	if (!Array.isArray(input)) throw new Error("歌单数据必须是数组");
	return input.map((raw) => {
		const name = String(raw?.name ?? "").trim();
		const url = String(raw?.url ?? "").trim();
		if (!name || !url) throw new Error("每首歌都需要「歌名」和「音频路径」");
		if (!/^(\/|https?:|\.\/)/.test(url)) {
			throw new Error(`音频路径要以 / 或 http(s) 开头：${url}`);
		}
		const song = { name, artist: String(raw?.artist ?? "").trim(), url };
		const cover = String(raw?.cover ?? "").trim();
		if (cover) song.cover = cover;
		const lrc = String(raw?.lrc ?? "").trim();
		if (lrc) song.lrc = lrc;
		return song;
	});
}

// ── 小工具 ──────────────────────────────────────────────────────────────────
function run(cmd, cmdArgs, options = {}) {
	return new Promise((resolve) => {
		execFile(
			cmd,
			cmdArgs,
			{ cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024, ...options },
			(error, stdout, stderr) => {
				resolve({
					ok: !error,
					code: error?.code ?? 0,
					stdout: (stdout || "").trim(),
					stderr: (stderr || "").trim(),
					message: error?.message || "",
				});
			},
		);
	});
}

async function git(gitArgs) {
	return run("git", gitArgs);
}

// 网络类报错的特征（代理没开、节点挂掉、被墙等）
const NETWORK_ERROR_RE =
	/(proxy|Could not connect|Failed to connect|Failed to fetch|TLS|unexpected eof|timed out|timeout|Connection was reset|Recv failure|RPC failed)/i;

/**
 * 需要联网的 git 命令：先按仓库配置执行（可能走了代理），
 * 如果是网络类失败，再自动去掉代理直连重试一次。
 * 这样不管用户有没有开 Clash，面板里的「发布 / 同步」都能尽量成功。
 */
async function gitNet(gitArgs) {
	const first = await git(gitArgs);
	if (first.ok) return { ...first, viaDirect: false };
	const detail = `${first.stderr}\n${first.stdout}\n${first.message}`;
	if (!NETWORK_ERROR_RE.test(detail)) return { ...first, viaDirect: false };
	const retry = await git(["-c", "http.proxy=", ...gitArgs]);
	return {
		...retry,
		viaDirect: retry.ok,
		firstTryError: detail.trim().split("\n").slice(-1)[0] || "",
	};
}

/** 把仓库内的相对路径解析成绝对路径，并阻止越界访问 */
function safeResolve(relative) {
	const abs = path.resolve(REPO_ROOT, relative);
	// 注意必须先 resolve 再比较，并带上 path.sep，否则 `../` 或同名前缀的兄弟目录能绕过
	if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) {
		throw new Error(`路径越界: ${relative}`);
	}
	return abs;
}

/**
 * 解析路径并校验它确实落在允许的目录内（先解析、后用绝对路径比较）。
 * @param relative       仓库内相对路径
 * @param allowedPrefixes 允许的目录前缀（相对仓库根目录），省略则不限制（只要在仓库内）
 */
function resolveInside(relative, allowedPrefixes) {
	const abs = safeResolve(relative);
	if (!allowedPrefixes || allowedPrefixes.length === 0) return abs;
	const ok = allowedPrefixes.some((prefix) => {
		const root = path.resolve(REPO_ROOT, prefix);
		return abs === root || abs.startsWith(root + path.sep);
	});
	if (!ok) throw new Error(`不在允许的目录内: ${relative}`);
	return abs;
}

/** 恒定时间比较访问令牌，避免时序侧信道 */
function tokenValid(provided) {
	if (typeof provided !== "string") return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(TOKEN);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * 写操作之前的快照：把原文件另存到 admin-backups/（已 gitignore，不会提交也不会发布）。
 * 备份失败不阻断保存，但会把警告返回给前端。
 */
async function snapshotBefore(rels, reason) {
	try {
		const list = (Array.isArray(rels) ? rels : [rels]).filter(Boolean);
		for (const rel of list) safeResolve(rel); // 越界直接抛错
		return await createSnapshot(REPO_ROOT, list, { reason });
	} catch (error) {
		return { id: null, warning: `快照失败：${error?.message ?? error}` };
	}
}

async function exists(p) {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

async function readYamlModule() {
	try {
		const mod = await import("yaml");
		// yaml 包在不同解析条件下导出形态不同：可能直接挂在命名空间上，也可能在 default 上
		if (typeof mod.stringify === "function") return mod;
		if (mod.default && typeof mod.default.stringify === "function") {
			return mod.default;
		}
		return null;
	} catch {
		return null;
	}
}

/** 解析 Markdown 的 frontmatter（优先用项目里的 yaml 包，失败则退回简易解析） */
async function parseFrontmatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) return { frontmatter: {}, body: raw };
	const yamlText = match[1];
	const body = raw.slice(match[0].length);
	const yaml = await readYamlModule();
	if (yaml) {
		try {
			return { frontmatter: yaml.parse(yamlText) || {}, body };
		} catch {
			// 落到下面的简易解析
		}
	}
	const frontmatter = {};
	for (const line of yamlText.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!m) continue;
		const key = m[1];
		let value = m[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else if (value.startsWith("[") && value.endsWith("]")) {
			value = value
				.slice(1, -1)
				.split(",")
				.map((v) => v.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
		} else if (value === "true" || value === "false") {
			value = value === "true";
		}
		frontmatter[key] = value;
	}
	return { frontmatter, body };
}

/** 组装 Markdown 文件内容（frontmatter 用 yaml 包序列化，保持可读） */
async function stringifyPost(frontmatter, body) {
	const yaml = await readYamlModule();
	const ordered = {
		title: frontmatter.title ?? "",
		published: frontmatter.published ?? new Date().toISOString().slice(0, 10),
		description: frontmatter.description ?? undefined,
		tags: frontmatter.tags?.length ? frontmatter.tags : undefined,
		category: frontmatter.category || undefined,
		image: frontmatter.image || undefined,
		pinned: frontmatter.pinned ? true : undefined,
		draft: frontmatter.draft ? true : undefined,
	};
	for (const [k, v] of Object.entries(frontmatter)) {
		if (!(k in ordered) && v !== undefined && v !== null && v !== "") {
			ordered[k] = v;
		}
	}
	const clean = Object.fromEntries(
		Object.entries(ordered).filter(([, v]) => v !== undefined && v !== null),
	);
	const yamlText = yaml
		? yaml.stringify(clean).trimEnd()
		: Object.entries(clean)
				.map(([k, v]) =>
					Array.isArray(v)
						? `${k}: [${v.join(", ")}]`
						: `${k}: ${typeof v === "string" ? `"${v}"` : v}`,
				)
				.join("\n");
	return `---\n${yamlText}\n---\n\n${body.replace(/^\s*\n/, "")}`;
}

async function listPosts() {
	const dir = safeResolve(POSTS_DIR);
	if (!(await exists(dir))) return [];
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const posts = [];
	for (const entry of entries) {
		if (!entry.isFile() || !/\.(md|mdx)$/i.test(entry.name)) continue;
		const file = path.join(POSTS_DIR, entry.name);
		const raw = await fs.readFile(safeResolve(file), "utf-8");
		const { frontmatter } = await parseFrontmatter(raw);
		const stat = await fs.stat(safeResolve(file));
		posts.push({
			slug: entry.name.replace(/\.(md|mdx)$/i, ""),
			file,
			title: frontmatter.title || entry.name,
			published: frontmatter.published ? String(frontmatter.published) : "",
			description: frontmatter.description || "",
			tags: frontmatter.tags || [],
			category: frontmatter.category || "",
			image: frontmatter.image || "",
			draft: frontmatter.draft === true,
			pinned: frontmatter.pinned === true,
			updatedAt: stat.mtime.toISOString(),
		});
	}
	posts.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
	return posts;
}

async function listMedia() {
	const result = {};
	for (const [key, dir] of Object.entries(MEDIA_DIRS)) {
		const abs = safeResolve(dir);
		if (!(await exists(abs))) {
			result[key] = [];
			continue;
		}
		const entries = await fs.readdir(abs, { withFileTypes: true });
		const files = [];
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const stat = await fs.stat(path.join(abs, entry.name));
			files.push({
				name: entry.name,
				path: mediaUrl(key, entry.name),
				repoPath: path.posix.join(dir, entry.name),
				size: stat.size,
				updatedAt: stat.mtime.toISOString(),
			});
		}
		files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		result[key] = files;
	}
	return result;
}

async function repoInfo() {
	const [branch, dirtyOut, remoteOut, logOut, upstreamOut, lastOut] = await Promise.all([
		git(["rev-parse", "--abbrev-ref", "HEAD"]),
		git(["status", "--porcelain"]),
		git(["remote", "get-url", "origin"]),
		git(["log", "-5", "--pretty=format:%h|%ad|%s", "--date=format:%m-%d %H:%M"]),
		// 与上游的差距：输出 "落后数<TAB>领先数"
		git(["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]),
		git(["log", "-1", "--format=%cI"]),
	]);
	const remote = remoteOut.stdout;
	const repoMatch = remote.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
	const files = dirtyOut.stdout
		? dirtyOut.stdout.split("\n").filter(Boolean)
		: [];
	const commits = logOut.stdout
		? logOut.stdout.split("\n").map((line) => {
				const [hash, date, subject] = line.split("|");
				return { hash, date, subject };
			})
		: [];
	let behind = 0;
	let ahead = 0;
	const counts = upstreamOut.stdout.split(/\s+/).filter(Boolean);
	if (counts.length === 2) {
		behind = Number(counts[0]) || 0;
		ahead = Number(counts[1]) || 0;
	}
	return {
		branch: branch.stdout || "unknown",
		dirty: files.length > 0,
		files,
		remote,
		owner: repoMatch?.[1] || "",
		repo: repoMatch?.[2]?.replace(/\.git$/, "") || "",
		commits,
		ahead,
		behind,
		lastCommitAt: lastOut.stdout || "",
	};
}

/** 查最近一次 GitHub Actions 运行（仓库公开，无需鉴权） */
async function latestAction() {
	const info = await repoInfo();
	if (!info.owner || !info.repo) return null;
	try {
		const res = await fetch(
			`https://api.github.com/repos/${info.owner}/${info.repo}/actions/runs?per_page=1`,
			{ headers: { "User-Agent": "zhi-blog-admin", Accept: "application/vnd.github+json" } },
		);
		if (!res.ok) return null;
		const data = await res.json();
		const run = data.workflow_runs?.[0];
		if (!run) return null;
		return {
			name: run.display_title,
			status: run.status,
			conclusion: run.conclusion,
			url: run.html_url,
			createdAt: run.created_at,
			number: run.run_number,
		};
	} catch {
		return null;
	}
}

/** 找 pnpm：直接命令 → corepack → npx（找不到返回 null） */
async function findPnpm() {
	const direct = await run("pnpm", ["--version"], { shell: process.platform === "win32" });
	if (direct.ok) return { cmd: "pnpm", prefix: [], shell: process.platform === "win32" };
	const corepack = await run("corepack", ["pnpm", "--version"], {
		shell: process.platform === "win32",
	});
	if (corepack.ok) {
		return { cmd: "corepack", prefix: ["pnpm"], shell: process.platform === "win32" };
	}
	return null;
}

async function publish(message, options = {}) {
	const steps = [];

	// 发布前把关：体检发现 error 级问题就先拦住（前端可以带 force 跳过）
	if (!options.force) {
		const report = await runDoctor(REPO_ROOT, { gitInfo: repoInfo });
		const errors = report.checks.filter((c) => c.level === "error");
		if (errors.length > 0) {
			return {
				ok: false,
				blocked: true,
				steps,
				report,
				message: `体检发现 ${errors.length} 个必须先修的问题，已阻止发布：${errors.map((e) => e.title).join("；")}`,
			};
		}
	}

	const add = await git(["add", "-A"]);
	steps.push({ name: "git add -A", ...add });

	const staged = await git(["diff", "--cached", "--name-only"]);
	if (!staged.stdout) {
		return { ok: false, dryRun: DRY_RUN_PUBLISH, steps, message: "没有需要提交的改动" };
	}
	const changedFiles = staged.stdout.split("\n").filter(Boolean);

	const commit = await git(["commit", "-m", message || "chore: 通过管理后台更新内容"]);
	steps.push({ name: "git commit", ...commit });
	if (!commit.ok) {
		return { ok: false, dryRun: DRY_RUN_PUBLISH, steps, message: commit.stderr || commit.message };
	}

	if (DRY_RUN_PUBLISH) {
		steps.push({ name: "git push（演练模式，已跳过）", ok: true, stdout: "", stderr: "" });
		const undo = await git(["reset", "--soft", "HEAD~1"]);
		steps.push({ name: "回滚本地提交（演练模式）", ...undo });
		return { ok: true, dryRun: true, steps, message: "演练模式：未真正推送" };
	}

	// 推送前先对齐远端：如果 GitHub 上有新提交（网页编辑、手机等），先 rebase 再推
	const fetched = await gitNet(["fetch", "origin"]);
	steps.push({
		name: fetched.viaDirect
			? "git fetch origin（代理不可用，已自动改用直连）"
			: "git fetch origin",
		...fetched,
	});
	const counts = await git(["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]);
	const parts = counts.stdout.split(/\s+/).filter(Boolean);
	const behind = Number(parts[0]) || 0;
	if (behind > 0) {
		const pull = await gitNet(["pull", "--rebase", "--autostash"]);
		steps.push({
			name: `git pull --rebase（远端有 ${behind} 个新提交）${pull.viaDirect ? "（改直连）" : ""}`,
			...pull,
		});
		if (!pull.ok) {
			return {
				ok: false,
				dryRun: false,
				steps,
				message: "远端有冲突，需要手动处理后再发布",
				files: changedFiles,
			};
		}
	}

	const pushed = await gitNet(["push"]);
	steps.push({
		name: pushed.viaDirect ? "git push（代理不可用，已自动改用直连）" : "git push",
		...pushed,
	});
	return {
		ok: pushed.ok,
		dryRun: false,
		steps,
		files: changedFiles,
		message: pushed.ok
			? "已推送到 GitHub，Actions 会自动构建并部署（约 1 分钟）"
			: pushed.stderr || pushed.message,
	};
}

/** 从远端同步：把 GitHub 上的新提交拉到本地（本地没有未提交改动时） */
async function syncFromRemote() {
	const steps = [];
	const dirty = await git(["status", "--porcelain"]);
	if (dirty.stdout) {
		return {
			ok: false,
			steps,
			message: "本地有未提交改动，先在「发布」页提交（或撤销）后再同步",
		};
	}
	const fetched = await gitNet(["fetch", "origin"]);
	steps.push({
		name: fetched.viaDirect
			? "git fetch origin（代理不可用，已自动改用直连）"
			: "git fetch origin",
		...fetched,
	});
	if (!fetched.ok) {
		return { ok: false, steps, message: fetched.stderr || fetched.message };
	}
	const counts = await git(["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]);
	const parts = counts.stdout.split(/\s+/).filter(Boolean);
	const behind = Number(parts[0]) || 0;
	const ahead = Number(parts[1]) || 0;
	if (behind === 0) {
		return {
			ok: true,
			steps,
			message: ahead > 0 ? `本地有 ${ahead} 个提交还没推送，去「发布」页推送` : "已经和 GitHub 一致",
		};
	}
	const pull = await gitNet(["pull", "--rebase", "--autostash"]);
	steps.push({
		name: `git pull --rebase（拉取 ${behind} 个远端提交）${pull.viaDirect ? "（改直连）" : ""}`,
		...pull,
	});
	return {
		ok: pull.ok,
		steps,
		message: pull.ok ? `已同步 GitHub 上的 ${behind} 个新提交` : pull.stderr || pull.message,
	};
}

// ── HTTP ────────────────────────────────────────────────────────────────────
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(body);
}

async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 64 * 1024 * 1024) throw new Error("请求体过大（上限 64 MB）");
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	const text = Buffer.concat(chunks).toString("utf-8");
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("请求体不是合法 JSON");
	}
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const route = url.pathname;
	const token = url.searchParams.get("token") || req.headers["x-admin-token"];

	try {
		// 静态页面：允许带 token 访问，页面内所有请求都会带上它
		if (route === "/" || route === "/index.html") {
			if (!tokenValid(token)) {
				res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
				res.end(
					`访问令牌不正确。请使用启动时打开的地址（含 ?token=…），或重新启动：node admin/server.mjs`,
				);
				return;
			}
			const html = await fs.readFile(UI_FILE, "utf-8");
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(html);
			return;
		}

		// 其余接口一律要令牌
		if (!tokenValid(token)) {
			sendJson(res, 403, { error: "令牌无效，请重新启动管理后台" });
			return;
		}

		const body = req.method === "POST" ? await readBody(req) : {};

		switch (route) {
			case "/api/status": {
				const [info, action, pnpm] = await Promise.all([
					repoInfo(),
					latestAction(),
					findPnpm(),
				]);
				sendJson(res, 200, {
					...info,
					action,
					hasPnpm: Boolean(pnpm),
					repoRoot: REPO_ROOT,
				});
				return;
			}
			case "/api/posts":
				sendJson(res, 200, { posts: await listPosts() });
				return;

			case "/api/post": {
				const slug = url.searchParams.get("slug");
				if (!slug) {
					sendJson(res, 400, { error: "缺少 slug" });
					return;
				}
				const file = `${POSTS_DIR}/${slug}.md`;
				if (!(await exists(safeResolve(file)))) {
					sendJson(res, 404, { error: `文章不存在: ${file}` });
					return;
				}
				const raw = await fs.readFile(safeResolve(file), "utf-8");
				const { frontmatter, body: md } = await parseFrontmatter(raw);
				sendJson(res, 200, { slug, file, frontmatter, body: md, raw });
				return;
			}

			case "/api/save-post": {
				const { slug, originalSlug, frontmatter, body: md } = body;
				if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug)) {
					sendJson(res, 400, { error: "slug 只能包含字母、数字、点、下划线和连字符" });
					return;
				}
				const content = await stringifyPost(frontmatter || {}, md || "");
				const target = safeResolve(`${POSTS_DIR}/${slug}.md`);
				await fs.mkdir(path.dirname(target), { recursive: true });
				await snapshotBefore(
					[`${POSTS_DIR}/${slug}.md`, originalSlug ? `${POSTS_DIR}/${originalSlug}.md` : null],
					"保存文章",
				);
				await fs.writeFile(target, content, "utf-8");
				if (originalSlug && originalSlug !== slug) {
					const oldFile = safeResolve(`${POSTS_DIR}/${originalSlug}.md`);
					if (await exists(oldFile)) await fs.rm(oldFile, { force: true });
				}
				sendJson(res, 200, { ok: true, file: `${POSTS_DIR}/${slug}.md` });
				return;
			}

			case "/api/delete-post": {
				const { slug } = body;
				if (!slug) {
					sendJson(res, 400, { error: "缺少 slug" });
					return;
				}
				if (!/^[A-Za-z0-9._-]+$/.test(String(slug))) {
					sendJson(res, 400, { error: "slug 只能包含字母、数字、点、下划线和连字符" });
					return;
				}
				const file = resolveInside(`${POSTS_DIR}/${slug}.md`, [POSTS_DIR]);
				await snapshotBefore(`${POSTS_DIR}/${slug}.md`, "删除文章");
				if (await exists(file)) await fs.rm(file, { force: true });
				sendJson(res, 200, { ok: true });
				return;
			}

			case "/api/media":
				sendJson(res, 200, { dirs: MEDIA_DIRS, files: await listMedia() });
				return;

			case "/api/upload": {
				const { dir, filename, dataBase64 } = body;
				if (!(dir in MEDIA_DIRS)) {
					sendJson(res, 400, { error: `未知目录: ${dir}` });
					return;
				}
				if (!filename || !dataBase64) {
					sendJson(res, 400, { error: "缺少文件名或数据" });
					return;
				}
				const safeName = path.basename(filename).replace(/[\\/]/g, "_");
				if (!UPLOAD_EXT[dir].test(safeName)) {
					sendJson(res, 400, {
						error: `该目录只允许 ${UPLOAD_EXT[dir].source} 类型的文件：${safeName}`,
					});
					return;
				}
				const target = resolveInside(path.posix.join(MEDIA_DIRS[dir], safeName), [MEDIA_DIRS[dir]]);
				await fs.mkdir(path.dirname(target), { recursive: true });
				const buffer = Buffer.from(dataBase64, "base64");
				await fs.writeFile(target, buffer);
				// 音频自动提取封面（APIC/FLAC PICTURE/MP4 covr）与歌词（USLT/SYLT/Vorbis/©lyr）
				const extracted =
					dir === "music" && AUDIO_EXT.test(safeName)
						? await extractAndStoreAudio(buffer, safeName)
						: {};
				sendJson(res, 200, {
					ok: true,
					name: safeName,
					bytes: buffer.length,
					path: mediaUrl(dir, safeName),
					repoPath: path.posix.join(MEDIA_DIRS[dir], safeName),
					...extracted,
				});
				return;
			}

			case "/api/delete-media": {
				const repoPath = body.repoPath;
				if (!repoPath) {
					sendJson(res, 400, { error: "缺少 repoPath" });
					return;
				}
				let target;
				try {
					target = resolveInside(repoPath, Object.values(MEDIA_DIRS));
				} catch {
					sendJson(res, 400, { error: "只能删除媒体目录里的文件" });
					return;
				}
				if (await exists(target)) await fs.rm(target, { force: true });
				sendJson(res, 200, { ok: true });
				return;
			}

			case "/api/announcements": {
				if (req.method === "GET") {
					sendJson(res, 200, { items: await readJsonData("announcements") });
					return;
				}
				const items = sanitizeAnnouncements(body.items);
				await writeJsonData("announcements", items);
				sendJson(res, 200, {
					ok: true,
					items,
					message: `已保存 ${items.length} 条公告${items.some((i) => i.pinned) ? "（含 1 条固定公告）" : "（没有固定公告）"}`,
				});
				return;
			}

			case "/api/playlist": {
				if (req.method === "GET") {
					sendJson(res, 200, { songs: await readJsonData("playlist") });
					return;
				}
				const songs = sanitizePlaylist(body.songs);
				await writeJsonData("playlist", songs);
				sendJson(res, 200, { ok: true, songs, message: `已保存 ${songs.length} 首歌` });
				return;
			}

			case "/api/save-lyrics": {
				// 把「无时间戳的歌词」按音频时长铺开成 LRC（前端从 <audio> 拿到时长后调用）
				const { url: audioUrl, text, duration } = body;
				if (!audioUrl || !text) {
					sendJson(res, 400, { error: "缺少音频路径或歌词文本" });
					return;
				}
				const base = path.basename(String(audioUrl)).replace(/\.[^.]+$/, "");
				const lrc = plainLyricsToLrc(String(text), Number(duration) || 0);
				if (!lrc) {
					sendJson(res, 400, { error: "歌词内容为空" });
					return;
				}
				await fs.mkdir(safeResolve("public/assets/music/lrc"), { recursive: true });
				await fs.writeFile(
					safeResolve(`public/assets/music/lrc/${base}.lrc`),
					lrc,
					"utf-8",
				);
				sendJson(res, 200, { ok: true, path: `/assets/music/lrc/${base}.lrc` });
				return;
			}

			case "/api/extract-audio": {
				// 对已经存在的音频重新提取一次（老歌曲也能补上封面/歌词）
				const repoPath = String(body.repoPath || (body.url ? `public${body.url}` : ""));
				let file;
				try {
					file = resolveInside(repoPath, [MEDIA_DIRS.music]);
				} catch {
					sendJson(res, 400, { error: "只能处理 public/assets/music 下的音频" });
					return;
				}
				const buffer = await fs.readFile(file).catch(() => null);
				if (!buffer) {
					sendJson(res, 404, { error: "音频文件不存在" });
					return;
				}
				const extracted = await extractAndStoreAudio(buffer, path.basename(file));
				sendJson(res, 200, { ok: true, ...extracted });
				return;
			}

			case "/media-file": {
				// 本地试听/预览：把媒体目录里的文件读出来（管理面板不是静态服务器，不能直接开 /assets 路径）
				const repoPath = url.searchParams.get("path");
				if (!repoPath) {
					sendJson(res, 400, { error: "只能读取媒体目录里的文件" });
					return;
				}
				let file;
				try {
					file = resolveInside(repoPath, Object.values(MEDIA_DIRS));
				} catch {
					sendJson(res, 400, { error: "只能读取媒体目录里的文件" });
					return;
				}
				const stat = await fs.stat(file).catch(() => null);
				if (!stat || !stat.isFile()) {
					sendJson(res, 404, { error: "文件不存在" });
					return;
				}
				const types = {
					".mp3": "audio/mpeg",
					".m4a": "audio/mp4",
					".aac": "audio/aac",
					".wav": "audio/wav",
					".flac": "audio/flac",
					".ogg": "audio/ogg",
					".png": "image/png",
					".jpg": "image/jpeg",
					".jpeg": "image/jpeg",
					".webp": "image/webp",
					".gif": "image/gif",
					".lrc": "text/plain; charset=utf-8",
				};
				const headers = {
					"Content-Type":
						types[path.extname(file).toLowerCase()] || "application/octet-stream",
					"Accept-Ranges": "bytes",
					"Cache-Control": "no-store",
				};
				const range = req.headers.range;
				const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
				if (match) {
					const start = match[1] ? Number(match[1]) : 0;
					const end = match[2] ? Number(match[2]) : stat.size - 1;
					res.writeHead(206, {
						...headers,
						"Content-Range": `bytes ${start}-${end}/${stat.size}`,
						"Content-Length": end - start + 1,
					});
					createReadStream(file, { start, end }).pipe(res);
				} else {
					res.writeHead(200, { ...headers, "Content-Length": stat.size });
					createReadStream(file).pipe(res);
				}
				return;
			}

			case "/api/configs":
				sendJson(res, 200, { files: CONFIG_FILES });
				return;

			case "/api/config-file": {
				if (req.method === "GET") {
					const rel = url.searchParams.get("path");
					if (!rel || !CONFIG_FILES.includes(rel)) {
						sendJson(res, 400, { error: "不在可编辑白名单内" });
						return;
					}
					const content = await fs.readFile(safeResolve(rel), "utf-8");
					sendJson(res, 200, { path: rel, content });
					return;
				}
				const { path: rel, content } = body;
				if (!rel || !CONFIG_FILES.includes(rel)) {
					sendJson(res, 400, { error: "不在可编辑白名单内" });
					return;
				}
				await snapshotBefore(rel, "保存配置文件");
				await fs.writeFile(safeResolve(rel), content ?? "", "utf-8");
				sendJson(res, 200, { ok: true, path: rel });
				return;
			}

			case "/api/sync": {
				const result = await syncFromRemote();
				sendJson(res, 200, result);
				return;
			}

			case "/api/publish": {
				const result = await publish(body.message, { force: body.force === true });
				sendJson(res, 200, result);
				return;
			}

			case "/api/doctor": {
				const report = await runDoctor(REPO_ROOT, { gitInfo: repoInfo });
				sendJson(res, 200, report);
				return;
			}

			case "/api/settings": {
				if (req.method !== "POST") {
					sendJson(res, 200, {
						values: readSettings(REPO_ROOT),
						defs: SETTINGS_DEFS,
						pagePrefix: "pages.",
					});
					return;
				}
				const patch = body?.values && typeof body.values === "object" ? body.values : body;
				const result = await applySettings(REPO_ROOT, patch, async (rel) => {
					await snapshotBefore(rel, "修改站点设置");
				});
				sendJson(res, 200, {
					ok: true,
					...result,
					message: `已更新 ${result.changed.length} 项设置（改动前的版本已自动备份）`,
				});
				return;
			}

			case "/api/backups": {
				sendJson(res, 200, { backups: await listSnapshots(REPO_ROOT) });
				return;
			}

			case "/api/restore": {
				const result = await restoreSnapshot(REPO_ROOT, body.id, body.rel);
				sendJson(res, 200, result);
				return;
			}

			case "/api/run": {
				const { script } = body;
				const allowed = { build: ["build"], dev: ["dev"], check: ["check"] };
				if (!(script in allowed)) {
					sendJson(res, 400, { error: `不支持的脚本: ${script}` });
					return;
				}
				const pnpm = await findPnpm();
				if (!pnpm) {
					sendJson(res, 200, {
						ok: false,
						output:
							"本地没有检测到 pnpm。\n发布（git push）不需要它——GitHub Actions 会完成构建与部署。\n如需本地预览/构建，请先执行：corepack enable pnpm",
					});
					return;
				}
				const result = await run(
					pnpm.cmd,
					[...pnpm.prefix, ...allowed[script]],
					{ shell: pnpm.shell },
				);
				sendJson(res, 200, {
					ok: result.ok,
					output: `${result.stdout}\n${result.stderr}`.trim().slice(-8000),
				});
				return;
			}

			case "/api/diff": {
				const staged = await git(["diff", "--stat"]);
				sendJson(res, 200, { stat: staged.stdout });
				return;
			}

			default:
				sendJson(res, 404, { error: `未知接口: ${route}` });
		}
	} catch (error) {
		sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
	}
});

server.listen(PORT, "127.0.0.1", async () => {
	const info = await repoInfo();
	const url = `http://127.0.0.1:${PORT}/?token=${TOKEN}`;
	console.log("");
	console.log("  栀海博客 · 本地管理后台已启动");
	console.log(`  仓库：${info.remote || REPO_ROOT}`);
	console.log(`  分支：${info.branch}${info.dirty ? `（有 ${info.files.length} 处未提交改动）` : "（干净）"}`);
	console.log("");
	console.log(`  请在浏览器打开：${url}`);
	console.log("  仅监听 127.0.0.1；关闭此窗口即停止服务（Ctrl+C）");
	console.log("");
	if (AUTO_OPEN) {
		const opener =
			process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: process.platform === "darwin"
					? ["open", [url]]
					: ["xdg-open", [url]];
		run(opener[0], opener[1]).catch(() => {});
	}
});
