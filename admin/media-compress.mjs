/**
 * 媒体批量压缩：把仓库里的位图转成 WebP，明显减小部署体积与访问流量。
 *
 * 几个刻意的设计：
 * - **绝不覆盖原文件**：输出到同目录同名的 `.webp`，原图留着。压缩是有损的，
 *   留一份原图才敢放心批量跑（管理面板的「备份 / 体检」也只能还原被我们改过的文件，
 *   凭空删掉的原图它救不回来）。
 * - **白名单目录**：只处理文章配图 / 站点图片 / 音乐封面这三个目录，
 *   别的路径一律拒绝，避免误伤 `src/assets`、`dist` 之类的构建产物。
 * - **sharp 用 createRequire 解析**：管理面板本身零依赖，sharp 是站点构建用的依赖；
 *   解析不到时返回明确的中文提示而不是抛异常（用户可能还没 `pnpm install`）。
 */

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

// 允许压缩的目录（相对仓库根，正斜杠）；与 MEDIA_DIRS 保持一致的口径
export const COMPRESS_DIRS = [
	"src/content/posts/images",
	"public/assets/images",
	"public/assets/music/cover",
];

const IMAGE_EXT_RE = /\.(png|jpe?g|bmp|tiff)$/i;

/** 解析 sharp：拿不到就返回 null，由调用方给出可读提示 */
function loadSharp() {
	try {
		const require = createRequire(import.meta.url);
		return require("sharp");
	} catch {
		return null;
	}
}

/** 把相对路径解析成绝对路径，并强制它落在白名单目录内（先 resolve 再比较，防 ../ 越界） */
function resolveInWhitelist(repoRoot, rel, dirs) {
	const root = path.resolve(repoRoot);
	const abs = path.resolve(root, rel);
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		throw new Error(`路径越界: ${rel}`);
	}
	const ok = dirs.some((dir) => {
		const base = path.resolve(root, dir);
		return abs === base || abs.startsWith(base + path.sep);
	});
	if (!ok) throw new Error(`不在允许压缩的目录内: ${rel}`);
	return abs;
}

/** 递归收集某个目录下的位图（返回相对仓库根的路径，统一正斜杠） */
async function collectImages(repoRoot, relDir, out) {
	const absDir = resolveInWhitelist(repoRoot, relDir, COMPRESS_DIRS);
	const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => null);
	if (!entries) return;
	for (const entry of entries) {
		const rel = path.posix.join(relDir, entry.name);
		if (entry.isDirectory()) {
			await collectImages(repoRoot, rel, out);
			continue;
		}
		if (entry.isFile() && IMAGE_EXT_RE.test(entry.name)) out.push(rel);
	}
}

