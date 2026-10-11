/**
 * 站点头像更换：上传图片 → 落盘成**新文件** → 改写 `src/config/profileConfig.ts` 的 `avatar` 字段。
 *
 * 几个刻意的设计（与「媒体」页的通用上传不同）：
 * - **绝不覆盖原头像**：新文件名是 `avatar-<内容 sha256 前 12 位>.<真实格式>`，
 *   所以 `avatar-zhi.webp` 永远留着 —— 出事能随时改回去（「恢复默认」就是改回它）。
 * - **按魔数判定真实格式**，不信扩展名：`a.php.png`、把 txt 改名成 .png 这类一律拒绝，
 *   否则站点目录里会出现「看着是图片、实际是别的字节」的文件。落盘用的扩展名也取自魔数。
 * - **可选等比缩放**（最长边 512px）：sharp 是站点构建依赖，面板本身零依赖，
 *   所以用 createRequire 惰性解析；解析不到 / 缩放失败 / 是动图 / 是 GIF 就**按原图保存**，
 *   绝不让「缩图」这一步把上传搞失败。动图（animated WebP / APNG）尤其不能缩：
 *   默认参数只会保留第一帧，动画就没了（`profileConfig.ts:9-10` 的动图红线）。
 * - **改配置走 `settings.mjs`**：白名单 → 类型校验 → 写前快照 → 结构体检 → 回读校验 → 失败回滚。
 *   配置写失败时把刚写进去的新图片删掉，不留下没人引用的孤儿文件。
 *
 * 落盘位置 `public/assets/images/` 与配置 `src/config/profileConfig.ts` 都在
 * `PUBLISH_SCOPE`（`admin/publish-scope.mjs:14-20`）里，所以面板「发布」按钮会一起提交。
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { applySettings, readSettings } from "./settings.mjs";

/** 头像落盘目录（相对仓库根，正斜杠）——就是 MEDIA_DIRS.avatar */
export const AVATAR_DIR = "public/assets/images";
/** 站点里引用头像的 URL 前缀 */
export const AVATAR_URL_PREFIX = "/assets/images/";
/** 出厂头像：`profileConfig.ts` 里原本写的就是它，「恢复默认」改回这个值（文件不删） */
export const AVATAR_DEFAULT = "/assets/images/avatar-zhi.webp";
/** 被改写的设置项 id（在 SETTINGS_DEFS 里已存在，标签「头像路径」） */
export const AVATAR_SETTING_ID = "profile.avatar";
/** 允许的扩展名：与 `server.mjs` 的 `UPLOAD_EXT.avatar` 完全一致（avif 也放行） */
export const AVATAR_EXT_RE = /\.(png|jpe?g|webp|avif|gif)$/i;
/** 前端 accept 属性用 */
export const AVATAR_ACCEPT = ".png,.jpg,.jpeg,.webp,.avif,.gif";

/**
 * 单文件体积上限 25 MB。
 * 为什么要显式卡：通用 `/api/upload` 其实**没有单文件上限**，只有 `readBody` 的 64 MB 请求体上限
 * （base64 会膨胀 4/3，也就是最大能塞进约 48 MB 的文件）。头像接口取 25 MB 有两个具体理由：
 *   1. 和 `import-doc.mjs` 的 `MAX_IMPORT_BYTES`、`backups.mjs` 的单文件快照上限（25 MB）同口径，
 *      不会出现「能传但快照备不上」的文件；
 *   2. 头像本来就不需要那么大，明确的 25 MB 提示比 64 MB 的通用「请求体过大」好懂得多。
 */
export const AVATAR_MAX_BYTES = 25 * 1024 * 1024;
/** 缩放后的最长边（等比、不放大） */
export const AVATAR_MAX_DIMENSION = 512;

/** 解析 sharp：拿不到就返回 null（面板零依赖，sharp 是站点构建依赖） */
function loadSharp() {
	try {
		const require = createRequire(import.meta.url);
		return require("sharp");
	} catch {
		return null;
	}
}

/** 人话体积，提示信息里用 */
function humanBytes(bytes) {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
	return `${bytes}B`;
}

/**
 * 面向用户的校验错误：带上 `status = 400`。
 * 为什么必须带：`server.mjs` 的 `publicErrorText()` 只回显「我们自己标记过 status」的错误消息，
 * 其余异常一律换成通用文案 —— 不带 status 的话，「头像太大」这种提示会被吞掉。
 */
