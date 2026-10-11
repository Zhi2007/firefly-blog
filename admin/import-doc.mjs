/**
 * 从 Word（.docx）/ .txt / .md 导入文章 —— 解析成 markdown 正文 + 建议标题/摘要。
 *
 * 设计取舍：
 * - 零依赖：.docx 本质是个 ZIP，这里自己读 ZIP（中央目录 → 本地头 → inflateRawSync），
 *   XML 用一个小状态机切成块后再逐块处理，不做"正则切整个文档"那种脆做法。
 * - 只负责"转换成 markdown"，**不写文章正文**；图片要落盘（否则引用不到），
 *   因为编辑器里贴不上二进制图片。文章本体始终由用户检查后自己点保存。
 * - 认不出的标签一律跳过而不是抛错，跳过的数量汇总进 warnings 让用户知道有损失。
 */

import { inflateRawSync } from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";

// 导入体积上限：管理面板走 base64 JSON，太大既慢又容易让浏览器卡住
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

// 支持的扩展名 → 内部 kind
const TEXT_KINDS = {
	".txt": "txt",
	".text": "txt",
	".md": "md",
	".markdown": "md",
};

// ── 通用小工具 ──────────────────────────────────────────────────────────────

/** 去掉 BOM、统一 CRLF 为标准换行 */
function normalizeNewlines(text) {
	return String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function baseNameWithoutExt(filename) {
	const base = path.basename(String(filename || ""));
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

function extensionOf(filename) {
	const base = path.basename(String(filename || ""));
	const dot = base.lastIndexOf(".");
	return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/** 文件名 → 建议标题：去扩展名，`-`/`_` 转空格，压掉多余空白 */
function titleFromFilename(filename) {
	const raw = baseNameWithoutExt(filename).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	return raw;
}

/** 图片文件名用的 slug：只留安全字符，避免拼出越界路径 */
function safeSlug(text, fallback = "import") {
	const cleaned = String(text ?? "")
		.trim()
		.toLowerCase()
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/[\s._]+/g, "-")
		.replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return cleaned || fallback;
}

/** 图片扩展名白名单：docx 里可能夹带 emf/wmf 之类，保留原扩展名但只允许常见图片 */
function imageExtOf(localName) {
	const ext = extensionOf(localName).slice(1);
	if (!/^[a-z0-9]+$/.test(ext)) return "";
	if (!/^(png|jpe?g|gif|webp|avif|bmp|tiff?|svg|emf|wmf)$/.test(ext)) return "";
	return ext === "jpeg" ? "jpg" : ext;
}

/** 按字数截断（用 code point 数，避免把 emoji/中文截断成半个） */
function truncate(text, limit) {
	const chars = [...String(text ?? "")];
	if (chars.length <= limit) return String(text ?? "").trim();
	return `${chars.slice(0, limit).join("").trim()}…`;
}

// ── TXT / MD ───────────────────────────────────────────────────────────────

/**
 * 编码自适应：先按 UTF-8（严格模式）解；失败或出现替换字符就改用 GBK。
 * 国内用户用记事本另存的 txt 大多是 GBK，不处理就会整篇乱码。
 */
function decodeText(buffer) {
	if (buffer.length === 0) return { text: "", encoding: "utf-8", warnings: [] };
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return {
			text: normalizeNewlines(buffer.subarray(3).toString("utf-8")),
			encoding: "utf-8",
			warnings: [],
		};
	}
	if (buffer[0] === 0xff && buffer[1] === 0xfe) {
		return {
			text: normalizeNewlines(buffer.subarray(2).toString("utf16le")),
			encoding: "utf-16le",
			warnings: [],
		};
	}
	if (buffer[0] === 0xfe && buffer[1] === 0xff) {
		// 大端 UTF-16：Node 没内置，手工翻转字节序后按小端解
		return {
			text: normalizeNewlines(Buffer.from(buffer.subarray(2)).swap16().toString("utf16le")),
			encoding: "utf-16be",
			warnings: [],
		};
	}

	let utf8 = "";
	try {
		utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		utf8 = "";
	}
	if (utf8 && !utf8.includes("\uFFFD")) {
		return { text: normalizeNewlines(utf8), encoding: "utf-8", warnings: [] };
	}

	try {
		const gbk = new TextDecoder("gbk").decode(buffer);
		if (gbk && !gbk.includes("\uFFFD")) {
			return {
				text: normalizeNewlines(gbk),
				encoding: "gbk",
				warnings: ["文件不是 UTF-8 编码，已按 GBK 解码；若出现个别乱码请确认原文件编码"],
			};
		}
	} catch {
		// 运行环境没有 GBK 解码器时继续往下走兜底
	}

	return {
		text: normalizeNewlines(new TextDecoder("utf-8").decode(buffer)),
		encoding: "utf-8",
		warnings: ["文件编码无法确定，已尽量按 UTF-8 解码，可能有个别乱码字符"],
	};
}

/**
 * 纯文本 → markdown 段落。
 * 段落规则：空行分段；每个非空行视为一段（保留换行带来的语义）。
 */
function textToMarkdown(text) {
	const lines = text.split("\n");
	const blocks = [];
	let firstBlockLine = -1;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].replace(/\s+$/, "");
		if (!trimmed.trim()) continue;
		if (firstBlockLine < 0) firstBlockLine = i;
		blocks.push(trimmed);
	}
	return { blocks, firstBlockLine };
}

