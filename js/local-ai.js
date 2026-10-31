const OLLAMA_ENDPOINT_KEY = "myai_ollama_endpoint_v1";
const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const OLLAMA_REQUEST_TIMEOUT_MS = 30_000;

function ollamaConnectionError() {
  const origin = globalThis.location?.origin;
  const allowedOrigin = origin ? `Tambahkan origin ${origin} ke OLLAMA_ORIGINS` : "Pastikan OLLAMA_ORIGINS mengizinkan origin MyAI";
  return `Browser tidak dapat mengakses Ollama. Pastikan Ollama berjalan di perangkat ini, ${allowedOrigin}, lalu mulai ulang Ollama.`;
}

const WEBGPU_MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 1B · Lite", memory: "±0.9 GB GPU", guestVisible: true },
  { id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", name: "Llama 3.2 3B · Plus", memory: "±2.9 GB GPU" },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", name: "Llama 3.1 8B", memory: "±4.9 GB GPU" },
  { id: "Llama-3-8B-Instruct-q4f16_1-MLC", name: "Llama 3 8B", memory: "±4.9 GB GPU" },
  { id: "Llama-2-7b-chat-hf-q4f16_1-MLC", name: "Llama 2 7B Chat", memory: "±6.6 GB GPU" },
  { id: "DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC", name: "DeepSeek R1 Distill Llama 8B", memory: "±4.9 GB GPU" },
  { id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", name: "DeepSeek R1 Distill Qwen 7B", memory: "±5.0 GB GPU" },
  { id: "Qwen2-0.5B-Instruct-q4f16_1-MLC", name: "Qwen2 0.5B", memory: "±0.9 GB GPU" },
  { id: "Qwen2-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2 1.5B", memory: "±1.6 GB GPU" },
  { id: "Qwen2-7B-Instruct-q4f16_1-MLC", name: "Qwen2 7B", memory: "±5.0 GB GPU" },
  { id: "Qwen2-Math-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2 Math 1.5B", memory: "±1.6 GB GPU" },
  { id: "Qwen2-Math-7B-Instruct-q4f16_1-MLC", name: "Qwen2 Math 7B", memory: "±5.0 GB GPU" },
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 0.5B", memory: "±0.9 GB GPU" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 1.5B", memory: "±1.6 GB GPU" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", name: "Qwen2.5 3B", memory: "±2.4 GB GPU" },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", name: "Qwen2.5 7B", memory: "±5.0 GB GPU" },
  { id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 Coder 0.5B", memory: "±0.9 GB GPU" },
  { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 Coder 1.5B", memory: "±1.6 GB GPU" },
  { id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", name: "Qwen2.5 Coder 3B", memory: "±2.4 GB GPU" },
  { id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", name: "Qwen2.5 Coder 7B", memory: "±5.0 GB GPU" },
  { id: "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 Math 1.5B", memory: "±1.6 GB GPU" },
  { id: "Qwen3-0.6B-q4f16_1-MLC", name: "Qwen3 0.6B", memory: "±1.4 GB GPU" },
  { id: "Qwen3-1.7B-q4f16_1-MLC", name: "Qwen3 1.7B", memory: "±2.0 GB GPU" },
  { id: "Qwen3-4B-q4f16_1-MLC", name: "Qwen3 4B", memory: "±3.4 GB GPU" },
  { id: "Qwen3-8B-q4f16_1-MLC", name: "Qwen3 8B", memory: "±5.6 GB GPU" },
  { id: "Qwen3.5-0.8B-q4f16_1-MLC", name: "Qwen3.5 0.8B", memory: "±1.6 GB GPU" },
  { id: "Qwen3.5-2B-q4f16_1-MLC", name: "Qwen3.5 2B", memory: "±2.2 GB GPU" },
  { id: "Qwen3.5-4B-q4f16_1-MLC", name: "Qwen3.5 4B", memory: "±3.8 GB GPU" },
  { id: "Qwen3.5-9B-q4f16_1-MLC", name: "Qwen3.5 9B", memory: "±6.3 GB GPU" },
  { id: "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC", name: "Hermes 2 Pro Llama 3 8B", memory: "±4.9 GB GPU" },
  { id: "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC", name: "Hermes 2 Pro Mistral 7B", memory: "±3.9 GB GPU" },
  { id: "Hermes-2-Theta-Llama-3-8B-q4f16_1-MLC", name: "Hermes 2 Theta Llama 3 8B", memory: "±4.9 GB GPU" },
  { id: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC", name: "Hermes 3 Llama 3.1 8B", memory: "±4.8 GB GPU" },
  { id: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC", name: "Hermes 3 Llama 3.2 3B", memory: "±2.2 GB GPU" },
  { id: "NeuralHermes-2.5-Mistral-7B-q4f16_1-MLC", name: "NeuralHermes 2.5 Mistral 7B", memory: "±4.5 GB GPU" },
  { id: "OpenHermes-2.5-Mistral-7B-q4f16_1-MLC", name: "OpenHermes 2.5 Mistral 7B", memory: "±4.5 GB GPU" },
  { id: "Mistral-7B-Instruct-v0.2-q4f16_1-MLC", name: "Mistral 7B v0.2", memory: "±4.5 GB GPU" },
  { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", name: "Mistral 7B v0.3", memory: "±4.5 GB GPU" },
  { id: "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC", name: "Ministral 3 3B Instruct", memory: "±2.8 GB GPU" },
  { id: "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC", name: "Ministral 3 3B Reasoning", memory: "±2.8 GB GPU" },
  { id: "phi-1_5-q4f16_1-MLC", name: "Phi 1.5", memory: "±1.2 GB GPU" },
  { id: "phi-2-q4f16_1-MLC", name: "Phi 2", memory: "±3.0 GB GPU" },
  { id: "Phi-3-mini-4k-instruct-q4f16_1-MLC", name: "Phi 3 Mini", memory: "±3.6 GB GPU" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi 3.5 Mini", memory: "±3.6 GB GPU" },
  { id: "Phi-4-mini-instruct-q4f16_1-MLC", name: "Phi 4 Mini", memory: "±3.4 GB GPU" },
  { id: "gemma-2b-it-q4f16_1-MLC", name: "Gemma 2B", memory: "±1.4 GB GPU" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", name: "Gemma 2 2B", memory: "±1.9 GB GPU" },
  { id: "gemma-2-2b-jpn-it-q4f16_1-MLC", name: "Gemma 2 2B JPN", memory: "±1.9 GB GPU" },
  { id: "gemma-2-9b-it-q4f16_1-MLC", name: "Gemma 2 9B", memory: "±6.3 GB GPU" },
  { id: "gemma3-1b-it-q4f16_1-MLC", name: "Gemma 3 1B", memory: "±0.7 GB GPU" },
  { id: "gemma-4-E2B-it-q4f16_1-MLC", name: "Gemma 4 E2B", memory: "±3.3 GB GPU" },
  { id: "SmolLM2-135M-Instruct-q0f16-MLC", name: "SmolLM2 135M", memory: "±0.4 GB GPU" },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", name: "SmolLM2 360M", memory: "±0.4 GB GPU" },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", name: "SmolLM2 1.7B", memory: "±1.7 GB GPU" },
  { id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", name: "TinyLlama 1.1B", memory: "±0.7 GB GPU" },
  { id: "OLMo-2-0425-1B-Instruct-q4f16_1-MLC", name: "OLMo 2 1B", memory: "±1.7 GB GPU" },
  { id: "OLMo-2-1124-7B-Instruct-q4f16_1-MLC", name: "OLMo 2 7B", memory: "±6.3 GB GPU" },
  { id: "RedPajama-INCITE-Chat-3B-v1-q4f16_1-MLC", name: "RedPajama INCITE Chat 3B", memory: "±2.9 GB GPU" },
  { id: "stablelm-2-zephyr-1_6b-q4f16_1-MLC", name: "StableLM 2 Zephyr 1.6B", memory: "±2.0 GB GPU" },
  { id: "WizardMath-7B-V1.1-q4f16_1-MLC", name: "WizardMath 7B", memory: "±4.5 GB GPU" },
];

export const WEBGPU_GUEST_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

export function normalizeOllamaEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Masukkan alamat Ollama yang valid, misalnya http://127.0.0.1:11434.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!["http:", "https:"].includes(url.protocol)
    || !loopbackHosts.has(url.hostname.toLowerCase())
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash) {
    throw new Error("Untuk keamanan, alamat Ollama harus menunjuk ke localhost dan tidak boleh berisi path atau kredensial.");
  }
  return url.origin;
}

export function getOllamaEndpoint() {
  try {
    return normalizeOllamaEndpoint(localStorage.getItem(OLLAMA_ENDPOINT_KEY) || DEFAULT_OLLAMA_ENDPOINT);
  } catch (error) {
    console.warn("Saved Ollama endpoint is invalid; using the local default.", error);
    return DEFAULT_OLLAMA_ENDPOINT;
  }
}

export function saveOllamaEndpoint(value) {
  const endpoint = normalizeOllamaEndpoint(value);
  localStorage.setItem(OLLAMA_ENDPOINT_KEY, endpoint);
  return endpoint;
}

export function getWebGpuModelGroup({ authenticated = true } = {}) {
  const visibleModels = authenticated
    ? WEBGPU_MODELS
    : WEBGPU_MODELS.filter((model) => model.guestVisible);
  return {
    provider: "local-webgpu",
    label: "AI Lokal · WebGPU",
    tag: "Berjalan di browser. Model diunduh sekali lalu dibuka dari cache; prompt tetap di perangkat.",
    models: visibleModels.map((model) => ({
      ...model,
      accessTier: "free",
      priceTier: "free",
      contextWindow: 4096,
    })),
  };
}

export function estimateWebGpuCatalogSize() {
  return WEBGPU_MODELS.reduce((total, model) => {
    const sizeGb = Number(String(model.memory || "").match(/(\d+(?:\.\d+)?)\s*GB/)?.[1]) || 0;
    return total + sizeGb;
  }, 0);
}

export async function prefetchWebGpuModels({ modelIds, onProgress, signal } = {}) {
  const webllm = await getWebLlmModule();
  if (!Array.isArray(modelIds) || !modelIds.length) return { downloaded: 0, skipped: 0 };
  let downloaded = 0;
  let skipped = 0;
  for (const modelId of modelIds) {
    if (signal?.aborted) throw signal.reason || new DOMException("Unduhan dibatalkan.", "AbortError");
    const cached = await webllm.hasModelInCache(modelId, webllm.prebuiltAppConfig);
    if (cached) {
      skipped++;
      onProgress?.({ model: modelId, fraction: 1, cached: true });
      continue;
    }
    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => onProgress?.({
        model: modelId,
        fraction: Math.max(0, Math.min(1, Number(progress?.progress) || 0)),
        text: progress?.text || "Mengunduh model…",
      }),
    });
    engine.unload();
    downloaded++;
    onProgress?.({ model: modelId, fraction: 1, done: true });
  }
  return { downloaded, skipped };
}

export function parseOllamaModels(payload) {
  if (!payload || !Array.isArray(payload.models)) {
    throw new Error("Respons Ollama tidak valid: daftar model tidak ditemukan.");
  }
  const seen = new Set();
  return payload.models.flatMap((model) => {
    const id = typeof model?.name === "string" ? model.name.trim() : "";
    if (!id || id.length > 200 || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: id,
      accessTier: "free",
      priceTier: "free",
      contextWindow: 4096,
    }];
  });
}

export async function listOllamaModels({
  endpoint = getOllamaEndpoint(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  const baseUrl = normalizeOllamaEndpoint(endpoint);
  if (typeof fetchImpl !== "function") throw new Error("Fetch API tidak tersedia untuk menghubungkan Ollama.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/api/tags`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Ollama tidak merespons. Pastikan Ollama aktif di perangkat ini.");
    }
    if (error instanceof TypeError) {
      throw new Error(ollamaConnectionError());
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Ollama menolak permintaan daftar model (HTTP ${response.status}). Pastikan Ollama aktif.`);
  }
  const models = parseOllamaModels(await response.json());
  return {
    provider: "local-ollama",
    label: "AI Lokal · Ollama",
    tag: `Model dari Ollama di perangkat ini · ${baseUrl}`,
    models,
  };
}

async function* readOllamaStream(response, signal) {
  if (!response.body) throw new Error("Ollama tidak mengembalikan aliran jawaban.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let chunk;
    try {
      chunk = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Ollama mengirim potongan JSON yang tidak valid: ${error.message}`);
    }
    if (typeof chunk.error === "string" && chunk.error) throw new Error(`Ollama: ${chunk.error}`);
    if (typeof chunk.message?.content === "string" && chunk.message.content) {
      return { content: chunk.message.content };
    }
    if (chunk.done && chunk.prompt_eval_count + chunk.eval_count > 0) {
      return {
        usage: {
          promptTokens: Number(chunk.prompt_eval_count) || 0,
          completionTokens: Number(chunk.eval_count) || 0,
        },
      };
    }
    return null;
  };
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException("Permintaan dibatalkan.", "AbortError");
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const chunk = parseLine(line);
        if (chunk) yield chunk;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const chunk = parseLine(buffer);
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamOllamaChat({
  model,
  messages,
  temperature = 0.7,
  endpoint = getOllamaEndpoint(),
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof model !== "string" || !model.trim() || !Array.isArray(messages)) {
    throw new TypeError("Permintaan Ollama tidak valid.");
  }
  if (messages.some((message) => message.images?.length)) {
    throw new Error("Lampiran gambar belum didukung pada model Ollama lokal.");
  }
  const baseUrl = normalizeOllamaEndpoint(endpoint);
  const controller = new AbortController();
  const abortRequest = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abortRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Ollama melampaui batas waktu 30 detik.")), OLLAMA_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        stream: true,
        options: { temperature },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error?.name === "AbortError") throw new Error("Permintaan Ollama melampaui batas waktu 30 detik.");
    if (error instanceof TypeError) {
      throw new Error(ollamaConnectionError());
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortRequest);
  }
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new Error(`Ollama gagal menjawab (HTTP ${response.status})${message ? `: ${message}` : "."}`);
  }
  yield* readOllamaStream(response, signal);
}

