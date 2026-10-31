import { AI_API_URL } from "./config.js?v=20261029-v5.130";
import { fetchAiApi } from "./api-client.js?v=20261029-v5.130";
import {
  buildFallbackImagePromptPlan,
  cleanImageGenerationPrompt,
  validateImagePromptPlan,
} from "./image-prompts.js?v=20261029-v5.130";
import { MODEL_MENU_PROVIDERS } from "../shared/model-catalog.js?v=20261029-v5.130";

const WORKER_MODEL_TIMEOUT_MS = 45000;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 45000;
const SETTINGS_KEY = "myai_settings";
const GUEST_DEVICE_ID_STORAGE_KEY = "myai_guest_device_id_v1";
const LEGACY_DEFAULT_SYSTEM_PROMPT = "Kamu adalah asisten AI yang ramah, cerdas, dan membantu. Berkomunikasilah secara natural, hangat, dan relevan seperti teman bicara yang baik; pahami konteks percakapan sebelumnya dan tanyakan klarifikasi hanya bila memang diperlukan. Jawab dalam bahasa yang dipakai pengguna. Gunakan Markdown untuk format, dan tulis rumus matematika dengan LaTeX ($...$ atau $$...$$).";
const PREVIOUS_DEFAULT_SYSTEM_PROMPTS = new Set([
  LEGACY_DEFAULT_SYSTEM_PROMPT,
  "Jawablah secara ramah, jelas, dan natural. Utamakan jawaban yang sesuai kebutuhan pengguna.",
]);
export const DEFAULT_SETTINGS = {
  showPaid: false,
  systemPrompt: "Ikuti instruksi inti MyAI. Sesuaikan bahasa, kedalaman, dan format dengan kebutuhan. Jaga akurasi, hindari pengulangan, dan gunakan hanya fitur yang benar-benar tersedia.",
  temperature: 0.7,
  about: "",
  persona: "balanced",
  responseLength: "balanced",
  enterToSend: true,
  autoSpeak: false,
  showPerformanceAnalytics: true,
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      if (Object.prototype.hasOwnProperty.call(saved, "apiKeys")) {
        const cleaned = { ...saved };
        delete cleaned.apiKeys;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(cleaned));
        } catch (error) {
          console.warn("Legacy browser API keys could not be removed from local storage.", error);
        }
      }
      return {
        ...DEFAULT_SETTINGS,
        showPaid: saved.showPaid === true,
        systemPrompt: typeof saved.systemPrompt === "string" && !PREVIOUS_DEFAULT_SYSTEM_PROMPTS.has(saved.systemPrompt)
          ? saved.systemPrompt
          : DEFAULT_SETTINGS.systemPrompt,
        temperature: Number.isFinite(Number(saved.temperature)) ? Math.min(1.5, Math.max(0, Number(saved.temperature))) : DEFAULT_SETTINGS.temperature,
        about: typeof saved.about === "string" ? saved.about.slice(0, 1500) : "",
        persona: ["balanced", "general", "tutor", "professional", "coding", "creative", "researcher"].includes(saved.persona) ? saved.persona : DEFAULT_SETTINGS.persona,
        responseLength: ["concise", "balanced", "detailed"].includes(saved.responseLength) ? saved.responseLength : DEFAULT_SETTINGS.responseLength,
        enterToSend: saved.enterToSend !== false,
        autoSpeak: saved.autoSpeak === true,
        showPerformanceAnalytics: saved.showPerformanceAnalytics !== false,
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    showPaid: s.showPaid === true,
    systemPrompt: s.systemPrompt,
    temperature: s.temperature,
    about: s.about || "",
    persona: ["balanced", "general", "tutor", "professional", "coding", "creative", "researcher"].includes(s.persona) ? s.persona : DEFAULT_SETTINGS.persona,
    responseLength: ["concise", "balanced", "detailed"].includes(s.responseLength) ? s.responseLength : DEFAULT_SETTINGS.responseLength,
    enterToSend: s.enterToSend !== false,
    autoSpeak: s.autoSpeak === true,
    showPerformanceAnalytics: s.showPerformanceAnalytics !== false,
  }));
}