function userError(message) {
	const error = new Error(message);
	error.status = 400;
	return error;
}

function startsWith(buffer, bytes) {
	if (buffer.length < bytes.length) return false;
	for (let i = 0; i < bytes.length; i++) {
		if (buffer[i] !== bytes[i]) return false;
	}
	return true;
}

/**
 * 按**魔数**判定真实图片格式，返回规范扩展名；不是已知图片返回 null。
 * 这一步是「改扩展名的文本 / a.php.png」的唯一拦路石：只看扩展名的白名单挡不住它们。
 */
export function sniffImageFormat(buffer) {
	if (!buffer || buffer.length < 12) return null;
	if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
	if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpg";
	const head6 = buffer.subarray(0, 6).toString("latin1");
	if (head6 === "GIF87a" || head6 === "GIF89a") return "gif";
	// WebP：RIFF....WEBP
	if (
		buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
		buffer.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return "webp";
	}
	// AVIF / AVIF 序列：....ftyp + major brand（avis = 动图序列）
	if (buffer.subarray(4, 8).toString("latin1") === "ftyp") {
		const brand = buffer.subarray(8, 12).toString("latin1");
		if (brand === "avif" || brand === "avis") return "avif";
	}
	return null;
}

/** 文件名里的扩展名（小写、jpeg → jpg）；没有扩展名返回 "" */
export function extensionOf(filename) {
	const match = /\.([A-Za-z0-9]+)$/.exec(String(filename || "").trim());
	if (!match) return "";
	const ext = match[1].toLowerCase();
	return ext === "jpeg" ? "jpg" : ext;
}

/**
 * 新头像文件名：`avatar-<内容 sha256 前 12 位>.<扩展名>`。
 * 用内容哈希而不是原名，是为了（a）绝不覆盖已有文件，（b）同名文件内容一定相同（可安全跳过重写），
 * （c）避免中文 / 空格 / 特殊字符被带进站点 URL。
 */
export function avatarFileName(buffer, ext) {
	const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
	return `avatar-${hash}.${ext}`;
}

/** 解析成绝对路径并强制落在允许目录内（先 resolve 再比较，防 ../ 越界）——与 media-compress.mjs 同款 */
function resolveInDir(repoRoot, rel, dir) {
	const root = path.resolve(repoRoot);
	const abs = path.resolve(root, rel);
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error(`路径越界: ${rel}`);
	}
	const base = path.resolve(root, dir);
	if (abs !== base && !abs.startsWith(base + path.sep)) {
		throw new Error(`不在允许的目录内: ${rel}`);
	}
	return abs;
}

async function statOrNull(abs) {
	try {
		const stat = await fs.stat(abs);
		return stat.isFile() ? stat : null;
	} catch {
		return null;
	}
}

/**
 * 等比缩小图片（只在「有 sharp + 不是动图 + 不是 GIF + 最长边超限」时真正动手）。
 * 任何一步失败都退回原图，并把原因写进 note 让面板显示出来。
 * @returns { buffer, resized, note, width, height }
 */
async function downscaleAvatar(buffer, ext) {
	const original = { buffer, resized: false, note: "", width: null, height: null };
	const sharp = loadSharp();
	if (!sharp) {
		return { ...original, note: "本地没有装 sharp（未执行 pnpm install），已按原图保存（未缩放）" };
	}
	if (ext === "gif") {
		return { ...original, note: "GIF 不缩放（避免把动图压成静帧）" };
	}
	try {
		const meta = await sharp(buffer, { failOn: "none" }).metadata();
		const pages = Number(meta?.pages) || 1;
		if (pages > 1) {
			return { ...original, note: "动图不缩放（避免把动画压成静帧）" };
		}
		const width = Number(meta?.width) || 0;
		const height = Number(meta?.height) || 0;
		if (!width || !height) {
			return { ...original, note: "读不到图片尺寸，已按原图保存（未缩放）" };
		}
		const longest = Math.max(width, height);
		if (longest <= AVATAR_MAX_DIMENSION) {
			return { ...original, note: `原图最长边 ${longest}px，未超过 ${AVATAR_MAX_DIMENSION}px，按原图保存`, width, height };
		}
		const pipeline = sharp(buffer, { failOn: "none" })
			.rotate()
			.resize({
				width: AVATAR_MAX_DIMENSION,
				height: AVATAR_MAX_DIMENSION,
				fit: "inside",
				withoutEnlargement: true,
			});
		const encoded = await encodeAs(pipeline, ext).toBuffer({ resolveWithObject: true });
		return {
			buffer: encoded.data,
			resized: true,
			note: `已等比缩放到最长边 ≤ ${AVATAR_MAX_DIMENSION}px（${width}×${height} → ${encoded.info.width}×${encoded.info.height}，${humanBytes(buffer.length)} → ${humanBytes(encoded.data.length)}），并去掉了 EXIF（含 GPS 等元数据）`,
			width: encoded.info.width,
			height: encoded.info.height,
		};
	} catch (error) {
		return { ...original, note: `缩放失败，已按原图保存：${error?.message ?? error}` };
	} finally {
		// Windows 上 sharp 会缓存文件句柄，跟 media-compress.mjs 一样用完清掉（这里喂的是 Buffer，属双保险）
		try {
			sharp.cache({ files: 0 });
		} catch {
			// 旧版本 sharp 没这个开关
		}
	}
}