function parseTxt(filename, text) {
	const lines = text.split("\n");
	const { blocks, firstBlockLine } = textToMarkdown(text);
	if (blocks.length === 0) return null;

	const firstLine = (lines[firstBlockLine] ?? "").trim();
	const rest = lines.slice(firstBlockLine + 1).join("\n");
	// 只有"第一行短 + 后面整行是空行"才敢把它当标题。
	// 用整行判断而不是 /^\s*\n/：避免第一行超过 60 字时连后面的空行都匹配不上。
	const blankAfterFirst = /^[ \t]*\r?\n/.test(rest);
	const title = firstLine && [...firstLine].length <= 60 && blankAfterFirst ? firstLine : "";
	// 标题已经填进「标题」输入框，正文里就不要再来一遍
	const bodyBlocks = title ? blocks.filter((block) => block !== title) : blocks;
	if (bodyBlocks.length === 0) return null;

	return {
		markdown: bodyBlocks.join("\n\n"),
		title: title || titleFromFilename(filename),
		description: truncate(bodyBlocks[0] ?? "", 100),
	};
}

/** 解析 md 开头的 `--- ... ---` frontmatter（只取 title / description，其余原样留在正文外） */
function parseFrontmatter(raw) {
	const text = normalizeNewlines(raw);
	if (!/^---[ \t]*\n/.test(text)) return null;
	const endMatch = /\n---[ \t]*(?:\n|$)/.exec(text.slice(3));
	if (!endMatch) return null;
	const inner = text.slice(text.indexOf("\n") + 1, 3 + endMatch.index);
	const body = text.slice(3 + endMatch.index + endMatch[0].length);

	const fields = {};
	for (const line of inner.split("\n")) {
		const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (!match) continue;
		let value = match[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}
		fields[match[1].toLowerCase()] = value;
	}
	return { fields, body };
}

function parseMarkdown(filename, raw) {
	const fm = parseFrontmatter(raw);
	const body = (fm ? fm.body : normalizeNewlines(raw)).replace(/^\n+/, "").replace(/\s+$/, "");
	if (!body.trim()) return null;
	const firstBlock = body.split(/\n{2,}/).find((block) => block.trim()) ?? "";
	return {
		markdown: body,
		title: fm?.fields.title || titleFromFilename(filename),
		description: fm?.fields.description ? truncate(fm.fields.description, 100) : truncate(firstBlock, 100),
	};
}

// ── ZIP 读取（只读，够解析 docx 即可） ─────────────────────────────────────

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

