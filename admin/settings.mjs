/**
 * 面板可编辑的站点设置（白名单 + 安全写入）
 *
 * 为什么不用"直接改 TS 源码"：TS 文件改坏会直接导致构建失败。
 * 这里的做法是：
 *   1. 只允许修改 SETTINGS_DEFS 白名单里的字段，类型/范围/枚举都校验
 *   2. 每次写入前先把原文件快照到 admin-backups/（可一键恢复）
 *   3. 写完后**回读校验**：把刚写的值再解析一遍，和目标不一致就立刻回滚并报错
 *
 * 这样即使正则匹配到了意料之外的位置，也不会留下坏文件。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 字段定义：
 *   id      面板用的键（如 "site.title"）
 *   file    相对仓库根目录的文件
 *   key     文件里的字段名
 *   type    string | number | boolean | enum
 *   within  可选：字段所在的嵌套块名（如 themeColor / pages）
 *   label   面板显示名
 */
export const SETTINGS_DEFS = [
	{ id: "site.title", file: "src/config/siteConfig.ts", key: "title", type: "string", label: "站点标题" },
	{ id: "site.subtitle", file: "src/config/siteConfig.ts", key: "subtitle", type: "string", label: "站点副标题" },
	{ id: "site.description", file: "src/config/siteConfig.ts", key: "description", type: "string", label: "站点描述（SEO / OG）" },
	{ id: "site.keywords", file: "src/config/siteConfig.ts", key: "keywords", type: "stringlist", label: "关键词（逗号分隔，会写成数组）" },
	{ id: "site.site_url", file: "src/config/siteConfig.ts", key: "site_url", type: "string", label: "站点 URL（主域）" },
	{ id: "site.startDate", file: "src/config/siteConfig.ts", key: "siteStartDate", type: "string", label: "建站日期（时间进度用）" },
	{ id: "site.pageWidth", file: "src/config/siteConfig.ts", key: "pageWidth", type: "number", min: 50, max: 200, label: "页面宽度（rem，50-200）" },
	{ id: "navbar.title", file: "src/config/siteConfig.ts", key: "title", within: "navbar", type: "string", label: "导航栏标题" },
	{ id: "theme.hue", file: "src/config/siteConfig.ts", key: "hue", within: "themeColor", type: "number", min: 0, max: 360, label: "主题色相（0-360）" },
	{ id: "theme.defaultMode", file: "src/config/siteConfig.ts", key: "defaultMode", within: "themeColor", type: "enum", values: ["light", "dark", "system"], label: "默认明暗模式" },
	{ id: "card.border", file: "src/config/siteConfig.ts", key: "border", within: "card", type: "boolean", label: "卡片边框与阴影" },
	{ id: "card.followTheme", file: "src/config/siteConfig.ts", key: "followTheme", within: "card", type: "boolean", label: "卡片风格跟随主题色" },
	{ id: "profile.name", file: "src/config/profileConfig.ts", key: "name", type: "string", label: "博主名字" },
	{ id: "profile.bio", file: "src/config/profileConfig.ts", key: "bio", type: "string", label: "个人签名" },
	{ id: "profile.avatar", file: "src/config/profileConfig.ts", key: "avatar", type: "string", label: "头像路径" },
	{ id: "wallpaper.mode", file: "src/config/backgroundWallpaper.ts", key: "mode", type: "enum", values: ["banner", "fullscreen", "overlay", "none"], label: "壁纸模式" },
	{ id: "wallpaper.dimOpacity", file: "src/config/backgroundWallpaper.ts", key: "dimOpacity", within: "common", type: "number", min: 0, max: 1, label: "壁纸遮罩暗度（0-1）" },
	{ id: "wallpaper.title", file: "src/config/backgroundWallpaper.ts", key: "title", within: "homeText", type: "string", label: "主页横幅主标题" },
	{ id: "display.enable", file: "src/config/displaySettingsConfig.ts", key: "enable", type: "boolean", label: "显示设置面板（🎨 按钮）" },
	{ id: "display.wallpaperModeSwitchable", file: "src/config/displaySettingsConfig.ts", key: "wallpaperModeSwitchable", type: "boolean", label: "允许访客切换壁纸模式" },
	{ id: "display.themeColorSwitchable", file: "src/config/displaySettingsConfig.ts", key: "themeColorSwitchable", type: "boolean", label: "允许访客切换主题色" },
	{ id: "display.sakuraSwitchable", file: "src/config/displaySettingsConfig.ts", key: "sakuraSwitchable", type: "boolean", label: "允许访客切换樱花特效" },
];

