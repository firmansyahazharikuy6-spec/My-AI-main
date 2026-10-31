const OLLAMA_ENDPOINT_KEY = "myai_ollama_endpoint_v1";
const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const OLLAMA_REQUEST_TIMEOUT_MS = 30_000;

function ollamaConnectionError() {
  const origin = globalThis.location?.origin;
  const allowedOrigin = origin ? `Tambahkan origin ${origin} ke OLLAMA_ORIGINS` : "Pastikan OLLAMA_ORIGINS mengizinkan origin MyAI";
  return `Browser tidak dapat mengakses Ollama. Pastikan Ollama berjalan di perangkat ini, ${allowedOrigin}, lalu mulai ulang Ollama.`;
}

const WEBGPU_MODELS = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B · Lite",
    memory: "±1 GB GPU",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    name: "Llama 3.2 3B · Plus",
    memory: "±3 GB GPU",
  },
];

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

export function getWebGpuModelGroup() {
  return {
    provider: "local-webgpu",
    label: "AI Lokal · WebGPU",
    tag: "Berjalan di browser. Unduhan model pertama kali cukup besar; prompt tetap di perangkat.",
    models: WEBGPU_MODELS.map((model) => ({
      ...model,
      accessTier: "free",
      priceTier: "free",
      contextWindow: 4096,
    })),
  };
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
