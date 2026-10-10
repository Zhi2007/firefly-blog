#!/usr/bin/env node
/**
 * 批量压缩站点媒体资源（音乐 / 封面），体积与流量都能明显下降。
 *
 * 用法：
 *   node scripts/compress-music.mjs                  # 压缩 public/assets/music 下所有 > 目标码率的 mp3
 *   node scripts/compress-music.mjs --covers         # 压缩封面图（PNG→JPEG、限制最长边，见 COVER_MAX）
 *   node scripts/compress-music.mjs --all            # 音频 + 封面一起处理（推荐）
 *   node scripts/compress-music.mjs --bitrate 160k   # 指定音频目标码率（默认 128k）
 *   node scripts/compress-music.mjs --dry-run        # 只列出会处理哪些文件、预计省多少
 *   node scripts/compress-music.mjs --force          # 已低于目标码率的也重新编码（不推荐，会有二次损失）
 *   node scripts/compress-music.mjs --dir <路径>     # 指定音乐目录（此时不改歌单）
 *
 * 说明：
 * - 音频保留标题/艺术家标签（-map_metadata 0）与内嵌封面（-c:v copy，只取第一张 APIC）
 * - 封面统一转成 JPEG（质量见 COVER_QUALITY）并把最长边限制到 COVER_MAX，显示尺寸远小于它就够了
 * - 转码后会用 admin/audio-meta.mjs 回读校验（标签、封面是否还在），校验不过就不替换原文件
 * - 原始文件都在 git 历史里，随时可以 git checkout 还原
 * - 会把歌单里的音频/封面地址改成带内容哈希的 ?v=xxxxxxxx，避免浏览器继续用缓存里的大文件
 * - ⚠️ 内嵌在音频里的歌词（TXXX/USLT）不会被保留：请先确认每首歌都有 .lrc 文件
 *   （管理面板「音乐」页的「从音频重新提取」可以生成，播放器读的是 .lrc 而不是音频内嵌标签）
 * - 需要 ffmpeg：优先用环境变量 FFMPEG_PATH，其次 PATH，最后查常见安装位置
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { extractAudioMeta } = await import(new URL("../admin/audio-meta.mjs", import.meta.url).href);

// 封面显示尺寸（播放器 / 歌单卡片）远小于这个值，600px 已经足够清晰
const COVER_MAX = 600;
const COVER_QUALITY = 4; // ffmpeg -q:v，数值越小质量越高（2~5 之间比较合适）

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const doAudio = !args.includes("--covers") || args.includes("--all");
const doCovers = args.includes("--covers") || args.includes("--all");
const bitrate = (() => {
	const i = args.indexOf("--bitrate");
	return i >= 0 ? args[i + 1] : "128k";
})();
const dirArg = (() => {
	const i = args.indexOf("--dir");
	return i >= 0 ? args[i + 1] : null;
})();
const musicDir = dirArg ? path.resolve(dirArg) : path.join(ROOT, "public", "assets", "music");
const coverDir = path.join(musicDir, "cover");
const playlistPath = path.join(ROOT, "src", "config", "music-playlist.json");
const targetKbps = Number.parseInt(bitrate, 10) || 128;

// ── 找 ffmpeg ────────────────────────────────────────────────────────────────
function findFfmpeg() {
	const candidates = [];
	if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
	if (process.env.TEMP) {
		candidates.push(path.join(process.env.TEMP, "fftools", "node_modules", "ffmpeg-static", "ffmpeg.exe"));
		// 之前用 npmmirror 包临时装的 ffmpeg（@ffmpeg-installer/win32-x64）
		candidates.push(path.join(process.env.TEMP, "fftools", "package", "ffmpeg.exe"));
	}
	try {
		const which = process.platform === "win32" ? "where" : "which";
		const out = execFileSync(which, ["ffmpeg"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		candidates.push(...out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
	} catch {
		// PATH 里没有就继续找常见位置
	}
	for (const p of [
		"C:\\ffmpeg\\bin\\ffmpeg.exe",
		path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
		path.join(process.env.USERPROFILE ?? "", "scoop", "shims", "ffmpeg.exe"),
		"/usr/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/opt/homebrew/bin/ffmpeg",
	]) {
		if (p) candidates.push(p);
	}
	return candidates.find((p) => {
		try {
			return fs.statSync(p).isFile();
		} catch {
			return false;
		}
	});
}

// ── 读 MP3 首帧，拿到码率 ────────────────────────────────────────────────────
const BITRATE_TABLE = {
	1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATE_TABLE = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

export function probeMp3(buffer) {
	let offset = 0;
	if (buffer.toString("latin1", 0, 3) === "ID3") {
		const size =
			((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
		offset = 10 + size;
	}
	const limit = Math.min(buffer.length - 4, offset + 2_000_000);
	for (let i = offset; i < limit; i++) {
		if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;
		const versionBits = (buffer[i + 1] >> 3) & 0x03;
		const layerBits = (buffer[i + 1] >> 1) & 0x03;
		const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
		const sampleRateIndex = (buffer[i + 2] >> 2) & 0x03;
		if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15) continue;
		if (sampleRateIndex === 3) continue;
		const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
		const table = version === 1 ? BITRATE_TABLE[1] : BITRATE_TABLE[2];
		const rate = table[bitrateIndex];
		const sampleRate = SAMPLE_RATE_TABLE[version]?.[sampleRateIndex];
		if (!rate || !sampleRate) continue;
		return { bitrate: rate, sampleRate, version };
	}
	return null;
}

function human(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function run(cmd, cmdArgs) {
	const result = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`${path.basename(cmd)} 执行失败：${(result.stderr || result.stdout || "").trim().split("\n").slice(-2).join(" ")}`,
		);
	}
	return result.stdout;
}

function shortHash(file) {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
}

/** 给歌单里的音频与封面地址补上内容哈希（文件没变则哈希不变，浏览器不会再拿旧缓存） */
function syncPlaylist(coverRename) {
	if (dryRun || dirArg || !fs.existsSync(playlistPath)) return;
	const playlist = JSON.parse(fs.readFileSync(playlistPath, "utf8"));
	let touched = 0;
	for (const song of playlist) {
		// 音频
		if (typeof song.url === "string" && song.url.includes("/assets/music/")) {
			const rel = decodeURIComponent(song.url.split("?")[0].replace("/assets/music/", ""));
			const file = path.join(musicDir, rel);
			if (fs.existsSync(file)) {
				const next = `${song.url.split("?")[0]}?v=${shortHash(file)}`;
				if (next !== song.url) {
					song.url = next;
					touched++;
				}
			}
		}
		// 封面（可能已被重命名为 .jpg）
		if (typeof song.cover === "string" && song.cover.includes("/assets/music/cover/")) {
			const oldName = decodeURIComponent(song.cover.split("?")[0].replace("/assets/music/cover/", ""));
			const newName = coverRename.get(oldName) ?? oldName;
			const base = `/assets/music/cover/${newName}`;
			const file = path.join(coverDir, newName);
			const next = fs.existsSync(file) ? `${base}?v=${shortHash(file)}` : base;
			if (next !== song.cover) {
				song.cover = next;
				touched++;
			}
		}
	}
	if (touched > 0) {
		fs.writeFileSync(playlistPath, `${JSON.stringify(playlist, null, "\t")}\n`, "utf8");
		console.log(`\n歌单已更新：${touched} 处地址（带内容哈希）`);
	}
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const ffmpeg = findFfmpeg();
if (!ffmpeg) {
	console.error("找不到 ffmpeg。请先安装（winget install Gyan.FFmpeg）或用 FFMPEG_PATH 指定路径。");
	process.exit(1);
}
if (!fs.existsSync(musicDir)) {
	console.error(`音乐目录不存在：${musicDir}`);
	process.exit(1);
}

console.log(`ffmpeg : ${ffmpeg}`);
console.log(`目录   : ${musicDir}`);
console.log(`任务   : ${doAudio ? `音频→${bitrate}` : ""}${doAudio && doCovers ? " + " : ""}${doCovers ? `封面→JPEG 最长边${COVER_MAX}px` : ""}${dryRun ? "（演练模式，不写文件）" : ""}\n`);

const tmpDir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "music-cmp-"));
const coverRename = new Map();

