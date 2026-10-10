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
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
	"src/config/navBarConfig.ts",
	"src/config/profileConfig.ts",
	"src/config/sidebarConfig.ts",
	"src/config/announcementConfig.ts",
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

/** 把仓库内的相对路径解析成绝对路径，并阻止越界访问 */
function safeResolve(relative) {
	const abs = path.resolve(REPO_ROOT, relative);
	if (!abs.startsWith(REPO_ROOT)) throw new Error(`路径越界: ${relative}`);
	return abs;
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
	const [branch, dirtyOut, remoteOut, logOut] = await Promise.all([
		git(["rev-parse", "--abbrev-ref", "HEAD"]),
		git(["status", "--porcelain"]),
		git(["remote", "get-url", "origin"]),
		git(["log", "-5", "--pretty=format:%h|%ad|%s", "--date=format:%m-%d %H:%M"]),
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
	return {
		branch: branch.stdout || "unknown",
		dirty: files.length > 0,
		files,
		remote,
		owner: repoMatch?.[1] || "",
		repo: repoMatch?.[2]?.replace(/\.git$/, "") || "",
		commits,
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

async function publish(message) {
	const steps = [];
	const add = await git(["add", "-A"]);
	steps.push({ name: "git add -A", ...add });

	const staged = await git(["diff", "--cached", "--name-only"]);
	if (!staged.stdout) {
		return { ok: false, dryRun: DRY_RUN_PUBLISH, steps, message: "没有需要提交的改动" };
	}

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

	const push = await git(["push"]);
	steps.push({ name: "git push", ...push });
	return {
		ok: push.ok,
		dryRun: false,
		steps,
		message: push.ok ? "已推送，GitHub Actions 会自动构建并部署（约 1 分钟）" : push.stderr || push.message,
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
			if (token !== TOKEN) {
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
		if (token !== TOKEN) {
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
				const file = safeResolve(`${POSTS_DIR}/${slug}.md`);
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
				const target = safeResolve(path.posix.join(MEDIA_DIRS[dir], safeName));
				await fs.mkdir(path.dirname(target), { recursive: true });
				const buffer = Buffer.from(dataBase64, "base64");
				await fs.writeFile(target, buffer);
				sendJson(res, 200, {
					ok: true,
					name: safeName,
					bytes: buffer.length,
					path: mediaUrl(dir, safeName),
					repoPath: path.posix.join(MEDIA_DIRS[dir], safeName),
				});
				return;
			}

			case "/api/delete-media": {
				const repoPath = body.repoPath;
				if (!repoPath) {
					sendJson(res, 400, { error: "缺少 repoPath" });
					return;
				}
				const inWhitelist = Object.values(MEDIA_DIRS).some((dir) =>
					repoPath.startsWith(`${dir}/`),
				);
				if (!inWhitelist) {
					sendJson(res, 400, { error: "只能删除媒体目录里的文件" });
					return;
				}
				const file = safeResolve(repoPath);
				if (await exists(file)) await fs.rm(file, { force: true });
				sendJson(res, 200, { ok: true });
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
				await fs.writeFile(safeResolve(rel), content ?? "", "utf-8");
				sendJson(res, 200, { ok: true, path: rel });
				return;
			}

			case "/api/publish": {
				const result = await publish(body.message);
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