let webLlmModulePromise;
const webGpuEngines = new Map();
const webGpuEngineLoads = new Map();

async function getWebLlmModule() {
  webLlmModulePromise ||= import("@mlc-ai/web-llm").catch((error) => {
    webLlmModulePromise = null;
    throw new Error(`Runtime AI lokal WebGPU gagal dimuat: ${error.message}`);
  });
  return webLlmModulePromise;
}

export async function inspectWebGpuCache(webllm, model, onProgress) {
  const cached = await webllm.hasModelInCache(model, webllm.prebuiltAppConfig);
  onProgress?.({
    progress: 0,
    text: cached
      ? "Model sudah tersimpan lokal; memeriksa file pendukung…"
      : "Model belum tersimpan. Mengunduh model WebGPU dari Hugging Face…",
  });
  return cached;
}

async function getWebGpuEngine(model, onProgress) {
  const loaded = webGpuEngines.get(model);
  if (loaded) return loaded;
  let loading = webGpuEngineLoads.get(model);
  if (!loading) {
    loading = (async () => {
      const webllm = await getWebLlmModule();
      if (!webllm.prebuiltAppConfig.model_list.some((entry) => entry.model_id === model)) {
        throw new Error(`Model ${model} tidak didukung versi runtime WebGPU ini.`);
      }
      await inspectWebGpuCache(webllm, model, onProgress);
      const engine = await webllm.CreateMLCEngine(model, {
        initProgressCallback: (progress) => onProgress?.({
          progress: Math.max(0, Math.min(1, Number(progress.progress) || 0)),
          text: progress.text || "Menyiapkan model AI lokal…",
        }),
      });
      webGpuEngines.set(model, engine);
      return engine;
    })().finally(() => webGpuEngineLoads.delete(model));
    webGpuEngineLoads.set(model, loading);
  }
  return loading;
}