try {
	// ── 1) 音频 ────────────────────────────────────────────────────────────
	if (doAudio) {
		const files = fs
			.readdirSync(musicDir)
			.filter((name) => name.toLowerCase().endsWith(".mp3"))
			.sort();
		let replaced = 0;
		let skipped = 0;
		let failed = 0;
		let beforeTotal = 0;
		let afterTotal = 0;

		for (const name of files) {
			const input = path.join(musicDir, name);
			const inputBuf = fs.readFileSync(input);
			const probe = probeMp3(inputBuf);
			beforeTotal += inputBuf.length;

			if (probe && probe.bitrate <= targetKbps && !force) {
				console.log(`跳过  ${name}  （已是 ${probe.bitrate}kbps）`);
				afterTotal += inputBuf.length;
				skipped++;
				continue;
			}

			if (dryRun) {
				const estimated = Math.round(inputBuf.length * (targetKbps / (probe?.bitrate ?? targetKbps)));
				console.log(`待压缩 ${name}  ${probe?.bitrate ?? "?"}kbps ${human(inputBuf.length)} → 约 ${human(estimated)}`);
				afterTotal += estimated;
				continue;
			}

			const output = path.join(tmpDir, name);
			try {
				run(ffmpeg, [
					"-hide_banner", "-loglevel", "error", "-y",
					"-i", input,
					"-map", "0:a:0",
					"-map", "0:v:0?",
					"-c:a", "libmp3lame",
					"-b:a", bitrate,
					"-c:v", "copy",
					"-disposition:v", "attached_pic",
					"-id3v2_version", "3",
					"-map_metadata", "0",
					output,
				]);

				const outBuf = fs.readFileSync(output);
				const outProbe = probeMp3(outBuf);
				const meta = extractAudioMeta(outBuf);
				const before = extractAudioMeta(inputBuf);
				const problems = [];
				if (!outProbe) problems.push("无法解析输出码率");
				if (outBuf.length >= inputBuf.length) problems.push("输出没有变小");
				if (before.cover && !meta.cover) problems.push("封面丢失");
				if (before.title && !meta.title) problems.push("标题标签丢失");
				if (problems.length) throw new Error(problems.join("；"));

				fs.copyFileSync(output, input);
				afterTotal += outBuf.length;
				replaced++;
				const cover = meta.cover ? ` 封面${Math.round(meta.cover.data.length / 1024)}KB` : "";
				const lyrics = meta.lyrics ? " 歌词在" : "";
				console.log(
					`压缩  ${name}  ${probe?.bitrate ?? "?"}kbps → ${outProbe?.bitrate ?? "?"}kbps  ${human(inputBuf.length)} → ${human(outBuf.length)}${cover}${lyrics}`,
				);
			} catch (error) {
				failed++;
				afterTotal += inputBuf.length;
				console.log(`失败  ${name}  ${error.message}`);
			}
		}
		console.log(
			`\n音频：压缩 ${replaced} 首，跳过 ${skipped} 首，失败 ${failed} 首` +
				`\n体积：${human(beforeTotal)} → ${human(afterTotal)}（省 ${human(beforeTotal - afterTotal)}）`,
		);
	}

	// ── 2) 封面 ────────────────────────────────────────────────────────────
	if (doCovers && fs.existsSync(coverDir)) {
		let cBefore = 0;
		let cAfter = 0;
		let cChanged = 0;
		for (const name of fs.readdirSync(coverDir).sort()) {
			if (!/\.(png|jpe?g)$/i.test(name)) continue;
			const full = path.join(coverDir, name);
			const before = fs.statSync(full).size;
			cBefore += before;
			const isPng = /\.png$/i.test(name);
			if (!isPng && before < 150 * 1024) {
				cAfter += before;
				continue;
			}
			if (dryRun) {
				console.log(`待压缩 ${name}  ${Math.round(before / 1024)}KB → 约 ${Math.round((before * (isPng ? 0.12 : 0.45)) / 1024)}KB`);
				cAfter += Math.round(before * (isPng ? 0.12 : 0.45));
				continue;
			}
			const outName = name.replace(/\.png$/i, ".jpg");
			const outFull = path.join(coverDir, outName);
			const tmp = path.join(tmpDir, `cover-${outName}`);
			try {
				run(ffmpeg, [
					"-hide_banner", "-loglevel", "error", "-y",
					"-i", full,
					"-vf", `scale='min(${COVER_MAX},iw)':-2:flags=lanczos`,
					"-q:v", String(COVER_QUALITY),
					"-pix_fmt", "yuvj420p",
					tmp,
				]);
				const after = fs.statSync(tmp).size;
				if (after >= before) {
					console.log(`跳过  ${name}（压缩后没变小）`);
					cAfter += before;
					continue;
				}
				fs.copyFileSync(tmp, outFull);
				if (outName !== name) fs.rmSync(full);
				coverRename.set(name, outName);
				cAfter += after;
				cChanged++;
				console.log(`压缩  ${name}${outName === name ? "" : ` → ${outName}`}  ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`);
			} catch (error) {
				cAfter += before;
				console.log(`失败  ${name}  ${error.message}`);
			}
		}
		console.log(
			`\n封面：处理 ${cChanged} 个` +
				`\n体积：${human(cBefore)} → ${human(cAfter)}（省 ${human(cBefore - cAfter)}）`,
		);
	}

	syncPlaylist(coverRename);
} finally {
	fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (!dryRun) {
	console.log("记得提交并推送：改动在 public/assets/music/ 与 src/config/music-playlist.json");
}
