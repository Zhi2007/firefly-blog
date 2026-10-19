/**
 * 轻量快照备份：任何写操作之前，先把原文件另存一份。
 *
 * 特点：
 * - 存在仓库里的 `admin-backups/`（已写进 .gitignore，不会被提交、不会发布）
 * - 每次写操作生成一个带时间戳的快照目录，里面保留相对路径结构 + meta.json
 * - 默认保留最新 40 份，超出自动删最旧的；保留份数可在面板「体检 / 备份」页改（任意正整数）
 * - 路径必须先经过调用方的 safeResolve 检查，避免越界写
 */

import fs from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = "admin-backups";
/** 保留份数设置文件（放在备份目录里，随 admin-backups/ 一起被 gitignore） */
const KEEP_FILE = "keep.json";
/** 默认保留最新 40 份 */
export const DEFAULT_KEEP = 40;

// 单文件与单次快照的默认上限。
// 为什么要限制：媒体目录里可能躺着几百 MB 的音乐/原图，全量复制会把磁盘吃光、也拖慢保存。
// 25MB 足够覆盖单曲 mp3（一般 5MB 上下）与常见配图；超限的文件跳过并在返回值里报出来。
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 60 * 1024 * 1024;

/** 把字节数说成人话（提示信息里用） */
function humanSize(bytes) {
	if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
	return `${bytes}B`;
}

function stamp() {
	const now = new Date();
	const pad = (n, w = 2) => String(n).padStart(w, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function readMeta(dir) {
	try {
		return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
	} catch {
		return null;
	}
}

/** 校验「保留份数」：任意正整数（字符串只接受纯十进制数字） */
export function parseKeepValue(value) {
	const n =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(n) || n < 1) {
		throw new Error(`保留份数必须是正整数（例如 1、10、40），收到：${JSON.stringify(value)}`);
	}
	return n;
}

/** 读取「保留最新 N 份」设置；文件不存在 / 内容不合法时回退默认 40 */
export async function readKeep(repoRoot) {
	try {
		const raw = JSON.parse(await fs.readFile(path.join(repoRoot, BACKUP_DIR, KEEP_FILE), "utf8"));
		return parseKeepValue(raw?.keep);
	} catch {
		return DEFAULT_KEEP;
	}
}

/**
 * 保存「保留最新 N 份」设置，并立即按新值清理更旧的快照。
 * @returns { keep, removed } removed = 本次实际删掉的快照数
 */
export async function writeKeep(repoRoot, value) {
	const keep = parseKeepValue(value);
	const base = path.join(repoRoot, BACKUP_DIR);
	await fs.mkdir(base, { recursive: true });
	await fs.writeFile(path.join(base, KEEP_FILE), `${JSON.stringify({ keep }, null, "\t")}\n`, "utf8");
	// 回读校验：写进去的不是用户要的值就报错，避免磁盘 / 权限问题被静默吞掉
	const readBack = await readKeep(repoRoot);
	if (readBack !== keep) throw new Error(`保留份数写入失败（写入 ${keep}，读回 ${readBack}）`);
	const removed = await prune(repoRoot, keep);
	return { keep, removed };
}

/**
 * 超出保留份数时删除最旧的快照。
 * @returns 实际删掉的快照数
 */
async function prune(root, keep = DEFAULT_KEEP) {
	const base = path.join(root, BACKUP_DIR);
	let entries;
	try {
		entries = await fs.readdir(base);
	} catch {
		return 0;
	}
	const dirs = [];
	for (const name of entries) {
		const full = path.join(base, name);
		try {
			if ((await fs.stat(full)).isDirectory()) dirs.push(name);
		} catch {
			// 忽略
		}
	}
	dirs.sort();
	let removed = 0;
	for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
		try {
			await fs.rm(path.join(base, name), { recursive: true, force: true });
			removed += 1;
		} catch {
			// 删不掉就保留，下次再试
		}
	}
	return removed;
}

/**
 * 为若干文件创建一份快照。
 * @param repoRoot 仓库根目录
 * @param rels     相对仓库根目录的文件列表
 * @param options  { reason, maxFileBytes, maxTotalBytes }
 *                 reason        说明这次快照是干什么的
 *                 maxFileBytes  单文件上限（默认 25MB），超限跳过
 *                 maxTotalBytes 单次快照总量上限（默认 60MB），超限的后面的文件跳过
 * @returns { id, files, skipped } 或 null（没有文件需要备份时）
 *          skipped 形如 [{ rel, size, reason }]，方便前端明确告诉用户"这几个文件没备份上"
 */