/** 页面开关（siteConfig 顶部 resolvePageToggles({...})），键从文件里动态读出，保持与主题同步 */
export const PAGE_PREFIX = "pages.";
const PAGE_BLOCK = "resolvePageToggles";

const STRING_RE = /^"(?:[^"\\]|\\.)*"$/;
const LITERAL_ALT = `("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|\\[[^\\]]*\\])`;

function escapeForTs(value) {
	return JSON.stringify(String(value));
}

function literalFor(def, value) {
	switch (def.type) {
		case "string":
			if (typeof value !== "string") throw new Error(`${def.label} 必须是字符串`);
			if (value.length > 2000) throw new Error(`${def.label} 太长（上限 2000 字符）`);
			return escapeForTs(value);
		case "stringlist": {
			const list = Array.isArray(value)
				? value.map((v) => String(v).trim()).filter(Boolean)
				: String(value ?? "")
						.split(/[,，]/)
						.map((v) => v.trim())
						.filter(Boolean);
			if (list.length === 0) throw new Error(`${def.label} 不能为空`);
			if (list.length > 30) throw new Error(`${def.label} 最多 30 项`);
			for (const item of list) {
				if (item.length > 60) throw new Error(`${def.label} 里单项过长：${item.slice(0, 20)}…`);
			}
			return JSON.stringify(list);
		}
		case "number": {
			const num = Number(value);
			if (!Number.isFinite(num)) throw new Error(`${def.label} 必须是数字`);
			if (def.min !== undefined && num < def.min) throw new Error(`${def.label} 不能小于 ${def.min}`);
			if (def.max !== undefined && num > def.max) throw new Error(`${def.label} 不能大于 ${def.max}`);
			return String(num);
		}
		case "boolean":
			if (typeof value === "boolean") return String(value);
			if (value === "true" || value === "false") return value;
			throw new Error(`${def.label} 必须是 true / false`);
		case "enum": {
			if (!def.values.includes(value)) {
				throw new Error(`${def.label} 只能是：${def.values.join(" / ")}`);
			}
			return escapeForTs(value);
		}
		default:
			throw new Error(`未知字段类型：${def.type}`);
	}
}

/** 找到 `blockName: {` 或 `blockName({` 对应的整个块，返回 [start, end]（含首尾花括号） */
function findBlock(text, blockName) {
	const startRe = new RegExp(`\\b${blockName}\\s*(?::\\s*|\\()\\s*\\{`, "m");
	const match = startRe.exec(text);
	if (!match) return null;
	let depth = 0;
	let i = match.index + match[0].length - 1; // 指向 "{"
	for (; i < text.length; i++) {
		const ch = text[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return [match.index, i + 1];
		}
	}
	return null;
}

/** 从一段文本里取出某个字段的原始字面量（字符串带引号） */
function extractLiteral(text, def) {
	const pattern = new RegExp(`(?:^|[\\s{,])${def.key}\\s*:\\s*${LITERAL_ALT}`);
	const match = pattern.exec(text);
	if (!match) return null;
	return match[1];
}

/** 替换一段文本里某个字段的字面量 */
function replaceLiteral(text, def, literal) {
	const pattern = new RegExp(`((?:^|[\\s{,])${def.key}\\s*:\\s*)${LITERAL_ALT}`);
	const match = pattern.exec(text);
	if (!match) return null;
	return text.slice(0, match.index) + match[1] + literal + text.slice(match.index + match[0].length);
}

function unquote(literal) {
	if (literal === null || literal === undefined) return undefined;
	if (literal === "true") return true;
	if (literal === "false") return false;
	if (literal.startsWith("[")) {
		try {
			return JSON.parse(literal);
		} catch {
			return undefined;
		}
	}
	if (STRING_RE.test(literal)) {
		try {
			return JSON.parse(literal);
		} catch {
			return literal.slice(1, -1);
		}
	}
	const num = Number(literal);
	return Number.isFinite(num) ? num : literal;
}

