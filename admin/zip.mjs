/**
 * 极简 ZIP 写入器（零依赖，仅 store 方式）。
 *
 * 为什么不直接用压缩库？
 * - 管理面板刻意保持「零依赖」，只靠 Node 原生模块；备份只有几 MB，不压缩也够快。
 * - store（不压缩）实现简单、出错面小，Windows 资源管理器 / PowerShell Expand-Archive
 *   都能正常解压。
 *
 * 关于文件名：
 * - 一律用正斜杠分隔（ZIP 规范要求），并剥离开头的 `/` 与 `.`/`..` 段，避免解压时越界。
 * - 统一置 UTF-8 标志位（general purpose bit 11），否则中文文件名在资源管理器里会变乱码。
 */

/** 生成 CRC32 查找表（多项式 0xEDB88320）；表驱动比按位逐位算快一个数量级 */
function buildCrcTable() {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
}

// 查找表在模块加载时生成一次即可，之后所有 CRC 计算复用
const CRC_TABLE = buildCrcTable();

/** 计算 CRC32（ZIP 各文件头里必须带） */
export function crc32(buffer) {
	let crc = 0xffffffff;
	for (let i = 0; i < buffer.length; i++) {
		crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** 把 JS 时间转成 MS-DOS 的日期/时间字段（ZIP 只支持 1980~2107） */
function dosDateTime(date) {
	const year = Math.max(1980, date.getFullYear());
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

/**
 * 规范化条目名：正斜杠分隔、去掉盘符/绝对路径前缀、丢弃 . 与 .. 段。
 * 解压方（资源管理器、Expand-Archive）都会把名字当相对路径用，这里先挡住穿越写法。
 */
function normalizeName(name) {
	const cleaned = String(name)
		.replace(/\\/g, "/")
		.replace(/^[A-Za-z]:/, "")
		.split("/")
		.filter((segment) => segment && segment !== "." && segment !== "..")
		.join("/");
	return cleaned;
}

/**
 * 生成一个 ZIP 文件。
 * @param entries [{ name, data }]，name 用正斜杠，data 是 Buffer（也接受 Uint8Array/字符串）
 * @param options { date } 可固定时间戳，便于测试时得到确定性输出
 * @returns Buffer
 */
export function createZip(entries, options = {}) {
	const when = options.date instanceof Date ? options.date : new Date();
	const { time: dosTime, date: dosDate } = dosDateTime(when);

	const files = [];
	for (const entry of entries ?? []) {
		if (!entry) continue;
		const name = normalizeName(entry.name);
		if (!name) continue;
		const data = Buffer.isBuffer(entry.data)
			? entry.data
			: Buffer.from(entry.data ?? "", "utf8");
		files.push({ name, data, crc: crc32(data), nameBytes: Buffer.from(name, "utf8") });
	}

	// 先算总长度：这样只分配一次内存，避免大备份时反复拼接
	let localSize = 0;
	let centralSize = 0;
	for (const file of files) {
		localSize += 30 + file.nameBytes.length + file.data.length;
		centralSize += 46 + file.nameBytes.length;
	}
	const out = Buffer.alloc(localSize + centralSize + 22);

	let offset = 0;
	const centralOffsets = [];

	for (const file of files) {
		// ── 本地文件头 ──────────────────────────────────────────────────────
		out.writeUInt32LE(0x04034b50, offset); // 签名 "PK\3\4"
		out.writeUInt16LE(20, offset + 4); // 解压所需版本 2.0
		out.writeUInt16LE(0x0800, offset + 6); // 标志位：文件名为 UTF-8
		out.writeUInt16LE(0, offset + 8); // 压缩方式 0 = store（不压缩）
		out.writeUInt16LE(dosTime, offset + 10);
		out.writeUInt16LE(dosDate, offset + 12);
		out.writeUInt32LE(file.crc, offset + 14);
		out.writeUInt32LE(file.data.length, offset + 18); // 压缩后大小 = 原始大小
		out.writeUInt32LE(file.data.length, offset + 22);
		out.writeUInt16LE(file.nameBytes.length, offset + 26);
		out.writeUInt16LE(0, offset + 28); // 扩展区长度
		file.nameBytes.copy(out, offset + 30);
		offset += 30 + file.nameBytes.length;
		file.data.copy(out, offset);
		offset += file.data.length;

		centralOffsets.push(offset - file.data.length - file.nameBytes.length - 30);
	}

	// ── 中央目录 ────────────────────────────────────────────────────────────
	const centralStart = offset;
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		out.writeUInt32LE(0x02014b50, offset); // 签名 "PK\1\2"
		out.writeUInt16LE(20, offset + 4); // 生成方版本
		out.writeUInt16LE(20, offset + 6); // 解压所需版本
		out.writeUInt16LE(0x0800, offset + 8);
		out.writeUInt16LE(0, offset + 10);
		out.writeUInt16LE(dosTime, offset + 12);
		out.writeUInt16LE(dosDate, offset + 14);
		out.writeUInt32LE(file.crc, offset + 16);
		out.writeUInt32LE(file.data.length, offset + 20);
		out.writeUInt32LE(file.data.length, offset + 24);
		out.writeUInt16LE(file.nameBytes.length, offset + 28);
		out.writeUInt16LE(0, offset + 30); // 扩展区
		out.writeUInt16LE(0, offset + 32); // 注释
		out.writeUInt16LE(0, offset + 34); // 起始磁盘号
		out.writeUInt16LE(0, offset + 36); // 内部属性
		out.writeUInt32LE(0, offset + 38); // 外部属性
		out.writeUInt32LE(centralOffsets[i], offset + 42); // 本地头偏移
		file.nameBytes.copy(out, offset + 46);
		offset += 46 + file.nameBytes.length;
	}

	// ── 中央目录结束记录 ────────────────────────────────────────────────────
	out.writeUInt32LE(0x06054b50, offset); // 签名 "PK\5\6"
	out.writeUInt16LE(0, offset + 4); // 当前磁盘号
	out.writeUInt16LE(0, offset + 6); // 中央目录起始磁盘号
	out.writeUInt16LE(files.length, offset + 8);
	out.writeUInt16LE(files.length, offset + 10);
	out.writeUInt32LE(offset - centralStart, offset + 12); // 中央目录字节数
	out.writeUInt32LE(centralStart, offset + 16);
	out.writeUInt16LE(0, offset + 20); // 注释长度

	return out;
}