/** 人类可读的体积，给前端直接显示用 */
function human(bytes) {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 批量转 WebP。
 * @param repoRoot 仓库根目录
 * @param dirs     要处理的目录（相对仓库根）；默认只用 COMPRESS_DIRS
 * @param maxWidth 最长边上限（等比缩放，不放大）
 * @param quality  WebP 质量 1~100
 * @param dryRun   只统计，不写文件
 * @param skipExisting 目标 .webp 已存在时跳过
 * @returns { ok, items, totals } 或 { ok: false, error }
 */
export async function compressImages({
	repoRoot,
	dirs = COMPRESS_DIRS,
	maxWidth = 1600,
	quality = 78,
	dryRun = false,
	skipExisting = true,
} = {}) {
	if (!repoRoot) return { ok: false, error: "缺少仓库根目录" };
	const wanted = Array.isArray(dirs) && dirs.length > 0 ? dirs : COMPRESS_DIRS;

	// 先整体校验目录，避免"处理了一半才发现越界"
	const targets = [];
	for (const dir of wanted) {
		if (typeof dir !== "string" || !dir.trim()) {
			return { ok: false, error: "目录名不合法" };
		}
		try {
			resolveInWhitelist(repoRoot, dir, COMPRESS_DIRS);
		} catch {
			return { ok: false, error: `只能压缩这三个目录：${COMPRESS_DIRS.join("、")}` };
		}
		targets.push(dir.replace(/\\/g, "/").replace(/\/+$/, ""));
	}

	const sharp = loadSharp();
	if (!sharp && !dryRun) {
		return { ok: false, error: "没有找到 sharp，请先 pnpm install" };
	}

	const sources = [];
	for (const dir of targets) await collectImages(repoRoot, dir, sources);
	sources.sort();

	const items = [];
	let beforeTotal = 0;
	let afterTotal = 0;
	let converted = 0;

	for (const rel of sources) {
		const absIn = resolveInWhitelist(repoRoot, rel, COMPRESS_DIRS);
		const outRel = rel.replace(IMAGE_EXT_RE, ".webp");
		const absOut = resolveInWhitelist(repoRoot, outRel, COMPRESS_DIRS);
		const before = (await fs.stat(absIn)).size;
		beforeTotal += before;

		if (skipExisting && (await fs.stat(absOut).catch(() => null))) {
			items.push({ rel, outRel, before, after: null, saved: 0, status: "skipped" });
			afterTotal += before; // 已压缩过 ⇒ 视作保持现状，不再算省下
			continue;
		}

		if (dryRun) {
			// 经验值：PNG 转 WebP 大约剩 25%，JPEG 转 WebP 大约剩 65%；只用于给个印象
			const estimate = Math.round(before * (before > 0 && /\.png$/i.test(rel) ? 0.25 : 0.65));
			items.push({ rel, outRel, before, after: estimate, saved: before - estimate, status: "pending" });
			afterTotal += estimate;
			continue;
		}

		try {
			const pipeline = sharp(absIn, { failOn: "none" }).rotate();
			const resized = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
			// 先编码到内存，再写「同目录临时文件 + rename」：
			// Windows 上直接往已存在的 .webp 写入会撞共享冲突（文件可能正被 sharp 自己读着），
			// rename 是原子的，顺带保证不会留下半个坏文件。
			const encoded = await resized.webp({ quality }).toBuffer();
			const temp = `${absOut}.tmp-${process.pid}-${Date.now()}`;
			try {
				await fs.writeFile(temp, encoded);
				// 删掉旧目标再改名：rename 覆盖在"目标被别的进程打开"时也会失败，先删能用上普通的覆盖写
				await fs.rm(absOut, { force: true }).catch(() => {});
				await fs.rename(temp, absOut);
			} catch (error) {
				await fs.rm(temp, { force: true }).catch(() => {});
				throw error;
			}
			const after = encoded.length;
			converted++;
			afterTotal += after;
			items.push({ rel, outRel, before, after, saved: before - after, status: "converted" });
		} catch (error) {
			afterTotal += before;
			items.push({
				rel,
				outRel: null,
				before,
				after: null,
				saved: 0,
				status: "failed",
				error: error?.message ?? String(error),
			});
		}
	}

	// 压缩完把 sharp 的文件句柄缓存清掉：
	// Windows 上被 sharp 读过的文件会被一直占着，导致下一轮想覆盖它时报 EPERM/UNKNOWN。
	// 放在 finally 里是为了压缩中途报错也照样释放。
	if (sharp) {
		try {
			sharp.cache({ files: 0 });
		} catch {
			// 旧版本 sharp 没有这个开关，忽略即可
		}
	}

	return {
		ok: true,
		dirs: targets,
		sharp: Boolean(sharp),
		dryRun,
		maxWidth,
		quality,
		items,
		totals: {
			total: items.length,
			converted,
			skipped: items.filter((i) => i.status === "skipped").length,
			failed: items.filter((i) => i.status === "failed").length,
			before: beforeTotal,
			after: afterTotal,
			saved: beforeTotal - afterTotal,
			beforeText: human(beforeTotal),
			afterText: human(afterTotal),
			savedText: human(Math.max(0, beforeTotal - afterTotal)),
		},
	};
}