export function isRateLimitOrQuotaError(error) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || message.match(/\b(?:HTTP\s*)?(402|429)\b/i)?.[1] || 0);
  return status === 402 || status === 429
    || /\brate[\s-]?limit\b|\bquota\b|\bkuota\b|batas (?:penggunaan|pemakaian)/i.test(message);
}

export function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) throw new TypeError("Riwayat chat harus berupa daftar pesan.");
  const systemParts = [];
  const conversation = [];
  for (const message of messages) {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new TypeError("Format riwayat chat tidak valid.");
    }
    if (message.role === "system") {
      const content = message.content.trim();
      if (content && !systemParts.includes(content)) systemParts.push(content);
    } else {
      conversation.push({ ...message });
    }
  }
  let latestUserIndex = -1;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  const activeConversation = latestUserIndex >= 0
    ? conversation.slice(0, latestUserIndex + 1)
    : conversation;
  return [
    ...(systemParts.length ? [{ role: "system", content: systemParts.join("\n\n") }] : []),
    ...activeConversation,
  ];
}

const GUEST_CHAR_BUDGET = 5800;
const SERVER_MODELS_CACHE_MS = 5 * 60 * 1000;
const MODEL_STORAGE_PREFIX = "myai_initial_model_catalog_v3";
let guestTurnstileScriptPromise = null;

function getGuestDeviceId() {
  let deviceId;
  try {
    deviceId = localStorage.getItem(GUEST_DEVICE_ID_STORAGE_KEY);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId || "")) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      deviceId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      localStorage.setItem(GUEST_DEVICE_ID_STORAGE_KEY, deviceId);
    }
  } catch {
    throw new Error("Penyimpanan ID perangkat guest tidak tersedia. Aktifkan localStorage lalu muat ulang halaman.");
  }
  return deviceId;
}

function getAccountDeviceId() {
  try {
    return getGuestDeviceId();
  } catch {
    return "";
  }
}

async function loadGuestTurnstile() {
  if (globalThis.turnstile) return globalThis.turnstile;
  if (!guestTurnstileScriptPromise) {
    guestTurnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => globalThis.turnstile
        ? resolve(globalThis.turnstile)
        : reject(new Error("Skrip verifikasi AI guest tidak dapat dimuat."));
      script.onerror = () => reject(new Error("Skrip verifikasi AI guest tidak dapat dijangkau."));
      document.head.append(script);
    }).catch((error) => {
      guestTurnstileScriptPromise = null;
      throw error;
    });
  }
  return guestTurnstileScriptPromise;
}

async function guestRequestHeaders(apiBase, { json = true } = {}) {
  const deviceId = getGuestDeviceId();
  const configResponse = await fetchAiApi("guest/config", { cache: "no-store" }, { baseUrl: apiBase });
  if (!configResponse.ok) throw new Error(await errorText(configResponse));
  const config = await configResponse.json();
  if (typeof config.turnstileSiteKey !== "string" || !config.turnstileSiteKey) {
    throw new Error("Konfigurasi verifikasi AI guest tidak valid. Hubungi admin.");
  }
  const turnstile = await loadGuestTurnstile();
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.right = "12px";
  container.style.bottom = "12px";
  container.style.zIndex = "10000";
  document.body.append(container);
  let widgetId;
  let timer;
  try {
    const token = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Verifikasi AI guest melewati batas waktu. Silakan coba lagi.")), 120000);
      widgetId = turnstile.render(container, {
        sitekey: config.turnstileSiteKey,
        size: "invisible",
        execution: "execute",
        appearance: "interaction-only",
        callback: resolve,
        "error-callback": () => reject(new Error("Verifikasi AI guest gagal dimuat. Silakan coba lagi.")),
        "expired-callback": () => reject(new Error("Verifikasi AI guest kedaluwarsa. Silakan coba lagi.")),
        "timeout-callback": () => reject(new Error("Verifikasi AI guest melewati batas waktu. Silakan coba lagi.")),
      });
      turnstile.execute(widgetId);
    });
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      "X-Turnstile-Token": token,
      "X-Guest-Device-Id": deviceId,
    };
  } finally {
    clearTimeout(timer);
    if (widgetId !== undefined) turnstile.remove(widgetId);
    container.remove();
  }
}
let guestModelsPromise = null;
let serverModelsCache = null;

