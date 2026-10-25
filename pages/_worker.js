const WORKER_ORIGIN = "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev";
const API_ROUTES = new Map([
  ["/api/guest/config", "/guest/config"],
  ["/api/guest/models", "/guest/models"],
  ["/api/guest/chat", "/guest/chat"],
  ["/api/guest/transcribe", "/guest/transcribe"],
  ["/api/guest/images/pollinations", "/guest/images/pollinations"],
  ["/api/models", "/models"],
  ["/api/health", "/health"],
  ["/api/providers/test", "/providers/test"],
  ["/api/chat", "/chat"],
  ["/api/enhance-prompt", "/enhance-prompt"],
  ["/api/send-email", "/send-email"],
  ["/api/gateway", "/gateway"],
  ["/api/live/token", "/live/token"],
  ["/api/transcribe", "/transcribe"],
  ["/api/images/generate", "/images/generate"],
  ["/api/images/pollinations", "/images/pollinations"],
  ["/api/presentation", "/presentation"],
  ["/api/canva/oauth/start", "/canva/oauth/start"],
  ["/api/canva/oauth/callback", "/canva/oauth/callback"],
  ["/api/monid/discover", "/monid/discover"],
  ["/api/monid/inspect", "/monid/inspect"],
  ["/api/monid/run", "/monid/run"],
  ["/api/monid/get", "/monid/get"],
  ["/api/explorium/search", "/explorium/search"],
]);
const ALLOWED_ORIGINS = new Set([
  "https://myai-v3-firmansyah.pages.dev",
  "https://b1259143.myai-v3-firmansyah.pages.dev",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "capacitor://localhost",
]);
function buildCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const ERROR_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), geolocation=(), microphone=(self), payment=()",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstreamPath = API_ROUTES.get(url.pathname);
    if (!upstreamPath) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries({ ...buildCorsHeaders(request), ...SECURITY_HEADERS })) {
        headers.set(name, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...buildCorsHeaders(request), ...ERROR_HEADERS, ...SECURITY_HEADERS } });
    }

    const upstreamUrl = new URL(`${upstreamPath}${url.search}`, WORKER_ORIGIN);
    const timeout = AbortSignal.timeout(130000);
    const signal = typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, timeout])
      : timeout;
    try {
      const response = await fetch(new Request(upstreamUrl, request), { signal });
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries({ ...buildCorsHeaders(request), ...SECURITY_HEADERS })) {
        headers.set(name, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error("Pages AI gateway request failed:", error?.name || "Error");
      const timedOut = timeout.aborted && !request.signal.aborted;
      return new Response(JSON.stringify({
        error: {
          message: timedOut
            ? "Cloudflare Pages menghentikan permintaan AI setelah 130 detik. Coba lagi."
            : "Cloudflare Pages tidak dapat menghubungi API AI. Coba lagi beberapa saat.",
        },
      }), {
        status: timedOut ? 504 : 502,
        headers: { ...buildCorsHeaders(request), ...ERROR_HEADERS, ...SECURITY_HEADERS },
      });
    }
  },
};
