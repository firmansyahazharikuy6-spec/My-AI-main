const WORKER_ORIGIN = "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev";
const API_ROUTES = new Map([
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
  ["/api/monid/discover", "/monid/discover"],
  ["/api/monid/inspect", "/monid/inspect"],
  ["/api/monid/run", "/monid/run"],
  ["/api/monid/get", "/monid/get"],
  ["/api/explorium/search", "/explorium/search"],
]);
const ERROR_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...ERROR_HEADERS, ...SECURITY_HEADERS } });
    }

    const upstreamUrl = new URL(`${upstreamPath}${url.search}`, WORKER_ORIGIN);
    const timeout = AbortSignal.timeout(130000);
    const signal = typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, timeout])
      : timeout;
    try {
      const response = await fetch(new Request(upstreamUrl, request), { signal });
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
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
        headers: { ...ERROR_HEADERS, ...SECURITY_HEADERS },
      });
    }
  },
};