function readStoredCatalog(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (value?.version === 1 && Array.isArray(value.groups)) return value;
  } catch (error) {
    console.warn("MyAI model catalog cache could not be read.", error);
  }
  return null;
}

function storeCatalog(key, catalog) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      cachedAt: Date.now(),
      groups: catalog.groups,
      ...(Array.isArray(catalog.providers) ? { providers: catalog.providers } : {}),
    }));
  } catch (error) {
    console.warn("MyAI model catalog could not be cached locally.", error);
  }
}

export function invalidateGuestModels() {
  guestModelsPromise = null;
}

export function invalidateServerModels() {
  serverModelsCache = null;
}

// Worker guest menolak >8 pesan, >6000 karakter total, atau >1 gambar.
function fitGuestMessages(messages) {
  const chatOnly = messages.filter((message) => message.role === "user" || message.role === "assistant");
  const fitted = [];
  let used = 0;
  let imageUsed = false;
  for (let index = chatOnly.length - 1; index >= 0 && fitted.length < 8; index -= 1) {
    const message = chatOnly[index];
    const remaining = GUEST_CHAR_BUDGET - used;
    if (remaining < 200 && fitted.length) break;
    let content = String(message.content || "");
    if (content.length > remaining) {
      content = message.role === "user" && !fitted.length
        ? content.slice(0, Math.max(0, remaining - 60)) + "\n\n[...dipotong karena batas AI guest]"
        : "";
    }
    if (!content) break;
    const next = { role: message.role, content };
    if (!imageUsed && message.images?.length) {
      next.images = [message.images[0]];
      imageUsed = true;
    }
    used += content.length;
    fitted.unshift(next);
  }
  while (fitted.length && fitted[0].role !== "user") fitted.shift();
  return fitted;
}

async function errorText(res) {
  const raw = await res.text();
  try {
    const j = JSON.parse(raw);
    const message = typeof j.error === "string" ? j.error : j.error?.message;
    const detail = message || j.message || raw;
    return `${res.status}${j.code ? ` ${j.code}` : ""}: ${detail}`;
  } catch {
    const eventLine = raw.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (eventLine) {
      try {
        const event = JSON.parse(eventLine.slice(5).trim());
        const message = typeof event.error === "string" ? event.error : event.error?.message;
        if (message) return `${res.status}: ${message}`;
      } catch {}
    }
    return `${res.status}: ${raw.slice(0, 300)}`;
  }
}

