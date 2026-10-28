/**
 * 音乐资源「防重复 / 防仓库膨胀」的纯函数（无第三方依赖，可单测）。
 *
 * 背景（2026-10-28 实测）：历史里先提交了 210MB 高码率 mp3、后来又压缩成 89MB 再提交，
 * 两代文件都永久留在 .git 里（音乐历史 295MB）。这里的三道闸门就是防止再次发生：
 *   1. 上传时按内容哈希去重（findSameContent）
 *   2. 上传高码率音频时提示先压缩（probeMp3 + AUDIO_MAX_KBPS）
 *   3. 发布前拦下还没压缩的音频（auditMusicChanges）
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 音乐目录（相对仓库根，/ 分隔） */
export const MUSIC_DIR = "public/assets/music";
/** 目标码率：面板「一键压缩」默认压到 128k（scripts/compress-music.mjs 的默认值） */
export const AUDIO_TARGET_KBPS = 128;
/** 上限：超过它的 mp3 视为「还没压缩」，发布会被拦住（160k 留一点余量） */
export const AUDIO_MAX_KBPS = 160;
/** 码率读不出来时按体积兜底（12MB ≈ 128kbps 的 12 分钟） */
export const AUDIO_MAX_BYTES = 12 * 1024 * 1024;

// ── 读 MP3 首帧，拿到码率（从 scripts/compress-music.mjs 抽出来复用） ──────────
const BITRATE_TABLE = {
	1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATE_TABLE = {
	1: [44100, 48000, 32000],
	2: [22050, 24000, 16000],
	2.5: [11025, 12000, 8000],
};

export function probeMp3(buffer) {
	let offset = 0;
	if (buffer.toString("latin1", 0, 3) === "ID3") {
		const size =
			((buffer[6] & 0x7f) << 21) |
			((buffer[7] & 0x7f) << 14) |
			((buffer[8] & 0x7f) << 7) |
			(buffer[9] & 0x7f);
		offset = 10 + size;
	}
	const limit = Math.min(buffer.length - 4, offset + 2_000_000);
	for (let i = offset; i < limit; i++) {
		if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;
		const versionBits = (buffer[i + 1] >> 3) & 0x03;
		const layerBits = (buffer[i + 1] >> 1) & 0x03;
		const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
		const sampleRateIndex = (buffer[i + 2] >> 2) & 0x03;
		if (
			versionBits === 1 ||
			layerBits === 0 ||
			bitrateIndex === 0 ||
			bitrateIndex === 15
		)
			continue;
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

export function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/**
 * 在 dir（不递归）里找「内容完全相同」的文件，返回文件名；没有则 null。
 * 用于上传时拒收重复文件：同样一首歌被拖两次、或改名后再传一遍，都不该在仓库里存两份。
 */
export function findSameContent(dir, buffer) {
	const hash = sha256(buffer);
	let names = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return null;
	}
	for (const name of names) {
		const full = path.join(dir, name);
		let stat;
		try {
			stat = fs.statSync(full);
		} catch {
			continue;
		}
		if (!stat.isFile() || stat.size !== buffer.length) continue;
		try {
			if (sha256(fs.readFileSync(full)) === hash) return name;
		} catch {
			// 读不了就跳过
		}
	}
	return null;
}

/**
 * 发布前审计：在被改动/新增的路径里，找出还没压缩的 mp3。
 * @returns {{path:string,kbps:number|null,bytes:number,limitKbps:number,limitBytes:number}[]}
 */
export function auditMusicChanges(repoRoot, relPaths) {
	const violations = [];
	for (const rel of relPaths) {
		const normalized = String(rel).split("\\").join("/");
		if (!normalized.startsWith(MUSIC_DIR + "/")) continue;
		if (!/\.mp3$/i.test(normalized)) continue;
		let buffer;
		try {
			buffer = fs.readFileSync(path.join(repoRoot, normalized));
		} catch {
			continue; // 被删除的文件没有内容可查
		}
		const probe = probeMp3(buffer);
		const kbps = probe?.bitrate ?? null;
		const tooBig = kbps === null ? buffer.length > AUDIO_MAX_BYTES : kbps > AUDIO_MAX_KBPS;
		if (tooBig) {
			violations.push({
				path: normalized,
				kbps,
				bytes: buffer.length,
				limitKbps: AUDIO_MAX_KBPS,
				limitBytes: AUDIO_MAX_BYTES,
			});
		}
	}
	return violations;
}
