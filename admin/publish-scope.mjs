/**
 * 发布时的暂存范围（仅面板自己管理的路径）。
 *
 * 为什么不用 `git add -A`：那会把工作区**所有**改动一起提交并推送 ——
 * 包括正在改一半的在制品。`admin/` 的半成品无害，但 `src/**` 的半成品会直接让
 * 站点构建失败，而 GitHub Actions 一失败部署就挂。
 *
 * 代价：面板管理范围之外的改动（例如手工改的 src/styles/variables.styl）
 * 不会被这个按钮提交 —— 因此 stageForPublish 会把这些路径**返回给调用方**，
 * 由界面上明确提示「已跳过」，而不是静默丢弃。
 */

/** 面板负责写入的路径前缀（相对仓库根，使用 / 分隔） */
export const PUBLISH_SCOPE = [
	"src/content", // 文章、动态、文章自带图片
	"src/config", // 站点设置 / 导航覆盖 / 友链 JSON / 公告 / 歌单等面板可写配置
	"public/assets", // 媒体库上传与压缩产物（图片、音乐、封面）
	"public/friends", // 友链图标
	"public/vendor", // 自托管第三方脚本（如 giscus）
	"src/constants", // 构建产物数据：LQIP 占位图（lqips.json）等，必须随文章一起发布，否则线上少了封面占位数据
];

/** 把 git 输出的路径归一化成 / 分隔、去掉可能的引号 */
export function normalizeRelPath(p) {
	return String(p || "")
		.trim()
		.replace(/^"|"$/g, "")
		.split("\\")
		.join("/")
		.replace(/^\.\//, "");
}

/** 该路径是否属于面板管理范围 */
export function isInPublishScope(relPath) {
	const p = normalizeRelPath(relPath);
	return PUBLISH_SCOPE.some((scope) => p === scope || p.startsWith(scope + "/"));
}

/**
 * 解析 `git status --porcelain -z` 的输出，返回 `{ path, code, origin }` 列表（保序、不去重）。
 * -z 用 NUL 分隔，能安全处理带空格、单引号、非 ASCII 的文件名（音乐封面里就有）。
 *
 * 两个必须讲清楚的点（调用方 `/api/diff` 靠它们决定「这条路径还能不能打开 / 断言存在」）：
 *   - `code` 是 porcelain 的两字符状态码（如 ` M`、`??`、` D`）；含 `D` 表示文件已经不在磁盘上。
 *   - 重命名 / 复制会占**两条**记录。git 文档（git-status，Porcelain v1 的 -z 段）写明
 *     「the -> is omitted and the field order is reversed」，也就是第一条是**新**路径、
 *     第二条才是**旧**路径，所以第二条用 `origin: "old"` 标出来 —— 旧路径在磁盘上已经不存在了。
 */
export function parsePorcelainEntriesZ(text) {
	const records = String(text || "").split("\0").filter((s) => s.length > 0);
	const out = [];
	let pendingOld = false;
	for (const rec of records) {
		if (pendingOld) {
			pendingOld = false;
			out.push({ path: normalizeRelPath(rec), code: "R ", origin: "old" });
			continue;
		}
		const code = rec.slice(0, 2);
		const p = rec.slice(3);
		// R = rename、C = copy：下一条记录是「旧路径」
		if (code[0] === "R" || code[0] === "C") pendingOld = true;
		out.push({ path: normalizeRelPath(p), code, origin: "new" });
	}
	return out;
}

/**
 * 解析 `git status --porcelain -z` 的输出，返回去重后的相对路径数组。
 * 是 parsePorcelainEntriesZ 的「只要路径」投影，两处口径永远一致。
 */
export function parsePorcelainZ(text) {
	return [...new Set(parsePorcelainEntriesZ(text).map((entry) => entry.path))];
}

/**
 * 只暂存面板管理范围内的改动。
 * 注意必须带 `--untracked-files=all`：否则 git 会把**整个未跟踪目录**折叠成一条
 * `public/`，导致新上传的媒体文件（public/assets 下）根本不会被暂存。
 * @returns {{ staged: string[], skipped: string[], result: object }}
 */
export async function stageForPublish(git, repoRoot) {
	// raw: true 是**必须**的：porcelain 的第一条记录可能以空格开头（` M path`），
	// 一旦被 trim 掉，状态码与路径就会错位一个字符，`git add -- <错路径>` 直接失败。
	const status = await git(["status", "--porcelain", "-z", "--untracked-files=all"], { raw: true });
	if (!status.ok) return { staged: [], skipped: [], result: status };
	const changed = parsePorcelainZ(status.stdout);
	const staged = changed.filter(isInPublishScope);
	const skipped = changed.filter((p) => !isInPublishScope(p));
	const result = { ok: true, stdout: "", stderr: "" };
	if (staged.length > 0) {
		// 分批发，避免命令行过长；git add -- <path> 同时覆盖新增、修改与删除
		for (let i = 0; i < staged.length; i += 50) {
			const batch = staged.slice(i, i + 50);
			const added = await git(["add", "--", ...batch]);
			if (!added.ok) return { staged, skipped, result: added };
		}
		result.stdout = `已暂存 ${staged.length} 个文件` + (skipped.length ? `；跳过 ${skipped.length} 个不在面板管理范围的改动` : "");
	}
	return { staged, skipped, result };
}