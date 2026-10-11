/**
 * CI 失败详情 · 纯逻辑（零依赖）
 *
 * 面板原来只会告诉用户「哪个提交红了」，用户还得自己点进 Actions 翻日志。
 * 这里把「从 check-run 定位到失败步骤、整理成一句人话」的逻辑全部抽出来，
 * 好处有两个：
 *   1. server.mjs 只负责接线（发请求、拼字段），逻辑集中在这里；
 *   2. 不联网也能测 —— 喂 fixture 就能验证 extractRunId / pickFailingSteps / summarizeFailure。
 *
 * 涉及的外部数据形态（GitHub REST API）：
 *   - check-run：{ name, conclusion, details_url, output: { title, summary }, html_url, head_sha }
 *   - jobs    ：{ total_count, jobs: [{ id, name, conclusion, html_url, steps: [{ name, conclusion }] }] }
 *   - 日志    ：GET /repos/{o}/{r}/actions/jobs/{job_id}/logs 返回纯文本（可能 302 到签名地址）
 *
 * 约定：本文件里所有函数都**不抛错**。网络/字段缺失一律降级成空值 + 警告文案，
 * 因为调用方（/api/ci）承诺永远返回 200，红条本身坏掉比没细节更糟。
 */

/** 内存缓存：同一 URL 在 TTL 内只请求一次（GitHub 匿名 API 每小时只有 60 次） */
const CACHE = new Map();

/** GitHub 请求默认缓存 60 秒 */
export const CI_CACHE_TTL_MS = 60 * 1000;
/** 单个 GitHub 请求默认 8 秒超时（和改造前保持一致） */
export const CI_TIMEOUT_MS = 8000;
/** 缓存条目上限，防止长期运行的面板把 URL 全攒在内存里 */
const CACHE_MAX_ENTRIES = 200;
/** 日志按文本读取时保留的字节上限（只取尾部，够 30 行就行） */
const LOG_MAX_BYTES = 2 * 1024 * 1024;

/** GitHub API 请求头（公开仓库不需要鉴权） */
export const GITHUB_HEADERS = {
	"User-Agent": "zhi-blog-admin",
	Accept: "application/vnd.github+json",
};

// GitHub check-run / job / step 的各种「没通过」结论。
// 注意：**故意不含 cancelled** —— 手动取消不算部署失败，否则取消一次红条就挂住了。
export const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "action_required", "startup_failure", "stale"]);

/** 把若干 check-run 的结论归并成一个：任一失败即失败，全绿才算成功 */
export function summarizeConclusion(checks) {
	if (!Array.isArray(checks) || checks.length === 0) return "unknown";
	const conclusions = checks.map((c) => c.conclusion).filter(Boolean);
	if (conclusions.length === 0) return "pending";
	if (conclusions.some((c) => FAILURE_CONCLUSIONS.has(c))) return "failure";
	if (conclusions.some((c) => c === "skipped" || c === "neutral")) {
		return conclusions.every((c) => c === "success" || c === "skipped" || c === "neutral") ? "success" : "pending";
	}
	if (conclusions.every((c) => c === "success")) return "success";
	return "pending";
}

/**
 * 从 check-run 的 details_url 里取出 Actions 运行 id。
 * 真实形态：https://github.com/<o>/<r>/actions/runs/123456789/job/987654321
 * 取不到（空值 / 不是这种链接 / id 不是数字）一律返回 ""，调用方据此降级。
 */
