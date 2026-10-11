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

import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 更新公告草稿：真正会出错的规则（提交解析 / 分组 / Markdown 转义 / 参数校验）都在这个纯函数文件里，
// 这里只负责「跑 git log（只读）+ 拼 HTTP 响应」
import {
	COMMIT_LOG_FORMAT,
	MAX_FETCH,
	buildAnnouncementDraft,
	daysAgoIsoDate,
	describeRangeLabel,
	formatDay,
	parseCommitLog,
	parseDraftQuery,
	suggestDraftId,
} from "./announcement-draft.mjs";
import { extractAudioMeta, mimeToExt, plainLyricsToLrc } from "./audio-meta.mjs";
import { AVATAR_DEFAULT, applyAvatar, describeAvatar, restoreDefaultAvatar } from "./avatar.mjs";
import { createSnapshot, listSnapshots, restoreSnapshot } from "./backups.mjs";
import { PUBLISH_SCOPE, parsePorcelainEntriesZ, stageForPublish } from "./publish-scope.mjs";
// CI 失败详情：纯逻辑（正则解析 / 步骤提取 / 摘要 / 带缓存请求）都在 ci.mjs 里，这里只接线
import {
	CI_CACHE_TTL_MS,
	CI_TIMEOUT_MS,
	FAILURE_CONCLUSIONS,
	GITHUB_HEADERS,
	conclusionFromWorkflowRuns,
	describeFailure,
	extractRunId,
	fetchWithCache,
	groupWorkflowRunsBySha,
	isRateLimitedResponse,
	pickFailingJobs,
	pickFailingSteps,
	rateLimitWarning,
	statusFromWorkflowRuns,
	tailLines,
} from "./ci.mjs";
import { runDoctor } from "./doctor.mjs";
import { handleFriends, handleFriendsFetch } from "./friends.mjs";
import { COMPRESS_DIRS, compressImages } from "./media-compress.mjs";
import { MAX_IMPORT_BYTES, convertToMarkdown } from "./import-doc.mjs";
import { handleNav } from "./nav.mjs";
import { PAGE_BLOCK, PAGE_FILE, PAGE_PREFIX, SETTINGS_DEFS, applySettings, readSettings } from "./settings.mjs";
import { createZip } from "./zip.mjs";

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

// ── 会话 Cookie ─────────────────────────────────────────────────────────────
// 把访问令牌换成 HttpOnly Cookie：地址栏里的 ?token= 只用于「首次进页面」，
// 页面加载后令牌就存进 HttpOnly Cookie，脚本读不到，也不会随页面内链泄漏到 Referer。
// 签名密钥直接用本次启动的一次性 TOKEN，所以重启面板后旧 Cookie 自动失效。
const SESSION_COOKIE = "admin_session";
const SESSION_SECRET = TOKEN;
const SESSION_VALUE = createHmac("sha256", SESSION_SECRET).update("admin-session").digest("hex");

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
	"src/config/friends.json", "src/config/feature-tour.json",
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
// 文章 slug 的唯一合法形态：字母 / 数字 / 点 / 下划线 / 连字符。
// 它会被拼进 `src/content/posts/<slug>.md`，所以**任何**拼路径的接口都必须先用它卡一遍
// （只要放行 `/` 或 `..`，就等于允许读写任意外部路径）。
const POST_SLUG_RE = /^[A-Za-z0-9._-]+$/;
// 快照目录（与 backups.mjs 里的 BACKUP_DIR 保持一致），导出 ZIP 时要按它拼路径
const BACKUP_DIR = "admin-backups";

// /media-file 的读取白名单 = 上面这些媒体目录 + 友链图标目录。
// 友链图标单独列出来，是因为「友链」页签要显示 public/friends 里的缩略图，
// 但它**不允许**通过上传/删除接口写入，所以不能塞进 MEDIA_DIRS。
const MEDIA_READ_DIRS = [...Object.values(MEDIA_DIRS), "public/friends"];

// 音乐压缩脚本的参数白名单：用户只能选这三个动作，命令行参数由服务端拼出来
const MUSIC_MODES = {
	all: ["--all"],
	covers: ["--covers"],
	// 关键：compress-music.mjs 里 doAudio = !args.includes("--covers") || args.includes("--all")，
	// 也就是**不加任何参数 = 真的压缩音频并改写歌单**。所以"只检查不改动"必须显式带 --dry-run，
	// 这里绝不能留空数组（否则面板上的「先试算」会变成破坏性操作）。
	check: ["--dry-run"],
};
// 音频重编码 + 封面压缩可能跑好几分钟，给足超时
const MUSIC_COMPRESS_TIMEOUT = 10 * 60 * 1000;

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
/**
 * 跑一个子进程并收集输出。
 *
 * `raw: true` 表示**不 trim** stdout —— 这不是洁癖：`git status --porcelain` 的第一条记录
 * 可能是 ` M path`（以空格开头），trim 会把那个空格吃掉，于是「状态码 + 路径」整体错位一个字符
 * （`README.md` 会变成 `EADME.md`），发布时 `git add -- <错路径>` 就会失败。
 */
function run(cmd, cmdArgs, options = {}) {
	const { raw, ...execOptions } = options;
	return new Promise((resolve) => {
		execFile(
			cmd,
			cmdArgs,
			{ cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024, ...execOptions },
			(error, stdout, stderr) => {
				const out = stdout || "";
				const err = stderr || "";
				resolve({
					ok: !error,
					code: error?.code ?? 0,
					stdout: raw ? out : out.trim(),
					stderr: raw ? err : err.trim(),
					message: error?.message || "",
				});
			},
		);
	});
}

async function git(gitArgs, options) {
	return run("git", gitArgs, options);
}

/** `git status --porcelain -z`：必须保留原始字节（见 run 的 raw 说明） */
async function gitStatusZ() {
	return git(["status", "--porcelain", "-z", "--untracked-files=all"], { raw: true });
}

/**
 * 跑 `node scripts/compress-music.mjs`（音乐/封面压缩）。
 *
 * 两个刻意的细节：
 * - stdio 用 "inherit"：压缩脚本会打印大量进度，而管道方式在受限环境里起不来子进程；
 *   让它直接继承本进程的输出，进度就打在启动管理面板的那个黑窗口里。
 * - 整个 execFile 包在 try 里：它**可能同步抛错**（例如被沙箱/权限拦下时直接抛 spawn EPERM），
 *   只注册回调是接不住的，那样会冒到最外层 catch 变成 500，前端只能看到一句莫名的报错。
 */
