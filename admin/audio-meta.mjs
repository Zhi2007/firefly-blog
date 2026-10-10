/**
 * 从音频文件里读取元数据：封面图、歌词、标题、艺术家
 *
 * 零依赖，自己解析标签结构：
 *   - MP3 ：ID3v2.3 / ID3v2.4 的 TIT2 / TPE1 / APIC / USLT / SYLT
 *   - FLAC：Vorbis Comment（TITLE / ARTIST / LYRICS / UNSYNCEDLYRICS）+ PICTURE 块
 *   - M4A / MP4：ilst 里的 ©nam / ©ART / ©lyr / covr
 *
 * 返回：
 *   {
 *     title, artist,
 *     cover: { data: Buffer, mime: string } | null,
 *     lyrics: { kind: "synced" | "plain", text: string } | null
 *   }
 */

/** ID3 的长度字段是「同步安全整数」，每字节只用低 7 位 */
function syncSafeInt(buffer) {
	return (
		((buffer[0] & 0x7f) << 21) |
		((buffer[1] & 0x7f) << 14) |
		((buffer[2] & 0x7f) << 7) |
		(buffer[3] & 0x7f)
	);
}

function swap16(buffer) {
	const out = Buffer.from(buffer);
	if (out.length % 2 === 0) out.swap16();
	return out;
}

/** 按 ID3 的编码字节解码文本 */
function decodeId3Text(buffer, encoding) {
	let text;
	if (encoding === 0) {
		text = buffer.toString("latin1");
	} else if (encoding === 1) {
		if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
			text = buffer.subarray(2).toString("utf16le");
		} else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
			text = swap16(buffer.subarray(2)).toString("utf16le");
		} else {
			text = buffer.toString("utf16le");
		}
	} else if (encoding === 2) {
		text = swap16(buffer).toString("utf16le");
	} else {
		text = buffer.toString("utf8");
	}
	return text.replace(/\0+$/, "");
}

/** 按编码切出第一个 null 结尾的字符串（宽字符是两个字节的 0） */
function splitNull(buffer, encoding) {
	const wide = encoding === 1 || encoding === 2;
	if (!wide) {
		const idx = buffer.indexOf(0);
		return idx < 0
			? { head: buffer, rest: Buffer.alloc(0) }
			: { head: buffer.subarray(0, idx), rest: buffer.subarray(idx + 1) };
	}
	for (let i = 0; i + 1 < buffer.length; i += 2) {
		if (buffer[i] === 0 && buffer[i + 1] === 0) {
			return { head: buffer.subarray(0, i), rest: buffer.subarray(i + 2) };
		}
	}
	return { head: buffer, rest: Buffer.alloc(0) };
}

const LRC_TIME = /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/;

function guessLyricsKind(text) {
	return LRC_TIME.test(text) ? "synced" : "plain";
}

function mimeToExt(mime) {
	const value = (mime || "").toLowerCase();
	if (value.includes("png")) return "png";
	if (value.includes("webp")) return "webp";
	if (value.includes("gif")) return "gif";
	if (value.includes("bmp")) return "bmp";
	return "jpg";
}

/** SYLT（同步歌词）→ LRC 文本 */
function syltToLrc(buffer) {
	const encoding = buffer[0];
	const format = buffer[4]; // 1 = MPEG 帧，2 = 毫秒
	let rest = buffer.subarray(6);
	rest = splitNull(rest, encoding).rest; // 跳过描述
	const entries = [];
	while (rest.length > 0) {
		const split = splitNull(rest, encoding);
		const text = decodeId3Text(split.head, encoding).trim();
		rest = split.rest;
		if (rest.length < 4) break;
		const stamp = rest.readUInt32BE(0);
		rest = rest.subarray(4);
		if (!text) continue;
		// MPEG 帧做单位时无法精确换算成秒，这里只保留毫秒制
		const ms = format === 2 ? stamp : 0;
		entries.push({ ms, text });
	}
	if (entries.length === 0) return null;
	const lines = entries.map(({ ms, text }) => {
		const total = Math.max(0, Math.round(ms / 10)); // 百分秒
		const m = String(Math.floor(total / 6000)).padStart(2, "0");
		const s = String(Math.floor((total % 6000) / 100)).padStart(2, "0");
		const cs = String(total % 100).padStart(2, "0");
		return `[${m}:${s}.${cs}]${text}`;
	});
	return lines.join("\n");
}

