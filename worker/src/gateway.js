const GATEWAY_PROVIDERS = {
  gemini: { label: "Google Gemini · Gateway", keyName: "GEMINI_API_KEY" },
  groq: { label: "Groq · Gateway", keyName: "GROQ_API_KEY" },
  openrouter: { label: "OpenRouter · Gateway", keyName: "OPENROUTER_API_KEY" },
  nvidia: { label: "NVIDIA NIM", keyName: "NVIDIA_API_KEY or NVIDIA_NIM_API_KEY" },
};
const GATEWAY_LABELS = {
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  nvidia: "NVIDIA",
};
const GATEWAY_FALLBACK_PRIORITY = ["groq", "gemini", "nvidia", "openrouter"];
const BUILTIN_TEXT_FALLBACKS = {
  groq: {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    accessTier: "free",
    priceTier: "check",
  },
  gemini: {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    accessTier: "free",
    priceTier: "check",
    imageSupport: true,
  },
};
const GATEWAY_CATALOG_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_CHARS = 1_500_000;
const UPSTREAM_CONNECT_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_ATTEMPTS = 2;
const PROVIDER_RETRY_BACKOFF_MS = 1_000;
const UPSTREAM_IDLE_TIMEOUT_MS = 30_000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const catalogCache = new Map();
const modelHealth = new Map();
export function clearGatewayCatalogCache(provider) {
  if (provider) {
    catalogCache.delete(provider);
    for (const key of modelHealth.keys()) {
      if (key.startsWith(`${provider}::`)) modelHealth.delete(key);
    }
  } else {
    catalogCache.clear();
    modelHealth.clear();
  }
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

class GatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OPENAI_COMPATIBLE_PROVIDER_URLS = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
};

function providerCatalogHeaders(provider, key) {
  if (provider === "gemini") return { "x-goog-api-key": key };
  const headers = { Authorization: `Bearer ${key}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://myai-v3-firmansyah.pages.dev";
    headers["X-Title"] = "MyAI";
  }
  return headers;
}

function providerChatConfig(input) {
  if (input.provider === "gemini") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": input.key },
      body: buildGeminiBody(input),
    };
  }
  const baseUrl = OPENAI_COMPATIBLE_PROVIDER_URLS[input.provider];
  if (!baseUrl) throw new GatewayError(400, "Provider gateway tidak didukung.");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${input.key}` };
  if (input.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://myai-v3-firmansyah.pages.dev";
    headers["X-Title"] = "MyAI";
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    body: buildOpenAIBody(input),
  };
}

export const PROVIDER_ADAPTERS = Object.freeze(Object.fromEntries(
  Object.entries(GATEWAY_PROVIDERS).map(([id, provider]) => [id, Object.freeze({
    id,
    name: GATEWAY_LABELS[id],
    icon: id,
    needsKey: true,
    async listModels(key, signal) {
      const endpoint = id === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
        : `${OPENAI_COMPATIBLE_PROVIDER_URLS[id]}/models`;
      return fetch(endpoint, { headers: providerCatalogHeaders(id, key), signal });
    },
    chat(input) {
      return providerChatConfig(input);
    },
    normalizeError(status, raw, key) {
      return providerErrorMessage(GATEWAY_LABELS[id], status, raw, key);
    },
    keyName: provider.keyName,
  })]),
));

function modelHealthKey(provider, modelId) {
  return `${provider}::${modelId}`;
}

function updateModelHealth(provider, modelId, status) {
  const duration = status === 404 ? 60 * 60 * 1000 : 60 * 1000;
  modelHealth.set(modelHealthKey(provider, modelId), { status, expiresAt: Date.now() + duration });
}

function currentModelHealth(provider, modelId) {
  const key = modelHealthKey(provider, modelId);
  const health = modelHealth.get(key);
  if (!health || health.expiresAt <= Date.now()) {
    modelHealth.delete(key);
    return null;
  }
  return health;
}

function corsHeaders(request) {
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Origin": request?.headers?.get("Origin") || "*",
    Vary: "Origin",
  };
}

