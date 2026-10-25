"use strict";

const { getAuth } = require("firebase-admin/auth");
const { initializeApp } = require("firebase-admin/app");
const { defineSecret, defineString } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");

initializeApp();

const REGION = "us-central1";
const PROVIDER_KEYS = defineSecret("AI_PROVIDER_KEYS");
const AUTHORIZED_EMAILS = defineString("AUTHORIZED_EMAILS", { default: "" });
const PROVIDERS = ["gemini", "groq", "openrouter", "nvidia", "modelscope", "deepseek", "llm7"];
const OPENAI_ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  modelscope: "https://api-inference.modelscope.cn/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  llm7: "https://api.llm7.io/v1/chat/completions",
};
const REQUEST_LIMIT_BYTES = 25 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readProviderKeys() {
  const raw = PROVIDER_KEYS.value();
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(500, "Konfigurasi AI_PROVIDER_KEYS harus berupa JSON yang valid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(500, "Konfigurasi AI_PROVIDER_KEYS harus berupa objek JSON.");
  }

  for (const name of Object.keys(parsed)) {
    if (!PROVIDERS.includes(name)) {
      throw new HttpError(500, `Provider "${name}" tidak dikenal di AI_PROVIDER_KEYS.`);
    }
    if (parsed[name] !== "" && typeof parsed[name] !== "string") {
      throw new HttpError(500, `Nilai key untuk "${name}" harus berupa teks.`);
    }
  }

  return Object.fromEntries(
    PROVIDERS
      .filter((name) => typeof parsed[name] === "string" && parsed[name].trim())
      .map((name) => [name, parsed[name].trim()])
  );
}

async function requireAuthorizedUser(req) {
  const header = req.get("authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Masuk dengan Google terlebih dahulu.");

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch (error) {
    console.warn("Firebase ID token rejected:", error?.code || "unknown");
    throw new HttpError(401, "Sesi Firebase tidak valid. Keluar lalu masuk kembali.");
  }

  const allowed = new Set(
    AUTHORIZED_EMAILS.value().split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
  );
  if (!allowed.size) {
    throw new HttpError(503, "Admin belum mengatur AUTHORIZED_EMAILS pada Firebase Functions.");
  }

  const email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : "";
  if (!decoded.email_verified || !allowed.has(email)) {
    throw new HttpError(403, "Akun Google ini belum diizinkan memakai API AI server.");
  }
}

function parseRequestBody(req) {
  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      throw new HttpError(400, "Isi permintaan harus berupa JSON yang valid.");
    }
  }
  throw new HttpError(400, "Isi permintaan JSON tidak ditemukan.");
}

function replaceGroup(groups, provider, label, tag, models) {
  if (!models.length) return;
  const existing = groups.find((group) => group.provider === provider && group.label === label);
  if (existing) {
    existing.tag = tag;
    existing.models = models;
  } else {
    groups.push({ provider, label, tag, models });
  }
}

