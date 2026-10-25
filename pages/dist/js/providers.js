import { AI_API_URL } from "./config.js?v=20261020-v5.29";

const WORKER_MODEL_TIMEOUT_MS = 45000;
const SETTINGS_KEY = "myai_settings";
const LEGACY_DEFAULT_SYSTEM_PROMPT = "Kamu adalah asisten AI yang ramah, cerdas, dan membantu. Berkomunikasilah secara natural, hangat, dan relevan seperti teman bicara yang baik; pahami konteks percakapan sebelumnya dan tanyakan klarifikasi hanya bila memang diperlukan. Jawab dalam bahasa yang dipakai pengguna. Gunakan Markdown untuk format, dan tulis rumus matematika dengan LaTeX ($...$ atau $$...$$).";
export const DEFAULT_SETTINGS = {
  showPaid: false,
  systemPrompt: "Jawablah secara ramah, jelas, dan natural. Utamakan jawaban yang sesuai kebutuhan pengguna.",
  temperature: 0.7,
  about: "",
  persona: "balanced",
  responseLength: "balanced",
  enterToSend: true,
  autoSpeak: false,
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
        systemPrompt: typeof saved.systemPrompt === "string" && saved.systemPrompt !== LEGACY_DEFAULT_SYSTEM_PROMPT
          ? saved.systemPrompt
          : DEFAULT_SETTINGS.systemPrompt,
        temperature: Number.isFinite(Number(saved.temperature)) ? Math.min(1.5, Math.max(0, Number(saved.temperature))) : DEFAULT_SETTINGS.temperature,
        about: typeof saved.about === "string" ? saved.about.slice(0, 1500) : "",
        persona: ["balanced", "tutor", "professional", "coding", "creative"].includes(saved.persona) ? saved.persona : DEFAULT_SETTINGS.persona,
        responseLength: ["concise", "balanced", "detailed"].includes(saved.responseLength) ? saved.responseLength : DEFAULT_SETTINGS.responseLength,
        enterToSend: saved.enterToSend !== false,
        autoSpeak: saved.autoSpeak === true,
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
    persona: ["balanced", "tutor", "professional", "coding", "creative"].includes(s.persona) ? s.persona : DEFAULT_SETTINGS.persona,
    responseLength: ["concise", "balanced", "detailed"].includes(s.responseLength) ? s.responseLength : DEFAULT_SETTINGS.responseLength,
    enterToSend: s.enterToSend !== false,
    autoSpeak: s.autoSpeak === true,
  }));
}

const GUEST_CHAR_BUDGET = 5800;
const SERVER_MODELS_CACHE_MS = 5 * 60 * 1000;
let guestModelsPromise = null;
let serverModelsCache = null;

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
    return `${res.status}: ${message || j.message || raw}`;
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

async function* readSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
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
    return event;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buf += decoder.decode();
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const event = parseLine(line);
        if (event?.done) return;
        if (event) yield event;
      }
    }
    const event = parseLine(buf.trim());
    if (event && !event.done) yield event;
  } finally {
    reader.releaseLock();
  }
}