/** 解析 ID3v2 标签 */
function parseId3(buffer) {
	const result = { title: "", artist: "", cover: null, lyrics: null };
	if (buffer.length < 10 || buffer.toString("latin1", 0, 3) !== "ID3") return null;
	const major = buffer[3];
	const flags = buffer[5];
	const size = syncSafeInt(buffer.subarray(6, 10));
	let offset = 10;
	const end = Math.min(10 + size, buffer.length);
	// TXXX / COMM 里的歌词先存着：只有没有标准 USLT/SYLT 时才采用
	let textCandidate = null;

	// 跳过扩展头 / 未同步
	if (flags & 0x40 && offset + 4 <= end) {
		const extSize = major === 4 ? syncSafeInt(buffer.subarray(offset, offset + 4)) : buffer.readUInt32BE(offset);
		offset += extSize + (major === 4 ? 0 : 4);
	}

	while (offset + 10 <= end) {
		const id = buffer.toString("latin1", offset, offset + 4);
		if (!/^[A-Z0-9]{4}$/.test(id)) break;
		const frameSize =
			major === 4
				? syncSafeInt(buffer.subarray(offset + 4, offset + 8))
				: buffer.readUInt32BE(offset + 4);
		if (frameSize <= 0 || offset + 10 + frameSize > end) break;
		const data = buffer.subarray(offset + 10, offset + 10 + frameSize);

		if (id === "TIT2" || id === "TPE1") {
			const text = decodeId3Text(data.subarray(1), data[0]).trim();
			if (id === "TIT2" && text) result.title = text;
			if (id === "TPE1" && text) result.artist = text;
		} else if (id === "APIC") {
			const encoding = data[0];
			const mimeSplit = splitNull(data.subarray(1), 0);
			const mime = mimeSplit.head.toString("latin1");
			let rest = mimeSplit.rest.subarray(1); // 跳过图片类型字节
			rest = splitNull(rest, encoding).rest; // 跳过描述
			if (rest.length > 0 && !result.cover) {
				result.cover = { data: Buffer.from(rest), mime };
			}
		} else if (id === "USLT") {
			const encoding = data[0];
			let rest = data.subarray(4); // 编码(1) + 语言(3)
			rest = splitNull(rest, encoding).rest; // 跳过描述
			const text = decodeId3Text(rest, encoding).trim();
			if (text) result.lyrics = { kind: guessLyricsKind(text), text };
		} else if (id === "SYLT") {
			try {
				const lrc = syltToLrc(data);
				if (lrc) result.lyrics = { kind: "synced", text: lrc };
			} catch {
				// 忽略解析失败的 SYLT
			}
		} else if (id === "TXXX") {
			// 很多国内音乐软件的歌词存在 TXXX 自定义帧里（描述为 LYRICS / UNSYNCEDLYRICS）
			const encoding = data[0];
			const split = splitNull(data.subarray(1), encoding);
			const description = decodeId3Text(split.head, encoding).trim().toUpperCase();
			const value = decodeId3Text(split.rest, encoding).trim();
			if (value && /LYRIC/.test(description) && !textCandidate) {
				textCandidate = { kind: guessLyricsKind(value), text: value };
			}
		} else if (id === "COMM") {
			const encoding = data[0];
			const split = splitNull(data.subarray(4), encoding); // 编码(1) + 语言(3)
			const description = decodeId3Text(split.head, encoding).trim().toUpperCase();
			const value = decodeId3Text(split.rest, encoding).trim();
			if (value && /LYRIC/.test(description) && !textCandidate) {
				textCandidate = { kind: guessLyricsKind(value), text: value };
			}
		}
		offset += 10 + frameSize;
	}
	if (!result.lyrics && textCandidate) result.lyrics = textCandidate;
	return result;
}

/** 解析 FLAC 的元数据块 */
function parseFlac(buffer) {
	const result = { title: "", artist: "", cover: null, lyrics: null };
	if (buffer.toString("latin1", 0, 4) !== "fLaC") return null;
	let offset = 4;
	while (offset + 4 <= buffer.length) {
		const header = buffer[offset];
		const last = (header & 0x80) !== 0;
		const type = header & 0x7f;
		const length = buffer.readUIntBE(offset + 1, 3);
		const start = offset + 4;
		const end = start + length;
		if (end > buffer.length) break;

		if (type === 4) {
			// Vorbis Comment
			let p = start;
			const vendorLength = buffer.readUInt32LE(p);
			p += 4 + vendorLength;
			const count = buffer.readUInt32LE(p);
			p += 4;
			for (let i = 0; i < count && p + 4 <= end; i++) {
				const len = buffer.readUInt32LE(p);
				p += 4;
				const entry = buffer.toString("utf8", p, p + len);
				p += len;
				const eq = entry.indexOf("=");
				if (eq < 0) continue;
				const key = entry.slice(0, eq).toUpperCase();
				const value = entry.slice(eq + 1).trim();
				if (!value) continue;
				if (key === "TITLE" && !result.title) result.title = value;
				else if (key === "ARTIST" && !result.artist) result.artist = value;
				else if ((key === "LYRICS" || key === "UNSYNCEDLYRICS") && !result.lyrics) {
					result.lyrics = { kind: guessLyricsKind(value), text: value };
				}
			}
		} else if (type === 6 && !result.cover) {
			// PICTURE
			let p = start + 4; // 图片类型
			const mimeLength = buffer.readUInt32BE(p);
			p += 4;
			const mime = buffer.toString("latin1", p, p + mimeLength);
			p += mimeLength;
			const descLength = buffer.readUInt32BE(p);
			p += 4 + descLength;
			p += 16; // 宽、高、色深、颜色数
			const dataLength = buffer.readUInt32BE(p);
			p += 4;
			if (dataLength > 0 && p + dataLength <= end) {
				result.cover = { data: Buffer.from(buffer.subarray(p, p + dataLength)), mime };
			}
		}
		offset = end;
		if (last) break;
	}
	return result;
}