export function extractRunId(detailsUrl) {
	if (typeof detailsUrl !== "string") return "";
	const match = detailsUrl.match(/\/actions\/runs\/(\d+)(?:\/|$|[?#])/);
	return match ? match[1] : "";
}

/**
 * 把 details_url 化简成「那次 Actions 运行」的页面链接：
 * https://github.com/<o>/<r>/actions/runs/<id>/job/<jobId> → https://github.com/<o>/<r>/actions/runs/<id>
 * 没有运行 id、或链接不是 <origin>/<owner>/<repo>/actions/runs/... 形态时返回 ""。
 */
export function runPageUrl(detailsUrl) {
	if (typeof detailsUrl !== "string") return "";
	const runId = extractRunId(detailsUrl);
	if (!runId) return "";
	const prefix = detailsUrl.match(/^(https?:\/\/[^/?#]+(?:\/[^/?#]+){2})\/actions\/runs\//);
	if (!prefix) return "";
	return `${prefix[1]}/actions/runs/${runId}`;
}

/** 作业列表里的失败作业（结论命中 FAILURE_CONCLUSIONS 的 job） */
export function pickFailingJobs(jobsJson) {
	if (!jobsJson || typeof jobsJson !== "object") return [];
	const jobs = Array.isArray(jobsJson.jobs) ? jobsJson.jobs : [];
	return jobs.filter((job) => job && typeof job === "object" && FAILURE_CONCLUSIONS.has(job.conclusion));
}

/**
 * 失败步骤名：遍历所有失败作业里结论为失败的步骤。
 * 字段缺失（没有 jobs / 没有 steps / name 不是字符串）直接跳过，不抛错；重名只留一份。
 */
export function pickFailingSteps(jobsJson) {
	const names = [];
	for (const job of pickFailingJobs(jobsJson)) {
		const steps = Array.isArray(job.steps) ? job.steps : [];
		for (const step of steps) {
			if (!step || typeof step !== "object" || !FAILURE_CONCLUSIONS.has(step.conclusion)) continue;
			const name = typeof step.name === "string" ? step.name.trim() : "";
			if (name && !names.includes(name)) names.push(name);
		}
	}
	return names;
}

/** 取第一行有效文本并压平空白（GitHub 的 title/summary 常带换行与 markdown），过长则截断 */
export function firstLine(text, maxLength = 200) {
	if (typeof text !== "string") return "";
	const line =
		text
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part.length > 0) ?? "";
	const flat = line.replace(/\s+/g, " ");
	const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 200;
	if (flat.length > limit) return `${flat.slice(0, limit)}…`;
	// GitHub 的 output.summary 常以英文句号收尾（"Process completed with exit code 1."），
	// 拼进中文摘要里这个句号是多余的；只去掉单个结尾句号，不动其它内容
	return flat.length > 1 && flat.endsWith(".") && !flat.endsWith("..") ? flat.slice(0, -1) : flat;
}

/** 日志尾部：只留最后 maxLines 行（去掉行尾空行与整体首尾空白），拿不到内容返回 "" */
export function tailLines(text, maxLines = 30) {
	if (typeof text !== "string" || !text) return "";
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
	const limit = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 30;
	return lines.slice(-limit).join("\n").trim();
}

/**
 * 整理一次失败：check-run + 该次运行的 jobs → 前端可直接展示的字段。
 * 纯函数（不联网、不抛错）；拿不到的东西写进 detailWarning，字段本身照常返回。
 *
 * @param checkRun 失败的 check-run（可为 null）
 * @param jobsJson actions/runs/{id}/jobs 的 JSON（拿不到就传 null）
 * @param options  { jobsWarning, logExcerpt, logWarning }
 * @returns { checkName, conclusion, detailsUrl, runUrl, jobName, failingSteps, reason, logExcerpt?, detailWarning }
 */
export function summarizeFailure(checkRun, jobsJson, options = {}) {
	const run = checkRun && typeof checkRun === "object" ? checkRun : {};
	const output = run.output && typeof run.output === "object" ? run.output : {};
	const conclusion = typeof run.conclusion === "string" ? run.conclusion : "";
	const title = firstLine(output.title);
	const summary = firstLine(output.summary);
	const failingSteps = pickFailingSteps(jobsJson);
	const failingJob = pickFailingJobs(jobsJson).find((job) => typeof job.name === "string" && job.name.trim()) ?? null;
	const warnings = [];

	// jobs 请求彻底没拿到（断网 / 超时 / 非 2xx）时说明一下；字段本身照样返回
	if (!jobsJson || typeof jobsJson !== "object") {
		const fromCaller = typeof options.jobsWarning === "string" ? options.jobsWarning.trim() : "";
		warnings.push(fromCaller || "没能取到这次运行的作业列表，无法定位失败步骤");
	}
	const logWarning = typeof options.logWarning === "string" ? options.logWarning.trim() : "";
	if (logWarning) warnings.push(logWarning);

	// 一句话说清「错在哪一步」：有失败步骤就点名步骤，否则退化成 check-run 的标题/摘要
	let reason;
	if (failingSteps.length > 0) {
		// 标题常常就是步骤名（"Build site"），此时只有 summary 才是有信息量的补充
		const detail = summary || (title && title !== failingSteps[0] ? title : "");
		reason = detail ? `步骤 \`${failingSteps[0]}\` 失败：${detail}` : `步骤 \`${failingSteps[0]}\` 失败`;
	} else if (title && summary) {
		reason = `检查「${title}」失败：${summary}`;
	} else if (title) {
		reason = `检查「${title}」失败`;
	} else if (summary) {
		reason = `失败：${summary}`;
	} else if (conclusion && conclusion !== "failure") {
		reason = `CI 未通过（结论：${conclusion}），GitHub 没有给出失败原因`;
	} else {
		reason = "CI 未通过，GitHub 没有给出失败原因";
	}

	const detail = {
		checkName: typeof run.name === "string" ? run.name : "",
		conclusion,
		detailsUrl: typeof run.details_url === "string" ? run.details_url : "",
		runUrl: runPageUrl(run.details_url),
		jobName: failingJob ? failingJob.name.trim() : "",
		failingSteps,
		reason,
		detailWarning: warnings.join("；"),
	};
	const logExcerpt = typeof options.logExcerpt === "string" ? options.logExcerpt.trim() : "";
	if (logExcerpt) detail.logExcerpt = logExcerpt;
	return detail;
}

/**
 * 把「某次运行的条目」与失败详情合成 /api/ci 的 lastFailure。
 * 运行条目（sha/status/createdAt/message…）优先，详情提供 checkName / runUrl / failingSteps / reason / logExcerpt。
 */
export function describeFailure(runEntry, checkRun, jobsJson, options = {}) {
	const run = runEntry && typeof runEntry === "object" ? runEntry : {};
	const detail = summarizeFailure(checkRun, jobsJson, options);
	const sha = String(run.sha || checkRun?.head_sha || "");
	return {
		...detail,
		sha,
		shortSha: String(run.shortSha || sha.slice(0, 7)),
		status: String(run.status || checkRun?.status || ""),
		conclusion: String(run.conclusion || checkRun?.conclusion || ""),
		url: String(run.url || checkRun?.html_url || ""),
		createdAt: String(run.createdAt || ""),
		message: String(run.message || ""),
	};
}

/** 缓存写入（Map 的迭代顺序即插入顺序，重新插入实现 LRU 淘汰） */
function remember(key, value, ttlMs) {
	if (ttlMs <= 0) return;
	CACHE.delete(key);
	CACHE.set(key, { expiresAt: Date.now() + ttlMs, value });
	while (CACHE.size > CACHE_MAX_ENTRIES) {
		const oldest = CACHE.keys().next().value;
		if (oldest === undefined) break;
		CACHE.delete(oldest);
	}
}

/** 清空内存缓存（测试用；面板里不需要主动调用） */
export function clearCache() {
	CACHE.clear();
}

/** 当前缓存条目数（测试用） */
export function cacheSize() {
	return CACHE.size;
}

/**
 * 带 60 秒内存缓存的 GET：同一 URL 在 TTL 内只发一次请求。
 *
 * 只有 **成功** 的响应会进缓存 —— 失败（断网、超时、403 限流、404）不缓存，
 * 否则一次偶发失败会在 TTL 内被"钉死"。失败一律返回 { ok:false }，绝不抛错。
 *
 * @param url  请求地址
 * @param options { ttlMs, timeoutMs, headers, asText, maxBytes, fetchImpl }
 *                fetchImpl 只给测试打桩用，默认用全局 fetch
 * @returns { ok, status, data, error, cached }
 */
export async function fetchWithCache(url, options = {}) {
	const key = String(url);
	const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : CI_CACHE_TTL_MS;
	const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : CI_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	const hit = ttlMs > 0 ? CACHE.get(key) : undefined;
	if (hit && hit.expiresAt > Date.now()) return { ...hit.value, cached: true };
	if (typeof fetchImpl !== "function") {
		return { ok: false, status: 0, data: null, error: "当前 Node 没有可用的 fetch", cached: false };
	}

	let res;
	try {
		res = await fetchImpl(key, {
			headers: options.headers ?? GITHUB_HEADERS,
			// 超时 / 断网 / DNS 失败都在这里被吃掉，降级成 ok:false
			signal: AbortSignal.timeout(timeoutMs),
			redirect: "follow",
		});
	} catch (error) {
		return { ok: false, status: 0, data: null, error: error?.message ?? String(error), cached: false };
	}

	if (!res || !res.ok) {
		const status = Number(res?.status) || 0;
		return { ok: false, status, data: null, error: `GitHub 返回 ${status}`, cached: false };
	}

	let data = null;
	try {
		if (options.asText) {
			const raw = await res.text();
			// 日志只关心最后几十行，超长时保留尾部即可（别把几 MB 文本整段留在内存里传下去）
			const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : LOG_MAX_BYTES;
			data = typeof raw === "string" && raw.length > maxBytes ? raw.slice(-maxBytes) : raw;
		} else {
			data = await res.json();
		}
	} catch (error) {
		return { ok: false, status: Number(res.status) || 0, data: null, error: `读取响应失败：${error?.message ?? String(error)}`, cached: false };
	}

	const value = { ok: true, status: Number(res.status) || 200, data, error: "" };
	remember(key, value, ttlMs);
	return { ...value, cached: false };
}
