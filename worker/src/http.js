export const HTTP_TIMEOUTS = Object.freeze({
  gatewayConnectMs: 12_000,
  workerConnectMs: 30_000,
  upstreamIdleMs: 30_000,
  sseHeartbeatMs: 15_000,
});

const CORS_ALLOWED_ORIGINS = new Set([
  "https://myai-v3-firmansyah.pages.dev",
  "https://b1259143.myai-v3-firmansyah.pages.dev",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "capacitor://localhost",
]);

export function isAllowedOrigin(origin, env = {}) {
  if (!origin) return true;
  const configuredOrigins = String(env.APP_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = new Set([
    "https://myai-v3-firmansyah.pages.dev",
    ...configuredOrigins,
    ...CORS_ALLOWED_ORIGINS,
  ]);
  if (candidates.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "capacitor:") {
      return url.hostname === "localhost" && !url.port;
    }
    if (url.protocol === "https:"
      && (url.hostname === "myai-v3-firmansyah.pages.dev"
        || url.hostname.endsWith(".myai-v3-firmansyah.pages.dev"))) return true;
    return url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname)
      && (!url.port || ["4173", "5173"].includes(url.port));
  } catch {
    return false;
  }
}

export function corsHeaders(request = null, options = {}) {
  const origin = request?.headers?.get("Origin") || "";
  const allowedOrigin = origin && isAllowedOrigin(origin, options.env) ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": options.allowHeaders || "Content-Type, Authorization, X-Requested-With",
    ...(options.exposeHeaders ? { "Access-Control-Expose-Headers": options.exposeHeaders } : {}),
    ...(options.maxAge ? { "Access-Control-Max-Age": options.maxAge } : {}),
    ...(options.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
    ...(options.contentTypeOptions ? { "X-Content-Type-Options": options.contentTypeOptions } : {}),
    Vary: "Origin",
  };
}

export function jsonResponse(body, status = 200, request = null, options = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, options.cors),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function makeUpstreamRequest(
  request,
  connectTimeoutMs = HTTP_TIMEOUTS.gatewayConnectMs,
  useTimeoutError = true,
) {
  let controller;
  let timeout;
  let abortFromRequest;
  let timedOut = false;
  const stop = () => {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abortFromRequest);
  };
  const start = () => {
    controller = new AbortController();
    timedOut = false;
    timeout = setTimeout(() => {
      timedOut = true;
      if (useTimeoutError) {
        controller.abort(new DOMException("Provider connection timed out.", "TimeoutError"));
      } else {
        controller.abort();
      }
    }, connectTimeoutMs);
    abortFromRequest = () => controller.abort(request.signal.reason);
    if (request.signal?.aborted) abortFromRequest();
    else request.signal?.addEventListener("abort", abortFromRequest, { once: true });
  };
  start();
  return {
    get controller() { return controller; },
    get timedOut() { return timedOut; },
    clearConnectTimeout() { clearTimeout(timeout); },
    reset() {
      stop();
      start();
    },
    cleanup: stop,
  };
}

export function streamResponse(body, {
  status = 200,
  headers = {},
  request = null,
  cors = {},
  contentType = "text/event-stream; charset=utf-8",
  cacheControl = "no-cache, no-transform",
} = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(request, cors),
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "X-Accel-Buffering": "no",
      ...headers,
    },
  });
}
