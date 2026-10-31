import { AI_API_URL } from "./config.js?v=20261029-v5.130";

export function getAiApiUrl(path, baseUrl = AI_API_URL) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("URL API MyAI belum dikonfigurasi.");
  }
  const base = baseUrl.replace(/\/+$/, "");
  const route = String(path || "").replace(/^\/+/, "");
  return `${base}/${route}`;
}

export async function fetchAiApi(path, options = {}, {
  baseUrl = AI_API_URL,
  fetchImpl = globalThis.fetch,
  location = globalThis.location,
  navigator = globalThis.navigator,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch API tidak tersedia di browser ini.");
  const url = getAiApiUrl(path, baseUrl);
  try {
    const response = await fetchImpl(url, options);
    const localDevelopment = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::4173)?(?:\/|$)/i.test(location?.origin || "");
    if (localDevelopment && response.status >= 500 && typeof response.clone === "function") {
      const body = await response.clone().text().catch(() => "");
      if (/http proxy error|ECONNREFUSED/i.test(body)) {
        console.warn("MyAI local Worker proxy returned a connection error.", {
          path: `/${String(path || "").replace(/^\/+/, "")}`,
          status: response.status,
        });
        throw Object.assign(new Error(
          "Worker lokal tidak dapat dijangkau. Jalankan `npm run worker:dev` pada port 8787 atau atur MYAI_WORKER_URL ke port Worker yang aktif.",
        ), { code: "AI_API_UNREACHABLE" });
      }
    }
    return response;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error?.code === "AI_API_UNREACHABLE") throw error;
    if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
    if (error instanceof TypeError || error?.name === "NetworkError") {
      const localDevelopment = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::4173)?(?:\/|$)/i.test(location?.origin || "");
      const message = navigator?.onLine === false
        ? "Perangkat sedang offline. Hubungkan ke internet lalu coba lagi."
        : localDevelopment
          ? "Worker lokal tidak dapat dijangkau. Jalankan `npm run worker:dev` pada port 8787 atau atur MYAI_WORKER_URL ke port Worker yang aktif."
          : "Layanan AI MyAI tidak dapat dijangkau. Periksa koneksi internet atau coba lagi.";
      console.warn("MyAI API request could not reach its configured endpoint.", {
        path: `/${String(path || "").replace(/^\/+/, "")}`,
        error: error?.name || "NetworkError",
      });
      throw Object.assign(new Error(message), { code: "AI_API_UNREACHABLE", cause: error });
    }
    throw error;
  }
}