export async function listServerModels(authToken, { includeCatalog = false, force = false } = {}) {
  if (!AI_API_URL) throw new Error("URL API Cloudflare Pages belum diatur di js/config.js.");
  if (!authToken) throw new Error("Masuk dengan akun untuk memuat API AI server.");
  if (!force && serverModelsCache?.authToken === authToken && Date.now() < serverModelsCache.expiresAt) {
    return serverModelsCache.promise;
  }
  const promise = (async () => {
    const apiBase = AI_API_URL.replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_MODEL_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${apiBase}/models`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ includeCatalog }),
        signal: controller.signal,
      });
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
    throw error;
  }
}

export async function listGuestModels() {
  if (guestModelsPromise) return guestModelsPromise;
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  guestModelsPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_MODEL_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${apiBase}/guest/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
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
    return { groups: result.groups, remaining: result.remaining, errors: result.errors || [] };
  })();
  try {
    return await guestModelsPromise;
  } catch (error) {
    guestModelsPromise = null;
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
  });
  if (new TextEncoder().encode(body).byteLength > 2 * 1024 * 1024) {
    throw new Error("Prompt AI guest terlalu besar. Ringkas teks atau kurangi gambar.");
  }
  const response = await fetch(`${apiBase}/guest/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) throw new Error(await errorText(response));
  const remaining = Number(response.headers.get("X-Guest-Remaining"));
  if (Number.isInteger(remaining) && remaining >= 0 && remaining <= 2) {
    yield {
      guestRemaining: remaining,
      ...(remaining === 0 ? { notice: "Jatah dua jawaban AI gratis tanpa login sudah digunakan. Masuk dengan Google untuk melanjutkan." } : {}),
    };
  }
  for await (const chunk of readSSE(response)) {
    if (chunk.error) throw new Error(chunk.error.message || "AI guest gagal menjawab.");
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
    const geminiParts = chunk.candidates?.[0]?.content?.parts || [];
    for (const source of chunk.candidates?.[0]?.groundingMetadata?.groundingChunks || []) {
      if (source.web?.uri) yield { citation: { url: source.web.uri, title: source.web.title } };
    }
    if (geminiParts.length) {
      for (const part of geminiParts) {
        if (part.text) yield part.thought ? { reasoning: part.text } : { content: part.text };
      }
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

function pollinationsSize(prompt) {
  if (/\b(landscape|lanskap|wide|lebar|banner|wallpaper desktop|16:9|pemandangan)\b/i.test(prompt)) return [1344, 768];
  if (/\b(portrait|potret|vertikal|vertical|poster|story|9:16|wallpaper hp)\b/i.test(prompt)) return [768, 1344];
  return [1024, 1024];
}

async function* pollinationsStream(model, messages, opts, signal) {
  const userPrompt = String([...messages].reverse().find((message) => message.role === "user")?.content || "").trim().slice(0, 1200);
  if (!userPrompt) throw new Error("Tulis deskripsi gambar terlebih dahulu.");
  const personalization = String(opts?.imagePromptContext || "").trim().slice(0, 500);
  const prompt = [userPrompt, personalization].filter(Boolean).join("\n\n");
  const [width, height] = pollinationsSize(userPrompt);
  const authToken = opts?.authToken || "";
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  const abortRequest = () => controller.abort();
  signal?.addEventListener("abort", abortRequest, { once: true });
  let image;
  try {
    const response = await fetch(`${apiBase}/${authToken ? "" : "guest/"}images/pollinations`, {
      method: "POST",
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, model, width, height }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await errorText(response));
    if (!response.headers.get("Content-Type")?.startsWith("image/")) {
      throw new Error("API gambar Cloudflare mengembalikan format yang tidak valid.");
    }
    image = await response.blob();
    if (!image.size || image.size > 10 * 1024 * 1024) {
      throw new Error("Ukuran gambar dari layanan gratis tidak didukung.");
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.name === "AbortError") throw new Error("Pembuatan gambar gratis melewati batas 90 detik.");
    if (error instanceof TypeError) throw new Error("API gambar Cloudflare tidak dapat dijangkau.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortRequest);
  }
  yield { image };
  yield { content: `Gambar dibuat dari prompt: *${userPrompt.replace(/[*_`]/g, "")}*` };
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
    const response = await fetch(`${apiBase}/${guest ? "guest/" : ""}transcribe`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
      signal: controller.signal,
    });
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

export function streamChat(provider, model, messages, opts, signal) {
  if (provider.startsWith("gateway-")) {
    return gatewayStream(provider.slice("gateway-".length), model, messages, opts, signal);
  }
  if (provider === "pollinations") return pollinationsStream(model, messages, opts, signal);
  if (provider === "guest") return guestStream(model, messages, opts, signal);
  if (provider.startsWith("manual-")) {
    throw new Error("Chat teks kini harus memakai model Cloudflare Worker. Pilih model server dari katalog AI.");
  }
  return serverStream(provider, model, messages, opts, signal);
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
  });
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) {
    throw new Error("Permintaan AI gateway maksimal 4 MiB. Hapus beberapa lampiran atau mulai chat baru.");
  }
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${apiBase}/gateway`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${opts.authToken}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.name === "AbortError") throw new Error("AI gateway melewati batas waktu. Coba lagi.");
    throw new Error("AI gateway tidak dapat dijangkau. Periksa route Cloudflare Worker/Pages.");
  }
  if (!response.ok) throw new Error(await errorText(response));
  if (!response.body) throw new Error("AI gateway tidak mengembalikan aliran jawaban.");
  for await (const result of readSSE(response)) {
    if (result.error) throw new Error(result.error.message || "Error dari AI gateway.");
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
    imageGeneration: opts.imageGeneration,
  });
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) {
    throw new Error("Permintaan online maksimal 4 MiB. Hapus beberapa lampiran atau lanjutkan chat baru.");
  }
  const apiBase = AI_API_URL.replace(/\/+$/, "");
  const response = await fetch(`${apiBase}/chat`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${opts.authToken}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!response.ok) throw new Error(await errorText(response));

  if (opts.imageGeneration) {
    const result = await response.json();
    let hasImage = false;
    for (const item of result.data || []) {
      if (item.b64_json) {
        hasImage = true;
        yield { image: `data:${item.media_type || "image/png"};base64,${item.b64_json}` };
      } else if (item.url && /^https?:\/\//i.test(item.url)) {
        hasImage = true;
        yield { image: item.url };
      }
    }
    if (!hasImage) throw new Error("OpenRouter tidak mengembalikan gambar. Coba model lain atau periksa akses akun.");
    return;
  }

  if (provider === "modelscope") {
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("ModelScope tidak mengembalikan teks jawaban yang valid.");
    }
    yield { content };
    return;
  }

  if (!response.body) throw new Error("Backend AI tidak mengembalikan aliran jawaban.");
  if (provider === "gemini") {
    const cited = new Set();
    for await (const result of readSSE(response)) {
      for (const part of result.candidates?.[0]?.content?.parts || []) {
        if (!part.text) continue;
        if (part.thought) yield { reasoning: part.text };
        else yield { content: part.text };
      }
      for (const source of result.candidates?.[0]?.groundingMetadata?.groundingChunks || []) {
        if (source.web?.uri && !cited.has(source.web.uri)) {
          cited.add(source.web.uri);
          yield { citation: { url: source.web.uri, title: source.web.title } };
        }
      }
    }
    return;
  }

  for await (const result of readSSE(response)) {
    if (result.error) throw new Error(result.error.message || "Error dari server provider.");
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