function buildDefaultGroups(keys, showPaid) {
  const groups = [];

  if (keys.openrouter) {
    groups.push({
      provider: "openrouter",
      label: "Qwen Super Cepat (Utama)",
      tag: "Default · gratis & cepat",
      models: [
        { id: "qwen/qwen3-8b:free", name: "Qwen3 8B · super cepat" },
        { id: "qwen/qwq-32b:free", name: "Qwen QwQ 32B · reasoning gratis" },
      ],
    });
    groups.push({
      provider: "openrouter",
      label: "OpenRouter Gratis",
      tag: "Model gratis yang tersedia",
      models: [{ id: "openrouter/auto", name: "Auto (model terbaik gratis/termurah)" }],
    });
    if (showPaid) {
      groups.push({
        provider: "openrouter",
        label: "OpenRouter Premium",
        tag: "Biaya provider berlaku",
        models: [
          { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
          { id: "openai/gpt-4.1", name: "GPT-4.1" },
        ],
      });
    }
  }
  if (keys.deepseek) {
    groups.push({
      provider: "deepseek",
      label: "DeepSeek",
      tag: "DeepSeek API",
      models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
    });
  }
  if (keys.llm7) {
    groups.push({
      provider: "llm7",
      label: "LLM7",
      tag: "LLM7 API",
      models: [{ id: "qwen/qwen3-8b", name: "Qwen3 8B" }],
    });
  }
  if (keys.gemini) {
    groups.push({
      provider: "gemini",
      label: "Google Gemini Gratis",
      tag: "Kuota gratis Google AI Studio",
      models: [{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }],
    });
  }
  if (keys.groq) {
    groups.push({
      provider: "groq",
      label: "Groq Gratis",
      tag: "Kuota gratis Groq",
      models: [{ id: "qwen/qwen3-32b", name: "Qwen3 32B · super cepat" }],
    });
  }
  if (keys.nvidia) {
    groups.push({
      provider: "nvidia",
      label: "NVIDIA Gratis",
      tag: "NVIDIA NIM · kuota gratis provider",
      models: [{ id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct" }],
    });
  }
  if (keys.modelscope) {
    groups.push({
      provider: "modelscope",
      label: "ModelScope Gratis",
      tag: "DeepSeek V4.1 Flash · kuota ModelScope",
      models: [{ id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash" }],
    });
  }

  return groups;
}

async function catalogFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("Request katalog melewati batas waktu 12 detik.");
    }
    throw new Error("API katalog tidak dapat dijangkau. Periksa koneksi provider.");
  }
}

async function upstreamErrorMessage(response, key = "") {
  const raw = await response.text();
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    message = parsed.error?.message || parsed.message || parsed.detail || raw;
  } catch {
    message = raw;
  }
  if (key) message = message.split(key).join("[redacted]");
  return message.slice(0, 1200) || `HTTP ${response.status}`;
}

async function listOpenRouterModels() {
  const response = await catalogFetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error(`OpenRouter: ${await upstreamErrorMessage(response)}`);
  const { data = [] } = await response.json();
  const free = [];
  const paid = [];

  for (const model of data) {
    const modalities = model.architecture?.output_modalities || ["text"];
    if (modalities.some((modality) => modality !== "text") || /safety|guard|:batch/i.test(model.id)) continue;
    const promptPrice = Number(model.pricing?.prompt);
    const completionPrice = Number(model.pricing?.completion);
    const item = {
      id: model.id,
      name: (model.name || model.id).replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)$/i, ""),
    };
    if (promptPrice === 0 && completionPrice === 0) free.push(item);
    else if (promptPrice > 0 || completionPrice > 0) paid.push(item);
  }
  return { free, paid };
}

