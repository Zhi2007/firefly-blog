/**
 * Cloudflare Worker 入口（wrangler.jsonc 里 run_worker_first: true，接管所有请求）
 *
 * 为什么需要它：Workers 静态资源既不处理 Range 请求，也不支持按域名匹配的跳转，
 * 而 `_redirects` / `_headers` 里的规则又**不作用于 Worker 处理的响应**，
 * 所以下面这些只能在代码里做：
 *
 *   1. 裸域 zhihaisblog.top → 301 到主域 www.zhihaisblog.top（保留路径与查询串）
 *   2. 旧站地址 301：/blog → /archive/、/blog/ → /archive/、/blog/<slug>/ → /posts/<slug>/
 *   3. /assets/music/* 自己实现 Range（206）、ETag 304、HEAD、416
 *   4. 其余请求交给静态资源，并补上安全响应头与缓存策略（等价于 public/_headers 的内容）
 *
 * 任何异常都会回退为直接取静态资源，保证 Worker 出问题时站点仍能打开。
 */

const CANONICAL_HOST = "www.zhihaisblog.top"; // 主域（裸域会 301 过来）
const APEX_HOST = "zhihaisblog.top"; // 需要跳转到主域的裸域
const MEDIA_PREFIX = "/assets/music/";
const AUDIO_RE = /\.(mp3|m4a|flac|ogg|oga|wav|aac)$/i;
const COVER_RE = /\/cover\//i;

// 与 public/_headers 保持一致（该文件不作用于 Worker 响应，这里才是实际生效的地方）
const SECURITY_HEADERS = {
	"strict-transport-security": "max-age=15552000; includeSubDomains",
	"x-content-type-options": "nosniff",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-frame-options": "SAMEORIGIN",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
	"x-xss-protection": "0",
	"content-security-policy":
		"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://giscus.app https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' https:; frame-src https://giscus.app; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

export default {
	async fetch(request, env) {
		try {
			const url = new URL(request.url);

			// 1) 裸域 → 主域（301，保留路径与查询串）
			if (url.hostname === APEX_HOST) {
				const target = new URL(url.toString());
				target.protocol = "https:";
				target.hostname = CANONICAL_HOST;
				// 每个出口都要过 withSecurityHeaders：301 也是给浏览器的正式响应，
				// 少了 HSTS / CSP 就等于这条路径裸奔（之前这里直接 return，7 个头全丢）
				return withSecurityHeaders(Response.redirect(target.toString(), 301));
			}

			// 2) 旧站地址 301
			const legacy = legacyRedirect(url.pathname);
			if (legacy) {
				const target = new URL(url.toString());
				target.protocol = "https:";
				target.pathname = legacy;
				return withSecurityHeaders(Response.redirect(target.toString(), 301));
			}

			// 3) 音乐目录：自己实现 Range，保证边下边播与拖动进度条
			if (url.pathname.startsWith(MEDIA_PREFIX)) {
				return await serveMedia(request, env);
			}

			// 4) 其余交给静态资源 + 安全头与缓存策略
			return await serveAsset(request, env);
		} catch (error) {
			// 出问题时尽量保底：直接把请求交给静态资源；再失败才返回 503（不回显内部错误细节）
			try {
				return withSecurityHeaders(await env.ASSETS.fetch(request));
			} catch {
				return new Response("服务暂时不可用，请稍后重试。", {
					status: 503,
					headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" },
				});
			}
		}
	},
};

/**
 * 旧站 /blog 系列地址 → 新地址（返回新的 pathname，不需要跳转时返回 null）。
 * 大小写不敏感：Cloudflare 的路径匹配区分大小写，而用户手输地址时大小写很随意
 * （/Blog/x、/BLOG/x 之前会直接落到静态资源上返回 200/404，而不是跳到新地址）。
 */
function legacyRedirect(pathname) {
	const lower = String(pathname ?? "").toLowerCase();
	if (lower === "/blog" || lower === "/blog/") return "/archive/";
	// 只按小写前缀判断，后缀（slug）保留原始大小写
	if (lower.startsWith("/blog/")) return `/posts/${pathname.slice("/blog/".length)}`;
	return null;
}

/**
 * 复制一份响应头，并**覆盖**安全响应头。
 * 注意是 set 而不是 append：上游（静态资源 / 平台默认）如果带了宽松的 CSP、X-Frame-Options，
 * 必须被这里换掉，绝不能出现两份同名头。
 */
function applySecurityHeaders(base) {
	const headers = new Headers(base);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(name, value);
	}
	return headers;
}

/**
 * 所有响应出口的统一收口：返回一个带齐安全响应头的新响应。
 * 301 跳转、媒体 404、异常兜底、静态资源都必须从这里返回，保证「每个响应都补头」这句话成立。
 */
function withSecurityHeaders(response) {
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: applySecurityHeaders(response.headers),
	});
}

/** 静态资源：补安全响应头，并按路径设置缓存策略 */
async function serveAsset(request, env) {
	const response = await env.ASSETS.fetch(request);
	const headers = applySecurityHeaders(response.headers);
	const { pathname } = new URL(request.url);
	if (pathname.startsWith("/_astro/")) {
		headers.set("cache-control", "public, max-age=31536000, immutable");
	} else if (pathname.startsWith("/vendor/")) {
		// 自托管客户端：文件名带版本号，可长期不可变缓存
		headers.set("cache-control", "public, max-age=31536000, immutable");
	} else if (pathname.startsWith("/pagefind/")) {
		headers.set("cache-control", "public, max-age=604800");
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

async function serveMedia(request, env) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { ...SECURITY_HEADERS, allow: "GET, HEAD" },
		});
	}

	// 取原始资源（不带 Range，拿全量数据后自己切片）
	const upstream = await env.ASSETS.fetch(new Request(request.url, { method: "GET" }));
	// 媒体 404 等非 2xx 也要走统一收口，否则这条路径会漏掉全部安全头
	if (!upstream.ok) return withSecurityHeaders(upstream);

	const body = await upstream.arrayBuffer();
	const total = body.byteLength;
	const etag = upstream.headers.get("etag") || `W/"${total.toString(16)}"`;

	const headers = new Headers(SECURITY_HEADERS);
	headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
	headers.set("etag", etag);
	headers.set("accept-ranges", "bytes");
	// 音频与封面在歌单里都带内容哈希（?v=），可以放心长缓存；歌词可能随时补，短一点
	const pathname = new URL(request.url).pathname;
	const maxAge = AUDIO_RE.test(pathname) ? 86400 : COVER_RE.test(pathname) ? 604800 : 3600;
	headers.set("cache-control", `public, max-age=${maxAge}`);
	const lastModified = upstream.headers.get("last-modified");
	if (lastModified) headers.set("last-modified", lastModified);

	// 缓存校验：内容没变就直接 304，不重传整个文件
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