function createRequestGuard(parentSignal, timeoutMs = CHAT_STREAM_IDLE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeout;
  let timedOut = false;
  const timeoutRequest = () => {
    timedOut = true;
    controller.abort(new DOMException("AI stream tidak menerima data sebelum batas waktu.", "TimeoutError"));
  };
  const armTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(timeoutRequest, timeoutMs);
  };
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  armTimeout();
  return {
    signal: controller.signal,
    touch: armTimeout,
    get timedOut() { return timedOut; },
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function* readSSE(res, requestGuard) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let complete = false;
  const parseLine = (line) => {
    if (!line.startsWith("data:")) return null;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return { done: true };
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return null;
    }
    if (event.error) {
      throw new Error(typeof event.error === "string"
        ? event.error
        : event.error.message || "Error dari server AI.");
    }
    const usage = event.type === "usage" && event.tokens
      ? event.tokens
      : event.usage || event.usageMetadata;
    if (usage) event.myaiUsage = normalizeUsage(usage);
    if (event.type === "metrics") {
      event.myaiMetrics = {
        tokens: Number(event.tokens || 0),
        completionTokens: Number(event.completion_tokens || 0),
        durationMs: Number(event.duration_ms || 0),
        ...(Number.isFinite(Number(event.tokens_per_second)) ? { tokensPerSecond: Number(event.tokens_per_second) } : {}),
        model: typeof event.model === "string" ? event.model : "",
      };
    }
    if (event.type === "truncated"
      || event.choices?.some((choice) => choice.finish_reason === "length")
      || event.candidates?.some((candidate) => candidate.finishReason === "MAX_TOKENS")
      || event.type === "message_delta" && event.delta?.stop_reason === "max_tokens") {
      event.myaiTruncated = true;
    }
    if (event.type === "route" && typeof event.provider === "string"
      && typeof event.model === "string") {
      event.myaiRoute = {
        provider: event.provider,
        model: event.model,
        modelName: typeof event.modelName === "string" ? event.modelName : event.model,
        fromProvider: typeof event.fromProvider === "string" ? event.fromProvider : "",
        fromModel: typeof event.fromModel === "string" ? event.fromModel : "",
        message: typeof event.message === "string" ? event.message : "",
      };
    }
    if (event.type === "fallback") {
      event.myaiFallback = {
        provider: typeof event.provider === "string" ? event.provider : "",
        model: typeof event.model === "string" ? event.model : "",
        modelName: typeof event.modelName === "string" ? event.modelName : "",
        message: typeof event.message === "string" ? event.message : "",
      };
    }
    if (event.type === "provider-health" && typeof event.provider === "string"
      && ["CHECKING", "HEALTHY", "DEGRADED", "EXHAUSTED", "ERROR", "UNREACHABLE"].includes(event.status)) {
      event.myaiProviderHealth = {
        provider: event.provider,
        model: typeof event.model === "string" ? event.model : "",
        status: event.status,
        detail: typeof event.detail === "string" ? event.detail : "",
        latencyMs: Number.isFinite(Number(event.latencyMs)) ? Number(event.latencyMs) : undefined,
      };
    }
    return event;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      requestGuard?.touch();
      if (done) {
        buf += decoder.decode();
        complete = true;
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const event = parseLine(line);
        if (event?.done) {
          complete = true;
          return;
        }
        if (event) yield event;
      }
    }
    const event = parseLine(buf.trim());
    if (event && !event.done) yield event;
  } finally {
    try {
      if (!complete) {
        try {
          await reader.cancel();
        } catch {}
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export async function listServerModels(authToken, { includeCatalog = false, force = false, cacheKey = "" } = {}) {
  if (!AI_API_URL) throw new Error("URL API Cloudflare Pages belum diatur di js/config.js.");
  if (!authToken) throw new Error("Masuk dengan akun untuk memuat API AI server.");
  if (!force && serverModelsCache?.authToken === authToken && Date.now() < serverModelsCache.expiresAt) {
    return serverModelsCache.promise;
  }
  const storageKey = cacheKey
    ? `${MODEL_STORAGE_PREFIX}_user_${encodeURIComponent(cacheKey)}_${includeCatalog ? "catalog" : "models"}`
    : "";
  const storedCatalog = storageKey ? readStoredCatalog(storageKey) : null;
  if (!force && storageKey) {
    if (storedCatalog) {
      serverModelsCache = {
        authToken,
        expiresAt: Date.now() + SERVER_MODELS_CACHE_MS,
        promise: Promise.resolve({ providers: storedCatalog.providers || [], groups: storedCatalog.groups, errors: [] }),
      };
      return serverModelsCache.promise;
    }
  }
  const promise = (async () => {
    const apiBase = AI_API_URL.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_MODEL_TIMEOUT_MS);
    let response;
    try {
      response = await fetchAiApi("models", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ includeCatalog }),
        signal: controller.signal,
      }, { baseUrl: apiBase });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Koneksi ke API Cloudflare Pages melewati batas 45 detik. Coba muat ulang dan periksa status Pages.");
      }
      if (error instanceof TypeError) {
        throw new Error("API Cloudflare Pages tidak dapat dijangkau (DNS, koneksi, atau CORS). Periksa koneksi dan status website.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(await errorText(response));
    const result = await response.json();
    if (!Array.isArray(result.providers) || !Array.isArray(result.groups) || !Array.isArray(result.errors)) {
      throw new Error("Respons katalog dari Cloudflare Worker tidak valid.");
    }
    if (storageKey) storeCatalog(storageKey, result);
    return result;
  })();
  serverModelsCache = {
    authToken,
    expiresAt: Date.now() + SERVER_MODELS_CACHE_MS,
    promise,
  };
  try {
    return await promise;
  } catch (error) {
    if (serverModelsCache?.promise === promise) serverModelsCache = null;
    if (storedCatalog) {
      console.warn("MyAI model catalog refresh failed; using the saved catalog.", error);
      return { providers: storedCatalog.providers || [], groups: storedCatalog.groups, errors: [error.message || String(error)] };
    }
    throw error;
  }
}

export async function listGuestModels({ force = false } = {}) {
  const storageKey = `${MODEL_STORAGE_PREFIX}_guest`;
  const storedCatalog = readStoredCatalog(storageKey);
  if (force) guestModelsPromise = null;
  if (!force) {
    if (storedCatalog) {
      guestModelsPromise = Promise.resolve({ groups: storedCatalog.groups, remaining: null, errors: [] });
      return guestModelsPromise;
    }
  }
  if (guestModelsPromise) return guestModelsPromise;
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  guestModelsPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_MODEL_TIMEOUT_MS);
    let response;
    try {
      response = await fetchAiApi("guest/models", {
        method: "POST",
        headers: await guestRequestHeaders(apiBase),
        body: "{}",
        signal: controller.signal,
      }, { baseUrl: apiBase });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Katalog AI guest melewati batas waktu 45 detik.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(await errorText(response));
    const result = await response.json();
    if (!Array.isArray(result.groups) || !Number.isInteger(result.remaining) || result.remaining < 0 || result.remaining > 2
      || (result.errors !== undefined && !Array.isArray(result.errors))) {
      throw new Error("Katalog AI guest tidak valid.");
    }
    storeCatalog(storageKey, result);
    return { groups: result.groups, remaining: result.remaining, errors: result.errors || [] };
  })();
  try {
    return await guestModelsPromise;
  } catch (error) {
    guestModelsPromise = null;
    if (/TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|Konfigurasi verifikasi AI guest/i.test(error?.message || "")) {
      throw error;
    }
    if (storedCatalog) {
      console.warn("MyAI guest model catalog refresh failed; using the saved catalog.", error);
      return { groups: storedCatalog.groups, remaining: null, errors: [error.message || String(error)] };
    }
    throw error;
  }
}