function jsonResponse(body, status = 200, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

function getGatewayKey(keys, provider) {
  const key = keys?.[provider];
  return typeof key === "string" ? key.trim() : "";
}

export function modelAccessTier(provider, model) {
  const identity = `${model.id} ${model.name}`.toLowerCase();
  const size = Math.max(0, ...[...identity.matchAll(/(?:^|[-_./ ])(\d+(?:\.\d+)?)([bt])(?=$|[-_./ ])/g)]
    .map((match) => Number(match[1]) * (match[2] === "t" ? 1000 : 1)));
  const flagship = /\b(opus|sonnet|gemini[- ]?(?:\d+(?:\.\d+)?[- ])?(?:pro|ultra)|gpt[- ]?(?:4(?:\.1|o)?|o[134])|deepseek[- ]?r1|deep-research|nemotron[- ]?ultra|405b|671b|235b)\b/.test(identity)
    || size >= 100;
  const advanced = /\b(reasoning|reasoner|thinking|qwq|r1|turbo|nemotron|mixtral|llama[- ]?4|70b|72b|80b)\b/.test(identity)
    || size >= 30;

  if (provider === "openrouter" && model.priceTier === "free") return "free";
  if (flagship) return "max";
  if (provider === "nvidia") return advanced ? "pro" : "basic";
  if (provider === "gemini") {
    if (advanced) return "pro";
    return /\b(flash|lite|gemma)\b/.test(identity) ? "free" : "basic";
  }
  if (provider === "groq") return advanced ? "pro" : size >= 10 ? "basic" : size > 0 ? "free" : "basic";
  if (provider === "openrouter") return advanced ? "pro" : "basic";
  return "basic";
}

async function fetchGatewayCatalog(provider, key, { forceRefresh = false } = {}) {
  const cached = catalogCache.get(provider);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) return cached.models;
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) throw new GatewayError(400, "Provider gateway tidak didukung.");
  let response;
  try {
    response = await adapter.listModels(key, AbortSignal.timeout(12000));
  } catch (error) {
    throw new GatewayError(error?.name === "AbortError" || error?.name === "TimeoutError" ? 504 : 502,
      `${GATEWAY_LABELS[provider]}: katalog model tidak dapat dimuat.`);
  }
  if (!response.ok) {
    throw new GatewayError(response.status,
      adapter.normalizeError(response.status, await response.text(), key));
  }
  let payload;
  try { payload = await response.json(); } catch {
    throw new GatewayError(502, `${GATEWAY_LABELS[provider]}: katalog mengembalikan JSON yang tidak valid.`);
  }
  const sourceModels = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : [];
  const models = sourceModels.flatMap((item) => {
    const rawId = typeof item.name === "string" && provider === "gemini" ? item.name.replace(/^models\//, "") : item.id;
    if (typeof rawId !== "string" || !rawId || rawId.length > 300) return [];
    if (provider === "gemini" && (!item.supportedGenerationMethods?.includes("generateContent")
      || /audio|tts|transcri|embedding|image|lyria|robotics|computer[-_ ]?use|live|antigravity/i.test(`${rawId} ${item.display_name || item.displayName || ""}`))) return [];
    if (/\b(?:image|flux|stable[\s_-]?diffusion|dall[\s_-]?e|text[-_ ]?to[-_ ]?image)\b/i.test(`${rawId} ${item.display_name || item.displayName || ""}`)) return [];
    if (provider === "groq" && /whisper|transcri|speech|audio|embed|moderation|guard|orpheus/i.test(rawId)) return [];
    if (provider === "nvidia" && /embed|retriev|rerank|ranker|nemoguard|safety[-_ ]guard|content[-_ ]safety|topic[-_ ]control|reward|classifier|moderation/i.test(`${rawId} ${item.display_name || item.displayName || ""}`)) return [];
    if (provider === "openrouter") {
      const outputModalities = item.architecture?.output_modalities || ["text"];
      if (!outputModalities.includes("text") || outputModalities.includes("image")) return [];
    }
    const name = String(item.display_name || item.displayName || item.name || item.id || rawId).replace(/^models\//, "");
    const pricing = item.pricing || {};
    const contextWindow = Number(item.context_length ?? item.inputTokenLimit ?? item.context_window);
    const isFree = provider === "openrouter"
      && [pricing.prompt, pricing.completion].every((price) => Number.isFinite(Number(price)) && Number(price) === 0)
      && (pricing.request === undefined || pricing.request === null || pricing.request === ""
        || (Number.isFinite(Number(pricing.request)) && Number(pricing.request) === 0));
    const inputModalities = item.architecture?.input_modalities || [];
    return [{
      id: rawId,
      name: name.slice(0, 160),
      priceTier: isFree ? "free" : "check",
      ...(Number.isSafeInteger(contextWindow) && contextWindow > 0 && contextWindow <= 10_000_000 ? { contextWindow } : {}),
      ...(provider === "openrouter" && inputModalities.includes("image") ? { imageSupport: true } : {}),
      ...(provider === "groq" && /llama-3\.2-11b-vision|llama-4-(?:scout|maverick)/i.test(rawId) ? { imageSupport: true } : {}),
      ...(provider === "gemini" && !/audio|tts|transcri|embedding|image/i.test(rawId) ? { imageSupport: true } : {}),
    }];
  });
  const unique = [...new Map(models.map((model) => [model.id, model])).values()]
    .sort((left, right) => {
      if (provider !== "openrouter") return left.name.localeCompare(right.name);
      const priority = (model) => /^(anthropic\/|openai\/)/i.test(model.id) ? 0 : 1;
      return priority(left) - priority(right) || left.name.localeCompare(right.name);
    });
  catalogCache.set(provider, { models: unique, expiresAt: Date.now() + GATEWAY_CATALOG_TTL_MS });
  return unique;
}

export async function gatewayModelGroups(keys, requestedProviders = Object.keys(GATEWAY_PROVIDERS)) {
  const results = await Promise.allSettled(requestedProviders
    .filter((provider) => Object.hasOwn(GATEWAY_PROVIDERS, provider))
    .filter((provider) => keys?.[provider])
    .map(async (provider) => ({
      provider: `gateway-${provider}`,
      label: GATEWAY_PROVIDERS[provider].label,
      tag: provider === "openrouter"
        ? "Model dari akun OpenRouter · biaya provider berlaku"
        : `${GATEWAY_LABELS[provider]} · biaya dan kuota provider berlaku`,
      models: (await fetchGatewayCatalog(provider, keys[provider]))
        .flatMap((model) => {
          const health = currentModelHealth(provider, model.id);
          if (health?.status === 404) return [];
          const availabilityStatus = health?.status === 402
            ? "credit-required"
            : health?.status === 429
              ? "limited-rate"
            : provider === "openrouter" && model.priceTier === "free"
                ? "limited-rate"
                : "";
          return [{
            ...model,
            priceTier: model.priceTier || "check",
            accessTier: modelAccessTier(provider, model),
            ...(availabilityStatus ? { availabilityStatus } : {}),
          }];
        }),
    })));
  const groups = [];
  const errors = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value.models.length) groups.push(result.value);
    } else {
      errors.push(result.reason?.message || "Katalog gateway gagal dimuat.");
    }

  }
  return { groups, errors };
}