/** 按真实格式编码（保持上传者的格式，不做格式替换，避免动图 / 透明通道被意外改变） */
function encodeAs(pipeline, ext) {
	switch (ext) {
		case "png":
			return pipeline.png({ compressionLevel: 9 });
		case "jpg":
			return pipeline.jpeg({ quality: 88, mozjpeg: true });
		case "webp":
			return pipeline.webp({ quality: 88 });
		case "avif":
			return pipeline.avif({ quality: 60 });
		default:
			return pipeline.png();
	}
}

/**
 * 当前头像状态（面板缩略图 / 路径 / 体积）。
 * 读的是 `settings.mjs` 的 `readSettings`，所以显示的一定是**配置里的真实值**，不是猜测。
 */
export async function describeAvatar(repoRoot) {
	let url = null;
	try {
		const values = readSettings(repoRoot);
		if (typeof values[AVATAR_SETTING_ID] === "string") url = values[AVATAR_SETTING_ID];
	} catch {
		url = null;
	}

	const base = {
		settingId: AVATAR_SETTING_ID,
		url,
		dir: AVATAR_DIR,
		default: AVATAR_DEFAULT,
		isDefault: url === AVATAR_DEFAULT,
		rewritable: typeof url === "string" && /\.(png|jpe?g|webp|avif|gif)$/i.test(url),
		remote: Boolean(url && /^https?:\/\//i.test(url)),
		repoPath: null,
		fileExists: false,
		size: null,
		updatedAt: null,
		limits: {
			maxBytes: AVATAR_MAX_BYTES,
			maxBytesText: humanBytes(AVATAR_MAX_BYTES),
			maxDimension: AVATAR_MAX_DIMENSION,
			accept: AVATAR_ACCEPT,
		},
	};

	// 只有「/assets/images/<文件名>」这种平铺路径才能被面板读文件信息
	// （远程 URL、src 相对路径、子目录都读不到 —— 那几种写法面板只显示路径本身）
	const name = url.slice(AVATAR_URL_PREFIX.length);
	if (!/^[^/\\]+$/.test(name)) return base;
	let abs;
	try {
		abs = resolveInDir(repoRoot, path.posix.join(AVATAR_DIR, name), AVATAR_DIR);
	} catch {
		return base;
	}
	const stat = await statOrNull(abs);
	return {
		...base,
		repoPath: path.posix.join(AVATAR_DIR, name),
		fileExists: Boolean(stat),
		size: stat ? stat.size : null,
		updatedAt: stat ? stat.mtime.toISOString() : null,
	};
}

/**
 * 换头像：校验 → 缩放 → 落盘（新文件名，不覆盖原图）→ 把 `profile.avatar` 指向新文件。
 * @param repoRoot   仓库根目录
 * @param filename   浏览器给的原文件名（只用来取扩展名 + 回显）
 * @param dataBase64 base64（前端已去掉 `data:...;base64,` 前缀）
 * @param snapshot   可选：写文件前的快照回调 `(rel) => Promise<void>`
 * @returns { ok, name, url, repoPath, bytes, originalName, resized, note, previous, changed }
 * @throws Error 校验失败 / 配置写入失败（失败时新图片会被删掉）
 */
export async function applyAvatar({ repoRoot, filename, dataBase64, snapshot } = {}) {
	if (!repoRoot) throw new Error("缺少仓库根目录");

	// ① 原文件名与扩展名：先用白名单卡一遍（`a.php` 这种直接拒），路径分隔符一律压平
	const safeName = path.basename(String(filename || "")).replace(/[\\/]/g, "_");
	if (!AVATAR_EXT_RE.test(safeName)) {
		throw userError(`头像只允许 png / jpg / jpeg / webp / avif / gif：${safeName || "（没有文件名）"}`);
	}

	// ② 体积：先按 base64 长度估算（不解码就能拒掉超大文件），解码后再精确卡一次
	const raw = String(dataBase64 || "");
	if (!raw) throw userError("缺少头像数据（dataBase64）");
	if (raw.length > Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 1024) {
		throw userError(`头像太大，上限 ${humanBytes(AVATAR_MAX_BYTES)}`);
	}
	const buffer = Buffer.from(raw, "base64");
	if (buffer.length === 0) throw userError("头像数据为空或不是合法的 base64");
	if (buffer.length > AVATAR_MAX_BYTES) {
		throw userError(`头像太大（${humanBytes(buffer.length)}），上限 ${humanBytes(AVATAR_MAX_BYTES)}`);
	}

	// ③ 真实格式（魔数）：扩展名对不对不算数，字节说了算；落盘扩展名也用它
	const realExt = sniffImageFormat(buffer);
	if (!realExt) {
		throw userError("这不是可识别的图片文件（只支持 PNG / JPEG / WebP / AVIF / GIF，改扩展名骗不过去）");
	}

	// ④ 可选缩放（失败/动图/GIF 都退回原图）
	const shrunk = await downscaleAvatar(buffer, realExt);

	// ⑤ 落盘：新文件名，不覆盖原头像
	const name = avatarFileName(shrunk.buffer, realExt);
	const repoPath = path.posix.join(AVATAR_DIR, name);
	const abs = resolveInDir(repoRoot, repoPath, AVATAR_DIR);
	const existed = Boolean(await statOrNull(abs));
	await fs.mkdir(path.dirname(abs), { recursive: true });
	if (existed && snapshot) await snapshot(repoPath);
	// 同目录临时文件 + rename：原子落盘，不会留下半个坏文件
	const temp = `${abs}.tmp-${process.pid}-${Date.now()}`;
	try {
		await fs.writeFile(temp, shrunk.buffer);
		await fs.rm(abs, { force: true }).catch(() => {});
		await fs.rename(temp, abs);
	} catch (error) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw error;
	}

	// ⑥ 改配置（走 settings.mjs 的白名单 / 校验 / 快照 / 回读 / 回滚）
	const url = `${AVATAR_URL_PREFIX}${name}`;
	let previous = null;
	try {
		previous = readSettings(repoRoot)[AVATAR_SETTING_ID] ?? null;
	} catch {
		previous = null;
	}
	try {
		const result = await applySettings(repoRoot, { [AVATAR_SETTING_ID]: url }, snapshot);
		return {
			ok: true,
			name,
			url,
			repoPath,
			bytes: shrunk.buffer.length,
			uploadedBytes: buffer.length,
			originalName: safeName,
			resized: shrunk.resized,
			width: shrunk.width,
			height: shrunk.height,
			note: shrunk.note,
			previous,
			changed: result.changed,
		};
	} catch (error) {
		// 配置没写成 ⇒ 这张新图片没人引用，删掉，别在 public 里堆垃圾（原有文件不动）
		if (!existed) await fs.rm(abs, { force: true }).catch(() => {});
		const rolled = new Error(`头像文件已写入但配置改写失败，已回滚：${error?.message ?? error}`);
		rolled.status = 500;
		throw rolled;
	}
}

/**
 * 恢复默认头像：只把 `profile.avatar` 改回 `AVATAR_DEFAULT`，**不删**已上传的文件
 * （删了就再也回不去那张图了；发布体积也就几十 KB，留着更划算）。
 */
export async function restoreDefaultAvatar({ repoRoot, snapshot } = {}) {
	if (!repoRoot) throw new Error("缺少仓库根目录");
	let previous = null;
	try {
		previous = readSettings(repoRoot)[AVATAR_SETTING_ID] ?? null;
	} catch {
		previous = null;
	}
	if (previous === AVATAR_DEFAULT) {
		return { ok: true, url: AVATAR_DEFAULT, previous, changed: [], unchanged: true };
	}
	const result = await applySettings(repoRoot, { [AVATAR_SETTING_ID]: AVATAR_DEFAULT }, snapshot);
	return { ok: true, url: AVATAR_DEFAULT, previous, changed: result.changed, unchanged: false };
}