async function* guestStream(model, messages, opts, signal) {
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  const body = JSON.stringify({
    model,
    messages: fitGuestMessages(messages),
    temperature: Math.min(0.7, opts.temperature),
    webSearch: opts.webSearch === true,
    researchMode: opts.researchMode === true,
    customInstructions: opts.customInstructions,
  });
  if (new TextEncoder().encode(body).byteLength > 2 * 1024 * 1024) {
    throw new Error("Prompt AI guest terlalu besar. Ringkas teks atau kurangi gambar.");
  }
  const response = await fetchAiApi("guest/chat", {
    method: "POST",
    signal,
  headers: await guestRequestHeaders(apiBase),
    body,
  }, { baseUrl: apiBase });
  if (!response.ok) throw new Error(await errorText(response));
  const remaining = Number(response.headers.get("X-Guest-Remaining"));
  if (Number.isInteger(remaining) && remaining >= 0 && remaining <= 2) {
    yield {
      guestRemaining: remaining,
      ...(remaining === 0 ? { notice: "Jatah dua penggunaan AI gratis tanpa login sudah digunakan. Masuk dengan Google untuk melanjutkan." } : {}),
    };
  }
  for await (const chunk of readSSE(response, opts.requestGuard)) {
    if (chunk.error) throw new Error(chunk.error.message || "AI guest gagal menjawab.");
    if (chunk.myaiUsage) yield { usage: chunk.myaiUsage };
    if (chunk.myaiMetrics) yield { metrics: chunk.myaiMetrics };
    if (chunk.myaiTruncated) yield { truncated: true };
    if (chunk.myaiRoute) yield { route: chunk.myaiRoute };
    if (chunk.myaiFallback) yield { fallback: chunk.myaiFallback };
    if (chunk.myaiProviderHealth) yield { providerHealth: chunk.myaiProviderHealth };
    const annotations = chunk.choices?.[0]?.delta?.annotations || chunk.choices?.[0]?.message?.annotations || [];
    for (const annotation of annotations) {
      if (annotation.type === "url_citation" && annotation.url_citation?.url) {
        yield { citation: { url: annotation.url_citation.url, title: annotation.url_citation.title } };
      }
    }
    if (chunk.content) {
      yield { content: chunk.content };
      continue;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.reasoning) yield { reasoning: delta.reasoning };
    const content = delta?.content;
    if (typeof content === "string") yield { content };
    else if (Array.isArray(content)) {
      const text = content.filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text).join("");
      if (text) yield { content: text };
    }
  }
}

