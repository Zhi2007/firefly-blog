/**
 * Cloudflare Worker 入口
 *
 * 只接管 /assets/music/*（见 wrangler.jsonc 里 assets.run_worker_first 的路径数组），
 * 其余请求仍然由 Workers 静态资源直接响应，不受这里影响。
 *
 * 为什么需要它：
 * Workers 静态资源不返回 Content-Length / Accept-Ranges，也不处理 Range 请求，
 * 浏览器因此无法边下边播音乐、无法拖动进度条 —— 对 10 MB 级的音频文件表现为"放不了"。
 * 这里自己实现 206 Partial Content、ETag 缓存校验与 HEAD 支持。
 */

const MEDIA_PREFIX = "/assets/music/";
const AUDIO_RE = /\.(mp3|m4a|flac|ogg|oga|wav|aac)$/i;

// 与 public/_headers 保持一致（Worker 返回的响应不会应用 _headers 文件）
const SECURITY_HEADERS = {
	"strict-transport-security": "max-age=15552000; includeSubDomains",
	"x-content-type-options": "nosniff",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-frame-options": "SAMEORIGIN",
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (!url.pathname.startsWith(MEDIA_PREFIX)) {
			return env.ASSETS.fetch(request);
		}
		try {
			return await serveMedia(request, env);
		} catch (error) {
			return new Response(`媒体服务异常：${error?.message ?? error}`, {
				status: 500,
				headers: SECURITY_HEADERS,
			});
		}
	},
};

async function serveMedia(request, env) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" },
		});
	}

	// 取原始资源（不带 Range，拿全量数据后自己切片）
	const upstream = await env.ASSETS.fetch(new Request(request.url, { method: "GET" }));
	if (!upstream.ok) return upstream;

	const body = await upstream.arrayBuffer();
	const total = body.byteLength;
	const etag = upstream.headers.get("etag") || `W/"${total.toString(16)}"`;

	const headers = new Headers(SECURITY_HEADERS);
	headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
	headers.set("etag", etag);
	headers.set("accept-ranges", "bytes");
	headers.set(
		"cache-control",
		AUDIO_RE.test(new URL(request.url).pathname) ? "public, max-age=86400" : "public, max-age=3600",
	);
	const lastModified = upstream.headers.get("last-modified");
	if (lastModified) headers.set("last-modified", lastModified);

	// 缓存校验：内容没变就直接 304，不重传 10 MB
	const ifNoneMatch = request.headers.get("if-none-match");
	if (
		ifNoneMatch &&
		ifNoneMatch
			.split(",")
			.map((value) => value.trim())
			.includes(etag)
	) {
		return new Response(null, { status: 304, headers });
	}

	const range = parseRange(request.headers.get("range"), total);
	if (range === "invalid") {
		headers.set("content-range", `bytes */${total}`);
		return new Response(null, { status: 416, headers });
	}

	if (range) {
		const chunk = body.slice(range.start, range.end + 1);
		headers.set("content-range", `bytes ${range.start}-${range.end}/${total}`);
		headers.set("content-length", String(chunk.byteLength));
		return new Response(request.method === "HEAD" ? null : chunk, { status: 206, headers });
	}

	headers.set("content-length", String(total));
	return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

/**
 * 解析单段 Range。
 * - 语法不合法（含多段）→ null：按 RFC 7233 忽略该头，返回完整内容
 * - 语法合法但越界 → "invalid"：返回 416
 */
function parseRange(header, total) {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;
	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return null;

	let start;
	let end;
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (!Number.isFinite(suffix) || suffix <= 0) return null;
		start = Math.max(0, total - suffix);
		end = total - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd === "" ? total - 1 : Number(rawEnd);
	}

	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
		return "invalid";
	}
	return { start, end: Math.min(end, total - 1) };
}