function findEocd(buffer) {
	const minOffset = Math.max(0, buffer.length - 66000);
	for (let i = buffer.length - 22; i >= minOffset; i--) {
		if (buffer.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
		const commentLength = buffer.readUInt16LE(i + 20);
		if (i + 22 + commentLength <= buffer.length) return i;
	}
	return -1;
}

/**
 * 用中央目录读出所有条目（名字、压缩方式、大小、本地头偏移）。
 * 只认中央目录：本地头里的 header 长度字段在有 data descriptor 时不可靠。
 */
function readCentralDirectory(buffer) {
	const eocd = findEocd(buffer);
	if (eocd < 0) throw new Error("不是合法的 ZIP（找不到中央目录结束记录）");

	let entryCount = buffer.readUInt16LE(eocd + 10);
	let centralSize = buffer.readUInt32LE(eocd + 12);
	let centralOffset = buffer.readUInt32LE(eocd + 16);

	// ZIP64：字段被填成 0xFFFFFFFF 时去 ZIP64 EOCD 里取真实值
	if (
		entryCount === 0xffff ||
		centralSize === 0xffffffff ||
		centralOffset === 0xffffffff
	) {
		const locator = eocd - 20;
		if (locator >= 0 && buffer.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
			const z64 = Number(buffer.readBigUInt64LE(locator + 8));
			if (z64 >= 0 && z64 + 56 <= buffer.length && buffer.readUInt32LE(z64) === ZIP64_EOCD_SIGNATURE) {
				entryCount = Number(buffer.readBigUInt64LE(z64 + 32));
				centralSize = Number(buffer.readBigUInt64LE(z64 + 40));
				centralOffset = Number(buffer.readBigUInt64LE(z64 + 48));
			}
		}
	}

	const entries = new Map();
	let offset = centralOffset;
	for (let i = 0; i < entryCount; i++) {
		if (offset + 46 > buffer.length) throw new Error("ZIP 中央目录被截断");
		if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("ZIP 中央目录记录损坏");

		const flags = buffer.readUInt16LE(offset + 8);
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const uncompressedSize = buffer.readUInt32LE(offset + 24);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);

		const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
		// 置了 UTF-8 标志位（bit 11）就按 UTF-8 解，否则按 CP437；
		// 但不少工具不置位却写 UTF-8，所以先试 UTF-8 解出合法结果就采用。
		let name = "";
		if (flags & 0x800) {
			name = nameBytes.toString("utf-8");
		} else {
			try {
				const strict = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
				name = strict;
			} catch {
				name = nameBytes.toString("latin1");
			}
		}

		entries.set(name, {
			name,
			flags,
			method,
			compressedSize,
			uncompressedSize,
			localOffset,
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** 读出某个条目的原始字节（支持 store 与 deflate） */
function readZipEntry(buffer, entry) {
	const base = entry.localOffset;
	if (base + 30 > buffer.length || buffer.readUInt32LE(base) !== LOCAL_SIGNATURE) {
		throw new Error(`ZIP 条目本地头损坏: ${entry.name}`);
	}
	const nameLength = buffer.readUInt16LE(base + 26);
	const extraLength = buffer.readUInt16LE(base + 28);
	const start = base + 30 + nameLength + extraLength;

	if (entry.method === 0) {
		return buffer.subarray(start, start + entry.compressedSize);
	}
	if (entry.method === 8) {
		const raw = buffer.subarray(start, start + entry.compressedSize);
		return inflateRawSync(raw);
	}
	throw new Error(`ZIP 压缩方式不支持（method=${entry.method}）: ${entry.name}`);
}

// ── 极简 XML 解析：按块切分 + 局部匹配 ─────────────────────────────────────

/** 从标签串里取属性值（属性名带命名空间前缀，如 r:id / w:val） */
function attrOf(attributes, name) {
	const match = new RegExp(`${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`).exec(attributes);
	return match ? match[1] : null;
}

/**
 * 属性串模式：`name="value"` / `name='value'` / 裸属性。
 * 必须显式写出属性结构，不能用 `[^>]*` 之类兜底：否则 `</w:r>` 这种闭合标签
 * 会被当成"属性里带了个 /"的开标签，自闭合判断失准、块的边界就会算错。
 */
const ATTRS = `(?:\\s+[^\\s"'>/=]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+))?)*`;

/**
 * 一遍扫描 XML，产出扁平的 token 列表：
 * `{ type: "open", name, local, attributes, start }`、
 * `{ type: "close", name, end }`、`{ type: "self", name, local, attributes, start, end }`。
 *
 * 为什么单独做这一层：docx 的标签带命名空间前缀（`<w:p>`），而 `<w:pPr>` / `<w:pStyle>`
 * 都以 `<w:p` 开头——用"按 local name 拼正则再数深度"的写法极易把 `<w:pPr>` 或 `</w:p>`
 * 误判成 `<w:p>`，从而把整篇文档切错。老老实实按文档顺序走一遍就不会有这类问题。
 */
function tokenizeXml(xml) {
	const re = new RegExp(`<(\\/?)([A-Za-z0-9_:.-]+)(?=[\\s/>])${ATTRS}(/?)>`, "g");
	const tokens = [];
	let match;
	while ((match = re.exec(xml)) !== null) {
		const [, slash, name, selfClose] = match;
		const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
		if (slash) {
			tokens.push({ type: "close", name, end: re.lastIndex });
		} else if (selfClose) {
			tokens.push({ type: "self", name, local, attributes: match[0], start: match.index, end: re.lastIndex });
		} else {
			tokens.push({ type: "open", name, local, attributes: match[0], start: match.index, end: re.lastIndex });
		}
	}
	return tokens;
}

/**
 * 用栈把 token 还原成元素树，并按**闭合顺序**回调。
 * 回调拿到的 inner 是该元素内部未解析的原始 XML 片段（表格单元格、段落属性都靠它二次解析）。
 */
function walkElements(xml, onElement) {
	const stack = [];
	const all = [];
	for (const token of tokenizeXml(xml)) {
		if (token.type === "open") {
			const node = {
				name: token.name,
				local: token.local,
				attributes: token.attributes,
				start: token.start,
				childStart: token.end,
				parent: stack.length > 0 ? stack[stack.length - 1] : null,
				children: null,
				inner: "",
			};
			stack.push(node);
			all.push(node);
			continue;
		}
		if (token.type === "self") {
			// 自闭合元素：有父级、没有子级，同样参与嵌套层级
			const node = {
				name: token.name,
				local: token.local,
				attributes: token.attributes,
				start: token.start,
				childStart: token.end,
				parent: stack.length > 0 ? stack[stack.length - 1] : null,
				children: [],
				inner: "",
			};
			all.push(node);
			onElement(node);
			continue;
		}
		// 闭合标签：从栈顶往下找同名元素（容忍畸形 XML）
		let index = -1;
		for (let i = stack.length - 1; i >= 0; i--) {
			if (stack[i].name === token.name) {
				index = i;
				break;
			}
		}
		if (index < 0) continue;
		// 深层元素先回调、父级后回调
		for (let i = stack.length - 1; i >= index; i--) {
			const node = stack[i];
			node.inner = xml.slice(node.childStart, Math.max(node.childStart, token.end - node.name.length - 3));
			onElement(node);
		}
		stack.length = index;
	}
	// 未闭合的残余元素也交出去，避免静默丢内容
	for (let i = stack.length - 1; i >= 0; i--) {
		const node = stack[i];
		node.inner = xml.slice(node.childStart);
		onElement(node);
	}
	return all;
}

/** 按文档顺序把每个节点的直接子级串成数组 */
function finalizeChildren(all) {
	for (const node of all) {
		if (node.children === null) node.children = [];
	}
	// 从后往前 unshift：闭合顺序的逆序正好还原文档顺序
	for (let i = all.length - 1; i >= 0; i--) {
		const node = all[i];
		if (node.parent) node.parent.children.unshift(node);
	}
	return all;
}

/** 解析一个 XML 片段，返回**顶层**元素列表（按文档顺序；后代通过 children 访问） */
function elementList(xml) {
	return finalizeChildren(walkElements(xml, () => {})).filter((node) => !node.parent);
}

/**
 * 解析一个 XML 片段，返回一棵"虚拟根"：它的直接子级就是这个片段里的顶层元素。
 * 为什么要虚拟根：段落片段自己没有外层包裹（`w:p` 的 inner 直接就是 `w:pPr` + `w:r`），
 * 不能想当然把第一个元素当父节点，否则 `w:pPr` 会被当成根、正文文本全丢。
 */
function rootOf(xml) {
	return { name: "#root", local: "#root", attributes: "", children: elementList(xml), inner: xml };
}

/** XML 文本节点反转义 */
function decodeXmlText(text) {
	return String(text)
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** 直接子元素 */
function childrenOf(node) {
	return node?.children ?? [];
}

/** 先序后代（不含自身），按文档顺序 */
function* walkDescendants(node) {
	for (const child of childrenOf(node)) {
		yield child;
		yield* walkDescendants(child);
	}
}

/**
 * 一个段落 → 内联节点数组（文本 / 粗体 / 斜体 / 链接 / 图片）。
 * 沿着元素树按文档顺序递归：容器元素（run / hyperlink / smartTag）进子树，
 * `w:t` 取文本，不认识的标签直接跳过（跳过的量统计进 warnings）。
 */
function inlineNodes(paragraphXml, rels, stats) {
	const nodes = [];
	const root = rootOf(paragraphXml);

	const walk = (element, style, link) => {
		let pending = "";
		const flush = () => {
			if (!pending) return;
			nodes.push({ type: "text", text: pending, style, link });
			pending = "";
		};

		for (const child of childrenOf(element)) {
			const { local, name } = child;

			if (local === "t") {
				pending += decodeXmlText(child.inner);
				continue;
			}
			if (local === "br" || local === "tab") {
				pending += " ";
				continue;
			}
			// 段落/字符属性、页面设置等不产生正文
			if (local === "rPr" || local === "pPr" || local === "sectPr" || local === "tblPr") {
				continue;
			}

			if (local === "drawing" || local === "pict" || local === "object") {
				// 一张 drawing 里可能有多个 a:blip，按出现顺序全部取出
				const embeds = [...child.inner.matchAll(/r:embed\s*=\s*"([^"]+)"/gi)].map((hit) => hit[1]);
				flush();
				for (const embedId of embeds) {
					const rel = rels.get(embedId);
					if (rel?.target) nodes.push({ type: "image", target: rel.target, style, link });
					else stats.unknownImages++;
				}
				// 没有 r:embed 的图形（形状 / 图表 / 公式）算作跳过
				if (embeds.length === 0) stats.skippedBlocks++;
				continue;
			}

			if (local === "hyperlink") {
				flush();
				const id = attrOf(child.attributes, "r:id");
				const anchor = attrOf(child.attributes, "w:anchor");
				const target = rels.get(id)?.target;
				walk(child, style, target || (anchor ? `#${anchor}` : link));
				continue;
			}

			if (name === "w:r") {
				flush();
				const props = childrenOf(child).find((grand) => grand.local === "rPr");
				walk(child, runStyleFrom(props) ?? style, link);
				continue;
			}

			// 其它容器（超链接里的 smartTag、内容控件等）：直接穿透，不丢文本
			walk(child, style, link);
		}
		flush();
	};

	walk(root, { bold: false, italic: false }, null);
	return nodes;
}

/** 判断属性子树里某个开关是否打开（w:val="0"/"false"/"off" 表示关闭） */
function propFlag(root, name) {
	const element = root
		? [...walkDescendants(rootOf(root.inner))].find((child) => child.local === name)
		: null;
	if (!element) return false;
	const value = attrOf(element.attributes, "w:val");
	if (value === null) return true;
	return !/^(0|false|off)$/i.test(value);
}

/** 一个 run 的字符样式 */
function runStyleFrom(runProps) {
	if (!runProps) return null;
	const bold = propFlag(runProps, "b") || propFlag(runProps, "bCs");
	const italic = propFlag(runProps, "i") || propFlag(runProps, "iCs");
	if (!bold && !italic) return null;
	return { bold, italic };
}

// ── 段落 / 表格 / 列表 → markdown ──────────────────────────────────────────

const EMPHASIS_RE = /([*_`[\]\\])/g;

function escapeEmphasis(text) {
	return String(text).replace(EMPHASIS_RE, "\\$1");
}

/** Heading1..6 / Title → markdown 标题级别；普通段落返回 0 */
function headingLevel(styleName) {
	if (!styleName) return 0;
	const name = String(styleName);
	if (/^Title$/i.test(name)) return 1;
	const withNumber = /(?:heading|标题)\s*([1-6])/i.exec(name);
	if (withNumber) return Number(withNumber[1]);
	const trailing = /^Heading([1-6])$/i.exec(name);
	if (trailing) return Number(trailing[1]);
	return 0;
}

/**
 * 段落的直接子级 `w:pPr`（段落属性）。
 * 只认直接子级：段落里嵌入的文本框有它自己的 pPr，不能误当本段样式。
 */
function paragraphProps(paragraph) {
	return childrenOf(paragraph).find((child) => child.local === "pPr") ?? null;
}

/** 段落样式名（w:pPr → w:pStyle@w:val），如 Heading1 / ListBullet */
function paragraphStyle(paragraph) {
	const style = paragraphProps(paragraph);
	if (!style) return null;
	const pStyle = childrenOf(style).find((child) => child.local === "pStyle");
	return pStyle ? attrOf(pStyle.attributes, "w:val") : null;
}

/** 段落是否是列表项；返回分组键（numId 优先，否则按样式名分组），非列表返回 null */
function listGroupKey(paragraph, styleName) {
	const props = paragraphProps(paragraph);
	if (props) {
		const numPr = childrenOf(props).find((child) => child.local === "numPr");
		if (numPr) {
			const numId = childrenOf(numPr).find((child) => child.local === "numId");
			return `num:${numId ? (attrOf(numId.attributes, "w:val") ?? "0") : "0"}`;
		}
	}
	// Word 的「项目符号/列表段落」样式通常直接带 ListBullet / ListNumber / ListParagraph 字样
	if (styleName && /^(?:List\s*(?:Bullet|Number|Paragraph)|列表段落)/i.test(String(styleName))) {
		return `style:${String(styleName).replace(/\s+/g, "")}`;
	}
	return null;
}

function renderInline(nodes) {
	let out = "";
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (node.type === "image") {
			out += `@@IMG${i}@@`;
			continue;
		}
		let text = escapeEmphasis(node.text);
		if (!text) continue;
		if (node.style?.bold && node.style?.italic) text = `***${text}***`;
		else if (node.style?.bold) text = `**${text}**`;
		else if (node.style?.italic) text = `*${text}*`;
		if (node.link) text = `[${text}](${node.link})`;
		out += text;
	}
	return out.trim();
}

/** 单元格文本：去掉换行（markdown 表格里换行会破格） */
function cellText(nodes) {
	return renderInline(nodes).replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

/** 按文档顺序取顶层 `w:p` / `w:tbl`（表格单元格里的段落不重复展开） */
function documentBlocks(xml) {
	// 只取 w:body 的直接子级：表格单元格里的 w:p 不会被误当成顶层段落
	const root = rootOf(xml);
	// w:body 可能被 w:document 包一层，直接在子树里找
	const container = [...walkDescendants(root)].find((element) => element.local === "body") ?? root;
	return childrenOf(container).filter(
		(element) => element.local === "p" || element.local === "tbl",
	);
}

/** 表格 → markdown 表格（首行当表头，列数按最宽行补齐） */
function tableToMarkdown(tableInnerXml) {
	const rows = [];
	for (const row of childrenOf(rootOf(tableInnerXml)).filter((el) => el.local === "tr")) {
		const cells = [];
		for (const cell of childrenOf(row).filter((el) => el.local === "tc")) {
			const lines = [];
			for (const paragraph of documentBlocks(cell.inner)) {
				if (paragraph.local !== "p") continue;
				const text = cellText(
					inlineNodes(paragraph.inner, new Map(), { skippedBlocks: 0, unknownImages: 0 }),
				);
				if (text) lines.push(text);
			}
			cells.push(lines.join(" ").trim());
		}
		rows.push(cells);
	}
	if (rows.length === 0) return null;

	const width = Math.max(...rows.map((row) => row.length));
	if (width === 0) return null;
	const padded = rows.map((row) => {
		const copy = row.slice();
		while (copy.length < width) copy.push("");
		return copy;
	});
	const header = padded[0];
	const separator = header.map(() => "---");
	const lines = [`| ${header.join(" | ")} |`, `| ${separator.join(" | ")} |`];
	for (const row of padded.slice(1)) lines.push(`| ${row.join(" | ")} |`);
	return lines.join("\n");
}

// ── docx 主流程 ────────────────────────────────────────────────────────────

function parseDocumentRels(xml) {
	const rels = new Map();
	const re = /<Relationship\b((?:"[^"]*"|[^>"])*?)\/?>/g;
	let match;
	while ((match = re.exec(xml)) !== null) {
		const id = attrOf(match[1], "Id");
		if (id) rels.set(id, { target: attrOf(match[1], "Target") ?? "" });
	}
	return rels;
}

/** 把 r:embed 指向的 media 目标解析成 ZIP 内的条目名 */
function resolveMediaName(target) {
	const clean = String(target).replace(/^\//, "").replace(/\\/g, "/");
	const normalized = path.posix.normalize(clean);
	if (normalized.startsWith("../") || normalized.includes("/../")) return null;
	return normalized.startsWith("word/") ? normalized : `word/${normalized}`;
}

async function parseDocx({ filename, buffer, repoRoot, imageDir, imageUrlPrefix, slug, warnings }) {
	const entries = readCentralDirectory(buffer);
	const stats = { skippedBlocks: 0, unknownImages: 0 };

	const documentEntry = entries.get("word/document.xml");
	if (!documentEntry) throw new Error("docx 里找不到 word/document.xml（文件可能已损坏）");
	let documentXml;
	try {
		documentXml = readZipEntry(buffer, documentEntry).toString("utf-8");
	} catch (error) {
		// 加密的 docx：Word 支持"用密码保护"，那种 ZIP 条目读不出来
		const fallback = entries.get("EncryptionInfo") ?? entries.get("EncryptedPackage");
		if (fallback) throw new Error("这个 docx 被加密了，请先在 Word 里去掉密码保护再导入");
		throw error;
	}
	// XML 声明 `<?xml …?>` 会被标签扫描器当成一个元素、把整篇文档吞进它的"内容"里，先去掉
	documentXml = documentXml.replace(/^\uFEFF?\s*<\?xml[\s\S]*?\?>/, "");

	const relsEntry = entries.get("word/_rels/document.xml.rels");
	const rels = relsEntry
		? parseDocumentRels(readZipEntry(buffer, relsEntry).toString("utf-8"))
		: new Map();

	const usedImageNames = new Set();
	const images = [];
	let imageCounter = 0;

	/**
	 * 把图片写进 imageDir，返回 markdown 里可用的相对 URL。
	 * 引用写法与主题一致（同目录 images/ 下的相对路径），文件名 `${slug}-imgN.ext`。
	 */
	const storeImage = async (mediaName) => {
		const entry = entries.get(mediaName);
		if (!entry) {
			stats.unknownImages++;
			return null;
		}
		const localName = path.posix.basename(mediaName);
		const ext = imageExtOf(localName) || "png";
		// 已存在（同 slug 导入第二次）就往后加序号，绝不覆盖已有文件
		let fileName = "";
		for (;;) {
			imageCounter++;
			const candidate = `${slug}-img${imageCounter}.${ext}`;
			if (usedImageNames.has(candidate)) continue;
			if (await existsFile(path.join(imageDir, candidate))) continue;
			fileName = candidate;
			break;
		}
		usedImageNames.add(fileName);
		const data = readZipEntry(buffer, entry);
		await fs.writeFile(path.join(imageDir, fileName), data);
		images.push({
			name: fileName,
			repoPath: path.posix.join(relativeImageDir(repoRoot, imageDir), fileName),
			url: `${imageUrlPrefix}${fileName}`,
		});
		return `${imageUrlPrefix}${fileName}`;
	};

	const blocks = [];
	const plainTexts = [];
	let suggestedTitle = "";

	// 文档顺序遍历：w:p 与 w:tbl 同级，但 w:p 内部嵌套的 w:p（文本框）不能被重复展开，
	// 所以这里跳过整块的 end，而不是无条件收集所有 <w:p>
	const pendingBlocks = documentBlocks(documentXml);
	for (const item of pendingBlocks) {
		if (item.local === "tbl") {
			const tableMd = tableToMarkdown(item.inner);
			if (tableMd) blocks.push(tableMd);
			else stats.skippedBlocks++;
			continue;
		}

		const nodes = inlineNodes(item.inner, rels, stats);
		// 图片单独处理：需要异步落盘，先把占位符留住
		const resolved = [];
		for (const inlineNode of nodes) {
			if (inlineNode.type === "image") {
				const mediaName = resolveMediaName(inlineNode.target);
				const url = mediaName ? await storeImage(mediaName) : null;
				if (!url) {
					stats.skippedBlocks++;
					continue;
				}
				resolved.push({ type: "image", url });
				continue;
			}
			resolved.push(inlineNode);
		}

		const hasImage = resolved.some((n) => n.type === "image");
		const text = renderInline(resolved);
		if (!text && !hasImage) continue;

		// 图片占位符 → 真实 markdown 图片语法（与主题里文章引用同目录图片的写法一致）
		let imageIndex = 0;
		const imageUrls = resolved.filter((n) => n.type === "image").map((n) => n.url);
		const withImages = text
			.replace(/@@IMG\d+@@/g, () => {
				const url = imageUrls[imageIndex++];
				if (!url) return "";
				const alt = path.posix.basename(url).replace(/\.[^.]+$/, "");
				return `![${alt}](${url})`;
			})
			.replace(/\s{2,}/g, " ")
			.trim();
		if (!withImages) continue;

		const pStyle = paragraphStyle(item);
		const level = headingLevel(pStyle);
		const listId = listGroupKey(item, pStyle);

		if (level > 0) {
			blocks.push(`${"#".repeat(level)} ${withImages}`);
			if (!suggestedTitle && level === 1) {
				suggestedTitle = withImages.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`]/g, "").trim();
			}
		} else if (listId) {
			blocks.push({ kind: "listItem", listId, text: withImages });
		} else {
			blocks.push(withImages);
		}
		if (!/^!\[/.test(withImages)) {
			plainTexts.push(withImages.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`[\]]/g, "").trim());
		}
	}

	if (blocks.length === 0) return null;

	// 把 "listItem" 分组渲染：同一 numId 且相邻的连续段落合成一个列表
	const rendered = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (typeof block === "string") {
			rendered.push(block);
			continue;
		}
		const group = [block.text];
		while (i + 1 < blocks.length && typeof blocks[i + 1] !== "string" && blocks[i + 1].listId === block.listId) {
			group.push(blocks[i + 1].text);
			i++;
		}
		// numId 相同的连续段落视为同一组；非连续会各自成组，符合 Word 的直觉
		rendered.push(group.map((text) => `- ${text}`).join("\n"));
	}

	if (stats.unknownImages > 0) {
		warnings.push(`${stats.unknownImages} 张图片在 docx 资源里找不到对应文件，已跳过`);
	}
	if (stats.skippedBlocks > 0) {
		warnings.push(`跳过了 ${stats.skippedBlocks} 处不支持的内容（文本框 / 嵌入对象 / 公式等）`);
	}

	const markdown = rendered.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
	const firstPlain = plainTexts.find((text) => text.trim()) ?? "";
	return {
		markdown,
		title: suggestedTitle || titleFromFilename(filename),
		description: truncate(firstPlain, 100),
		images,
	};
}

async function existsFile(target) {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

/** imageDir 相对仓库根的 posix 路径（用于返回 repoPath） */
function relativeImageDir(repoRoot, imageDir) {
	return path.relative(repoRoot, imageDir).split(path.sep).join("/");
}

// ── 对外入口 ───────────────────────────────────────────────────────────────

/**
 * 把上传的文件转换成 markdown。
 * @param {{ filename?: string, buffer?: Buffer, repoRoot?: string, imageDir?: string, slug?: string, imageUrlPrefix?: string }} options
 * @returns {Promise<{ok:true, kind:"docx"|"txt"|"md", markdown:string, suggested:{title:string,description:string}, images:Array<{name:string,repoPath:string,url:string}>, warnings:string[]} | {ok:false, error:string}>}
 */
export async function convertToMarkdown(options = {}) {
	const { filename, buffer, repoRoot, imageDir, slug, imageUrlPrefix } = options;
	const warnings = [];

	try {
		if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
			return { ok: false, error: "文件是空的，没有可导入的内容" };
		}
		if (buffer.length > MAX_IMPORT_BYTES) {
			return {
				ok: false,
				error: `文件太大（${(buffer.length / 1024 / 1024).toFixed(1)} MB），最大支持 25 MB`,
			};
		}

		const ext = extensionOf(filename);
		if (ext === ".docx") {
			if (!repoRoot || !imageDir) {
				return { ok: false, error: "服务端缺少图片目录配置，无法解析 docx" };
			}
			const resolvedRoot = path.resolve(repoRoot);
			const resolvedImageDir = path.resolve(imageDir);

			// 图片目录必须落在仓库内：这里做的是解析**之后**的路径比较，能挡住 ../ 越界
			const insideRepo =
				resolvedImageDir === resolvedRoot ||
				resolvedImageDir.startsWith(resolvedRoot + path.sep);
			const insideAllowed =
				resolvedImageDir === path.resolve(resolvedRoot, "src/content/posts/images") ||
				resolvedImageDir.startsWith(
					path.resolve(resolvedRoot, "src/content/posts/images") + path.sep,
				);
			if (!insideRepo || !insideAllowed) {
				return { ok: false, error: "图片目录不在允许的位置（src/content/posts/images）" };
			}

			const imageSlug = safeSlug(slug || baseNameWithoutExt(filename), "import");
			const prefix = typeof imageUrlPrefix === "string" && imageUrlPrefix ? imageUrlPrefix : "./images/";
			const parsed = await parseDocx({
				filename,
				buffer,
				repoRoot: resolvedRoot,
				imageDir: resolvedImageDir,
				imageUrlPrefix: prefix,
				slug: imageSlug,
				warnings,
			});
			if (!parsed || !parsed.markdown.trim()) {
				return { ok: false, error: "文件里没有可导入的文本" };
			}
			return {
				ok: true,
				kind: "docx",
				markdown: parsed.markdown,
				suggested: { title: parsed.title, description: parsed.description },
				images: parsed.images.map((image) => ({
					...image,
					repoPath: image.repoPath || "",
				})),
				warnings,
			};
		}

		if (ext in TEXT_KINDS) {
			const decoded = decodeText(buffer);
			warnings.push(...decoded.warnings);
			const kind = TEXT_KINDS[ext];
			const parsed = kind === "md" ? parseMarkdown(filename, decoded.text) : parseTxt(filename, decoded.text);
			if (!parsed || !parsed.markdown.trim()) {
				return { ok: false, error: "文件里没有可导入的文本" };
			}
			return {
				ok: true,
				kind,
				markdown: parsed.markdown,
				suggested: { title: parsed.title, description: parsed.description },
				images: [],
				warnings,
			};
		}

		if (ext === ".doc") {
			return {
				ok: false,
				error: "旧版 .doc 是二进制格式无法解析，请在 Word 里另存为 .docx，或直接复制正文粘贴到编辑器",
			};
		}

		return {
			ok: false,
			error: ext
				? `暂不支持 ${ext}，请用 .docx / .txt / .md`
				: "文件没有扩展名，无法判断格式；请用 .docx / .txt / .md",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/ZIP|中央目录|inflate|incorrect header|invalid/i.test(message)) {
			return { ok: false, error: `文件不是有效的 docx（ZIP 结构损坏）：${message}` };
		}
		return { ok: false, error: `解析失败：${message}` };
	}
}

export { MAX_IMPORT_BYTES };