export async function enhanceImagePrompt(prompt, {
  authToken = "",
  signal,
  autoEnhance = true,
} = {}) {
  const cleaned = cleanImageGenerationPrompt(prompt).slice(0, 1200);
  const fallback = buildFallbackImagePromptPlan(cleaned);
  if (!autoEnhance) {
    return { ...fallback, enhanced: false, enhancer: "disabled", reason: "Penyempurnaan otomatis dimatikan." };
  }
  if (!AI_API_URL || !authToken) {
    return { ...fallback, enhanced: false, enhancer: "local", reason: "Dipakai prompt lokal karena sesi enhancer tidak tersedia." };
  }
  try {
    const response = await fetchAiApi("enhance-prompt", {
      method: "POST",
      signal: signal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "image", prompt: cleaned }),
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      return { ...fallback, enhanced: false, enhancer: "local", reason: "Penyempurna AI tidak tersedia; prompt lokal digunakan." };
    }
    const result = await response.json();
    const plan = validateImagePromptPlan(result, cleaned);
    return {
      ...plan,
      enhanced: result.enhanced === true && plan.prompt !== fallback.prompt,
      enhancer: MODEL_MENU_PROVIDERS.includes(result.enhancer) ? result.enhancer : "local",
      enhancerModel: typeof result.enhancerModel === "string" ? result.enhancerModel : "deterministic-fallback",
      ...(!result.enhanced ? {
        reason: typeof result.reason === "string"
          ? result.reason
          : "Penyempurnaan AI tidak tersedia; prompt lokal digunakan.",
      } : {}),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ...fallback, enhanced: false, enhancer: "local", reason: "Penyempurna AI tidak terjangkau; prompt lokal digunakan." };
  }
}

export async function transcribeVoiceAudio(audio, { authToken, language, signal } = {}) {
  if (!AI_API_URL) throw new Error("URL API AI belum tersedia.");
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  const form = new FormData();
  form.append("audio", audio, audio.name || "myai-voice.webm");
  if (language && language !== "auto") {
    form.append("language", language.split("-")[0].toLowerCase());
  }
  return transcribeThroughServer(apiBase, form, authToken, signal);
}