export async function testGatewayProvider(provider, key) {
  if (!PROVIDER_ADAPTERS[provider]) {
    return { status: "ERROR", code: "UNSUPPORTED_PROVIDER", message: "Provider tidak didukung." };
  }
  if (typeof key !== "string" || !key.trim()) {
    return { status: "NOT_CONFIGURED", code: "MISSING_SECRET", message: "Secret provider belum dipasang di Worker." };
  }
  try {
    const models = await fetchGatewayCatalog(provider, key.trim(), { forceRefresh: true });
    return {
      status: models.length ? "HEALTHY" : "DEGRADED",
      code: models.length ? "CATALOG_OK" : "EMPTY_CATALOG",
      modelCount: models.length,
      message: models.length
        ? `Katalog provider berhasil diakses (${models.length} model). Ini belum menguji permintaan chat atau kuota model.`
        : "Katalog merespons, tetapi tidak menampilkan model chat yang didukung.",
    };
  } catch (error) {
    const status = error?.status;
    return {
      status: status === 402 || status === 429 ? "EXHAUSTED"
        : status === 401 || status === 403 ? "ERROR"
          : status === 504 || status === 502 || status >= 500 ? "UNREACHABLE"
            : "DEGRADED",
      code: status === 401 || status === 403 ? "INVALID_KEY_OR_PERMISSION"
        : status === 402 || status === 429 ? "QUOTA_OR_RATE_LIMIT"
          : status === 404 ? "ENDPOINT_NOT_FOUND"
            : status ? `HTTP_${status}` : "NETWORK_ERROR",
      message: String(error?.message || "Koneksi provider tidak dapat diverifikasi.").slice(0, 400),
    };
  }
}

function healthStatusFromError(error) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return "KEY_SALAH";
  if (status === 402 || status === 429) return "KUOTA";
  if (status === 404) return "MODEL_TIDAK_ADA";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "TIMEOUT";
  return "GANGGUAN";
}

function healthStatusFromResponse(status, raw) {
  if (status === 402 || status === 429
    || /credit balance.{0,40}too low|insufficient (?:credits?|funds)|quota.{0,30}(?:exceeded|limit)/i.test(raw)) {
    return "KUOTA";
  }
  if (status === 401 || status === 403) return "KEY_SALAH";
  if (status === 404) return "MODEL_TIDAK_ADA";
  if (status === 408) return "TIMEOUT";
  return "GANGGUAN";
}

function healthStatusMessage(status) {
  return ({
    KEY_HILANG: "Secret provider belum dipasang di Cloudflare Worker.",
    KEY_SALAH: "Key ditolak atau tidak memiliki izin untuk model ini.",
    KUOTA: "Kuota, saldo, atau batas permintaan provider tercapai.",
    MODEL_TIDAK_ADA: "Model tidak ditemukan atau tidak tersedia untuk akun ini.",
    GANGGUAN: "Provider mengalami gangguan atau mengembalikan respons tidak valid.",
    TIMEOUT: "Provider melewati batas waktu pemeriksaan.",
  })[status] || "Provider merespons dengan benar.";
}