/** 读取当前设置值（面板表单用），返回 { id: value } */
export function readSettings(repoRoot) {
	const values = {};
	const cache = new Map();
	const textOf = (rel) => {
		if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8"));
		return cache.get(rel);
	};
	for (const def of SETTINGS_DEFS) {
		let text;
		try {
			text = textOf(def.file);
		} catch {
			continue;
		}
		let scope = text;
		if (def.within) {
			const block = findBlock(text, def.within);
			if (!block) continue;
			scope = text.slice(block[0], block[1]);
		}
		const literal = extractLiteral(scope, def);
		if (literal !== null) values[def.id] = unquote(literal);
	}

	// 页面开关：从 siteConfig 顶部的 resolvePageToggles({...}) 里逐个读出
	try {
		const text = textOf("src/config/siteConfig.ts");
		const block = findBlock(text, PAGE_BLOCK);
		if (block) {
			const scope = text.slice(block[0], block[1]);
			for (const m of scope.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)/g)) {
				values[`${PAGE_PREFIX}${m[1]}`] = m[2] === "true";
			}
		}
	} catch {
		// 读不到就跳过
	}

	return values;
}

/**
 * 写入设置。
 * @param repoRoot 仓库根目录
 * @param patch    { "site.title": "新标题", ... }
 * @param snapshot 可选：(relPath) => Promise<void>，在改写文件前做快照
 * @returns { changed: string[], values: object }
 */
export async function applySettings(repoRoot, patch, snapshot) {
	if (!patch || typeof patch !== "object") throw new Error("设置数据格式不对");

	const byFile = new Map();
	for (const [id, rawValue] of Object.entries(patch)) {
		let def;
		let key;

		if (id.startsWith(PAGE_PREFIX)) {
			key = id.slice(PAGE_PREFIX.length);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`页面开关名字不合法：${key}`);
			def = {
				id,
				file: "src/config/siteConfig.ts",
				key,
				within: PAGE_BLOCK,
				type: "boolean",
				label: `页面开关 ${key}`,
			};
		} else {
			def = SETTINGS_DEFS.find((d) => d.id === id);
			if (!def) throw new Error(`不允许修改的设置项：${id}`);
		}

		const literal = literalFor(def, rawValue);
		if (!byFile.has(def.file)) byFile.set(def.file, []);
		byFile.get(def.file).push({ def, literal });
	}

	const changed = [];
	for (const [rel, edits] of byFile) {
		const full = path.join(repoRoot, rel);
		const original = await fs.promises.readFile(full, "utf8");
		let next = original;

		for (const { def, literal } of edits) {
			let result;
			if (def.within) {
				const block = findBlock(next, def.within);
				if (!block) throw new Error(`${rel} 里找不到 ${def.within} 配置块`);
				const scope = next.slice(block[0], block[1]);
				const replaced = replaceLiteral(scope, def, literal);
				if (replaced === null) throw new Error(`${rel} 的 ${def.within}.${def.key} 没找到，已放弃修改`);
				result = next.slice(0, block[0]) + replaced + next.slice(block[1]);
			} else {
				result = replaceLiteral(next, def, literal);
				if (result === null) throw new Error(`${rel} 的 ${def.key} 没找到，已放弃修改`);
			}
			next = result;
		}

		if (next === original) continue;

		// 轻量语法体检：花括号/方括号数量必须与原文一致（正则改坏结构时能挡住）
		const count = (str, ch) => (str.match(new RegExp(`\\${ch}`, "g")) ?? []).length;
		for (const ch of ["{", "}", "[", "]"]) {
			if (count(next, ch) !== count(original, ch)) {
				throw new Error(`${rel} 改写后 ${ch} 数量不一致，已放弃修改（可能是正则匹配到了意外位置）`);
			}
		}

		if (snapshot) await snapshot(rel);
		await fs.promises.writeFile(full, next, "utf8");

		// 回读校验：逐个确认写入的值能被重新解析出来且一致
		const after = await fs.promises.readFile(full, "utf8");
		for (const { def, literal } of edits) {
			let scope = after;
			if (def.within) {
				const block = findBlock(after, def.within);
				scope = block ? after.slice(block[0], block[1]) : "";
			}
			const got = extractLiteral(scope, def);
			if (got !== literal) {
				await fs.promises.writeFile(full, original, "utf8");
				throw new Error(`${rel} 写入校验失败（${def.key}: 期望 ${literal}，实际 ${got}），已回滚`);
			}
			changed.push(def.id);
		}
	}

	return { changed, values: readSettings(repoRoot) };
}