async function listOpenRouterImageModels() {
  const response = await catalogFetch("https://openrouter.ai/api/v1/images/models");
  if (!response.ok) throw new Error(`OpenRouter Image: ${await upstreamErrorMessage(response)}`);
  const { data = [] } = await response.json();
  return data
    .filter((model) => model.id && model.architecture?.output_modalities?.includes("image"))
    .map((model) => ({ id: model.id, name: model.name || model.id, imageGeneration: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listGeminiModels(key) {
  const response = await catalogFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    headers: { "x-goog-api-key": key },
  });
  if (!response.ok) throw new Error(`Gemini: ${await upstreamErrorMessage(response, key)}`);
  const { models = [] } = await response.json();
  return models
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .filter((model) => /gemini|gemma/i.test(model.name) && !/tts|image|embedding|live|native-audio|robotics|computer-use/i.test(model.name))
    .map((model) => ({
      id: model.name.replace(/^models\//, ""),
      name: model.displayName || model.name,
    }))
    .sort((left, right) => right.id.localeCompare(left.id));
}

async function listGroqModels(key) {
  const response = await catalogFetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Groq: ${await upstreamErrorMessage(response, key)}`);
  const { data = [] } = await response.json();
  return data
    .filter((model) => !/whisper|tts|guard|playai|orpheus/i.test(model.id))
    .map((model) => ({ id: model.id, name: model.id }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadCatalogs(groups, keys, showPaid) {
  const jobs = [];
  const errors = [];

  if (keys.openrouter) {
    jobs.push({
      label: "OpenRouter",
      load: listOpenRouterModels,
      apply: ({ free, paid }) => {
        replaceGroup(groups, "openrouter", "OpenRouter Gratis", "Katalog API gratis", free);
        if (showPaid) replaceGroup(groups, "openrouter", "OpenRouter Premium", "Katalog API berbayar", paid);
      },
    });
    jobs.push({
      label: "OpenRouter Image",
      load: listOpenRouterImageModels,
      apply: (models) => replaceGroup(groups, "openrouter-image", "OpenRouter Image", "Katalog API gambar", models),
    });
  }
  if (keys.gemini) {
    jobs.push({
      label: "Google Gemini",
      load: () => listGeminiModels(keys.gemini),
      apply: (models) => replaceGroup(groups, "gemini", "Google Gemini Gratis", "Katalog API Gemini", models),
    });
  }
  if (keys.groq) {
    jobs.push({
      label: "Groq",
      load: () => listGroqModels(keys.groq),
      apply: (models) => replaceGroup(groups, "groq", "Groq Gratis", "Katalog API Groq", models),
    });
  }

  const results = await Promise.allSettled(jobs.map((job) => job.load()));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      jobs[index].apply(result.value);
    } else {
      errors.push(`${jobs[index].label}: ${result.reason?.message || "gagal memuat katalog."}`);
    }
  });
  return errors;
}

async function getModels(req, res, keys) {
  if (req.method !== "POST") throw new HttpError(405, "Gunakan POST untuk memuat katalog model.");
  const body = parseRequestBody(req);
  const showPaid = body.showPaid === true;
  const groups = buildDefaultGroups(keys, showPaid);
  const errors = body.includeCatalog === true ? await loadCatalogs(groups, keys, showPaid) : [];

  res.json({
    providers: PROVIDERS.filter((provider) => Boolean(keys[provider])),
    groups: groups.filter((group) => group.models.length),
    errors,
  });
}

function imageReference(url) {
  if (typeof url !== "string" || (!/^data:image\/[^;]+;base64,/i.test(url) && !/^https:\/\/[^/]/i.test(url))) {
    throw new HttpError(400, "Format lampiran gambar tidak valid.");
  }
  return { type: "image_url", image_url: { url } };
}

function validateChatBody(body) {
  const provider = body.provider;
  if (!PROVIDERS.includes(provider) && provider !== "openrouter-image") {
    throw new HttpError(400, "Provider AI tidak dikenal.");
  }
  if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 300) {
    throw new HttpError(400, "Model AI tidak valid.");
  }
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 120) {
    throw new HttpError(400, "Daftar pesan tidak valid.");
  }

  const messages = body.messages.map((message) => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new HttpError(400, "Format pesan tidak valid.");
    }
    const images = Array.isArray(message.images) ? message.images : [];
    if (images.length > 10) throw new HttpError(400, "Maksimal 10 gambar per pesan.");
    return {
      role: message.role,
      content: message.content,
      ...(images.length ? { images } : {}),
    };
  });

  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > REQUEST_LIMIT_BYTES) {
    throw new HttpError(413, "Ukuran permintaan terlalu besar. Kurangi lampiran atau gambar.");
  }

  const imageGeneration = body.imageGeneration === true;
  if (imageGeneration && provider !== "openrouter-image") {
    throw new HttpError(400, "Generasi gambar hanya tersedia melalui model gambar OpenRouter.");
  }
  if (provider === "openrouter-image" && !imageGeneration) {
    throw new HttpError(400, "Pilih mode Gambar untuk memakai model gambar OpenRouter.");
  }
  if (body.webSearch === true && provider !== "openrouter") {
    throw new HttpError(400, "Pencarian web memerlukan provider OpenRouter.");
  }

  return {
    provider,
    model: body.model.trim(),
    messages,
    temperature: Number.isFinite(Number(body.temperature))
      ? Math.max(0, Math.min(2, Number(body.temperature)))
      : 0.7,
    webSearch: body.webSearch === true,
    researchMode: body.researchMode === true,
    imageGeneration,
  };
}

async function providerFetch(url, options, provider, controller) {
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new HttpError(504, `${provider}: permintaan melewati batas waktu.`);
    }
    throw new HttpError(502, `${provider}: API provider tidak dapat dijangkau.`);
  }
}

async function sendProviderError(res, provider, response, key) {
  const message = await upstreamErrorMessage(response, key);
  res.status(response.status).json({ error: { message: `${provider}: ${message}` } });
}

async function streamUpstream(response, res) {
  res.status(response.status);
  res.set("Content-Type", response.headers.get("content-type") || "text/event-stream; charset=utf-8");
  res.set("Cache-Control", "no-cache, no-transform");
  res.set("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  if (!response.body) {
    res.end();
    return;
  }

  for await (const chunk of response.body) {
    if (res.destroyed) return;
    if (!res.write(Buffer.from(chunk))) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  }
  if (!res.writableEnded) res.end();
}

function geminiRequestBody(messages, input) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      { text: message.content },
      ...(message.images || []).map((image) => {
        const match = image.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new HttpError(400, "Gemini menerima lampiran gambar dalam format data URL.");
        return { inlineData: { mimeType: match[1], data: match[2] } };
      }),
    ],
  }));
  return {
    contents,
    generationConfig: { temperature: input.temperature },
    ...(input.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

function openAIRequestBody(input) {
  const messages = input.messages.map((message) => {
    const { images, ...plainMessage } = message;
    if (!images?.length) return plainMessage;
    return {
      ...plainMessage,
      content: [
        { type: "text", text: message.content },
        ...images.map(imageReference),
      ],
    };
  });
  return {
    model: input.model,
    messages,
    stream: input.provider !== "modelscope",
    temperature: input.temperature,
    ...(input.webSearch && input.provider === "openrouter"
      ? { plugins: [{ id: "web", max_results: input.researchMode ? 10 : 5 }] }
      : {}),
  };
}

async function sendImageRequest(req, res, input, keys, controller) {
  const key = keys.openrouter;
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const userMessages = input.messages.filter((message) => message.role === "user");
  const prompt = [system, ...userMessages.map((message) => message.content)].filter(Boolean).join("\n\n");
  const references = userMessages.flatMap((message) => message.images || []).map(imageReference);
  const origin = req.get("origin");
  const response = await providerFetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: input.model,
      prompt,
      output_format: "png",
      ...(references.length ? { input_references: references } : {}),
    }),
  }, "OpenRouter", controller);

  if (!response.ok) return sendProviderError(res, "OpenRouter", response, key);
  const result = await response.json();
  if (!Array.isArray(result.data) || !result.data.some((item) => item.b64_json || item.url)) {
    throw new HttpError(502, "OpenRouter tidak mengembalikan gambar. Coba model lain atau periksa akses akun.");
  }
  res.json(result);
}

async function sendGeminiRequest(res, input, key, controller) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`;
  const response = await providerFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(geminiRequestBody(input.messages, input)),
  }, "Gemini", controller);
  if (!response.ok) return sendProviderError(res, "Gemini", response, key);
  await streamUpstream(response, res);
}

async function sendOpenAIRequest(req, res, input, key, controller) {
  const url = OPENAI_ENDPOINTS[input.provider];
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (input.provider === "openrouter") {
    headers["HTTP-Referer"] = req.get("origin") || "https://localhost";
    headers["X-Title"] = "MyAI";
  }
  const body = openAIRequestBody(input);
  let response = await providerFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, input.provider, controller);

  if (input.provider === "groq" && [413, 429].includes(response.status)) {
    const error = await response.clone().text();
    const limit = Number(error.match(/output tokens per minute[^]*?Limit (\d+)/i)?.[1]);
    if (limit) {
      response = await providerFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, max_tokens: Math.floor(limit * 0.9) }),
      }, input.provider, controller);
    }
  }

  if (!response.ok) return sendProviderError(res, input.provider, response, key);
  if (input.provider === "modelscope") {
    let result;
    try {
      result = await response.json();
    } catch {
      throw new HttpError(502, "ModelScope mengembalikan respons yang tidak valid.");
    }
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new HttpError(502, "ModelScope tidak mengembalikan teks jawaban yang valid.");
    }
    res.json(result);
    return;
  }
  await streamUpstream(response, res);
}