function healthUsage(provider, payload) {
  const usage = provider === "gemini" ? payload?.usageMetadata : payload?.usage;
  const safeCount = (value) => {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  };
  const promptTokens = safeCount(usage?.promptTokenCount ?? usage?.input_tokens ?? usage?.prompt_tokens);
  const completionTokens = safeCount(usage?.candidatesTokenCount ?? usage?.output_tokens ?? usage?.completion_tokens);
  const totalTokens = safeCount(usage?.totalTokenCount ?? usage?.total_tokens) || promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function hasHealthReply(provider, payload) {
  if (provider === "gemini") {
    return payload?.candidates?.some((candidate) =>
      candidate?.content?.parts?.some((part) => typeof part.text === "string" && part.text.trim()));
  }
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string"
    ? Boolean(content.trim())
    : Array.isArray(content) && content.some((part) => typeof part?.text === "string" && part.text.trim());
}

function healthProbeModels(provider, models) {
  return [...models].sort((left, right) => {
    const priority = (model) => {
      const id = model.id.toLowerCase();
      if (provider === "gemini" && id === "gemini-3-flash-preview") return 0;
      if (provider === "nvidia" && /nvidia\/nemotron.*bolt.*e4b/.test(id)) return 0;
      if (provider === "openrouter") {
        if (id === "cohere/north-mini-code:free") return 0;
        if (/^(?:google\/|meta-llama\/|qwen\/)/.test(id) && model.priceTier === "free") return 0;
        if (model.priceTier === "free") return 1;
      }
      return 2;
    };
    const fast = (model) => /(?:flash|haiku|instant|mini|lite|small|8b)/i.test(`${model.id} ${model.name}`) ? 0 : 1;
    return priority(left) - priority(right)
      || fast(left) - fast(right)
      || left.name.localeCompare(right.name);
  }).slice(0, provider === "nvidia" ? 2 : 3);
}

export async function probeGatewayProvider(provider, key) {
  const startedAt = Date.now();
  if (!PROVIDER_ADAPTERS[provider]) {
    return { status: "GANGGUAN", latencyMs: 0, usage: null, message: "Provider chat tidak dikenal." };
  }
  if (typeof key !== "string" || !key.trim()) {
    return { status: "KEY_HILANG", latencyMs: null, usage: null, message: healthStatusMessage("KEY_HILANG") };
  }
  let model = "";
  try {
    const models = await fetchGatewayCatalog(provider, key.trim(), { forceRefresh: true });
    const probeModels = healthProbeModels(provider, models);
    if (!probeModels.length) {
      return {
        status: "MODEL_TIDAK_ADA",
        latencyMs: Date.now() - startedAt,
        usage: null,
        message: healthStatusMessage("MODEL_TIDAK_ADA"),
      };
    }
    let lastModelResponse;
    for (const probeModel of probeModels) {
      model = probeModel.id;
      const config = providerChatConfig({
        provider,
        key: key.trim(),
        model,
        messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
        temperature: 0,
        webSearch: false,
        researchMode: false,
      });
      let url = config.url;
      let body = { ...config.body };
      if (provider === "gemini") {
        url = url.replace(":streamGenerateContent?alt=sse", ":generateContent");
        body = { ...body, generationConfig: { ...body.generationConfig, maxOutputTokens: 64 } };
      } else {
        body.stream = false;
        body.max_tokens = 64;
        delete body.stream_options;
      }
      const response = await fetch(url, {
        method: "POST",
        headers: config.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) {
        const raw = await response.text();
        const mappedStatus = healthStatusFromResponse(response.status, raw);
        lastModelResponse = {
          status: mappedStatus,
          latencyMs: Date.now() - startedAt,
          model,
          usage: null,
          message: PROVIDER_ADAPTERS[provider].normalizeError(response.status, raw, key.trim())
            || healthStatusMessage(mappedStatus),
        };
        if (response.status === 404) continue;
        return lastModelResponse;
      }
      let payload;
      try {
        payload = JSON.parse(await response.text());
      } catch {
        throw new GatewayError(502, "Provider mengembalikan JSON yang tidak valid.");
      }
      if (!hasHealthReply(provider, payload)) {
        if (provider === "openrouter") {
          lastModelResponse = {
            status: "GANGGUAN",
            latencyMs: Date.now() - startedAt,
            model,
            usage: null,
            message: "Model OpenRouter tidak mengembalikan jawaban teks.",
          };
          continue;
        }
        throw new GatewayError(502, "Provider tidak mengembalikan jawaban teks.");
      }
      return {
        status: "OK",
        latencyMs: Date.now() - startedAt,
        model,
        usage: healthUsage(provider, payload),
        message: healthStatusMessage("OK"),
      };
    }
    return lastModelResponse;
  } catch (error) {
    const status = healthStatusFromError(error);
    return {
      status,
      latencyMs: Date.now() - startedAt,
      ...(model ? { model } : {}),
      usage: null,
      message: error instanceof GatewayError
        ? String(error.message).slice(0, 400)
        : healthStatusMessage(status),
    };
  }
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 120) {
    throw new GatewayError(400, "Daftar messages harus berisi 1–120 pesan.");
  }
  const messages = value.map((message) => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new GatewayError(400, "Setiap pesan harus memiliki role dan content yang valid.");
    }
    if (message.audio || message.video) {
      throw new GatewayError(400, "Audio/video harus ditranskripsikan atau diringkas menjadi teks sebelum dikirim ke model chat ini.");
    }
    const images = Array.isArray(message.images) ? message.images : [];
    if (images.length > 4) throw new GatewayError(400, "Maksimal empat gambar per pesan untuk gateway.");
    if (images.length && message.role !== "user") throw new GatewayError(400, "Gambar hanya dapat disertakan pada pesan pengguna.");
    for (const image of images) {
      if (typeof image !== "string" || image.length > MAX_IMAGE_CHARS
        || !/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(image)) {
        throw new GatewayError(400, "Gambar harus berupa data URL PNG, JPEG, atau WebP dengan ukuran yang didukung.");
      }
    }
    return { role: message.role, content: message.content, ...(images.length ? { images } : {}) };
  });
  if (!messages.some((message) => message.role === "user")) {
    throw new GatewayError(400, "Daftar messages harus berisi setidaknya satu pesan pengguna.");
  }
  return messages;
}

export function validateGatewayBody(body, keys) {
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!Object.hasOwn(GATEWAY_PROVIDERS, provider)) {
    throw new GatewayError(400, "Provider gateway harus merupakan provider AI yang didukung.");
  }
  const key = getGatewayKey(keys, provider);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model || model.length > 300) {
    throw new GatewayError(400, "Model gateway tidak valid.");
  }
  const messages = validateMessages(body.messages);
  const byteLength = new TextEncoder().encode(JSON.stringify(messages)).byteLength;
  if (byteLength > MAX_REQUEST_BYTES) throw new GatewayError(413, "Permintaan gateway melebihi batas 4 MiB.");
  const webSearch = body.webSearch === true;
  if (webSearch && !["gemini", "openrouter"].includes(provider)) {
    throw new GatewayError(400, `Pencarian web belum didukung oleh ${GATEWAY_LABELS[provider]}. Pilih Gemini atau OpenRouter.`);
  }
  const temperature = Number(body.temperature);
  return {
    provider,
    key,
    model,
    messages,
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.7,
    webSearch,
    researchMode: body.researchMode === true,
  };
}

function imageParts(images) {
  return images.map((image) => {
    const match = image.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
    if (!match) throw new GatewayError(400, "Format gambar gateway tidak didukung.");
    return { mimeType: match[1].toLowerCase(), data: match[2] };
  });
}

function buildGeminiBody(input) {
  const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const contents = input.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      { text: message.content },
      ...imageParts(message.images || []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
    ],
  }));
  return {
    contents,
    generationConfig: { temperature: input.temperature, maxOutputTokens: 4096 },
    ...(input.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

function buildOpenAIBody(input) {
  const messages = input.messages.map((message) => {
    if (!message.images?.length) return { role: message.role, content: message.content };
    return {
      role: message.role,
      content: [
        { type: "text", text: message.content },
        ...message.images.map((image) => ({ type: "image_url", image_url: { url: image } })),
      ],
    };
  });
  return {
    model: input.model,
    messages,
    stream: true,
    ...(input.provider === "groq" || input.provider === "openrouter"
      ? { stream_options: { include_usage: true } }
      : {}),
    temperature: input.provider === "nvidia" ? Math.min(1, input.temperature) : input.temperature,
    max_tokens: 4096,
    ...(input.webSearch && input.provider === "openrouter"
      ? { plugins: [{ id: "web", max_results: input.researchMode ? 10 : 5 }] }
      : {}),
  };
}

function upstreamConfig(input, request) {
  const adapter = PROVIDER_ADAPTERS[input.provider];
  if (!adapter) throw new GatewayError(400, "Provider gateway tidak didukung.");
  return adapter.chat(input, request);
}

async function* readProviderEvents(response) {
  if (!response.body) throw new Error("Provider tidak mengembalikan stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];
  const parseLine = (line) => {
    if (!line || line.startsWith(":")) return null;
    if (line.startsWith("event:")) { eventName = line.slice(6).trim() || "message"; return null; }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    return null;
  };
  const flush = () => {
    if (!dataLines.length) { eventName = "message"; return null; }
    const event = { event: eventName, data: dataLines.join("\n") };
    eventName = "message";
    dataLines = [];
    return event;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) {
          const event = flush();
          if (event) yield event;
        } else parseLine(line);
      }
      if (done) break;
    }
    if (buffer) parseLine(buffer);
    const event = flush();
    if (event) yield event;
  } finally {
    reader.releaseLock();
  }
}