/** 解析 M4A / MP4 的 ilst 标签 */
function parseMp4(buffer) {
	const result = { title: "", artist: "", cover: null, lyrics: null };
	if (buffer.length < 12 || buffer.toString("latin1", 4, 8) !== "ftyp") return null;

	const readDataAtom = (start, end) => {
		let offset = start;
		while (offset + 8 <= end) {
			const size = buffer.readUInt32BE(offset);
			const type = buffer.toString("latin1", offset + 4, offset + 8);
			if (size < 8 || offset + size > end) break;
			if (type === "data" && offset + 16 <= end) {
				const dataType = buffer.readUInt32BE(offset + 8) & 0xffffff;
				const payload = buffer.subarray(offset + 16, offset + size);
				return { dataType, payload };
			}
			offset += size;
		}
		return null;
	};

	const walk = (start, end, depth) => {
		if (depth > 6) return;
		let offset = start;
		while (offset + 8 <= end) {
			let size = buffer.readUInt32BE(offset);
			const type = buffer.toString("latin1", offset + 4, offset + 8);
			let headerSize = 8;
			if (size === 1) {
				size = Number(buffer.readBigUInt64BE(offset + 8));
				headerSize = 16;
			} else if (size === 0) {
				size = end - offset;
			}
			if (size < headerSize || offset + size > end) break;
			const bodyStart = offset + headerSize;
			const bodyEnd = offset + size;
			const name = type.toLowerCase();

			if (name === "covr") {
				const data = readDataAtom(bodyStart, bodyEnd);
				if (data && !result.cover && data.payload.length > 0) {
					result.cover = {
						data: Buffer.from(data.payload),
						mime: data.dataType === 14 ? "image/png" : "image/jpeg",
					};
				}
			} else if (name === "©lyr" || name === "lyr") {
				const data = readDataAtom(bodyStart, bodyEnd);
				if (data && !result.lyrics) {
					const text = data.payload.toString("utf8").trim();
					if (text) result.lyrics = { kind: guessLyricsKind(text), text };
				}
			} else if (name === "©nam" || name === "©art") {
				const data = readDataAtom(bodyStart, bodyEnd);
				if (data) {
					const text = data.payload.toString("utf8").trim();
					if (name === "©nam" && !result.title) result.title = text;
					if (name === "©art" && !result.artist) result.artist = text;
				}
			} else if (
				name === "moov" ||
				name === "udta" ||
				name === "ilst" ||
				name === "trak" ||
				name === "mdia" ||
				name === "meta"
			) {
				// meta 原子前面有 4 字节版本/标志
				walk(bodyStart + (name === "meta" ? 4 : 0), bodyEnd, depth + 1);
			}
			offset = bodyEnd;
		}
	};

	walk(0, buffer.length, 0);
	return result;
}

/**
 * 统一入口：按文件头自动判断格式并提取元数据
 * @param {Buffer} buffer 音频文件内容
 * @returns {{title: string, artist: string, cover: {data: Buffer, mime: string}|null, lyrics: {kind: string, text: string}|null, format: string}}
 */
export function extractAudioMeta(buffer) {
	const empty = { title: "", artist: "", cover: null, lyrics: null, format: "unknown" };
	try {
		const id3 = parseId3(buffer);
		if (id3) return { ...empty, ...id3, format: "mp3" };
		const flac = parseFlac(buffer);
		if (flac) return { ...empty, ...flac, format: "flac" };
		const mp4 = parseMp4(buffer);
		if (mp4) return { ...empty, ...mp4, format: "m4a/mp4" };
	} catch {
		// 遇到坏文件就当没有元数据
	}
	return empty;
}

/** 把「无时间戳的纯文本歌词」按音频时长平均铺开成 LRC（粗略同步） */
export function plainLyricsToLrc(text, durationSeconds) {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return null;
	const total = Number(durationSeconds) > 0 ? Number(durationSeconds) : lines.length * 4;
	const start = Math.min(2, total * 0.05);
	const span = Math.max(1, total - start - 1);
	const step = span / lines.length;
	const toStamp = (seconds) => {
		const total2 = Math.max(0, Math.round(seconds * 100));
		const m = String(Math.floor(total2 / 6000)).padStart(2, "0");
		const s = String(Math.floor((total2 % 6000) / 100)).padStart(2, "0");
		const cs = String(total2 % 100).padStart(2, "0");
		return `[${m}:${s}.${cs}]`;
	};
	return lines.map((line, i) => `${toStamp(start + step * i)}${line}`).join("\n");
}

export { mimeToExt };
