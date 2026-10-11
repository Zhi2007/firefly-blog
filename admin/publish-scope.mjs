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
 * 解析 `git status --porcelain -z` 的输出，返回去重后的相对路径数组。
 * -z 用 NUL 分隔，能安全处理带空格、单引号、非 ASCII 的文件名（音乐封面里就有）。
 * 重命名/复制会占两条记录（旧、新），这里取**新**路径作为代表。
 */
export function parsePorcelainZ(text) {
	const records = String(text || "").split("\0").filter((s) => s.length > 0);
	const out = [];
	let skipNext = false;
	for (const rec of records) {
		if (skipNext) {
			skipNext = false;
			out.push(normalizeRelPath(rec));
			continue;
		}
		const code = rec.slice(0, 2);
		const p = rec.slice(3);
		if (code[0] === "R" || code[0] === "C") skipNext = true;
		out.push(normalizeRelPath(p));
	}
	return [...new Set(out)];
}

/**
 * 只暂存面板管理范围内的改动。
 * 注意必须带 `--untracked-files=all`：否则 git 会把**整个未跟踪目录**折叠成一条
 * `public/`，导致新上传的媒体文件（public/assets 下）根本不会被暂存。
 * @returns {{ staged: string[], skipped: string[], result: object }}
 */
export async function stageForPublish(git, repoRoot) {
	const status = await git(["status", "--porcelain", "-z", "--untracked-files=all"]);
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