async function transcribeThroughServer(apiBase, form, authToken, signal) {
  const guest = !authToken;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const abortRequest = () => controller.abort();
  signal?.addEventListener("abort", abortRequest, { once: true });
  try {
    const headers = authToken
      ? { Authorization: `Bearer ${authToken}` }
      : await guestRequestHeaders(apiBase, { json: false });
    const response = await fetchAiApi(`${guest ? "guest/" : ""}transcribe`, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    }, { baseUrl: apiBase });
    if (!response.ok) throw new Error(await errorText(response));
    const result = await response.json();
    if (typeof result.text !== "string" || !result.text.trim()) {
      throw new Error("Layanan transkripsi tidak mengembalikan teks.");
    }
    return result.text.trim();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.name === "AbortError") {
      throw new Error("Transkripsi lewat server melewati batas 45 detik.");
    }
    if (error instanceof TypeError) {
      throw new Error("API Worker tidak dapat dijangkau. Periksa koneksi atau deploy Worker terbaru.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortRequest);
  }
}

export async function* streamChat(provider, model, messages, opts, signal) {
  if (provider === "pollinations" || opts?.imageGeneration === true || opts?.generateImage === true) {
    throw new Error("Pembuatan dan edit gambar hanya tersedia melalui Gemini Image di OpenRouter.");
  }
  if (provider === "gemini" || provider === "gateway-gemini") {
    throw new Error("Chat langsung Google Gemini tidak tersedia. Pilih provider lain dari katalog MyAI.");
  }
  const normalizedMessages = normalizeChatMessages(messages);
  const requestGuard = createRequestGuard(signal);
  const guardedOptions = { ...opts, requestGuard };
  try {
    let stream;
    if (provider.startsWith("gateway-")) {
      stream = gatewayStream(provider.slice("gateway-".length), model, normalizedMessages, guardedOptions, requestGuard.signal);
    } else if (provider === "guest") {
      stream = guestStream(model, normalizedMessages, guardedOptions, requestGuard.signal);
    } else if (provider.startsWith("manual-")) {
      throw new Error("Chat teks kini harus memakai model Cloudflare Worker. Pilih model server dari katalog AI.");
    } else {
      stream = serverStream(provider, model, normalizedMessages, guardedOptions, requestGuard.signal);
    }
    for await (const chunk of stream) {
      requestGuard.touch();
      yield chunk;
    }
  } catch (error) {
    if (requestGuard.timedOut) {
      throw new Error(`Koneksi model ${model} tidak menerima data selama ${Math.round(CHAT_STREAM_IDLE_TIMEOUT_MS / 1000)} detik. Coba lagi atau pilih model lain.`);
    }
    throw error;
  } finally {
    requestGuard.cleanup();
  }
}