function runMusicCompress(scriptArgs) {
	const command = `node ${scriptArgs.join(" ")}`;
	return new Promise((resolve) => {
		try {
			execFile(
				process.execPath,
				scriptArgs,
				{ cwd: REPO_ROOT, timeout: MUSIC_COMPRESS_TIMEOUT, stdio: "inherit" },
				(error) => {
					const detail = error ? error.message || String(error) : "";
					resolve({
						ok: !error,
						output: error
							? `压缩脚本执行失败：${detail}\n（进度与详细输出请查看启动管理面板的命令行窗口）`
							: "压缩完成。进度与详细输出在启动管理面板的命令行窗口里，可按需 git diff 查看改动。",
						command,
					});
				},
			);
		} catch (error) {
			resolve({
				ok: false,
				output: `压缩脚本没能启动：${error?.message ?? error}\n（常见原因：运行环境不允许拉起子进程，或被安全软件拦截）`,
				command,
			});
		}
	});
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

/**
 * ── 更新公告草稿（GET /api/announcement-draft）─────────────────────────────
 * 解决的是「加完功能，老访客不知道你改了什么」：读 git log（**只读**）→ 交给纯函数
 * 分组整理成中文草稿 → 回给前端填进公告表单，让人确认/删减后再保存。
 *
 * 三条刻意设计的边界：
 *   1. **绝不写盘**：不碰 announcements.json、不打快照、不改任何文件（测试里会验证请求前后
 *      `git status` 不变）；
 *   2. **绝不自动发布**：它只产草稿；保存仍走 POST /api/announcements，上线仍走「发布」页；
 *   3. **git 失败一律降级**：给可读中文原因 + 合适的 4xx/5xx，绝不抛未捕获异常。
 */

/** 判断「上次公告」是哪个提交：最后一次改动 announcements.json 的那条 */
async function lastAnnouncementCommit() {
	const result = await git([
		"--no-pager",
		"log",
		"-1",
		"--format=%H",
		"--",
		DATA_FILES.announcements,
	]);
	if (!result.ok) return null;
	const sha = result.stdout.split(/\r?\n/)[0].trim();
	return /^[0-9a-fA-F]{7,40}$/.test(sha) ? sha : null;
}

/** git 用不了时的兜底起点：公告里出现过的最新发布日期 */
async function lastAnnouncementDate() {
	try {
		const items = await readJsonData("announcements");
		const days = items
			.map((item) => String(item?.published ?? "").slice(0, 10))
			.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
			.sort();
		return days.length > 0 ? days[days.length - 1] : null;
	} catch {
		return null;
	}
}

/**
 * 生成草稿并组装 HTTP 响应（status + payload 都由这里决定，路由里只负责发出去）。
 * @param {{since: null|{kind: string, value: string|number, label: string}, limit: number}} query
 */
async function announcementDraftResponse(query) {
	const now = Date.now();
	const warnings = [];
	let mode = "recent";
	let since = null;
	let rangeArgs = [];
	let cap = MAX_FETCH;

	if (query.since) {
		since = query.since.value;
		mode = query.since.kind;
		if (query.since.kind === "sha") {
			// 语法合法但不存在（或不是提交）的 sha：这是用户填错了，回 400 而不是 500
			const exists = await git([
				"rev-parse",
				"--verify",
				"--quiet",
				`${query.since.value}^{commit}`,
			]);
			if (!exists.ok || !exists.stdout.trim()) {
				return {
					status: 400,
					payload: {
						error: `起始提交不存在：${query.since.value}（也可以改填天数，例如 since=30，或日期 2026-10-01）`,
					},
				};
			}
			rangeArgs = [`${query.since.value}..HEAD`];
		} else if (query.since.kind === "date") {
			rangeArgs = [`--since=${query.since.value}`];
		} else {
			since = daysAgoIsoDate(query.since.value, now);
			rangeArgs = [`--since=${since}`];
		}
	} else {
		// 默认：自「上次公告」之后。优先用提交（精确到发布那一刻），其次用公告里的日期
		const commit = await lastAnnouncementCommit();
		if (commit) {
			mode = "announcement-commit";
			since = commit;
			rangeArgs = [`${commit}..HEAD`];
		} else {
			const date = await lastAnnouncementDate();
			if (date) {
				mode = "announcement-date";
				since = date;
				rangeArgs = [`--since=${date}`];
			} else {
				mode = "recent";
				cap = query.limit;
				warnings.push(
					"判断不出「上次公告」是哪次提交（git 历史或公告文件读不到），已退化成取最近若干条提交。可以手动填起始点（天数 / 日期 / 提交 sha）缩小范围。",
				);
			}
		}
	}

	const log = await git([
		"--no-pager",
		"log",
		`--pretty=format:${COMMIT_LOG_FORMAT}`,
		"-n",
		String(cap),
		...rangeArgs,
	]);
	if (!log.ok) {
		const detail = (log.stderr || log.message || "").split(/\r?\n/)[0].trim();
		return {
			status: 502,
			payload: {
				error: `读取 git 历史失败${detail ? `：${detail}` : ""}（请确认当前目录是 git 仓库；也可以改填 since 参数缩小范围）`,
			},
		};
	}

	const commits = parseCommitLog(log.stdout);
	const draft = buildAnnouncementDraft(commits, { now });
	const truncated = commits.length >= cap;
	if (truncated) {
		warnings.push(
			`只读取了前 ${cap} 条提交（区间里的提交更多）：请填一个更近的起始点，或分批生成，不要漏发。`,
		);
	}
	const label = query.since
		? query.since.label
		: describeRangeLabel({ mode, limit: query.limit, since });
	const payload = {
		ok: true,
		hasDraft: !draft.stats.empty,
		empty: draft.stats.empty,
		range: {
			mode,
			label,
			since,
			limit: query.limit,
			fetched: commits.length,
			truncated,
			cap,
		},
		draft: draft.stats.empty
			? null
			: {
					// id 必须满足公告 id 的既有约束（字母数字与 . _ -），见 sanitizeAnnouncements
					id: suggestDraftId(commits, now),
					title: draft.title,
					published: formatDay(now),
					version: formatDay(now),
					type: "info",
					// 默认不勾固定：固定公告只能有一条，勾不勾是人的决定（草稿里会提示）
					pinned: false,
					content: draft.body,
					links: [],
				},
		warnings: [...warnings, ...draft.warnings],
		stats: draft.stats,
		commits: commits.map((commit) => ({
			hash: commit.hash,
			shortHash: commit.shortHash,
			type: commit.type,
			scope: commit.scope,
			subject: commit.text,
			breaking: commit.breaking,
			conventional: commit.conventional,
			merge: commit.merge,
		})),
		message: draft.stats.empty
			? "没有可用的提交，未生成草稿（不会用一条空公告糊弄访客）"
			: `已生成草稿：${draft.title}（${draft.stats.used} 条要点）。请确认或删减后点「保存」，再去「发布」页推送即可上线。`,
	};
	return { status: 200, payload };
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

/** 从 Cookie 头里取某个 cookie 的值（不引依赖，够用即可） */
function readCookie(req, name) {
	const header = req.headers.cookie;
	if (!header) return "";
	for (const part of String(header).split(";")) {
		const index = part.indexOf("=");
		if (index < 0) continue;
		if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
	}
	return "";
}

/**
 * 会话 Cookie 是否有效。
 * 注意要比的是**签名**而不是原始令牌：签名 64 位、令牌 32 位，长度就对不上；
 * 用 tokenValid 去比会永远返回 false。这里同样用恒定时间比较。
 */
function sessionValid(req) {
	const provided = readCookie(req, SESSION_COOKIE);
	if (!provided) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(SESSION_VALUE);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * 认证总入口：Cookie 有效，或 `x-admin-token` 头有效，或 `?token=` 有效，三者任一即可。
 * 为什么要保留后两者：ZIP 导出、媒体试听这类用 <a href> / <audio src> 发起的请求
 * 不方便带请求头，只能把令牌放在 URL 里；旧书签里的 ?token= 地址也要继续能用。
 */
function isAuthed(req, url) {
	if (sessionValid(req)) return true;
	return tokenValid(url.searchParams.get("token") || req.headers["x-admin-token"]);
}

/** 登录成功后下发的会话 Cookie：HttpOnly + SameSite=Strict，只监听 127.0.0.1 所以不需要 Secure */
function sessionCookie() {
	return `${SESSION_COOKIE}=${SESSION_VALUE}; HttpOnly; SameSite=Strict; Path=/`;
}

/** 退出登录：清掉会话 Cookie */
function clearSessionCookie() {
	return `${SESSION_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * 写操作之前的快照：把原文件另存到 admin-backups/（已 gitignore，不会提交也不会发布）。
 * 备份失败不阻断保存，但会把警告返回给前端。
 */
async function snapshotBefore(rels, reason, options = {}) {
	try {
		const list = (Array.isArray(rels) ? rels : [rels]).filter(Boolean);
		for (const rel of list) safeResolve(rel); // 越界直接抛错
		const result = await createSnapshot(REPO_ROOT, list, { reason, ...options });
		// 超过体积上限被跳过的文件要明确告诉用户，否则他会以为"备份一定有"
		if (result?.skipped?.length > 0) {
			const detail = result.skipped.map((s) => `${s.rel}（${Math.round(s.size / 1024)}KB：${s.reason}）`).join("；");
			return { ...result, warning: `以下文件体积过大，未纳入快照：${detail}` };
		}
		return result;
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

// ── 「这个值落在哪个真实文件里」─────────────────────────────────────────────
//
// 面板上每一处路径都必须来自后端：要么是 fs.readdir / git 返回的，要么是按**站点约定**拼出来
// 并当场 stat 核对过的。这一组小函数就是后半句的公共实现，前端只负责显示，绝不自己拼路径。

/**
 * 站内公开路径 → 仓库相对路径。
 * 站点的 web 根是 `public/`（`astro` 的约定），所以 `/assets/music/a.mp3` 就是
 * `public/assets/music/a.mp3`。只认「以单个 / 开头」的写法；远程 URL、`//` 协议相对、
 * 相对路径一律返回 null（**不猜**）。
 */
function publicUrlToRepoPath(url) {
	const text = String(url ?? "").trim();
	if (!text.startsWith("/") || text.startsWith("//")) return null;
	return `public${text.replace(/\\/g, "/")}`;
}

/**
 * 核对一组「站内公开路径」各自对应的真实文件。
 * @param urls 待核对的 URL（可以是 null / 远程 URL —— 那些返回 null，不显示路径徽章）
 * @returns 与 urls 等长的数组，元素为 null 或 { repoPath, exists, size }
 */
async function describeLocalFiles(urls) {
	const out = [];
	for (const url of urls) {
		const repoPath = publicUrlToRepoPath(url);
		if (!repoPath) {
			out.push(null);
			continue;
		}
		let abs;
		try {
			// 必须在仓库内才认（`/../etc/passwd` 这类写法直接判为「没有本地文件」）
			abs = resolveInside(repoPath);
		} catch {
			out.push(null);
			continue;
		}
		const stat = await fs.stat(abs).catch(() => null);
		out.push({
			repoPath,
			exists: Boolean(stat?.isFile()),
			size: stat?.isFile() ? stat.size : null,
		});
	}
	return out;
}

/**
 * 「打开所在文件夹」：Windows 上用 `explorer /select,<绝对路径>` 选中该文件（目录则打开它）。
 *
 * 三个刻意的写法：
 *   1. 用 `spawn` 而不是 `execFile`+回调等待：explorer 会自己活得比请求久（而且退出码通常是 1），
 *      等它只会把接口挂住。`detached: true` + `unref()` 让子进程与本次请求彻底脱钩。
 *   2. `stdio: "ignore"`：不建管道（受限环境里建管道会 EPERM），也不需要它的输出。
 *   3. 同步抛错（例如环境不允许起子进程）在这里接住并返回可读中文，绝不让它冒到最外层变 500。
 *
 * 非 Windows 一律返回 ok:false + 说明：宁可不做，也不要拉起一个行为不确定的命令。
 */
function revealInExplorer(abs) {
	if (process.platform !== "win32") {
		return {
			ok: false,
			message: "「打开所在文件夹」只在 Windows 上可用；其它系统请在文件管理器里手动定位：",
		};
	}
	try {
		const child = spawn("explorer.exe", [`/select,${abs}`], {
			detached: true,
			stdio: "ignore",
		});
		// 拉起失败（缺 explorer.exe）也不能变成未捕获异常：错误已经按 ok:false 回给前端了
		child.on("error", () => {});
		child.unref();
		return { ok: true };
	} catch (error) {
		return { ok: false, message: `没能拉起资源管理器：${error?.message ?? error}` };
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

/**
 * 从文章正文里找出它引用的**本地图片**，并逐个核对真实文件。
 *
 * 只认 `./images/<文件名>` 这一种写法 —— 面板把「文章图片」的引用前缀固定成了
 * `MEDIA_URL_PREFIX["post-images"]`（见该常量的注释），正文里就该这么写。
 * 其它写法（远程 URL、`/assets/...`、子目录、`../`）一律**不猜**：猜出来的路径只会让作者去找一个不存在的位置。
 *
 * 正则刻意带一个「后面必须紧跟收尾符」的断言（`)` / 引号 / `>`，中间可以有一个
 * Markdown 标题 `"…"`）：文件名里出现空格时 markdown 本身就已经坏了，这时**宁可不列出**，
 * 也不要截出一段半截文件名去 stat —— 那会显示一个编造的路径。
 *
 * 不存在的引用也会返回（`exists: false`）——「文章引用了它，但文件不在」本身就是有用的信息，
 * 面板会如实标出来，而不是假装它存在。
 * @returns [{ ref, repoPath, exists, size }]
 */
async function postImages(markdown) {
	const dir = MEDIA_DIRS["post-images"];
	const prefix = MEDIA_URL_PREFIX["post-images"];
	const found = [];
	const seen = new Set();
	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// `(?<![\w./-])`：前缀前面不能紧跟路径字符，否则 `../images/x.png` 会因为其中**含有**
	// `./images/` 而被误判成 `./images/x.png`（那就等于把一个上跳路径显示成了仓库内路径）。
	// 结尾断言 `[)"'>]|$`：正文里是 `](./images/x.png)` / `"…"` / `>` 收尾，
	// 而 frontmatter 的 `image` 是**裸路径**（后面什么都没有），所以必须允许行尾。
	const pattern = new RegExp(
		`(?<![\\w./-])${escapedPrefix}([^)"'\\s>]+)(?=\\s*(?:["'][^"']*["']\\s*)?(?:[)"'>]|$))`,
		"g",
	);
	for (const match of String(markdown ?? "").matchAll(pattern)) {
		const raw = match[1];
		// 只允许「images 目录下的一个文件名」：带 / 或 ? 或 # 的写法不认（可能是子目录或查询串）
		if (!/^[^/\\?#]+$/.test(raw)) continue;
		const repoPath = path.posix.join(dir, raw);
		if (seen.has(repoPath)) continue;
		seen.add(repoPath);
		let existsLocal = false;
		let size = null;
		try {
			const stat = await fs.stat(resolveInside(repoPath, [dir]));
			existsLocal = stat.isFile();
			if (existsLocal) size = stat.size;
		} catch {
			existsLocal = false;
		}
		found.push({ ref: `${prefix}${raw}`, repoPath, exists: existsLocal, size });
	}
	return found.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
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

/**
 * 收集标签/分类候选：扫所有文章的 frontmatter，给前端做下拉用。
 * 前端拿到的是「当前写过的」而不是硬编码清单，主题里新加的标签自动出现。
 */
async function taxonomy() {
	const posts = await listPosts();
	const tags = new Set();
	const categories = new Set();
	for (const post of posts) {
		for (const tag of Array.isArray(post.tags) ? post.tags : []) {
			const text = String(tag).trim();
			if (text) tags.add(text);
		}
		const category = String(post.category ?? "").trim();
		if (category) categories.add(category);
	}
	// 中文按本地顺序（拼音/笔画）排更符合直觉，英文再按字母序
	const sorter = (a, b) => a.localeCompare(b, "zh-Hans-CN");
	const tagList = [...tags].sort(sorter);
	const categoryList = [...categories].sort(sorter);
	return { tags: tagList, categories: categoryList, allTags: tagList };
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
		gitStatusZ(),
		git(["remote", "get-url", "origin"]),
		git(["log", "-5", "--pretty=format:%h|%ad|%s", "--date=format:%m-%d %H:%M"]),
		// 与上游的差距：输出 "落后数<TAB>领先数"
		git(["rev-list", "--count", "--left-right", "@{upstream}...HEAD"]),
		git(["log", "-1", "--format=%cI"]),
	]);
	const remote = remoteOut.stdout;
	const repoMatch = remote.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
	// changed 是结构化的「状态码 + 路径」（前端与体检报告都靠它显示真实文件路径）；
	// files 保留成可读的单行文本，只是为了让「未提交改动有几处」这类计数继续成立。
	const changed = parsePorcelainEntriesZ(dirtyOut.stdout).filter((entry) => entry.path);
	const files = changed.map((entry) => `${entry.code} ${entry.path}`);
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
		// 结构化的改动列表（{ code, path, origin }）：面板用它显示「待提交的真实文件路径」
		changed,
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

/** 一次拉取多少个 Actions 运行：要够覆盖最近 N 个提交（同一提交可能有多个 workflow） */
const CI_RUNS_PER_PAGE = 20;

/**
 * 拉一次「本分支最近的 Actions 运行」。
 *
 * 之前是**逐个提交**查 `/commits/{sha}/check-runs`：8 个提交 = 8~10 个请求，
 * GitHub 匿名配额（每小时 60 次）几下就打光了。改成一次列表 + 按 head_sha 归并到本地提交。
 */
async function workflowRunsFor(owner, repo, branch, perPage) {
	const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=${perPage}`;
	return fetchWithCache(url, {
		ttlMs: CI_CACHE_TTL_MS,
		timeoutMs: CI_TIMEOUT_MS,
		headers: GITHUB_HEADERS,
	});
}

/**
 * 失败详情：workflow run → 作业列表 → 失败步骤 → 失败作业日志尾部。
 *
 * 每一步都是「尽力而为」：任何一步失败都只往 detailWarning 里写一句中文，
 * 基本字段（sha / conclusion / checkName / runUrl / reason）照常返回，
 * 所以 /api/ci 永远不会因为详情拿不到而变成 5xx。
 */
async function failureDetail(owner, repo, run, workflowRuns) {
	const list = Array.isArray(workflowRuns) ? workflowRuns : [];
	// 优先挑真的失败的那次运行；没有就退回第一条（保持和原来 check-run 版一样的兜底）
	const failed = list.find((item) => FAILURE_CONCLUSIONS.has(item?.conclusion)) ?? list[0] ?? null;
	// 把 workflow run 拼成 describeFailure 认识的 check-run 形态：
	// name=workflow 名（checkName）、html_url=运行页（runUrl/detailsUrl）、head_sha=提交
	const checkRun = failed
		? {
				name: typeof failed.name === "string" ? failed.name : "",
				conclusion: typeof failed.conclusion === "string" ? failed.conclusion : "",
				details_url: typeof failed.html_url === "string" ? failed.html_url : "",
				html_url: typeof failed.html_url === "string" ? failed.html_url : "",
				head_sha: run.sha,
				status: failed.status,
			}
		: null;

	// 1) 运行 id：workflow run 自带 id，取不到再从 html_url 里解析
	const runId = Number.isFinite(Number(failed?.id)) && Number(failed.id) > 0 ? String(failed.id) : extractRunId(failed?.html_url);
	let jobsJson = null;
	let jobsWarning = "";
	if (!runId) {
		jobsWarning = "这次运行没有可用的 Actions 运行 id，无法定位失败步骤";
	} else {
		const jobs = await fetchWithCache(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, {
			ttlMs: CI_CACHE_TTL_MS,
			timeoutMs: CI_TIMEOUT_MS,
			headers: GITHUB_HEADERS,
		});
		if (jobs.ok) jobsJson = jobs.data;
		else jobsWarning = `读取运行 ${runId} 的作业列表失败：${jobs.error}`;
	}

	// 2) 只有真拿到了失败步骤才去拉日志（省一次请求）；公开仓库的 logs 接口有时可匿名读取
	let logExcerpt = "";
	let logWarning = "";
	if (pickFailingSteps(jobsJson).length > 0) {
		const job = pickFailingJobs(jobsJson).find((item) => Number.isFinite(Number(item?.id)) && Number(item.id) > 0);
		if (!job) {
			logWarning = "作业列表里没有可用的作业 id，未取日志片段";
		} else {
			const logs = await fetchWithCache(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`, {
				ttlMs: CI_CACHE_TTL_MS,
				timeoutMs: CI_TIMEOUT_MS,
				headers: GITHUB_HEADERS,
				asText: true,
			});
			if (!logs.ok) {
				logWarning = `读取作业日志失败（${logs.error}），已省略日志片段`;
			} else {
				logExcerpt = tailLines(logs.data, 30);
				if (!logExcerpt) logWarning = "作业日志为空，已省略日志片段";
			}
		}
	}
	return describeFailure(run, checkRun, jobsJson, { jobsWarning, logExcerpt, logWarning });
}

/** 查不到任何运行记录时，给前端用的降级 runs（status 一律不是 pending，避免被读成"构建排队中"） */
function fallbackRuns(entries, status) {
	return entries.map((entry) => ({
		sha: entry.sha,
		shortSha: entry.sha.slice(0, 7),
		status,
		conclusion: "unknown",
		url: "",
		createdAt: entry.createdAt,
		message: entry.message,
	}));
}

/**
 * 最近 8 个提交的 CI 状态：坏版本挡住发布时，一眼能看出"从哪个提交开始红的"。
 * 注意：这是 Node 主动发起的 HTTP 请求（不是 spawn 子进程），断网/被墙时按降级返回而不是抛 500。
 * 每次只发**一个**列表请求（GitHub 匿名配额一小时只有 60 次）。
 */
async function ciStatus() {
	const info = await repoInfo();
	if (!info.owner || !info.repo) {
		return { ok: false, error: "没能从 git remote 解析出 GitHub 仓库（owner/repo）", runs: [], lastSuccess: null, lastFailure: null };
	}

	const log = await git(["log", "-8", "--pretty=format:%H|%cI|%s"]);
	if (!log.ok || !log.stdout) {
		return { ok: false, error: log.stderr || log.message || "读取 git log 失败", runs: [], lastSuccess: null, lastFailure: null };
	}

	const entries = log.stdout
		.split("\n")
		.map((line) => {
			const [sha, createdAt, ...rest] = line.split("|");
			return { sha, createdAt, message: rest.join("|") };
		})
		.filter((e) => e.sha);

	const branch = info.branch || "main";
	// 拉够覆盖 8 个提交的量（同一个提交可能跑多个 workflow）
	const perPage = Math.min(100, Math.max(entries.length * 2, CI_RUNS_PER_PAGE));
	const list = await workflowRunsFor(info.owner, info.repo, branch, perPage);

	// 限流：明确告诉用户"是 GitHub 限流，不是构建在排队"，而且不要误报失败
	if (!list.ok && isRateLimitedResponse(list)) {
		return {
			ok: true,
			rateLimited: true,
			warning: rateLimitWarning(list),
			runs: fallbackRuns(entries, "rate_limited"),
			lastSuccess: null,
			lastFailure: null,
		};
	}
	if (!list.ok) {
		return {
			ok: true,
			rateLimited: false,
			warning: list.error || "没有拿到任何 Actions 运行记录（仓库可能未开 Actions，或当前网络不可达）",
			runs: fallbackRuns(entries, "unknown"),
			lastSuccess: null,
			lastFailure: null,
		};
	}

	const runsBySha = groupWorkflowRunsBySha(list.data?.workflow_runs);
	const runs = entries.map((entry) => {
		const matched = runsBySha.get(entry.sha) ?? [];
		return {
			sha: entry.sha,
			shortSha: entry.sha.slice(0, 7),
			status: statusFromWorkflowRuns(matched),
			conclusion: conclusionFromWorkflowRuns(matched),
			url: matched.find((item) => item.html_url)?.html_url ?? "",
			createdAt: entry.createdAt,
			message: entry.message,
		};
	});

	const lastSuccessIndex = runs.findIndex((r) => r.conclusion === "success");
	const lastFailureIndex = runs.findIndex((r) => FAILURE_CONCLUSIONS.has(r.conclusion));
	const lastSuccess = lastSuccessIndex >= 0 ? runs[lastSuccessIndex] : null;
	// 仅当"失败"比任何一次成功都更新时才提示；旧的失败被后续成功覆盖后红条必须消失
	const failedRun = lastFailureIndex >= 0 && (lastSuccessIndex < 0 || lastFailureIndex < lastSuccessIndex) ? runs[lastFailureIndex] : null;
	// 失败详情（作业列表 + 日志）只在这个失败真的要展示时才去拉，避免白耗匿名配额
	const lastFailure = failedRun
		? await failureDetail(info.owner, info.repo, failedRun, runsBySha.get(failedRun.sha) ?? [])
		: null;
	return {
		ok: true,
		rateLimited: false,
		runs,
		lastSuccess: lastSuccess ? { sha: lastSuccess.sha, url: lastSuccess.url } : null,
		lastFailure,
		...(runs.every((r) => r.conclusion === "unknown") ? { warning: "没有拿到任何运行记录（仓库可能未开 Actions，或当前网络不可达）" } : {}),
	};
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

/**
 * 「提交之后」的推送流程：先 fetch 对齐远端，落后就 rebase，最后 push。
 * 抽出来是因为「发布」和「一键回滚」都要走同一套，逻辑只维护一份。
 * @returns { ok, steps, message }
 */
async function pushToRemote(steps) {
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
			return { ok: false, steps, message: "远端有冲突，需要手动处理后再推送" };
		}
	}

	const pushed = await gitNet(["push"]);
	steps.push({
		name: pushed.viaDirect ? "git push（代理不可用，已自动改用直连）" : "git push",
		...pushed,
	});
	return { ok: pushed.ok, steps, message: pushed.ok ? "" : pushed.stderr || pushed.message };
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

	// 只暂存面板自己管理的路径（见 publish-scope.mjs）。
	// 用 git add -A 会把在制品一起提交推送：admin/ 的半成品无害，但 src/ 的半成品会直接让构建失败。
	const scoped = await stageForPublish(git, REPO_ROOT);
	steps.push({ name: `git add（仅面板管理范围：${PUBLISH_SCOPE.join("、")}）`, ...scoped.result });

	const staged = await git(["diff", "--cached", "--name-only"]);
	if (!staged.stdout) {
		const outside = scoped.skipped;
		return {
			ok: false,
			dryRun: DRY_RUN_PUBLISH,
			steps,
			skipped: outside,
			message: outside.length
				? `面板管理范围内没有改动。另有 ${outside.length} 个改动不在面板管理范围，已跳过（不会提交）：${outside.slice(0, 8).join("、")}${outside.length > 8 ? " 等" : ""} —— 需要提交请用 git 命令手动处理`
				: "没有需要提交的改动",
		};
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

	const pushed = await pushToRemote(steps);
	return {
		ok: pushed.ok,
		dryRun: false,
		steps,
		files: changedFiles,
		message: pushed.ok
			? "已推送到 GitHub，Actions 会自动构建并部署（约 1 分钟）"
			: pushed.message,
	};
}

/**
 * 一键回滚：把某个提交 revert 掉（生成一个反向提交，不改写历史），然后走和发布一样的推送流程。
 * 用途：某次改动把站点搞坏了，又被别的提交压在下面，没法简单 reset 时，revert 是最稳的解法。
 * 失败原因要原样带回来，否则用户完全不知道该手动做什么。
 */
async function revertCommit(sha) {
	const steps = [];
	const reverted = await git(["revert", "--no-edit", sha]);
	steps.push({ name: `git revert --no-edit ${sha}`, ...reverted });
	if (!reverted.ok) {
		const detail = reverted.stderr || reverted.stdout || reverted.message || "未知错误";
		// revert 失败最常见的两种：冲突 / 该提交已被回滚过，分开说清楚
		const conflict = /conflict|could not apply|需要合并/i.test(detail);
		return {
			ok: false,
			steps,
			message: conflict
				? `回滚 ${sha} 时产生冲突，已在本地留下冲突现场，请手动解决（git status 看冲突文件，解决后 git revert --continue，或 git revert --abort 放弃）`
				: `回滚失败：${detail}`,
		};
	}

	if (DRY_RUN_PUBLISH) {
		steps.push({ name: "git push（演练模式，已跳过）", ok: true, stdout: "", stderr: "" });
		const undo = await git(["reset", "--hard", "HEAD~1"]);
		steps.push({ name: "撤销本地 revert 提交（演练模式）", ...undo });
		return { ok: true, dryRun: true, steps, message: "演练模式：回滚提交已撤销，未推送" };
	}

	const pushed = await pushToRemote(steps);
	return {
		ok: pushed.ok,
		steps,
		message: pushed.ok
			? `已回滚 ${sha} 并推送，Actions 会自动重新构建部署`
			: pushed.message,
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

/**
 * 递归收集某个快照目录下的所有文件（含子目录里的），返回 { rel, data } 列表供打包。
 * 每个文件都再确认一次"落在快照目录内"，防止快照目录里有软链接指到仓库外面。
 */
async function collectSnapshotFiles(dir, prefix, out) {
	const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			await collectSnapshotFiles(full, rel, out);
			continue;
		}
		if (!entry.isFile()) continue;
		const resolved = path.resolve(full);
		if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
			throw new Error(`快照内路径越界: ${rel}`);
		}
		out.push({ name: rel, data: await fs.readFile(resolved) });
	}
}

// ── 媒体文件的单段 Range ────────────────────────────────────────────────────
/**
 * 解析单段 Range（只支持 `bytes=` 单段）。
 *
 * 返回值：
 *   - null        没有 Range 头 → 按 200 返回完整文件
 *   - "invalid"   语法非法 / 多段 / 越界 → 416（带 `Content-Range: bytes *\/size`）
 *   - {start,end} 合法，且已夹到 [0, size-1]
 *
 * 两个刻意的决定：
 *   1. RFC 7233 允许服务器忽略非法 Range，这里选择回 416 —— 面板是本地播放器专用，
 *      明确报错比悄悄返回整段更容易暴露前端越界请求（审计要求）。
 *   2. 一律夹取：`bytes=0-99999999999999` 的 end 会被夹到 size-1，
 *      不会出现「声明 1e14 字节、实际 0 字节」这种自相矛盾的 206。
 */
function parseByteRange(header, size) {
	if (typeof header !== "string" || !header.trim()) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return "invalid";
	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return "invalid";
	let start;
	let end;
	if (rawStart === "") {
		// 后缀形式 bytes=-N：取最后 N 字节
		const suffix = Number(rawEnd);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd === "" ? size - 1 : Number(rawEnd);
	}
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "invalid";
	if (start > end || start >= size) return "invalid";
	return { start, end: Math.min(end, size - 1) };
}

/**
 * 把文件（或文件区间）流式写给响应。
 * createReadStream 的参数越界会**同步**抛错，读流本身也可能异步报错（文件被删等），
 * 两者都必须在这里兜住：头已经发出去了，能做的只有断开连接，绝不能让异常冒到最外层。
 * @returns false 表示连流都没建起来（调用方负责销毁响应）
 */
function streamFile(res, file, options) {
	try {
		const stream = options ? createReadStream(file, options) : createReadStream(file);
		stream.on("error", () => res.destroy());
		// 客户端提前断开（暂停/切歌）时别把 fd 留着
		res.on("close", () => stream.destroy());
		stream.pipe(res);
		return true;
	} catch {
		return false;
	}
}

// ── HTTP ────────────────────────────────────────────────────────────────────
/**
 * 统一 JSON 响应。第四个参数用于附加响应头（例如登录时下发 Set-Cookie）。
 * headersSent 之后绝不能再 writeHead（会抛 ERR_HTTP_HEADERS_SENT，且没人接），只能收尾。
 */
function sendJson(res, status, payload, extraHeaders) {
	if (res.headersSent) {
		// 头已经发出去了（例如 /media-file 已经开始推流）：改不了状态码，安全地结束即可
		res.end();
		return;
	}
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		...(extraHeaders ?? {}),
	});
	res.end(body);
}

/**
 * 带 HTTP 状态码的错误。抛出它的地方都是「客户端请求有问题」，最外层 catch 会照 status 返回。
 * 为什么不直接把 Error 当 400：只有我们自己明确标记过的错误才配当 4xx，
 * 其它意外异常一律 500，且不回显 JS 内部消息。
 */
function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

/**
 * 面向用户的中文错误文案。
 * 规则：带 status 的（我们自己抛的校验错误）原样返回；其余意外异常一律回通用文案，
 * 绝不把 `Cannot read properties of null (reading 'items')` 这类 JS 内部消息回显给用户。
 */
const INTERNAL_MESSAGE_RE =
	/Cannot read propert|Cannot destructure|is not a function|is not defined|as it is (?:null|undefined)|undefined \(reading|TypeError|ReferenceError|RangeError|SyntaxError|Maximum call stack|\bE[A-Z]{2,}\b/;

function publicErrorText(error) {
	const message = error instanceof Error ? error.message : String(error ?? "");
	const ours = typeof error?.status === "number";
	if (ours && message && !INTERNAL_MESSAGE_RE.test(message)) return message;
	return "服务器内部错误，请查看启动面板的命令行窗口获取详情";
}

/**
 * 每个 POST 接口允许出现的请求体字段。
 * 为什么要有这张表：
 *   1. body 是 null / 数组 / 字符串时直接 400，不再让各 handler 解构出 TypeError 变成 500；
 *   2. 出现表里没有的字段直接 400，避免"字段名打错却真的执行了破坏性操作"
 *      （例如 /api/compress-media 少写一个 dryRun 就会真的去改图片）；
 *   3. 新增接口时忘了登记字段 → 一律 400，噪声很大但不会静默放行。
 * 只对 POST 生效；GET 请求体不参与校验。
 */
const POST_BODY_FIELDS = {
	"/api/save-post": ["slug", "originalSlug", "frontmatter", "body"],
	"/api/delete-post": ["slug"],
	"/api/upload": ["dir", "filename", "dataBase64"],
	"/api/delete-media": ["repoPath"],
	"/api/announcements": ["items"],
	// 草稿是 GET-only：登记空数组不是为了接收字段，而是让「往只读接口 POST 带字段」也走 400 而不是静默执行
	"/api/announcement-draft": [],
	"/api/playlist": ["songs"],
	"/api/save-lyrics": ["url", "text", "duration"],
	"/api/extract-audio": ["repoPath", "url"],
	"/api/config-file": ["path", "content"],
	"/api/sync": [],
	"/api/publish": ["message", "force"],
	"/api/doctor": [],
	"/api/settings": ["values"],
	"/api/backups": [],
	"/api/restore": ["id", "rel"],
	"/api/revert": ["sha"],
	"/api/import-document": ["filename", "dataBase64", "slug"],
	"/api/nav": ["items"],
	"/api/friends": ["action", "item", "index", "direction", "enabled"],
	"/api/friends-fetch": ["url"],
	"/api/compress-music": ["mode", "dryRun"],
	"/api/compress-media": ["dirs", "dryRun"],
	// 头像：filename + dataBase64 换图；restore: true 恢复默认（两者不能同时给）
	"/api/avatar": ["filename", "dataBase64", "restore"],
	"/api/run": ["script"],
	"/api/diff": [],
	// 只读 + 拉起资源管理器（不写盘）；path 必须落在仓库内且真实存在
	"/api/reveal": ["path"],
	"/api/status": [],
	"/api/media": [],
	"/api/posts": [],
	"/api/taxonomy": [],
	"/api/configs": [],
	"/api/ci": [],
	"/api/backup-export": [],
};

/**
 * 校验 POST 请求体：必须是 JSON 对象，且只含该接口声明过的字段。
 * 不合法 → 抛 400（而不是让 handler 里冒出 500）。
 */
function assertPostBody(route, body) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw httpError(400, "请求体必须是一个 JSON 对象");
	}
	const allowed = POST_BODY_FIELDS[route];
	if (!allowed) return body; // 没登记的接口不做字段校验（保守：保持原有行为）
	const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
	if (unknown.length > 0) {
		throw httpError(400, `请求体包含不支持的字段：${unknown.join("、")}`);
	}
	return body;
}

async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 64 * 1024 * 1024) throw httpError(400, "请求体过大（上限 64 MB）");
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	const text = Buffer.concat(chunks).toString("utf-8");
	try {
		return JSON.parse(text);
	} catch {
		// 客户端发了坏 JSON：这是 400，不是服务端 500
		throw httpError(400, "请求体不是合法 JSON");
	}
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	const route = url.pathname;

	try {
		// 静态页面：允许带 token 访问，页面内所有请求都会带上它
		if (route === "/" || route === "/index.html") {
			// 只认 URL / 请求头里的令牌，不认 Cookie：带着 ?token= 打开才算"登录"，
			// 否则任何人直接访问 / 都能白拿页面（本机其它程序也一样）
			const provided = url.searchParams.get("token") || req.headers["x-admin-token"];
			if (!tokenValid(provided)) {
				res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
				res.end(
					`访问令牌不正确。请使用启动时打开的地址（含 ?token=…），或重新启动：node admin/server.mjs`,
				);
				return;
			}
			const html = await fs.readFile(UI_FILE, "utf-8");
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				// 令牌校验通过 → 顺手种下 HttpOnly 会话 Cookie，页面里的脚本读不到它
				"Set-Cookie": sessionCookie(),
			});
			res.end(html);
			return;
		}

		// 退出登录：**故意免认证**（设计如此）—— 它只清掉本地会话 Cookie，
		// 没登录时调用也无害，前端调完刷新页面即可。除了它，其余接口一律要凭证。
		if (route === "/api/logout") {
			if (req.method !== "POST") {
				sendJson(res, 405, { error: "请用 POST 调用 /api/logout" });
				return;
			}
			sendJson(res, 200, { ok: true, message: "已退出登录" }, { "Set-Cookie": clearSessionCookie() });
			return;
		}

		// 其余接口一律要凭证（Cookie / 请求头 / URL 令牌，任一即可）
		if (!isAuthed(req, url)) {
			sendJson(res, 403, { error: "令牌无效，请重新启动管理后台" });
			return;
		}

		// POST 的请求体必须先过统一校验：坏 JSON / null / 数组 / 多余字段 → 400，
		// 不能让它们在各 handler 的解构里炸成 500，也不能让字段写错就真去执行破坏性操作
		const body = req.method === "POST" ? assertPostBody(route, await readBody(req)) : {};

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
				// dir / imagesDir 一并回给前端：面板要显示「文章存在哪、它的图片放哪」，
				// 路径以后端为准（前端不拼），新建文章时的目标路径也从这里取。
				sendJson(res, 200, {
					posts: await listPosts(),
					dir: POSTS_DIR,
					imagesDir: MEDIA_DIRS["post-images"],
					imagesUrlPrefix: MEDIA_URL_PREFIX["post-images"],
				});
				return;

			case "/api/post": {
				const slug = url.searchParams.get("slug");
				if (!slug) {
					sendJson(res, 400, { error: "缺少 slug" });
					return;
				}
				// 先卡格式再拼路径：否则 `../../Windows/win.ini` 会被拼成越界路径，
				// safeResolve 抛出的「路径越界: src/content/posts/../../..」会连同内部路径一起回显给用户
				if (!POST_SLUG_RE.test(slug)) {
					sendJson(res, 400, { error: "slug 只能包含字母、数字、点、下划线和连字符" });
					return;
				}
				const file = `${POSTS_DIR}/${slug}.md`;
				if (!(await exists(safeResolve(file)))) {
					sendJson(res, 404, { error: `文章不存在: ${file}` });
					return;
				}
				const raw = await fs.readFile(safeResolve(file), "utf-8");
				const { frontmatter, body: md } = await parseFrontmatter(raw);
				// 正文里引用的图片 + frontmatter.image（封面）都算「这篇文章用到的图片」，
				// 两者都逐个核对过真实文件；role 让面板区分「封面」与「正文引用」。
				const bodyImages = await postImages(md);
				const coverImage = typeof frontmatter?.image === "string" ? frontmatter.image : "";
				const coverImages = coverImage ? await postImages(coverImage) : [];
				const coverPaths = new Set(coverImages.map((item) => item.repoPath));
				const images = [...bodyImages, ...coverImages.filter((item) => !bodyImages.some((b) => b.repoPath === item.repoPath))]
					.map((item) => ({ ...item, role: coverPaths.has(item.repoPath) ? "cover" : "body" }))
					.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
				sendJson(res, 200, {
					slug,
					file,
					dir: POSTS_DIR,
					imagesDir: MEDIA_DIRS["post-images"],
					imagesUrlPrefix: MEDIA_URL_PREFIX["post-images"],
					images,
					frontmatter,
					body: md,
					raw,
				});
				return;
			}

			case "/api/save-post": {
				const { slug, originalSlug, frontmatter, body: md } = body;
				if (!slug || !POST_SLUG_RE.test(slug)) {
					sendJson(res, 400, { error: "slug 只能包含字母、数字、点、下划线和连字符" });
					return;
				}
				// originalSlug 会参与「删掉改名前的旧文件」和「打快照」两件事，必须和 slug 同一套校验：
				// 否则 originalSlug="../config/navBarConfig" 就能删掉 src/config 下的任意 .md
				if (originalSlug !== undefined && originalSlug !== null && originalSlug !== "" && !POST_SLUG_RE.test(String(originalSlug))) {
					sendJson(res, 400, { error: "originalSlug 只能包含字母、数字、点、下划线和连字符" });
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
				if (!POST_SLUG_RE.test(String(slug))) {
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
				const repoPath = path.posix.join(MEDIA_DIRS[dir], safeName);
				const target = resolveInside(repoPath, [MEDIA_DIRS[dir]]);
				await fs.mkdir(path.dirname(target), { recursive: true });
				const buffer = Buffer.from(dataBase64, "base64");
				// 覆盖同名文件时先把旧文件存进快照；新文件没有旧内容可备份，createSnapshot 会返回 null
				const snapshot = await snapshotBefore(repoPath, `覆盖上传 ${safeName}`);
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
					repoPath,
					// 旧文件被替换过 ⇒ 告诉前端快照在哪，方便"传错了想还原"
					backup: snapshot?.id ?? null,
					snapshot,
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
				// 删除是不可逆的，删之前一定留一份快照（超限的会跳过并在 warning 里说明）
				const snapshot = await snapshotBefore(repoPath, `删除媒体 ${path.basename(repoPath)}`);
				if (await exists(target)) await fs.rm(target, { force: true });
				sendJson(res, 200, { ok: true, backup: snapshot?.id ?? null, snapshot });
				return;
			}

			case "/api/announcements": {
				if (req.method === "GET") {
					// file：公告数据真实落在哪（前端渲染路径徽章用，不在前端拼）
					sendJson(res, 200, { items: await readJsonData("announcements"), file: DATA_FILES.announcements });
					return;
				}
				// 先自己卡类型：sanitizeAnnouncements 抛的是普通 Error，会让整条链路变成 500
				if (!Array.isArray(body.items)) {
					sendJson(res, 400, { error: "公告数据必须是数组（items）" });
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

			case "/api/announcement-draft": {
				// 只读接口：读 git log → 生成草稿。绝不写盘、绝不发布（见 announcementDraftResponse 注释）
				if (req.method !== "GET") {
					sendJson(res, 405, { error: "请用 GET 调用 /api/announcement-draft" });
					return;
				}
				const query = parseDraftQuery(Object.fromEntries(url.searchParams));
				if (!query.ok) {
					sendJson(res, 400, { error: query.error });
					return;
				}
				const result = await announcementDraftResponse(query);
				sendJson(res, result.status, result.payload);
				return;
			}

			case "/api/playlist": {
				if (req.method === "GET") {
					const songs = await readJsonData("playlist");
					// paths：每首歌的音频 / 封面 / 歌词各自对应哪个真实文件（后端 stat 核对过）。
					// 只对「以 / 开头的站内路径」给路径；远程 URL 与填错的路径返回 null / exists:false。
					const localFiles = await describeLocalFiles(
						songs.flatMap((song) => [song?.url, song?.cover, song?.lrc]),
					);
					sendJson(res, 200, {
						songs,
						file: DATA_FILES.playlist,
						paths: songs.map((_, index) => ({
							url: localFiles[index * 3] ?? null,
							cover: localFiles[index * 3 + 1] ?? null,
							lrc: localFiles[index * 3 + 2] ?? null,
						})),
					});
					return;
				}
				if (!Array.isArray(body.songs)) {
					sendJson(res, 400, { error: "歌单数据必须是数组（songs）" });
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
				const lrcRel = `public/assets/music/lrc/${base}.lrc`;
				// 和其它写接口一样先打快照：这是唯一漏掉的一处，补上之后
				// 「面板写过的任何文件都能从 admin-backups 里找回来」这条承诺才成立
				const snapshot = await snapshotBefore(lrcRel, "保存歌词");
				await fs.mkdir(safeResolve("public/assets/music/lrc"), { recursive: true });
				await fs.writeFile(safeResolve(lrcRel), lrc, "utf-8");
				sendJson(res, 200, {
					ok: true,
					path: `/assets/music/lrc/${base}.lrc`,
					backup: snapshot?.id ?? null,
					snapshot: snapshot ?? null,
				});
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
				// 本地试听/预览：把媒体目录（以及友链图标目录）里的文件读出来
				// （管理面板不是静态服务器，不能直接开 /assets、/friends 路径）
				const repoPath = url.searchParams.get("path");
				if (!repoPath) {
					sendJson(res, 400, { error: "只能读取媒体目录里的文件" });
					return;
				}
				let file;
				try {
					file = resolveInside(repoPath, MEDIA_READ_DIRS);
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
					// 友链图标常见这两种：svg 走 <img> 加载不会执行脚本，ico 直接按图标类型返回
					".svg": "image/svg+xml",
					".ico": "image/x-icon",
					".lrc": "text/plain; charset=utf-8",
				};
				const headers = {
					"Content-Type":
						types[path.extname(file).toLowerCase()] || "application/octet-stream",
					"Accept-Ranges": "bytes",
					"Cache-Control": "no-store",
				};
				const range = req.headers.range;
				const parsed = parseByteRange(range, stat.size);
				if (parsed === "invalid") {
					// 越界 / 语法非法：明确回 416，并按 RFC 7233 告知真实长度。
					// （不能像以前那样把 start/end 直接丢给 createReadStream：越界会同步抛
					// ERR_OUT_OF_RANGE，冒到最外层 catch 时头已经发出，进程直接被打死。）
					res.writeHead(416, {
						...headers,
						"Content-Range": `bytes */${stat.size}`,
						"Content-Length": 0,
					});
					res.end();
					return;
				}
				if (parsed) {
					// start/end 已夹到 [0, size-1]，Content-Length 与实际发出的字节数必然一致
					res.writeHead(206, {
						...headers,
						"Content-Range": `bytes ${parsed.start}-${parsed.end}/${stat.size}`,
						"Content-Length": parsed.end - parsed.start + 1,
					});
					if (!streamFile(res, file, { start: parsed.start, end: parsed.end })) res.destroy();
					return;
				}
				res.writeHead(200, { ...headers, "Content-Length": stat.size });
				if (!streamFile(res, file)) res.destroy();
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
				// message 会直接进 git commit -m：必须是字符串（否则 execFile 拿到数字会抛 TypeError → 500）
				if (body.message !== undefined && typeof body.message !== "string") {
					sendJson(res, 400, { error: "提交说明必须是字符串" });
					return;
				}
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
						pagePrefix: PAGE_PREFIX,
						// 页面开关写在哪：文件 + 块名（与 SETTINGS_DEFS 的 file/within/key 同一套口径）
						pageToggle: { file: PAGE_FILE, block: PAGE_BLOCK },
					});
					return;
				}
				const patch = body?.values && typeof body.values === "object" ? body.values : body;
				if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
					sendJson(res, 400, { error: "设置数据格式不对（需要 values 对象）" });
					return;
				}
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
				if (!body.id) {
					sendJson(res, 400, { error: "缺少快照 id" });
					return;
				}
				const result = await restoreSnapshot(REPO_ROOT, body.id, body.rel);
				sendJson(res, 200, result);
				return;
			}

			case "/api/backup-export": {
				if (req.method !== "GET") {
					sendJson(res, 405, { error: "请用 GET 调用 /api/backup-export?id=<快照 id>" });
					return;
				}
				const id = url.searchParams.get("id") ?? "";
				// id 直接参与拼路径，格式必须先卡死（与 restoreSnapshot 用同一套规则）
				if (!/^[A-Za-z0-9-]+$/.test(id)) {
					sendJson(res, 400, { error: "快照 id 不合法（只允许字母、数字、连字符）" });
					return;
				}
				const dir = safeResolve(`${BACKUP_DIR}/${id}`);
				const stat = await fs.stat(dir).catch(() => null);
				if (!stat?.isDirectory()) {
					sendJson(res, 404, { error: `快照不存在: ${id}` });
					return;
				}
				const entries = [];
				await collectSnapshotFiles(dir, "", entries);
				if (entries.length === 0) {
					sendJson(res, 404, { error: `快照 ${id} 里没有文件` });
					return;
				}
				const zip = createZip(entries);
				res.writeHead(200, {
					"Content-Type": "application/zip",
					"Content-Disposition": `attachment; filename="admin-backup-${id}.zip"`,
					"Cache-Control": "no-store",
					"Content-Length": zip.length,
				});
				res.end(zip);
				return;
			}

			case "/api/ci": {
				if (req.method !== "GET") {
					sendJson(res, 405, { error: "请用 GET 调用 /api/ci" });
					return;
				}
				// ciStatus 内部已经把网络异常降级成 ok:false，这里再兜一层，保证永远不是 500
				try {
					sendJson(res, 200, await ciStatus());
				} catch (error) {
					sendJson(res, 200, {
						ok: false,
						error: error?.message ?? String(error),
						runs: [],
						lastSuccess: null,
						lastFailure: null,
					});
				}
				return;
			}

			case "/api/revert": {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "请用 POST 调用 /api/revert" });
					return;
				}
				const sha = String(body.sha ?? "").trim();
				// sha 会被拼进 git 命令参数，只放行十六进制；用 execFile 不经过 shell，双保险
				if (!/^[0-9a-f]{7,40}$/.test(sha)) {
					sendJson(res, 400, { error: "sha 不合法（需要 7~40 位十六进制）" });
					return;
				}
				// 这是 git 操作，没有"原文件"可备份，所以不调 snapshotBefore
				const result = await revertCommit(sha);
				sendJson(res, 200, result);
				return;
			}

			case "/api/taxonomy": {
				if (req.method !== "GET") {
					sendJson(res, 405, { error: "请用 GET 调用 /api/taxonomy" });
					return;
				}
				sendJson(res, 200, await taxonomy());
				return;
			}

			case "/api/import-document": {
				// 从 Word(.docx) / txt / md 导入：只做"转换成 markdown + 图片落盘"，
				// 不写文章、不建快照（没有旧版本可备份），正文由用户在编辑器里确认后自己保存。
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "请用 POST 调用 /api/import-document" });
					return;
				}
				const { filename, dataBase64, slug } = body;
				if (typeof filename !== "string" || !filename.trim()) {
					sendJson(res, 400, { error: "缺少文件名" });
					return;
				}
				if (typeof dataBase64 !== "string" || !dataBase64.trim()) {
					sendJson(res, 400, { error: "缺少文件数据" });
					return;
				}
				// 先按 base64 估算体积，再真正解码，避免解出一个超大 buffer 才报错
				if (dataBase64.length > Math.ceil((MAX_IMPORT_BYTES * 4) / 3) + 1024) {
					sendJson(res, 400, { error: "文件太大，最大支持 25 MB" });
					return;
				}
				const buffer = Buffer.from(dataBase64, "base64");
				// 空文件的提示交给 convertToMarkdown 统一给（"文件是空的，没有可导入的内容"）
				if (buffer.length > MAX_IMPORT_BYTES) {
					sendJson(res, 400, {
						error: `文件太大（${(buffer.length / 1024 / 1024).toFixed(1)} MB），最大支持 25 MB`,
					});
					return;
				}
				// 图片目录固定落在 post-images 里，并且必须通过仓库根 + 白名单前缀校验
				const imageDir = resolveInside(MEDIA_DIRS["post-images"], [MEDIA_DIRS["post-images"]]);
				await fs.mkdir(imageDir, { recursive: true });
				const result = await convertToMarkdown({
					filename: path.basename(filename),
					buffer,
					repoRoot: REPO_ROOT,
					imageDir,
					slug,
					imageUrlPrefix: MEDIA_URL_PREFIX["post-images"],
				});
				sendJson(res, result.ok ? 200 : 400, result);
				return;
			}

			case "/api/nav": {
				// 导航菜单的隐藏 / 改名 / 排序：只读写 src/config/nav-overrides.json，
				// 不改写 TS 源码（面板不支持新增菜单项）
				const navResult = await handleNav({
					repoRoot: REPO_ROOT,
					method: req.method,
					body,
					snapshotBefore,
				});
				sendJson(res, navResult.status, navResult.payload);
				return;
			}

			case "/api/friends": {
				// 友链的增删改排序：只读写 src/config/friends.json（不改 TS 源码）
				const friendsResult = await handleFriends({
					repoRoot: REPO_ROOT,
					method: req.method,
					body,
					snapshotBefore,
				});
				sendJson(res, friendsResult.status, friendsResult.payload);
				return;
			}

			case "/api/friends-fetch": {
				// 抓取目标站点猜标题 / 简介 / 图标：会联网，但**不写 friends.json**，
				// 结果只回给前端填表单，由人确认后再走 /api/friends 保存
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "请用 POST 调用 /api/friends-fetch" });
					return;
				}
				const fetchResult = await handleFriendsFetch({ repoRoot: REPO_ROOT, body });
				sendJson(res, fetchResult.status, fetchResult.payload);
				return;
			}

			case "/api/compress-music": {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "请用 POST 调用 /api/compress-music" });
					return;
				}
				// 参数只从白名单拼，绝不把用户输入直接塞进命令行。
				// mode 必须显式给出：省掉它就会默认去跑一次真正的压缩脚本（有副作用）
				const mode = String(body.mode ?? "");
				if (!(mode in MUSIC_MODES)) {
					sendJson(res, 400, { error: `不支持的 mode: ${mode || "(缺少 mode)"}（可选 all / covers / check）` });
					return;
				}
				const scriptArgs = ["scripts/compress-music.mjs", ...MUSIC_MODES[mode]];
				// 去重：check 模式本身已带 --dry-run
				if (body.dryRun === true && !scriptArgs.includes("--dry-run")) scriptArgs.push("--dry-run");
				const result = await runMusicCompress(scriptArgs);
				sendJson(res, 200, {
					ok: result.ok,
					output: result.output,
					command: result.command,
				});
				return;
			}

			case "/api/compress-media": {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "请用 POST 调用 /api/compress-media" });
					return;
				}
				let dirs = COMPRESS_DIRS;
				if (body.dirs !== undefined) {
					if (!Array.isArray(body.dirs) || body.dirs.length === 0) {
						sendJson(res, 400, { error: "dirs 必须是「目录名」数组" });
						return;
					}
					// 去掉结尾斜杠再比对，否则 "public/assets/images/" 会被白名单误判为越界
					dirs = body.dirs.map((d) => String(d).trim().replace(/\\/g, "/").replace(/\/+$/, ""));
					const bad = dirs.find((d) => !COMPRESS_DIRS.includes(d));
					if (bad) {
						sendJson(res, 400, {
							error: `只能压缩这三个目录：${COMPRESS_DIRS.join("、")}（收到：${bad}）`,
						});
						return;
					}
				}
				const result = await compressImages({
					repoRoot: REPO_ROOT,
					dirs,
					dryRun: body.dryRun === true,
					skipExisting: true,
				});
				sendJson(res, result.ok ? 200 : 400, result);
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

			case "/api/avatar": {
				// 站点头像：GET 读当前状态（缩略图用），POST 换图 / 恢复默认。
				// 这是个「文件 + 配置」的组合操作，所以不放在 /api/upload 里：
				// 换图会同时落盘一张**新**图片（不覆盖原头像）并改写 profileConfig.ts 的 avatar 字段，
				// 配置那一步走 settings.mjs 的白名单 / 快照 / 回读 / 回滚（见 admin/avatar.mjs 顶部说明）。
				if (req.method !== "POST") {
					sendJson(res, 200, await describeAvatar(REPO_ROOT));
					return;
				}
				if (body.restore === true) {
					const restored = await restoreDefaultAvatar({
						repoRoot: REPO_ROOT,
						snapshot: async (rel) => {
							await snapshotBefore(rel, "恢复默认头像");
						},
					});
					sendJson(res, 200, {
						...restored,
						avatar: await describeAvatar(REPO_ROOT),
						message: restored.unchanged
							? "当前用的已经是默认头像，无需改动"
							: `已恢复默认头像（${AVATAR_DEFAULT}）；上传过的图片文件仍留在 public/assets/images/`,
					});
					return;
				}
				if (body.restore !== undefined) {
					sendJson(res, 400, { error: "restore 只接受 true" });
					return;
				}
				const saved = await applyAvatar({
					repoRoot: REPO_ROOT,
					filename: body.filename,
					dataBase64: body.dataBase64,
					snapshot: async (rel) => {
						await snapshotBefore(rel, "更换站点头像");
					},
				});
				sendJson(res, 200, {
					...saved,
					avatar: await describeAvatar(REPO_ROOT),
					message: `头像已换成 ${saved.url}（新文件，原头像保留，可随时「恢复默认」）${saved.note ? `；${saved.note}` : ""}`,
				});
				return;
			}

			case "/api/diff": {
				const [stat, status] = await Promise.all([
					git(["diff", "--stat"]),
					// -z + raw：路径里带空格 / 单引号 / 非 ASCII（音乐封面就有）也不会解析错，
					// 第一条记录的前导空格也不会被 trim 吃掉（见 gitStatusZ 的注释）
					gitStatusZ(),
				]);
				// files 是结构化的「待提交路径 + 状态码」：面板按它渲染路径徽章。
				// code 含 D、或 origin === "old"（重命名前的旧路径）表示磁盘上已经没有这个文件，
				// 面板不会对它显示「打开所在文件夹」，校验脚本也据此决定要不要断言存在。
				const files = parsePorcelainEntriesZ(status.stdout).filter((entry) => entry.path);
				sendJson(res, 200, { stat: stat.stdout, files });
				return;
			}

			/**
			 * 「打开所在文件夹」（可选能力，只在 Windows 上真正执行）：
			 *   - 认证走面板统一入口（Cookie / 头 / ?token=），没有额外放宽；
			 *   - 目标必须落在**仓库内**（resolveInside），且必须真实存在；
			 *   - 只接受 POST（避免被 <img>/<a> 这类 GET 顺带触发），不阻塞请求（见 revealInExplorer）；
			 *   - 非 Windows 返回 ok:false + 中文说明，绝不猜测性地拉起别的命令。
			 */
			case "/api/reveal": {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "请用 POST 调用 /api/reveal" });
					return;
				}
				const rel = String(body.path ?? "")
					.trim()
					.replace(/\\/g, "/")
					.replace(/^\.\//, "");
				if (!rel) {
					sendJson(res, 400, { error: "缺少要打开的路径（path）" });
					return;
				}
				let abs;
				try {
					abs = resolveInside(rel);
				} catch {
					sendJson(res, 400, { error: `只能打开仓库内的路径：${rel}` });
					return;
				}
				const stat = await fs.stat(abs).catch(() => null);
				if (!stat) {
					sendJson(res, 404, { error: `仓库里没有这个路径：${rel}` });
					return;
				}
				const revealed = revealInExplorer(abs);
				sendJson(res, 200, {
					ok: revealed.ok,
					path: rel,
					kind: stat.isDirectory() ? "directory" : "file",
					...(revealed.message ? { message: `${revealed.message}${rel}` } : {}),
				});
				return;
			}

			default:
				sendJson(res, 404, { error: `未知接口: ${route}` });
		}
	} catch (error) {
		// 头已经发出去了（例如 /media-file 已经 writeHead(206) 并开始推流）：这时再 sendJson
		// 会抛 ERR_HTTP_HEADERS_SENT，而它没人接 → 整个面板进程 exit 1。
		// 所以这里必须先判断 headersSent，只做收尾。
		if (res.headersSent) {
			res.end();
			return;
		}
		// error.status 是我们自己标记的 4xx；其它意外异常统一 500，且不回显 JS 内部消息
		sendJson(res, typeof error?.status === "number" ? error.status : 500, { error: publicErrorText(error) });
	}
});

// 端口被占用时给出可读提示，而不是抛未捕获的 EADDRINUSE 栈（只引用 server，避免作用域问题）
server.on("error", (err) => {
	if (err && err.code === "EADDRINUSE") {
		console.error("[面板] 端口已被占用。可能已有一个管理面板在运行：直接用它那个窗口；");
		console.error("[面板] 若已关闭，请在任务管理器结束 node.exe，或换个端口启动：node admin/server.mjs --port=8800");
		process.exit(1);
	}
	throw err;
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