function chatChunk(content, extra = {}) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { ...extra, ...(content ? { content } : {}) }, finish_reason: null }] })}\n\n`;
}

function errorChunk(message) {
  return `data: ${JSON.stringify({ error: message })}\n\n`;
}

function usageChunk(tokens) {
  return `data: ${JSON.stringify({ type: "usage", tokens })}\n\n`;
}

function parseProviderData(event) {
  if (event.data === "[DONE]") return null;
  try { return JSON.parse(event.data); } catch { return null; }
}

function providerErrorMessage(provider, status, raw, key) {
  let detail = "";
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.error?.message || parsed.message || parsed.type || "";
  } catch {}
  if (typeof detail !== "string") detail = detail ? JSON.stringify(detail) : "";
  if (key) detail = detail.split(key).join("[redacted]");
  if (status === 401 || status === 403) return `${provider}: API key ditolak. Periksa secret provider di Cloudflare Worker.`;
  if (status === 429) return `${provider}: kuota atau rate limit provider tercapai. Periksa billing dan batas penggunaan.`;
  if (status === 402) return `${provider}: kuota atau saldo provider tidak mencukupi (HTTP 402).`;
  if (status === 404) return `${provider}: model tidak ditemukan atau tidak tersedia untuk akun ini (HTTP 404).`;
  if (status >= 500) return `${provider}: layanan provider sedang bermasalah. Coba lagi nanti.`;
  return `${provider}: ${detail || `provider menolak permintaan (HTTP ${status})`}`.slice(0, 1200);
}

function providerEventHasText(provider, eventName, data) {
  const providerError = typeof data.error === "string" ? data.error : data.error?.message;
  if (data.type === "error" || providerError) {
    throw new GatewayError(502, String(providerError || data.message || `${provider}: provider mengembalikan error.`).slice(0, 1200));
  }
  if (provider === "gemini") {
    return (data.candidates?.[0]?.content?.parts || [])
      .some((part) => typeof part.text === "string" && Boolean(part.text.trim()));
  }
  const choices = data.choices || [];
  return choices.some((choice) => {
    const content = choice.delta?.content ?? choice.message?.content;
    return typeof content === "string" ? Boolean(content.trim())
      : Array.isArray(content) && content.some((part) => typeof part.text === "string" && Boolean(part.text.trim()));
  });
}

async function primeProviderStream(response, provider) {
  if (!response.body) throw new GatewayError(502, `${provider}: provider tidak mengembalikan stream jawaban.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const bufferedChunks = [];
  let buffer = "";
  let bytesRead = 0;
  const maxProbeBytes = 64 * 1024;
  let readerReleased = false;
  const releaseReader = () => {
    if (readerReleased) return;
    readerReleased = true;
    reader.releaseLock();
  };
  try {
    while (bytesRead < maxProbeBytes) {
      let timeoutId;
      const read = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new GatewayError(504, `${provider}: provider tidak mengirim jawaban dalam batas waktu.`)),
            UPSTREAM_IDLE_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timeoutId));
      if (read.done) {
        buffer += decoder.decode();
        throw new GatewayError(502, `${provider}: provider menutup stream tanpa jawaban teks yang valid.`);
      }
      bufferedChunks.push(read.value);
      bytesRead += read.value.byteLength;
      buffer += decoder.decode(read.value, { stream: true });

      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index).replace(/\r/g, "");
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const eventName = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
        const dataText = block.split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!dataText) continue;
        if (dataText === "[DONE]") {
          throw new GatewayError(502, `${provider}: provider mengakhiri stream tanpa jawaban teks.`);
        }
        let data;
        try {
          data = JSON.parse(dataText);
        } catch {
          throw new GatewayError(502, `${provider}: provider mengirim event stream yang tidak valid.`);
        }
        if (providerEventHasText(provider, eventName, data)) {
          const prefix = [...bufferedChunks];
          const body = new ReadableStream({
            async pull(controller) {
              try {
                if (prefix.length) {
                  controller.enqueue(prefix.shift());
                  return;
                }
                const next = await reader.read();
                if (next.done) {
                  releaseReader();
                  controller.close();
                  return;
                }
                controller.enqueue(next.value);
              } catch (error) {
                releaseReader();
                controller.error(error);
              }
            },
            async cancel(reason) {
              try {
                await reader.cancel(reason);
              } finally {
                releaseReader();
              }
            },
          });
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      }
    }
    throw new GatewayError(502, `${provider}: provider tidak mengirim jawaban teks yang valid.`);
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {}
    releaseReader();
    throw error;
  }
}