async function* gatewayStream(provider, model, messages, opts, signal) {
  if (!AI_API_URL) throw new Error("URL API Cloudflare Pages belum diatur di js/config.js.");
  if (!opts.authToken) throw new Error("Masuk dengan akun yang diizinkan untuk memakai AI gateway.");
  const body = JSON.stringify({
    provider,
    model,
    messages,
    temperature: opts.temperature,
    webSearch: opts.webSearch === true,
    researchMode: opts.researchMode === true,
    promptHelper: opts.promptHelper === true && provider === "groq",
    customInstructions: opts.customInstructions,
    allowFallback: true,
    idempotencyKey: opts.idempotencyKey,
  });
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) {
    throw new Error("Permintaan AI gateway maksimal 4 MiB. Hapus beberapa lampiran atau mulai chat baru.");
  }
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  let response;
  const deviceId = getAccountDeviceId();
  try {
    response = await fetchAiApi("gateway", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${opts.authToken}`,
        "Content-Type": "application/json",
        ...(deviceId ? { "X-Device-Id": deviceId } : {}),
      },
      body,
    }, { baseUrl: apiBase });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.name === "AbortError") throw new Error("AI gateway melewati batas waktu. Coba lagi.");
    if (error?.code === "AI_API_UNREACHABLE") throw error;
    throw new Error("AI gateway tidak dapat dijangkau. Periksa route Cloudflare Worker/Pages.");
  }
  if (!response.ok) throw new Error(await errorText(response));
  if (!response.body) throw new Error("AI gateway tidak mengembalikan aliran jawaban.");
  for await (const result of readSSE(response, opts.requestGuard)) {
    if (result.error) throw new Error(result.error.message || "Error dari AI gateway.");
    if (result.myaiUsage) yield { usage: result.myaiUsage };
    if (result.myaiMetrics) yield { metrics: result.myaiMetrics };
    if (result.myaiTruncated) yield { truncated: true };
    if (result.myaiRoute) yield { route: result.myaiRoute };
    if (result.myaiFallback) yield { fallback: result.myaiFallback };
    if (result.myaiProviderHealth) yield { providerHealth: result.myaiProviderHealth };
    const annotations = result.choices?.[0]?.delta?.annotations || [];
    for (const annotation of annotations) {
      if (annotation.type === "url_citation" && annotation.url_citation?.url) {
        yield { citation: { url: annotation.url_citation.url, title: annotation.url_citation.title } };
      }
    }
    const delta = result.choices?.[0]?.delta;
    if (delta?.reasoning) yield { reasoning: delta.reasoning };
    if (delta?.content) yield { content: delta.content };
  }
}

function normalizeUsage(usage) {
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokenCount ?? usage.input_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens ?? 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(usage.total_tokens ?? usage.totalTokenCount ?? promptTokens + completionTokens),
  };
}

async function* serverStream(provider, model, messages, opts, signal) {
  if (!AI_API_URL) throw new Error("URL API Cloudflare Pages belum diatur di js/config.js.");
  if (!opts.authToken) throw new Error("Masuk dengan Google untuk memakai API AI server.");
  const body = JSON.stringify({
    provider,
    model,
    messages,
    temperature: opts.temperature,
    webSearch: opts.webSearch,
    researchMode: opts.researchMode,
    customInstructions: opts.customInstructions,
    idempotencyKey: opts.idempotencyKey,
  });
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) {
    throw new Error("Permintaan online maksimal 4 MiB. Hapus beberapa lampiran atau lanjutkan chat baru.");
  }
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  const deviceId = getAccountDeviceId();
  const response = await fetchAiApi("chat", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${opts.authToken}`,
      "Content-Type": "application/json",
      ...(deviceId ? { "X-Device-Id": deviceId } : {}),
    },
    body,
  }, { baseUrl: apiBase });
  if (!response.ok) throw new Error(await errorText(response));

  if (provider === "modelscope") {
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("ModelScope tidak mengembalikan teks jawaban yang valid.");
    }
    const usage = result.usage || result.usageMetadata;
    if (usage) yield { usage: normalizeUsage(usage) };
    yield { content };
    return;
  }

  if (!response.body) throw new Error("Backend AI tidak mengembalikan aliran jawaban.");
  for await (const result of readSSE(response, opts.requestGuard)) {
    if (result.error) throw new Error(result.error.message || "Error dari server provider.");
    if (result.myaiUsage) yield { usage: result.myaiUsage };
    if (result.myaiMetrics) yield { metrics: result.myaiMetrics };
    if (result.myaiTruncated) yield { truncated: true };
    if (result.myaiRoute) yield { route: result.myaiRoute };
    if (result.myaiFallback) yield { fallback: result.myaiFallback };
    if (result.myaiProviderHealth) yield { providerHealth: result.myaiProviderHealth };
    const annotations = result.choices?.[0]?.delta?.annotations || result.choices?.[0]?.message?.annotations || [];
    for (const annotation of annotations) {
      if (annotation.type === "url_citation" && annotation.url_citation?.url) {
        yield {
          citation: {
            url: annotation.url_citation.url,
            title: annotation.url_citation.title,
          },
        };
      }
    }
    const delta = result.choices?.[0]?.delta;
    if (delta?.reasoning) yield { reasoning: delta.reasoning };
    if (delta?.content) yield { content: delta.content };
  }
}
