/**
 * 导航菜单的可视化编辑（隐藏 / 改名 / 排序）
 *
 * 设计：**不改写 TS 源码**，而是把改动写进 `src/config/nav-overrides.json`，
 * 由主题侧 `src/config/navBarConfig.ts` 的 applyNavOverrides() 在构建时应用。
 * 空覆盖（三个字段都空）就等于"什么都没发生"，所以面板出错也不会影响站点。
 *
 * 菜单项列表是从 `navBarConfig.ts` 里**只读解析**出来的（每项都有显式 id + name），
 * 解析失败时不猜测、直接报错让作者人工处理。
 *
 * 注意：本模块只做这三件事，**不支持新增菜单项** —— 新增需要改 TS 源码里的数组，
 * 面板不做这种有风险的改写。
 */

import fs from "node:fs/promises";
import path from "node:path";

const NAV_FILE = "src/config/navBarConfig.ts";
const OVERRIDES_FILE = "src/config/nav-overrides.json";
const MAX_LABEL = 60;

/** 从 navBarConfig.ts 里把 `id: "..."` / `name: "..."` 成对读出来（只读、不改文件） */
async function extractNavItems(repoAbs) {
	const text = await fs.readFile(path.join(repoAbs, NAV_FILE), "utf8");
	const lines = text.split(/\r?\n/);
	const items = [];
	for (let i = 0; i < lines.length; i++) {
		const idMatch = /^\s*id:\s*"([^"]+)"/.exec(lines[i]);
		if (!idMatch) continue;
		let name = "";
		let pageKey;
		// id 之后几行内必定有 name；再顺带看看有没有 pageKey（用于面板展示）
		for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
			const nameMatch = /^\s*name:\s*"([^"]*)"/.exec(lines[j]);
			if (nameMatch && !name) name = nameMatch[1];
			const keyMatch = /^\s*pageKey:\s*"([^"]+)"/.exec(lines[j]);
			if (keyMatch) pageKey = keyMatch[1];
		}
		if (!name) continue;
		items.push({ id: idMatch[1], label: name, ...(pageKey ? { pageKey } : {}) });
	}
	if (items.length === 0) {
		throw new Error(`没能从 ${NAV_FILE} 里解析出菜单项，请人工检查该文件是否被改动过`);
	}
	return items;
}

/** 读当前覆盖（文件不存在或字段缺失 → 视为空覆盖） */
async function readOverrides(repoAbs) {
	try {
		const raw = JSON.parse(await fs.readFile(path.join(repoAbs, OVERRIDES_FILE), "utf8"));
		const hidden = Array.isArray(raw?.hidden) ? raw.hidden.filter((x) => typeof x === "string") : [];
		const order = Array.isArray(raw?.order) ? raw.order.filter((x) => typeof x === "string") : [];
		const renamed = raw?.renamed && typeof raw.renamed === "object" && !Array.isArray(raw.renamed) ? raw.renamed : {};
		return { hidden, order, renamed };
	} catch {
		return { hidden: [], order: [], renamed: {} };
	}
}

/** 组装面板要的列表：原始顺序 + 当前覆盖状态 */
async function listNav(repoAbs) {
	const items = await extractNavItems(repoAbs);
	const overrides = await readOverrides(repoAbs);
	const hidden = new Set(overrides.hidden);
	const orderIndex = new Map(overrides.order.map((id, index) => [id, index]));
	const withState = items.map((item, index) => ({
		id: item.id,
		label: overrides.renamed[item.id] ?? item.label,
		...(item.pageKey ? { pageKey: item.pageKey } : {}),
		hidden: hidden.has(item.id),
		order: orderIndex.has(item.id) ? orderIndex.get(item.id) : orderIndex.size + index,
	}));
	// 与主题侧一致：order 里出现的 id 靠前，其余保持原顺序
	withState.sort((a, b) => a.order - b.order);
	return withState.map(({ id, label, pageKey, hidden: h }) => ({ id, label, ...(pageKey ? { pageKey } : {}), hidden: h }));
}

/**
 * 保存面板提交的列表：与"原始配置"对比，只写出**最小**覆盖。
 * @returns { status, payload }
 */
async function saveNav({ repoRoot, body, snapshotBefore }) {
	const submitted = body?.items;
	if (!Array.isArray(submitted) || submitted.length === 0) {
		return { status: 400, payload: { error: "缺少 items（菜单项列表）" } };
	}

	const originals = await extractNavItems(repoRoot);
	const originalIds = originals.map((i) => i.id);
	const submittedIds = submitted.map((i) => String(i?.id ?? ""));

	// 只允许对已有菜单项做隐藏/改名/排序：id 集合必须与配置完全一致（面板不能增删）
	if (submittedIds.length !== originalIds.length || new Set(submittedIds).size !== submittedIds.length) {
		return { status: 400, payload: { error: "菜单项数量与配置不一致，请先点「重新载入」再改" } };
	}
	const unknown = submittedIds.filter((id) => !originalIds.includes(id));
	if (unknown.length > 0) {
		return { status: 400, payload: { error: `未知菜单项 id：${unknown.join(", ")}（面板不支持新增菜单项，请改 navBarConfig.ts）` } };
	}

	const hidden = [];
	const renamed = {};
	for (const item of submitted) {
		const id = String(item.id);
		if (item.hidden === true) hidden.push(id);
		const label = String(item.label ?? "").trim();
		const original = originals.find((o) => o.id === id);
		if (label && label.length <= MAX_LABEL && label !== original?.label) renamed[id] = label;
	}
	// 顺序：与原始顺序不同才写进 order，避免无意义地"钉死"顺序
	const orderChanged = submittedIds.some((id, index) => id !== originalIds[index]);
	const order = orderChanged ? submittedIds : [];

	const next = {
		hidden: hidden.sort(),
		order,
		renamed: Object.fromEntries(Object.entries(renamed).sort(([a], [b]) => a.localeCompare(b))),
	};

	if (snapshotBefore) await snapshotBefore(OVERRIDES_FILE, "修改导航菜单");
	await fs.mkdir(path.dirname(path.join(repoRoot, OVERRIDES_FILE)), { recursive: true });
	await fs.writeFile(path.join(repoRoot, OVERRIDES_FILE), `${JSON.stringify(next, null, "\t")}\n`, "utf8");

	const summary = [
		hidden.length > 0 ? `隐藏 ${hidden.length} 项` : "",
		Object.keys(renamed).length > 0 ? `改名 ${Object.keys(renamed).length} 项` : "",
		order.length > 0 ? "自定义顺序" : "",
	].filter(Boolean);
	return {
		status: 200,
		payload: {
			ok: true,
			items: await listNav(repoRoot),
			overrides: next,
			message: summary.length > 0 ? `导航已更新（${summary.join("、")}）` : "导航已恢复为配置默认（没有任何覆盖）",
		},
	};
}

/** 路由入口：GET 取列表，POST 保存 */
export async function handleNav({ repoRoot, method = "GET", body, snapshotBefore }) {
	try {
		if (method === "GET") {
			return { status: 200, payload: { items: await listNav(repoRoot) } };
		}
		if (method === "POST") {
			return await saveNav({ repoRoot, body, snapshotBefore });
		}
		return { status: 405, payload: { error: "请用 GET 或 POST 调用 /api/nav" } };
	} catch (error) {
		return { status: 500, payload: { error: error?.message ?? String(error) } };
	}
}