async function* normalizeStream(response, provider) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let hasUsage = false;
  for await (const event of readProviderEvents(response)) {
    const data = parseProviderData(event);
    if (!data) continue;
    if (provider === "gemini" && data.usageMetadata) {
      usage.prompt_tokens = Number(data.usageMetadata.promptTokenCount ?? usage.prompt_tokens);
      usage.completion_tokens = Number(data.usageMetadata.candidatesTokenCount ?? usage.completion_tokens);
      usage.total_tokens = Number(data.usageMetadata.totalTokenCount ?? (usage.prompt_tokens + usage.completion_tokens));
      hasUsage = true;
    } else if (data.usage) {
      usage.prompt_tokens = Number(data.usage.prompt_tokens ?? usage.prompt_tokens);
      usage.completion_tokens = Number(data.usage.completion_tokens ?? usage.completion_tokens);
      usage.total_tokens = Number(data.usage.total_tokens ?? (usage.prompt_tokens + usage.completion_tokens));
      hasUsage = true;
    }
    const providerError = typeof data.error === "string" ? data.error : data.error?.message;
    if (provider === "gemini") {
      if (providerError) { yield errorChunk(providerError); break; }
      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (!part.text) continue;
        yield part.thought ? chatChunk("", { reasoning: part.text }) : chatChunk(part.text);
      }
      const citations = (data.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
        .filter((source) => source.web?.uri)
        .map((source) => ({
          type: "url_citation",
          url_citation: { url: source.web.uri, title: source.web.title },
        }));
      if (citations.length) yield chatChunk("", { annotations: citations });
      continue;
    }
    if (data.type === "error" || providerError) {
      yield errorChunk(providerError || data.message || `${GATEWAY_LABELS[provider]} mengembalikan error saat streaming.`);
      break;
    }
    const delta = data.choices?.[0]?.delta;
    const annotations = delta?.annotations || data.choices?.[0]?.message?.annotations || [];
    if (provider === "openrouter" && annotations.length) yield chatChunk("", { annotations });
    if (typeof delta?.content === "string") yield chatChunk(delta.content);
  }
  if (hasUsage) yield usageChunk(usage);
  yield "data: [DONE]\n\n";
}

function metricsEvent(usage, model, startedAt) {
  return `data: ${JSON.stringify({
    type: "metrics",
    tokens: usage.total_tokens,
    completion_tokens: usage.completion_tokens,
    duration_ms: Math.max(0, Date.now() - startedAt),
    model,
  })}\n\n`;
}

export function streamResponse(
  response,
  provider,
  upstreamRequest,
  idleTimeoutMs = UPSTREAM_IDLE_TIMEOUT_MS,
  heartbeatIntervalMs = SSE_HEARTBEAT_INTERVAL_MS,
  metrics = {},
) {
  const iterator = normalizeStream(response, provider)[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const startedAt = Number.isFinite(metrics.startedAt) ? metrics.startedAt : Date.now();
  let settled = false;
  let sentMetrics = false;
  let idleTimer;
  let heartbeatTimer;
  const cleanup = () => {
    clearTimeout(idleTimer);
    clearInterval(heartbeatTimer);
    upstreamRequest?.cleanup();
  };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": keep-alive\n\n"));
      for (const health of metrics.providerHealth || []) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "provider-health", ...health })}\n\n`));
      }
      if (metrics.fallback) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "fallback", ...metrics.fallback })}\n\n`));
      }
      const resetIdleTimeout = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          upstreamRequest?.controller.abort();
          controller.enqueue(encoder.encode(`${errorChunk(`${GATEWAY_LABELS[provider]} tidak mengirim data selama ${Math.ceil(idleTimeoutMs / 1000)} detik. Coba lagi.`)}data: [DONE]\n\n`));
          controller.close();
          void iterator.return?.().catch(() => {});
          cleanup();
        }, idleTimeoutMs);
      };
      resetIdleTimeout();
      heartbeatTimer = setInterval(() => {
        if (!settled) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, heartbeatIntervalMs);
      void (async () => {
        try {
          while (!settled) {
            const next = await iterator.next();
            if (settled) return;
            if (next.done) {
              settled = true;
              controller.close();
              cleanup();
              return;
            }
            resetIdleTimeout();
            if (next.value.includes("data: [DONE]")) {
              if (!sentMetrics) {
                controller.enqueue(encoder.encode(metricsEvent(usage, metrics.model || "", startedAt)));
                sentMetrics = true;
              }
            } else if (next.value.startsWith("data: ")) {
              try {
                const event = JSON.parse(next.value.slice(6).trim());
                if (event.type === "usage" && event.tokens) {
                  usage.prompt_tokens = Number(event.tokens.prompt_tokens || 0);
                  usage.completion_tokens = Number(event.tokens.completion_tokens || 0);
                  usage.total_tokens = Number(event.tokens.total_tokens || usage.prompt_tokens + usage.completion_tokens);
                }
              } catch {}
            }
            controller.enqueue(encoder.encode(next.value));
          }
        } catch {
          if (settled) return;
          settled = true;
          if (!upstreamRequest?.controller.signal.aborted) {
            controller.enqueue(encoder.encode(`${errorChunk(`${GATEWAY_LABELS[provider]}: stream provider terputus atau tidak valid.`)}data: [DONE]\n\n`));
          }
          controller.close();
          cleanup();
        }
      })();
    },
    async cancel(reason) {
      if (!settled) {
        settled = true;
        upstreamRequest?.controller.abort(reason);
        cleanup();
        await iterator.return?.(reason);
      }
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders(metrics.request),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function makeUpstreamRequest(request) {
  let controller;
  let timeout;
  let abortFromRequest;
  const start = () => {
    controller = new AbortController();
    timeout = setTimeout(() => controller.abort(new DOMException("Provider connection timed out.", "TimeoutError")), UPSTREAM_CONNECT_TIMEOUT_MS);
    abortFromRequest = () => controller.abort(request.signal.reason);
    if (request.signal?.aborted) abortFromRequest();
    else request.signal?.addEventListener("abort", abortFromRequest, { once: true });
  };
  const stop = () => {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abortFromRequest);
  };
  start();
  return {
    get controller() { return controller; },
    clearConnectTimeout() { clearTimeout(timeout); },
    reset() {
      stop();
      start();
    },
    cleanup: stop,
  };
}