async function chat(req, res, keys) {
  if (req.method !== "POST") throw new HttpError(405, "Gunakan POST untuk mengirim chat.");
  const input = validateChatBody(parseRequestBody(req));
  const keyProvider = input.provider === "openrouter-image" ? "openrouter" : input.provider;
  const key = keys[keyProvider];
  if (!key) throw new HttpError(400, `Provider ${keyProvider} belum dikonfigurasi di Firebase Secret Manager.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (input.imageGeneration) {
      await sendImageRequest(req, res, input, keys, controller);
    } else if (input.provider === "gemini") {
      await sendGeminiRequest(res, input, key, controller);
    } else {
      await sendOpenAIRequest(req, res, input, key, controller);
    }
  } finally {
    clearTimeout(timeout);
  }
}

exports.aiApi = onRequest(
  {
    region: REGION,
    cors: true,
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [PROVIDER_KEYS],
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    try {
      await requireAuthorizedUser(req);
      const keys = readProviderKeys();
      const route = req.path.split("/").filter(Boolean).pop() || "";
      if (route === "models") {
        await getModels(req, res, keys);
        return;
      }
      if (route === "chat") {
        await chat(req, res, keys);
        return;
      }
      throw new HttpError(404, "Endpoint AI tidak ditemukan.");
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) console.error("AI API request failed:", error?.name || "Error");
      res.status(status).json({
        error: {
          message: error instanceof HttpError ? error.message : "Terjadi kesalahan pada backend AI.",
        },
      });
    }
  }
);