export async function createSnapshot(repoRoot, rels, options = {}) {
	const list = [...new Set(rels)].filter(Boolean);
	if (list.length === 0) return null;

	const maxFile = Number(options.maxFileBytes) > 0 ? Number(options.maxFileBytes) : DEFAULT_MAX_FILE_BYTES;
	const maxTotal =
		Number(options.maxTotalBytes) > 0 ? Number(options.maxTotalBytes) : DEFAULT_MAX_TOTAL_BYTES;

	const base = path.join(repoRoot, BACKUP_DIR);
	const id = `${stamp()}-${Math.random().toString(16).slice(2, 6)}`;
	const dir = path.join(base, id);
	const copied = [];
	const skipped = [];
	let total = 0;

	for (const rel of list) {
		const source = path.join(repoRoot, rel);
		let stat;
		try {
			stat = await fs.stat(source);
		} catch {
			continue; // 新文件没有旧内容可备份
		}
		if (!stat.isFile()) continue;

		// 超限只跳过，不报错：媒体文件动辄几十 MB，报错会让用户没法保存，跳过并如实汇报更合适
		if (stat.size > maxFile) {
			skipped.push({
				rel,
				size: stat.size,
				reason: `超过单文件上限 ${humanSize(maxFile)}`,
			});
			continue;
		}
		if (total + stat.size > maxTotal) {
			skipped.push({
				rel,
				size: stat.size,
				reason: `超过单次快照总量上限 ${humanSize(maxTotal)}`,
			});
			continue;
		}

		const target = path.join(dir, rel);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.copyFile(source, target);
		total += stat.size;
		copied.push({ rel, size: stat.size });
	}

	if (copied.length === 0) {
		// 一个文件都没备份成（全新文件或全部超限）：不产生空快照，但把跳过原因带回去
		return skipped.length > 0 ? { id: null, files: [], skipped } : null;
	}

	await fs.writeFile(
		path.join(dir, "meta.json"),
		`${JSON.stringify(
			{ id, time: new Date().toISOString(), reason: options.reason ?? "", files: copied, skipped },
			null,
			"\t",
		)}\n`,
		"utf8",
	);
	await prune(repoRoot, await readKeep(repoRoot));
	return { id, files: copied, skipped };
}

/** 列出所有快照（新的在前） */
export async function listSnapshots(repoRoot) {
	const base = path.join(repoRoot, BACKUP_DIR);
	let entries;
	try {
		entries = await fs.readdir(base);
	} catch {
		return [];
	}
	const out = [];
	for (const name of entries) {
		const dir = path.join(base, name);
		try {
			if (!(await fs.stat(dir)).isDirectory()) continue;
		} catch {
			continue;
		}
		const meta = await readMeta(dir);
		out.push({
			id: name,
			// 面板要显示「这份快照在仓库里的哪里」：目录是我们刚刚 stat 过的，真实存在
			dir: `${BACKUP_DIR}/${name}`,
			time: meta?.time ?? null,
			reason: meta?.reason ?? "",
			files: (meta?.files ?? []).map((f) => ({ rel: f.rel, size: f.size })),
			// 超限没备份成的文件数（媒体文件常见），前端可据此提示"这份快照并不完整"
			skipped: (meta?.skipped ?? []).length,
		});
	}
	out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
	return out;
}

/**
 * 从快照恢复某个文件（恢复当前状态前会再打一份快照，避免"恢复错了"没法回头）。
 * @returns { ok, rel, message }
 */
export async function restoreSnapshot(repoRoot, id, rel) {
	if (!id || !/^[A-Za-z0-9-]+$/.test(id)) throw new Error("快照 id 不合法");
	if (!rel) throw new Error("缺少要恢复的文件路径");

	// 双重校验：目标必须落在仓库内，源文件必须落在该快照目录内（防止 ../ 越界读或越界写）
	const repoAbs = path.resolve(repoRoot);
	const target = path.resolve(repoAbs, rel);
	if (target !== repoAbs && !target.startsWith(repoAbs + path.sep)) {
		throw new Error(`恢复路径越界: ${rel}`);
	}
	const snapshotDir = path.resolve(repoAbs, BACKUP_DIR, id);
	const source = path.resolve(snapshotDir, rel);
	if (source !== snapshotDir && !source.startsWith(snapshotDir + path.sep)) {
		throw new Error(`快照内路径越界: ${rel}`);
	}

	try {
		if (!(await fs.stat(source)).isFile()) throw new Error("不是文件");
	} catch {
		throw new Error(`快照 ${id} 里没有文件 ${rel}`);
	}

	// 恢复前先给"当前版本"留一份
	await createSnapshot(repoAbs, [rel], { reason: `恢复 ${id}/${rel} 前的现场` }).catch(() => {});

	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.copyFile(source, target);
	const size = (await fs.stat(target)).size;
	return { ok: true, rel, size, message: `已从快照 ${id} 恢复 ${rel}（${size} 字节）` };
}