function waitForProviderRetry(signal, delayMs) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GatewayError(499, "Permintaan dibatalkan."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new GatewayError(499, "Permintaan dibatalkan."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function handleGatewayRequest(request, keys) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Gunakan POST untuk mengirim ke AI gateway." } }, 405, request);
  }
  const requestStartedAt = Date.now();
  let upstreamStarted = false;
  try {
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > MAX_REQUEST_BYTES) throw new GatewayError(413, "Permintaan gateway melebihi batas 4 MiB.");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new GatewayError(413, "Permintaan gateway melebihi batas 4 MiB.");
    let body;
    try { body = raw.trim() ? JSON.parse(raw) : {}; } catch { throw new GatewayError(400, "Isi permintaan gateway harus berupa JSON yang valid."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new GatewayError(400, "Payload gateway harus berupa objek JSON.");
    const input = validateGatewayBody(body, keys);
    const allowFallback = body.allowFallback === true;
    if (!Object.values(keys || {}).some((key) => typeof key === "string" && key.trim())) {
      return jsonResponse({
        error: true,
        code: "MISSING_ENV_SECRETS",
        message: "API Secrets belum dikonfigurasi di Worker. Pastikan .dev.vars aktif atau jalankan wrangler dev.",
      }, 401, request);
    }
    const { groups, errors } = await gatewayModelGroups(keys, [input.provider]);
    const group = groups.find((item) => item.provider === `gateway-${input.provider}`);
    const selectedModel = group?.models.find((candidate) => candidate.id === input.model);
    const hasImages = input.messages.some((message) => message.images?.length);
    if (selectedModel && hasImages && !selectedModel.imageSupport) {
      throw new GatewayError(400, `Model ${selectedModel.name} tidak mencantumkan dukungan input gambar.`);
    }
    const upstreamRequest = makeUpstreamRequest(request);
    const fallbackProviders = input.webSearch
      ? GATEWAY_FALLBACK_PRIORITY.filter((provider) => ["gemini", "openrouter"].includes(provider))
      : GATEWAY_FALLBACK_PRIORITY;
    const fallbackModels = async () => {
      const providers = fallbackProviders.filter((provider) => provider !== input.provider && keys?.[provider]);
      const catalog = await gatewayModelGroups(keys, providers);
      const available = catalog.groups.flatMap((fallbackGroup) => fallbackGroup.models
        .filter((model) => model.accessTier === "free"
          && (fallbackGroup.provider !== "gateway-openrouter" || model.priceTier === "free")
          && (!hasImages || model.imageSupport)
          && (!input.webSearch || ["gateway-gemini", "gateway-openrouter"].includes(fallbackGroup.provider)))
        .map((model) => ({ ...model, provider: fallbackGroup.provider.slice("gateway-".length) })))
        .concat(providers.flatMap((provider) => {
          const fallbackModel = BUILTIN_TEXT_FALLBACKS[provider];
          const catalogLoaded = catalog.groups.some((group) => group.provider === `gateway-${provider}`);
          if (!fallbackModel || catalogLoaded || hasImages && !fallbackModel.imageSupport
            || input.webSearch && provider !== "gemini") return [];
          return [{ ...fallbackModel, provider }];
        }))
        .sort((left, right) => GATEWAY_FALLBACK_PRIORITY.indexOf(left.provider) - GATEWAY_FALLBACK_PRIORITY.indexOf(right.provider)
          || left.name.localeCompare(right.name));
      const seen = new Set();
      return available.filter((model) => {
        if (seen.has(model.provider)) return false;
        seen.add(model.provider);
        return true;
      });
    };
    let activeInput = input;
    let fallback = null;
    let response;
    let retryStatus = selectedModel ? 0 : errors.length ? 502 : 404;
    let retryMessage = selectedModel
      ? ""
      : errors.length
        ? errors[0]
        : `${input.provider}: model ${input.model} tidak lagi ada di katalog aktif.`;
    let primaryError = errors.length ? { status: 502, message: errors[0] } : null;
    const providerHealth = [];
    if (!selectedModel) {
      providerHealth.push({
        provider: input.provider,
        model: input.model,
        status: "ERROR",
        detail: retryMessage,
      });
    }
    let candidates = retryStatus && allowFallback ? await fallbackModels() : [];
    if (retryStatus && !candidates.length) {
      if (!input.key) {
        throw new GatewayError(503, `${GATEWAY_LABELS[input.provider]} belum dikonfigurasi. Admin perlu memasang secret ${GATEWAY_PROVIDERS[input.provider].keyName}; tidak ada provider cadangan aktif.`);
      }
      throw new GatewayError(404, `Model ${input.model} tidak tersedia pada katalog aktif ${GATEWAY_LABELS[input.provider]}. Pilih model lain untuk melanjutkan.`);
    }
    const attempts = selectedModel ? [{ input, model: selectedModel }] : [];
    const appendFallbackAttempts = () => attempts.push(...candidates.map((model) => ({
      input: { ...input, provider: model.provider, model: model.id, key: keys[model.provider] },
      model,
    })));
    if (retryStatus) appendFallbackAttempts();
    let fallbackCandidatesAdded = retryStatus && allowFallback;
    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      const isPrimaryAttempt = Boolean(selectedModel && index === 0);
      const attemptInput = attempt.input;
      const upstream = upstreamConfig(attemptInput, request);
      let providerFailure = null;
      let providerSucceeded = false;
      for (let providerAttempt = 0; providerAttempt < MAX_PROVIDER_ATTEMPTS; providerAttempt++) {
        if (request.signal?.aborted) {
          upstreamRequest.cleanup();
          throw new GatewayError(499, "Permintaan dibatalkan.");
        }
        upstreamRequest.reset();
        const attemptStartedAt = Date.now();
        try {
          upstreamStarted = true;
          response = await fetch(upstream.url, {
            method: "POST",
            headers: upstream.headers,
            body: JSON.stringify(upstream.body),
            signal: upstreamRequest.controller.signal,
          });
        } catch (error) {
          if (request.signal?.aborted) {
            upstreamRequest.cleanup();
            throw new GatewayError(499, "Permintaan dibatalkan.");
          }
          const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
          providerFailure = {
            status: timedOut ? 504 : 502,
            retryable: false,
            healthStatus: "UNREACHABLE",
            latencyMs: Date.now() - attemptStartedAt,
            message: timedOut
              ? `${attemptInput.provider}: API tidak merespons dalam 12 detik.`
              : `${attemptInput.provider}: API resmi tidak dapat dijangkau.`,
          };
          response = null;
        }
        if (response?.ok) {
          upstreamRequest.clearConnectTimeout();
          try {
            response = await primeProviderStream(response, attemptInput.provider);
            providerHealth.push({
              provider: attemptInput.provider,
              model: attemptInput.model,
              status: "HEALTHY",
              latencyMs: Date.now() - attemptStartedAt,
              detail: providerAttempt ? "Provider pulih setelah percobaan ulang." : "",
            });
            providerSucceeded = true;
            break;
          } catch (error) {
            const timedOut = error?.status === 504;
            providerFailure = {
              status: timedOut ? 504 : 502,
              retryable: false,
              healthStatus: timedOut ? "UNREACHABLE" : "ERROR",
              latencyMs: Date.now() - attemptStartedAt,
              message: error.message || `${attemptInput.provider}: stream jawaban tidak valid.`,
            };
            updateModelHealth(attemptInput.provider, attemptInput.model, providerFailure.status);
            response = null;
          }
        }
        if (response) {
          upstreamRequest.clearConnectTimeout();
          const failedStatus = response.status;
          const failureBody = await response.text();
          updateModelHealth(attemptInput.provider, attemptInput.model, failedStatus);
          const message = providerErrorMessage(attemptInput.provider, failedStatus, failureBody, attemptInput.key);
          providerFailure = {
            status: failedStatus,
            retryable: failedStatus === 429 || failedStatus >= 500,
            healthStatus: failedStatus === 402 || failedStatus === 429 ? "EXHAUSTED" : "ERROR",
            latencyMs: Date.now() - attemptStartedAt,
            message,
          };
          response = null;
          if (![401, 402, 404, 429, 500, 502, 503, 504].includes(failedStatus)) {
            upstreamRequest.cleanup();
            throw new GatewayError(failedStatus >= 500 ? 502 : failedStatus, message);
          }
        }
        const willRetry = providerAttempt + 1 < MAX_PROVIDER_ATTEMPTS && providerFailure.retryable === true;
        providerHealth.push({
          provider: attemptInput.provider,
          model: attemptInput.model,
          latencyMs: providerFailure.latencyMs,
          status: willRetry
            ? providerFailure.healthStatus === "EXHAUSTED" ? "EXHAUSTED" : "DEGRADED"
            : providerFailure.healthStatus,
          detail: providerFailure.message,
        });
        if (willRetry) {
          await waitForProviderRetry(request.signal, PROVIDER_RETRY_BACKOFF_MS * (2 ** providerAttempt));
        } else {
          break;
        }
      }
      if (providerSucceeded) {
        if (!isPrimaryAttempt) {
          fallback = {
            provider: attemptInput.provider,
            model: attemptInput.model,
            modelName: attempt.model.name,
            message: `Model ${input.model} dialihkan ke ${attempt.model.name} (${GATEWAY_LABELS[attemptInput.provider]}) setelah provider utama gagal${primaryError ? ` dengan HTTP ${primaryError.status}` : " diverifikasi tidak tersedia"}. Tarif dan kuota provider tetap berlaku.`,
          };
        }
        activeInput = attemptInput;
        retryStatus = 0;
        break;
      }
      if (isPrimaryAttempt) {
        primaryError = providerFailure;
        retryStatus = providerFailure.status;
        if (allowFallback && !fallbackCandidatesAdded) {
          candidates = await fallbackModels();
          appendFallbackAttempts();
          fallbackCandidatesAdded = true;
        }
      }
      retryMessage = providerFailure.message;
    }
    if (!response) {
      upstreamRequest.cleanup();
      const message = primaryError?.message || retryMessage || "Semua provider AI yang tersedia sedang gagal.";
      return new Response([
        ...providerHealth.map((health) => `data: ${JSON.stringify({ type: "provider-health", ...health })}\n\n`),
        errorChunk(message),
        "data: [DONE]\n\n",
      ].join(""), {
        status: 200,
        headers: {
          ...corsHeaders(request),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }
    const requestedStart = Number(body.metricsStartedAt);
    const startedAt = Number.isFinite(requestedStart) && requestedStart <= requestStartedAt
      && requestStartedAt - requestedStart < 10 * 60 * 1000
      ? requestedStart
      : requestStartedAt;
    return streamResponse(response, activeInput.provider, upstreamRequest, undefined, undefined, {
      model: activeInput.model,
      startedAt,
      request,
      providerHealth,
      ...(fallback ? { fallback } : {}),
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message = error instanceof GatewayError ? error.message : "Gateway AI mengalami kesalahan internal. Coba lagi nanti.";
    if (status >= 500) console.error("AI gateway failed:", error?.name || "Error");
    if (!upstreamStarted) return jsonResponse({ error: { message } }, status, request);
    return new Response(`${errorChunk(message)}data: [DONE]\n\n`, {
      status,
      headers: {
        ...corsHeaders(request),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