export async function* streamWebGpuChat({
  model,
  messages,
  temperature = 0.7,
  onProgress,
  signal,
} = {}) {
  if (!globalThis.isSecureContext || !globalThis.navigator?.gpu) {
    throw new Error("WebGPU tidak tersedia di browser/perangkat ini. Gunakan Chrome atau Edge terbaru dengan akselerasi grafis, atau pilih Ollama lokal.");
  }
  if (!WEBGPU_MODELS.some((entry) => entry.id === model)) {
    throw new Error(`Model browser lokal tidak dikenal: ${model}`);
  }
  const engine = await getWebGpuEngine(model, onProgress);
  if (signal?.aborted) throw signal.reason || new DOMException("Permintaan dibatalkan.", "AbortError");
  const interrupt = () => engine.interruptGenerate();
  signal?.addEventListener("abort", interrupt, { once: true });
  let stream;
  try {
    stream = await engine.chat.completions.create({
      messages: messages.map(({ role, content }) => ({ role, content })),
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    });
    for await (const chunk of stream) {
      if (signal?.aborted) throw signal.reason || new DOMException("Permintaan dibatalkan.", "AbortError");
      const content = chunk.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) yield { content };
      if (chunk.usage) {
        yield {
          usage: {
            promptTokens: Number(chunk.usage.prompt_tokens) || 0,
            completionTokens: Number(chunk.usage.completion_tokens) || 0,
          },
        };
      }
    }
  } finally {
    signal?.removeEventListener("abort", interrupt);
  }
}
