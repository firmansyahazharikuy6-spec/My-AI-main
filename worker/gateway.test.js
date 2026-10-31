import assert from "node:assert/strict";
import test from "node:test";
import { setFetch } from "../test/set-fetch.js";
import { dailyLimitForUser, isMaintenanceAdmin, outputTokenLimitForUser, CLOUD_CHAT_DAILY_LIMIT, MAX_ACCOUNT_DEVICES } from "./src/rate-limit.js";
import pagesWorker from "../pages/_worker.js";
import { clearGatewayCatalogCache, gatewayModelGroups, handleGatewayRequest, modelAccessTier, probeGatewayProvider, PROVIDER_ADAPTERS, streamResponse as gatewayStreamResponse, testGatewayProvider, validateGatewayBody } from "./src/gateway.js";
import worker, { AIRateLimitStore, AI_ROUTE_LIMITS, callImageEditProvider, EmailActionStore, GuestTrialCounter, guestModelsForKeys, ImageEditQueue, isAllowedOrigin, isImageEditRequest, readProviderKeys, streamResponse, validateChatBody, validatePresentationBody, withCoreSystemInstruction, withUserPersonalization } from "./src/index.js";
import { boostImagePromptQuality, cleanImageGenerationPrompt } from "../js/image-prompts.js";

function request(payload, method = "POST", origin) {
  return new Request("https://worker.test/gateway", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

function openRouterCatalog() {
  return {
    data: [
      { id: "meta/llama-4-scout", name: "Llama", pricing: { prompt: "0.000001", completion: "0.000002" }, architecture: { output_modalities: ["text"] } },
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" }, architecture: { output_modalities: ["text"] } },
      { id: "openai/gpt-4o", name: "GPT-4o", pricing: { prompt: "0.0000025", completion: "0.00001" }, architecture: { output_modalities: ["text"] } },
    ],
  };
}

function guestHeaders(deviceId = "7f6e75d2-0fb1-4a5d-8b24-bb8a3ea57419") {
  return {
    "Content-Type": "application/json",
    "cf-connecting-ip": "203.0.113.50",
    "X-Turnstile-Token": "valid-test-turnstile-token",
    "X-Guest-Device-Id": deviceId,
  };
}

function imageEditQueue() {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value)),
    delete: async (key) => values.delete(key),
    list: async ({ prefix = "", limit = 1000 } = {}) => new Map(
      [...values.entries()].filter(([key]) => key.startsWith(prefix)).slice(0, limit),
    ),
    transaction: async (callback) => callback(storage),
  };
  return new ImageEditQueue({ storage });
}

async function imageQueueCall(queue, action, body) {
  const response = await queue.fetch(new Request(`https://queue.test/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}

function imageEditReservation(userHash, requestHash, sharedLimit = 4, userLimit = 5) {
  return {
    userHash,
    requestHash,
    sourceImage: `data:image/png;base64,${"a".repeat(1200)}`,
    prompt: "Edit the supplied source photo only.",
    sharedLimit,
    userLimit,
    options: { sharedLimit },
  };
}

function imageEditQueueBinding() {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value)),
    delete: async (key) => values.delete(key),
    list: async ({ prefix = "", limit = 1000 } = {}) => new Map(
      [...values.entries()].filter(([key]) => key.startsWith(prefix)).slice(0, limit),
    ),
    transaction: async (callback) => callback(storage),
  };
  const queue = new ImageEditQueue({ storage });
  return {
    idFromName: () => "image-edit-global",
    get: () => ({ fetch: (url, options) => queue.fetch(new Request(url, options)) }),
  };
}

function aiDailyRateLimitBinding(allow = true, calls = []) {
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload);
        return Response.json({
          allowed: typeof allow === "function" ? allow(payload) : allow,
          remaining: 0,
        });
      },
    }),
  };
}

const PREMIUM_TEST_AUTH = {
  user: { sub: "premium-test-user" },
  env: { PREMIUM_ALLOWED_UIDS: "premium-test-user" },
};

test("provider API secrets are read from Worker environment and aliases", () => {
  const result = readProviderKeys(JSON.stringify({
    anthropic: "json-claude",
    moonshot: "json-kimi",
    nvidia_nim: "json-nvidia",
    openrouter_api_key: "json-openrouter",
    monid_api_key: "json-monid",
  }), {
    GEMINI_API_KEY: "legacy-gemini-secret",
    GEMINI_LIVE_API_KEY: "gemini-live-worker",
    GROQ_API_KEY: "groq-worker",
    OPENROUTER_API_KEY: "openrouter-worker",
    ANTHROPIC_API_KEY: "anthropic-worker",
    CLAUDE_API_KEY: "claude-worker",
    KIMI_API_KEY: "kimi-worker",
    NVIDIA_API_KEY: "",
    NVIDIA_NIM_API_KEY: "nvidia-worker",
    MONID_API_KEY: "monid-worker",
  });

  assert.deepEqual(result.keys, {
    claude: "claude-worker",
    groq: "groq-worker",
    kimi: "kimi-worker",
    monid: "monid-worker",
    nvidia: "nvidia-worker",
    openrouter: "openrouter-worker",
  });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(readProviderKeys("", {
    GEMINI_API_KEY: "legacy-gemini-secret",
    GEMINI_LIVE_API_KEY: "gemini-live-worker",
  }).keys, {});
  assert.deepEqual(readProviderKeys("", {
    ANTHROPIC_API_KEY: "anthropic-alias",
    MOONSHOT_API_KEY: "moonshot-alias",
    CLAUDE_API_KEY: "claude-alias",
    KIMI_API_KEY: "kimi-alias",
  }).keys, { claude: "claude-alias", kimi: "kimi-alias" });
  const unsupported = readProviderKeys(JSON.stringify({ huggingface_token: "unused-secret" }), {
    HF_TOKEN: "unused-secret",
  });
  assert.deepEqual(unsupported.keys, {});
  assert.match(unsupported.warnings[0], /tidak didukung Worker/);
});

test("presentation route accepts a bounded Canva outline and rejects invalid fields", () => {
  assert.deepEqual(validatePresentationBody({
    title: "Ringkasan",
    slides: [{ title: "Tujuan", content: ["Poin satu"], notes: "Catatan" }],
  }), {
    title: "Ringkasan",
    slides: [{ title: "Tujuan", content: ["Poin satu"], notes: "Catatan" }],
    exportFormat: "pptx",
  });
  assert.throws(() => validatePresentationBody({
    title: "Ringkasan",
    slides: [{ title: "Tujuan", content: ["Poin satu"], extra: "not allowed" }],
  }), /Data slide 1 tidak valid/);
  assert.throws(() => validatePresentationBody({
    title: "Ringkasan",
    slides: [{ title: "Tujuan", content: ["Poin satu"] }],
    exportFormat: "pptx-exe",
  }), /Format ekspor/);
});

test("Pages proxy forwards Canva OAuth and presentation routes to the Worker", async (context) => {
  const forwarded = [];
  setFetch(context, async (input) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    forwarded.push(requestUrl);
    return Response.json({ ok: true });
  });
  const routes = [
    ["/api/canva/oauth/start", "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev/canva/oauth/start"],
    ["/api/presentation", "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev/presentation"],
  ];
  for (const [path, expectedUrl] of routes) {
    const response = await pagesWorker.fetch(new Request(`https://myai-v3-firmansyah.pages.dev${path}`, {
      method: path.endsWith("/presentation") ? "POST" : "GET",
      headers: { Origin: "https://myai-v3-firmansyah.pages.dev" },
      ...(path.endsWith("/presentation") ? { body: "{}" } : {}),
    }), {});
    assert.equal(response.status, 200);
    assert.equal(await response.json().then((payload) => payload.ok), true);
    assert.equal(forwarded.at(-1), expectedUrl);
  }
});

test("all chat providers expose the shared server-side adapter contract", () => {
  assert.deepEqual(Object.keys(PROVIDER_ADAPTERS).sort(), ["claude", "groq", "kimi", "nvidia", "openrouter"]);
  assert.equal(PROVIDER_ADAPTERS.gemini, undefined);
  for (const [id, adapter] of Object.entries(PROVIDER_ADAPTERS)) {
    assert.equal(adapter.id, id);
    assert.equal(typeof adapter.name, "string");
    assert.equal(typeof adapter.icon, "string");
    assert.equal(adapter.needsKey, true);
    assert.equal(typeof adapter.listModels, "function");
    assert.equal(typeof adapter.chat, "function");
    assert.equal(typeof adapter.normalizeError, "function");
  }
});

test("legacy Hugging Face secrets cannot register a chat provider or trigger catalog requests", async (context) => {
  let requests = 0;
  setFetch(context, async () => {
    requests++;
    return Response.json({ data: [] });
  });
  assert.equal(PROVIDER_ADAPTERS.huggingface, undefined);
  assert.deepEqual(await gatewayModelGroups({ huggingface: "legacy-secret" }, ["huggingface"]), {
    groups: [],
    errors: [],
  });
  assert.equal(requests, 0);
});

test.skip("Legacy Hugging Face catalog and chat integration", async (context) => {
  clearGatewayCatalogCache("huggingface");
  let catalogRequest;
  const replaceFetch = setFetch(context, async (url, options = {}) => {
    catalogRequest = { url: String(url), options };
    return Response.json({ data: [
      { id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" },
      { id: "sentence-transformers/all-MiniLM-L6-v2", name: "Embedding model" },
    ] });
  });
  const catalog = await gatewayModelGroups({ huggingface: "hf-server-token" }, ["huggingface"]);
  assert.equal(catalogRequest.url, "https://router.huggingface.co/v1/models");
  assert.match(catalogRequest.options.headers.Authorization, /^Bearer /);
  assert.deepEqual(catalog.groups[0].models.map((model) => model.id), ["meta-llama/Llama-3.1-8B-Instruct"]);
  assert.equal(catalog.groups[0].models[0].accessTier, "basic");

  const config = PROVIDER_ADAPTERS.huggingface.chat({
    provider: "huggingface",
    key: "hf-server-token",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    messages: [{ role: "user", content: "Halo" }],
    temperature: 0.7,
  });
  assert.equal(config.url, "https://router.huggingface.co/v1/chat/completions");
  assert.match(config.headers.Authorization, /^Bearer /);
  assert.equal(config.headers["X-Title"], "MyAI");
  assert.equal(JSON.parse(JSON.stringify(config.body)).model, "meta-llama/Llama-3.1-8B-Instruct");

  replaceFetch(async (url, options = {}) => {
    assert.equal(String(url), "https://router.huggingface.co/v1/chat/completions");
    assert.match(options.headers.Authorization, /^Bearer /);
    return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\\n\\ndata: [DONE]\\n\\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await fetch(config.url, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify(config.body),
  });
  assert.equal(response.status, 200);
});

test("provider catalog test distinguishes working and rejected server-side secrets", async (context) => {
  clearGatewayCatalogCache();
  const replaceFetch = setFetch(context, async (url) => {
    assert.equal(String(url), "https://api.groq.com/openai/v1/models");
    return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
  });
  const connected = await testGatewayProvider("groq", "server-secret");
  assert.equal(connected.status, "HEALTHY");
  assert.equal(connected.modelCount, 1);
  assert.doesNotMatch(JSON.stringify(connected), /server-secret/);

  replaceFetch(async () => Response.json({ error: { message: "invalid key" } }, { status: 401 }));
  clearGatewayCatalogCache("groq");
  const rejected = await testGatewayProvider("groq", "server-secret");
  assert.equal(rejected.status, "ERROR");
  assert.equal(rejected.code, "INVALID_KEY_OR_PERMISSION");
  assert.doesNotMatch(JSON.stringify(rejected), /server-secret/);
});

  test.skip("Legacy Hugging Face 402 error normalization", () => {
    const message = PROVIDER_ADAPTERS.huggingface.normalizeError(
      402,
      JSON.stringify({ error: { message: "credits unavailable for token hf-secret-value" } }),
      "hf-secret-value",
    );
    assert.match(message, /credits unavailable/);
    assert.doesNotMatch(message, /hf-secret-value/);
  });

  test("live provider probe returns model usage and never exposes the configured secret", async (context) => {
    clearGatewayCatalogCache("groq");
    const calls = [];
    setFetch(context, async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
      }
      return Response.json({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 },
      });
    });
    const result = await probeGatewayProvider("groq", "groq-secret");
    assert.equal(result.status, "OK");
    assert.equal(result.model, "llama-3.1-8b-instant");
    assert.deepEqual(result.usage, { promptTokens: 9, completionTokens: 1, totalTokens: 10 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, "POST");
    assert.equal(JSON.parse(calls[1].options.body).stream, false);
    assert.equal(JSON.parse(calls[1].options.body).max_tokens, 64);
    assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
  });

  test("live provider probe tries another catalog model after a model-not-found response", async (context) => {
    clearGatewayCatalogCache("groq");
    const chatModels = [];
    setFetch(context, async (url, options = {}) => {
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [
          { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
          { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
        ] });
      }
      const model = JSON.parse(options.body).model;
      chatModels.push(model);
      if (model === "llama-3.1-8b-instant") return Response.json({ error: { message: "model not found" } }, { status: 404 });
      return Response.json({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
      });
    });
    const result = await probeGatewayProvider("groq", "groq-secret");
    assert.equal(result.status, "OK");
    assert.equal(result.model, "llama-3.3-70b-versatile");
    assert.deepEqual(chatModels, ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]);
  });

  test("live NVIDIA probe prefers the confirmed working Nemotron Bolt model", async (context) => {
    clearGatewayCatalogCache("nvidia");
    const chatModels = [];
    setFetch(context, async (url, options = {}) => {
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [
          { id: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
          { id: "nvidia/nemotron-3.5-lightning", name: "NVIDIA Nemotron 3.5 Lightning" },
          { id: "nvidia/nemotron-3.5-bolt-e4b", name: "NVIDIA Nemotron 3.5 Bolt E4B" },
        ] });
      }
      chatModels.push(JSON.parse(options.body).model);
      assert.equal(JSON.parse(options.body).max_tokens, 64);
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    });
    const result = await probeGatewayProvider("nvidia", "nvidia-secret");
    assert.equal(result.status, "OK");
    assert.deepEqual(chatModels, ["nvidia/nemotron-3.5-bolt-e4b"]);
  });

  test("live OpenRouter probe prefers the confirmed working free Cohere model", async (context) => {
    clearGatewayCatalogCache("openrouter");
    const chatModels = [];
    setFetch(context, async (url, options = {}) => {
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [
          {
            id: "cohere/north-mini-code:free",
            name: "North Mini Code",
            pricing: { prompt: "0", completion: "0" },
            architecture: { output_modalities: ["text"] },
          },
          {
            id: "meta-llama/llama-3.3-70b-instruct:free",
            name: "Llama 3.3 70B Instruct",
            pricing: { prompt: "0", completion: "0" },
            architecture: { output_modalities: ["text"] },
          },
          {
            id: "google/gemma-4-26b-a4b-it:free",
            name: "Gemma 4 26B",
            pricing: { prompt: "0", completion: "0" },
            architecture: { output_modalities: ["text"] },
          },
        ] });
      }
      const model = JSON.parse(options.body).model;
      chatModels.push(model);
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    });
    const result = await probeGatewayProvider("openrouter", "openrouter-secret");
    assert.equal(result.status, "OK");
    assert.deepEqual(chatModels, ["cohere/north-mini-code:free"]);
  });

  test("live provider probe does not retry other models for quota failures", async (context) => {
    clearGatewayCatalogCache("groq");
    let chatAttempts = 0;
    setFetch(context, async (url) => {
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [
          { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
          { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
        ] });
      }
      chatAttempts++;
      return Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 });
    });
    const result = await probeGatewayProvider("groq", "groq-secret");
    assert.equal(result.status, "KUOTA");
    assert.equal(chatAttempts, 1);
  });

  test("live provider probe classifies missing keys and invalid upstream keys", async (context) => {
    const missing = await probeGatewayProvider("groq", "");
    assert.equal(missing.status, "KEY_HILANG");
    clearGatewayCatalogCache("groq");
    setFetch(context, async (url) => String(url).endsWith("/models")
      ? Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] })
      : Response.json({ error: { message: "invalid api key" } }, { status: 401 }));
    const rejected = await probeGatewayProvider("groq", "invalid-secret");
    assert.equal(rejected.status, "KEY_SALAH");
    assert.equal(rejected.usage, null);
  });

  test("health route authenticates, rate-limits, tests requested providers and records usage payload", async (context) => {
    const { token, jwk } = await authorizedToken();
    clearGatewayCatalogCache("groq");
    setFetch(context, async (url, options = {}) => {
      if (String(url).includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      if (String(url).endsWith("/models")) {
        return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
      }
      return Response.json({
        choices: [{ message: { content: "OK" } }],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      });
    });
    const response = await worker.fetch(new Request("https://worker.test/api/health", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["groq"] }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      GROQ_API_KEY: "groq-secret",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.providers.groq.status, "OK");
    assert.deepEqual(result.providers.groq.usage, { promptTokens: 4, completionTokens: 1, totalTokens: 5 });
    assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
  });

  test("health route tests Monid without returning credentials", async (context) => {
    const { token, jwk } = await authorizedToken();
    setFetch(context, async (url, options = {}) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      if (target.includes("api.monid.ai/v1/discover")) return Response.json({ results: [] });
      throw new Error(`Unexpected request to ${target}`);
    });
    const response = await worker.fetch(new Request("https://worker.test/api/health", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["monid"] }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      MONID_API_KEY: "monid-secret",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.providers.monid.status, "OK");
    assert.equal(Object.hasOwn(result.providers, "pollinations"), false);
    assert.doesNotMatch(JSON.stringify(result), /monid-secret/);
  });

  test("health route verifies Gemini Live token issuance using only its dedicated secret", async (context) => {
    const { token, jwk } = await authorizedToken();
    const upstreamRequests = [];
    setFetch(context, async (url, options = {}) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      upstreamRequests.push({
        target,
        key: options.headers?.["x-goog-api-key"],
        body: JSON.parse(options.body),
      });
      return Response.json({ name: "authTokens/temporary-check-token" });
    });
    const response = await worker.fetch(new Request("https://worker.test/api/health", {
      method: "POST",
      headers: { Authorization: ["Bearer", token].join(" "), "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["gemini-live"] }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      GEMINI_API_KEY: "chat-secret-must-not-be-used",
      GEMINI_LIVE_API_KEY: "live-secret",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.providers["gemini-live"].status, "OK");
    assert.match(result.providers["gemini-live"].message, /WebSocket belum diuji/);
    assert.doesNotMatch(JSON.stringify(result), /live-secret|temporary-check-token/);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].target, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    assert.equal(upstreamRequests[0].key, "live-secret");
    assert.deepEqual(upstreamRequests[0].body.uses, 1);
  });

  test("image generation requires OpenRouter and never uses the Google Gemini API", async (context) => {
    const { token, jwk } = await authorizedToken();
    const upstreamRequests = [];
    setFetch(context, async (url) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      upstreamRequests.push(target);
      throw new Error(`Unexpected image provider request: ${target}`);
    });
    const response = await worker.fetch(new Request("https://worker.test/images/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "kemerdekaan indonesia",
        autoEnhance: false,
        plan: {
          prompt: "An Indonesian Independence Day flag ceremony at a village square.",
          negative: "unrelated subjects, text",
          aspect: "16:9",
          style: "editorial illustration",
          assumptions: "Saya menafsirkan tema sebagai upacara bendera.",
          enhanced: false,
          enhancer: "local",
        },
      }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      GEMINI_LIVE_API_KEY: "live-only-secret-must-not-be-used",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.match(result.error.message, /OPENROUTER_API_KEY/);
    assert.deepEqual(upstreamRequests, []);
    assert.doesNotMatch(JSON.stringify(result), /live-only-secret/);
  });

  test("OpenRouter Gemini Image quota errors are sanitized without trying Google or other image providers", async (context) => {
    const { token, jwk } = await authorizedToken();
    const upstreamRequests = [];
    setFetch(context, async (url) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      upstreamRequests.push(target);
      return Response.json({
        error: { code: 402, message: "openrouter-secret provider credits exhausted" },
      }, { status: 402 });
    });
    const response = await worker.fetch(new Request("https://worker.test/images/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "bendera Merah Putih",
        autoEnhance: false,
        plan: {
          prompt: "A red-and-white Indonesian flag in a village square.",
          negative: "text, logos",
          aspect: "1:1",
          style: "editorial illustration",
          assumptions: "Bendera Merah Putih di lapangan desa.",
          enhanced: false,
          enhancer: "local",
        },
      }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      OPENROUTER_API_KEY: "openrouter-secret",
      GEMINI_LIVE_API_KEY: "live-only-secret-must-not-be-used",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 429);
    const result = await response.json();
    assert.match(result.error.message, /kuota atau kredit OpenRouter/i);
    assert.doesNotMatch(JSON.stringify(result), /openrouter-secret|live-only-secret/);
    assert.deepEqual(upstreamRequests, ["https://openrouter.ai/api/v1/images"]);
  });

  test("provider catalogs map models into the requested access tiers", () => {
    assert.equal(modelAccessTier("openrouter", { id: "google/gemini-2.5-pro", name: "Gemini Pro" }), "max");
  assert.equal(modelAccessTier("groq", { id: "llama-3.1-8b-instant", name: "Llama 8B Instant" }), "free");
  assert.equal(modelAccessTier("groq", { id: "llama-3.3-70b-versatile", name: "Llama 70B" }), "pro");
  assert.equal(modelAccessTier("groq", { id: "llama-3.3-70b", name: "Llama 3.3" }), "pro");
  assert.equal(modelAccessTier("nvidia", { id: "nvidia/cosmos-reason2-8b", name: "Cosmos Reason2 8B" }), "free");
  assert.equal(modelAccessTier("nvidia", { id: "nvidia/nemotron", name: "Nemotron" }), "pro");
  assert.equal(modelAccessTier("nvidia", { id: "nvidia/llama-3.1-405b", name: "Llama 3.1 405B" }), "max");
  assert.equal(modelAccessTier("openrouter", { id: "meta/llama-4", name: "Llama" }), "pro");
  assert.equal(modelAccessTier("openrouter", { id: "meta/llama-4-scout", name: "Llama 4 Scout" }), "pro");
  assert.equal(modelAccessTier("openrouter", { id: "meta/llama-4-behemoth", name: "Llama 4 Behemoth", priceTier: "free" }), "free");
  assert.equal(modelAccessTier("openrouter", { id: "openai/gpt-4o", name: "GPT-4o" }), "max");
  assert.equal(modelAccessTier("openrouter", { id: "example/request-priced", name: "Request-priced", priceTier: "check" }), "basic");
});

test("OpenRouter catalog retains chat, image, audio, and embedding modalities with support metadata", async (context) => {
  setFetch(context, async (url) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/models");
    return Response.json({ data: [
      {
        id: "google/text-model",
        name: "Text Model",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "black-forest-labs/flux-1.1-pro",
        name: "Flux Image Generator",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["image"] },
      },
      {
        id: "provider/mixed-output",
        name: "Mixed Text and Image",
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text", "image"] },
      },
      {
        id: "qwen/qwen3-8b:free",
        name: "Qwen3 8B",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "audio/voice-model",
        name: "Voice Model",
        pricing: { prompt: "0.001", completion: "0.001" },
        architecture: { input_modalities: ["audio"], output_modalities: ["audio"] },
      },
      {
        id: "vector/embedding-model",
        name: "Vector Embedding",
        pricing: { prompt: "0.001", completion: "0.001" },
        architecture: { input_modalities: ["text"], output_modalities: ["embedding"] },
      },
    ] });
  });
  clearGatewayCatalogCache();
  const { groups } = await gatewayModelGroups({ openrouter: "openrouter-secret" }, ["openrouter"]);
  const models = groups[0].models;
  assert.deepEqual(models.map((model) => model.id), [
    "black-forest-labs/flux-1.1-pro",
    "provider/mixed-output",
    "qwen/qwen3-8b:free",
    "google/text-model",
    "vector/embedding-model",
    "audio/voice-model",
  ]);
  assert.equal(models.find((model) => model.id === "black-forest-labs/flux-1.1-pro").imageOnly, true);
  assert.equal(models.find((model) => model.id === "provider/mixed-output").chatSupport, true);
  assert.equal(models.find((model) => model.id === "provider/mixed-output").imageSupport, true);
  assert.equal(models.find((model) => model.id === "audio/voice-model").chatSupport, false);
  assert.equal(models.find((model) => model.id === "vector/embedding-model").chatSupport, false);
});

test("core accuracy instructions are added once while preserving user system context and messages", () => {
  const input = [
    { role: "system", content: "Answer in Indonesian and follow the user's coding constraints." },
    { role: "user", content: "Write a complete HTML page." },
  ];
  const result = withCoreSystemInstruction(input);
  assert.equal(result.length, 2);
  assert.match(result[0].content, /capable, warm, practical assistant/);
  assert.match(result[0].content, /Answer the latest request directly/);
  assert.match(result[0].content, /fewest tokens that fully solve the task/);
  assert.match(result[0].content, /distinguish evidence from inference/);
  assert.match(result[0].content, /Follow safety, privacy, and copyright limits/);
  assert.match(result[0].content, /Answer in Indonesian/);
  assert.deepEqual(result[1], input[1]);
  assert.equal(input[0].content, "Answer in Indonesian and follow the user's coding constraints.");
  const defaulted = withCoreSystemInstruction([{ role: "user", content: "hello" }]);
  assert.equal(defaulted[0].role, "system");
  assert.match(defaulted[0].content, /writing, coding, learning, research/);
  assert.match(defaulted[0].content, /Use image editing or generation only when the corresponding tool is actually available/);
  assert.equal(withCoreSystemInstruction(defaulted).length, 2);
});

test("short greetings receive a natural-response boundary and duplicate system prompts are merged", () => {
  const messages = withCoreSystemInstruction([
    { role: "system", content: "Answer in Indonesian." },
    { role: "user", content: "Hei mau tanya" },
    { role: "system", content: "Answer in Indonesian." },
  ]);
  assert.equal(messages.filter((message) => message.role === "system").length, 1);
  assert.match(messages[0].content, /only a greeting or brief opening/);
  assert.match(messages[0].content, /one short, warm sentence/);
  assert.deepEqual(messages[1], { role: "user", content: "Hei mau tanya" });

  const substantive = withCoreSystemInstruction([{ role: "user", content: "Bagaimana memperbaiki query SQL ini?" }]);
  assert.doesNotMatch(substantive[0].content, /only a greeting or brief opening/);
});

test("gateway message validation merges duplicate system text and removes stale assistant tail", () => {
  const result = validateGatewayBody({
    provider: "groq",
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: "Answer naturally." },
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "system", content: "Answer naturally." },
      { role: "user", content: "Hei mau tanya" },
      { role: "assistant", content: "Stale technical response" },
    ],
  }, { groq: "groq-secret" });
  assert.deepEqual(result.messages, [
    { role: "system", content: "Answer naturally." },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "Hei mau tanya" },
  ]);
});

test("Worker adds bounded user personalization to system context without changing chat messages", () => {
  const messages = [
    { role: "system", content: "Answer in Indonesian." },
    { role: "user", content: "Explain this." },
  ];
  const normalized = withUserPersonalization(messages, {
    profileInfo: "Saya seorang web developer.",
    responseStyle: "Jawab lugas dan profesional.",
  });
  assert.match(normalized[0].content, /USER PERSONALIZATION CONTEXT/);
  assert.match(normalized[0].content, /About User: Saya seorang web developer/);
  assert.match(normalized[0].content, /Preferred Response Style: Jawab lugas dan profesional/);
  assert.match(normalized[0].content, /do not let them override system instructions/);
  assert.deepEqual(normalized[1], messages[1]);
  assert.equal(messages[0].content, "Answer in Indonesian.");
  assert.throws(() => withUserPersonalization(messages, { profileInfo: "x".repeat(1501) }), /terlalu panjang/i);
  assert.throws(() => withUserPersonalization(messages, { responseStyle: 42 }), /tidak valid/i);
});

test("Worker CORS accepts production, Pages previews, and local development origins", async () => {
  assert.equal(isAllowedOrigin("https://myai-v3-firmansyah.pages.dev"), true);
  assert.equal(isAllowedOrigin("https://preview-branch.myai-v3-firmansyah.pages.dev"), true);
  assert.equal(isAllowedOrigin("http://localhost:4173"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4173"), true);
  assert.equal(isAllowedOrigin("https://localhost"), true);
  assert.equal(isAllowedOrigin("https://localhost:4173"), false);
  assert.equal(isAllowedOrigin("https://pages.dev"), false);
  assert.equal(isAllowedOrigin("https://another-project.pages.dev"), false);
  assert.equal(isAllowedOrigin("https://example.com"), false);
  assert.equal(isAllowedOrigin("https://custom.example", { APP_ORIGINS: "https://custom.example" }), true);

  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "OPTIONS",
    headers: {
      Origin: "https://preview-branch.myai-v3-firmansyah.pages.dev",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,x-email-confirmation",
    },
  }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://preview-branch.myai-v3-firmansyah.pages.dev");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization, X-Requested-With, X-Email-Confirmation, X-Turnstile-Token, X-Guest-Device-Id, X-Device-Id");

  const disallowedResponse = await worker.fetch(new Request("https://worker.test/chat", {
    method: "OPTIONS",
    headers: { Origin: "https://another-project.pages.dev" },
  }), {});
  assert.equal(disallowedResponse.status, 403);
  assert.equal(disallowedResponse.headers.get("Access-Control-Allow-Origin"), null);

  const pagesResponse = await pagesWorker.fetch(new Request("https://myai-v3-firmansyah.pages.dev/api/chat", {
    method: "OPTIONS",
    headers: { Origin: "https://b1259143.myai-v3-firmansyah.pages.dev" },
  }), {});
  assert.equal(pagesResponse.status, 204);
  assert.equal(pagesResponse.headers.get("Access-Control-Allow-Origin"), "https://b1259143.myai-v3-firmansyah.pages.dev");
  assert.equal(pagesResponse.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");

  const disallowedPagesResponse = await pagesWorker.fetch(new Request("https://myai-v3-firmansyah.pages.dev/api/chat", {
    method: "OPTIONS",
    headers: { Origin: "https://another-project.pages.dev" },
  }), {});
  assert.equal(disallowedPagesResponse.status, 204);
  assert.equal(disallowedPagesResponse.headers.get("Access-Control-Allow-Origin"), null);
});

test("chat SSE starts with heartbeat and terminates idle providers with a readable timeout", async () => {
  const upstream = new ReadableStream({ start() {} });
  const response = streamResponse(new Response(upstream), undefined, 10, 1000);
  const body = await response.text();
  assert.match(body, /^: keep-alive\n\n/);
  assert.match(body, /tidak mengirim data selama 1 detik/);
  assert.match(body, /data: \[DONE\]/);
});

test("chat SSE reports token and timing metrics before the terminal event", async () => {
  const startedAt = Date.now() - 1200;
  const response = streamResponse(new Response([
    'data: {"choices":[{"delta":{"content":"hello"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":12,"total_tokens":42}}',
    "data: [DONE]",
    "",
  ].join("\n\n")), undefined, 1000, 1000, { model: "test-model", startedAt });
  const body = await response.text();
  const metricsMatch = body.match(/data: (\{"type":"metrics"[^]*?\})\n\n/);
  assert.ok(metricsMatch);
  const metrics = JSON.parse(metricsMatch[1]);
  assert.equal(metrics.tokens, 42);
  assert.equal(metrics.completion_tokens, 12);
  assert.equal(metrics.model, "test-model");
  assert.ok(metrics.duration_ms >= 1000);
  assert.ok(body.indexOf('"type":"metrics"') < body.indexOf("data: [DONE]"));
  assert.match(body, /"content":"hello"/);
});

test("gateway SSE sends its initial heartbeat before provider tokens", async () => {
  const response = gatewayStreamResponse(new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'), "groq");
  const body = await response.text();
  assert.match(body, /^: keep-alive\n\n/);
  assert.match(body, /"content":"hello"/);
});

test("gateway SSE adds usage and duration metrics before the terminal event", async () => {
  const startedAt = Date.now() - 850;
  const response = gatewayStreamResponse(new Response([
    'data: {"choices":[{"delta":{"content":"hello"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}',
    "data: [DONE]",
    "",
  ].join("\n\n")), "groq", undefined, 1000, 1000, { model: "llama-test", startedAt });
  const body = await response.text();
  const metricsMatch = body.match(/data: (\{"type":"metrics"[^]*?\})\n\n/);
  assert.ok(metricsMatch);
  const metrics = JSON.parse(metricsMatch[1]);
  assert.equal(metrics.tokens, 28);
  assert.equal(metrics.completion_tokens, 8);
  assert.equal(metrics.model, "llama-test");
  assert.ok(metrics.duration_ms >= 800);
  assert.ok(metrics.tokens_per_second > 0);
  assert.ok(body.indexOf('"type":"metrics"') < body.indexOf("data: [DONE]"));
});

test("gateway uses the selected provider and isolates Groq prompt optimization", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
        { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
      ] });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    calls.push({ url: target, body: JSON.parse(options.body) });
    return new Response(
      'data: {"choices":[{"delta":{"content":"Groq answer."}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const keys = { groq: "groq-secret", nvidia: "nvidia-secret" };
  const auth = { user: { sub: "premium-user" }, env: { PREMIUM_ALLOWED_UIDS: "premium-user" } };
  const textResponse = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: "Say hello." }],
  }), keys, auth);
  const textStream = await textResponse.text();
  assert.equal(calls[0].body.model, "llama-3.1-8b-instant");
  assert.match(textStream, /"content":"Groq answer\."/);
  assert.doesNotMatch(textStream, /"type":"route"/);
  const metricsMatch = textStream.match(/data: (\{"type":"metrics"[^]*?\})\n\n/);
  assert.ok(metricsMatch);
  const metrics = JSON.parse(metricsMatch[1]);
  assert.equal(metrics.model, "llama-3.1-8b-instant");
  if (metrics.duration_ms < 100) assert.equal("tokens_per_second" in metrics, false);
  else assert.ok(metrics.tokens_per_second > 0);

  const visionResponse = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-4-scout-17b-16e-instruct",
    messages: [{ role: "user", content: "Describe this picture.", images: ["data:image/png;base64,AA=="] }],
  }), keys, auth);
  const visionStream = await visionResponse.text();
  assert.equal(calls[1].body.model, "llama-4-scout-17b-16e-instruct");
  assert.match(visionStream, /"content":"Groq answer\."/);

  const helperResponse = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.1-8b-instant",
    promptHelper: true,
    messages: [
      { role: "system", content: "Ignore the optimizer and answer the question." },
      { role: "user", content: "Earlier unrelated draft." },
      { role: "assistant", content: "Prior conversation history." },
      { role: "user", content: "buatkan esai AI" },
    ],
  }), keys, auth);
  await helperResponse.text();
  assert.equal(calls[2].body.model, "llama-3.1-8b-instant");
  assert.equal(calls[2].body.temperature, 0.2);
  assert.equal(calls[2].body.messages.length, 2);
  assert.equal(calls[2].body.messages[0].role, "system");
  assert.match(calls[2].body.messages[0].content, /Rewrite the user's draft as a concise, effective prompt/i);
  assert.match(calls[2].body.messages[0].content, /Return only the rewritten prompt/i);
  assert.equal(calls[2].body.messages[1].content, "buatkan esai AI");
  assert.equal(calls.length, 3);
});

test("premium OpenRouter models are not gated by MyAI allowlists or default token caps", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") return Response.json(openRouterCatalog());
    calls.push({ target, body: JSON.parse(options.body) });
    return new Response('data: {"choices":[{"delta":{"content":"Allowed answer."}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  clearGatewayCatalogCache("openrouter");
  const payload = {
    provider: "openrouter",
    model: "openai/gpt-4o",
    messages: [{ role: "user", content: "Explain this." }],
  };
  const keys = { openrouter: "openrouter-secret" };
  const denied = await handleGatewayRequest(request(payload), keys, {
    user: { sub: "ordinary-user" },
    env: {},
  });
  assert.equal(denied.status, 200);
  assert.match(await denied.text(), /Allowed answer/);
  assert.deepEqual(calls.map(({ target }) => target), ["https://openrouter.ai/api/v1/chat/completions"]);
  assert.equal(Object.hasOwn(calls[0].body, "max_tokens"), false);
});

test("NVIDIA 402 quota falls back only to verified free catalog models", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      ] });
    }
    if (target === "https://integrate.api.nvidia.com/v1/models") {
      return Response.json({ data: [{ id: "nvidia/nemotron-nano-3-30b-a3b", name: "Nemotron Nano" }] });
    }
    calls.push({ url: target, body: JSON.parse(options.body) });
    if (target === "https://integrate.api.nvidia.com/v1/chat/completions") {
      return Response.json({ error: { message: "insufficient credits" } }, { status: 402 });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(JSON.parse(options.body).model, "llama-3.1-8b-instant");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Free fallback answer."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    provider: "nvidia",
    model: "nvidia/nemotron-nano-3-30b-a3b",
    messages: [{ role: "user", content: "Continue without charging." }],
  }), { groq: "groq-secret", nvidia: "nvidia-secret" }, {
    user: { sub: "premium-user" },
    env: { PREMIUM_ALLOWED_UIDS: "premium-user" },
  });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ body }) => body.model), [
    "nvidia/nemotron-nano-3-30b-a3b",
    "llama-3.1-8b-instant",
  ]);
  assert.match(stream, /"type":"fallback"/);
  assert.doesNotMatch(stream, /llama-3\.3-70b-versatile/);
  assert.match(stream, /Free fallback answer/);
});

test("direct Gemini chat is excluded from gateway model discovery", async (context) => {
  clearGatewayCatalogCache();
  let requests = 0;
  setFetch(context, async () => {
    requests++;
    throw new Error("Direct Gemini catalog must not be requested.");
  });
  const result = await gatewayModelGroups({ gemini: "legacy-secret" }, ["gemini"]);
  assert.deepEqual(result, { groups: [], errors: [] });
  assert.equal(requests, 0);
  clearGatewayCatalogCache();
});

test("Groq vision catalog marks currently supported Llama vision model IDs", async (context) => {
  clearGatewayCatalogCache("groq");
  setFetch(context, async () => Response.json({
    data: [
      { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    ],
  }));
  const { groups } = await gatewayModelGroups({ groq: "groq-secret" }, ["groq"]);
  const models = groups[0].models;
  assert.equal(models.find((model) => model.id === "llama-4-scout-17b-16e-instruct").imageSupport, true);
  assert.equal(models.find((model) => model.id === "llama-3.3-70b-versatile").imageSupport, undefined);
});

test("NVIDIA catalog excludes embedding and safety models while retaining chat models", async (context) => {
  clearGatewayCatalogCache();
  setFetch(context, async () => Response.json({
    data: [
      { id: "nvidia/nemotron-nano-3-30b-a3b", name: "Nemotron Nano" },
      { id: "nvidia/nemotron-3-embed-1b", name: "Nemotron Embed" },
      { id: "nvidia/llama-3.1-nemoguard-8b-content-safety", name: "Nemoguard Content Safety" },
      { id: "nvidia/llama-nemotron-retriever-1b", name: "Nemotron Retriever" },
      { id: "google/gemma-3-4b-it", name: "Gemma 3 Instruct" },
    ],
  }));
  const result = await gatewayModelGroups({ nvidia: "configured" }, ["nvidia"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.groups[0].models.map((model) => model.id), [
    "google/gemma-3-4b-it",
    "nvidia/nemotron-nano-3-30b-a3b",
  ]);
  clearGatewayCatalogCache();
});

test("NVIDIA NIM catalogs explicitly reported or named vision models", async (context) => {
  clearGatewayCatalogCache("nvidia");
  setFetch(context, async () => Response.json({
    data: [
      { id: "meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 Vision" },
      { id: "nvidia/custom-vision-chat", name: "Custom Vision", architecture: { input_modalities: ["text", "image"] } },
      { id: "nvidia/nemotron-nano-3-30b-a3b", name: "Nemotron Nano" },
    ],
  }));
  const { groups } = await gatewayModelGroups({ nvidia: "nvidia-secret" }, ["nvidia"]);
  const models = groups[0].models;
  assert.equal(models.find((model) => model.id === "meta/llama-3.2-11b-vision-instruct").imageSupport, true);
  assert.equal(models.find((model) => model.id === "nvidia/custom-vision-chat").imageSupport, true);
  assert.equal(models.find((model) => model.id === "nvidia/nemotron-nano-3-30b-a3b").imageSupport, undefined);
});

test("guest models use current provider catalogs instead of hardcoded model IDs", () => {
  const models = guestModelsForKeys(
    { openrouter: "configured" },
    [
      {
        provider: "gateway-groq",
        models: [
          { id: "llama-current-8b", name: "Llama 8B", accessTier: "free" },
          { id: "llama-current-70b", name: "Llama 70B", accessTier: "pro" },
        ],
      },
    ],
    [
      { id: "qwen/qwen3-8b:free", name: "Qwen3 8B" },
      { id: "example/openrouter-free", name: "OpenRouter Free" },
    ],
  );
  assert.deepEqual(models.map((model) => model.id), [
    "groq::llama-current-8b",
    "openrouter::qwen/qwen3-8b:free",
    "openrouter::example/openrouter-free",
  ]);
  assert.equal(models[0].backendProvider, "groq");
  assert.equal(models[0].accessTier, "free");
  assert.equal(models.some((model) => /qwen|qwq/i.test(`${model.id} ${model.name}`)), true);
});

test("guest catalog prioritizes one baseline NVIDIA NIM model and excludes premium and vision NIM models", () => {
  const models = guestModelsForKeys(
    { nvidia: "configured" },
    [
      {
        provider: "gateway-nvidia",
        models: [
          { id: "nvidia/cosmos-reason2-8b", name: "Cosmos Reason2 8B", accessTier: "free", priceTier: "check" },
          { id: "nvidia/nemotron-ultra", name: "Nemotron Ultra", accessTier: "max" },
          { id: "nvidia/nemotron-vision", name: "Nemotron Vision 8B", accessTier: "basic", imageSupport: true },
          { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", accessTier: "basic" },
          { id: "meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct", accessTier: "basic" },
          { id: "meta/llama-3.1-8b-limited", name: "Llama 3.1 8B", accessTier: "basic", availabilityStatus: "limited-rate" },
        ],
      },
    ],
  );
  assert.deepEqual(models.map((model) => model.id), ["nvidia::nvidia/cosmos-reason2-8b"]);
  assert.equal(models[0].backendProvider, "nvidia");
  assert.match(models[0].name, /NVIDIA NIM/);
  assert.equal(models[0].priceTier, "check");
});

test("guest-general tries NVIDIA NIM first and falls back to Groq without using Gemini", async (context) => {
  clearGatewayCatalogCache("nvidia");
  clearGatewayCatalogCache("groq");
  const attemptedModels = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return Response.json({ success: true });
    }
    if (target === "https://integrate.api.nvidia.com/v1/models") {
      return Response.json({ data: [
        { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
      ] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    if (target === "https://integrate.api.nvidia.com/v1/chat/completions") {
      attemptedModels.push(JSON.parse(options.body).model);
      return Response.json({ error: { message: "quota exhausted" } }, { status: 429 });
    }
    if (target === "https://api.groq.com/openai/v1/chat/completions") {
      attemptedModels.push(JSON.parse(options.body).model);
      return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    throw new Error(`Unexpected provider request: ${target}`);
  });
  const counterActions = [];
  const response = await worker.fetch(new Request("https://worker.test/guest/chat", {
    method: "POST",
    headers: guestHeaders(),
    body: JSON.stringify({
      model: "guest-general",
      messages: [{ role: "user", content: "Hei" }],
    }),
  }), {
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "test-secret",
    NVIDIA_API_KEY: "nvidia-secret",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    GUEST_TRIAL_COUNTER: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (url) => {
          const action = String(url).split("/").pop();
          counterActions.push(action);
          return Response.json(action === "reserve" ? { reserved: true, remaining: 1 } : { remaining: 2 });
        },
      }),
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(attemptedModels, ["meta/llama-3.1-8b-instruct", "llama-3.1-8b-instant"]);
  assert.deepEqual(counterActions, ["reserve"]);
});

test("guest NVIDIA NIM success returns a readable streamed answer without calling fallback providers", async (context) => {
  clearGatewayCatalogCache("nvidia");
  const attempts = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return Response.json({ success: true });
    }
    if (target === "https://integrate.api.nvidia.com/v1/models") {
      return Response.json({ data: [
        { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
      ] });
    }
    if (target === "https://integrate.api.nvidia.com/v1/chat/completions") {
      const body = JSON.parse(options.body);
      attempts.push(body.model);
      assert.equal(body.stream, true);
      assert.match(body.messages.at(-1).content, /Hei/);
      return new Response([
        'data: {"choices":[{"delta":{"content":"Halo, ada yang bisa saya bantu?"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":8,"total_tokens":12}}',
        "data: [DONE]",
        "",
      ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected fallback request: ${target}`);
  });
  const response = await worker.fetch(new Request("https://worker.test/guest/chat", {
    method: "POST",
    headers: guestHeaders(),
    body: JSON.stringify({
      model: "nvidia::meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: "Hei" }],
    }),
  }), {
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "test-secret",
    NVIDIA_API_KEY: "nvidia-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    GUEST_TRIAL_COUNTER: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => Response.json({ reserved: true, remaining: 1 }),
      }),
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(attempts, ["meta/llama-3.1-8b-instruct"]);
  const output = await response.text();
  assert.match(output, /Halo, ada yang bisa saya bantu\?/);
  assert.match(output, /"type":"metrics"/);
  assert.match(output, /"model":"meta\/llama-3\.1-8b-instruct"/);
});

test("guest chat without a Turnstile token is rejected", async () => {
  const response = await worker.fetch(new Request("https://worker.test/guest/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.51",
      "X-Guest-Device-Id": "7f6e75d2-0fb1-4a5d-8b24-bb8a3ea57419",
    },
    body: JSON.stringify({ model: "guest-general", messages: [{ role: "user", content: "Hai" }] }),
  }), {
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "test-secret",
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error.message, /verifikasi keamanan.*diperlukan/i);
});

test("guest chat fails closed with a clear configuration error when Turnstile secret is missing", async () => {
  const response = await worker.fetch(new Request("https://worker.test/guest/chat", {
    method: "POST",
    headers: guestHeaders(),
    body: JSON.stringify({ model: "guest-general", messages: [{ role: "user", content: "Hai" }] }),
  }), {
    TURNSTILE_SITE_KEY: "site-key",
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /TURNSTILE_SITE_KEY dan TURNSTILE_SECRET_KEY/i);
});

test("guest trial reservations are atomic and refunds restore the shared quota", async () => {
  const values = new Map();
  let transactionQueue = Promise.resolve();
  const storage = {
    get: async (key) => values.get(key),
    transaction: (callback) => {
      const result = transactionQueue.then(() => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value),
      }));
      transactionQueue = result.catch(() => {});
      return result;
    },
  };
  const counter = new GuestTrialCounter({ storage });
  const reservations = await Promise.all([
    counter.fetch(new Request("https://guest-trial.internal/reserve", { method: "POST" })).then((response) => response.json()),
    counter.fetch(new Request("https://guest-trial.internal/reserve", { method: "POST" })).then((response) => response.json()),
    counter.fetch(new Request("https://guest-trial.internal/reserve", { method: "POST" })).then((response) => response.json()),
  ]);
  assert.equal(reservations.filter((result) => result.reserved).length, 2);
  assert.equal(reservations.filter((result) => !result.reserved).length, 1);
  const refund = await counter.fetch(new Request("https://guest-trial.internal/refund", { method: "POST" }));
  assert.deepEqual(await refund.json(), { remaining: 1 });
});

test("guest transcription consumes the same trial quota as chat", async (context) => {
  const actions = [];
  const rateLimitKeys = [];
  let used = 0;
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const verification = new URLSearchParams(options.body);
      assert.equal(verification.get("secret"), "test-secret");
      assert.equal(verification.get("response"), "valid-test-turnstile-token");
      assert.equal(verification.get("remoteip"), "203.0.113.52");
      return Response.json({ success: true });
    }
    if (target === "https://api.groq.com/openai/v1/audio/transcriptions") {
      return Response.json({ text: "teks hasil transkripsi" });
    }
    throw new Error(`Unexpected request to ${target}`);
  });
  const form = new FormData();
  form.append("audio", new Blob(["audio"], { type: "audio/webm" }), "guest.webm");
  const response = await worker.fetch(new Request("https://worker.test/guest/transcribe", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.52",
      "X-Turnstile-Token": "valid-test-turnstile-token",
      "X-Guest-Device-Id": "7f6e75d2-0fb1-4a5d-8b24-bb8a3ea57419",
    },
    body: form,
  }), {
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "test-secret",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: {
      limit: async ({ key }) => {
        rateLimitKeys.push(key);
        return { success: true };
      },
    },
    GUEST_TRIAL_COUNTER: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (url) => {
          const action = String(url).split("/").pop();
          actions.push(action);
          if (action === "reserve") {
            used += 1;
            return Response.json({ reserved: true, remaining: 2 - used });
          }
          if (action === "refund") used = Math.max(0, used - 1);
          return Response.json({ remaining: 2 - used });
        },
      }),
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "teks hasil transkripsi" });
  assert.deepEqual(actions, ["reserve"]);
  assert.equal(rateLimitKeys.length, 2);
  assert.equal(rateLimitKeys[0], "guest-ip:203.0.113.52");
  assert.match(rateLimitKeys[1], /^guest-device:[a-f0-9]{64}$/);
  assert.equal(used, 1);
});

test("guest transcription refunds its trial reservation when the provider fails", async (context) => {
  const actions = [];
  let used = 0;
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      return Response.json({ success: true });
    }
    if (target === "https://api.groq.com/openai/v1/audio/transcriptions") {
      return Response.json({ error: { message: "provider unavailable" } }, { status: 503 });
    }
    throw new Error(`Unexpected request to ${target}`);
  });
  const form = new FormData();
  form.append("audio", new Blob(["audio"], { type: "audio/webm" }), "guest.webm");
  const response = await worker.fetch(new Request("https://worker.test/guest/transcribe", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "203.0.113.53",
      "X-Turnstile-Token": "valid-test-turnstile-token",
      "X-Guest-Device-Id": "7f6e75d2-0fb1-4a5d-8b24-bb8a3ea57419",
    },
    body: form,
  }), {
    TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "test-secret",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    GUEST_TRIAL_COUNTER: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (url) => {
          const action = String(url).split("/").pop();
          actions.push(action);
          if (action === "reserve") {
            used += 1;
            return Response.json({ reserved: true, remaining: 1 });
          }
          if (action === "refund") used = Math.max(0, used - 1);
          return Response.json({ remaining: 2 - used });
        },
      }),
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(actions, ["reserve", "refund"]);
  assert.equal(used, 0);
});

test("gateway rejects unknown provider names and display aliases before any upstream call", async () => {
  const response = await handleGatewayRequest(request({ provider: "unknown", model: "x", messages: [] }), {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /Provider gateway harus/);
});

test("gateway reports missing Groq key without exposing secrets", async () => {
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "hello" }],
  }, "POST", "http://127.0.0.1:4173"), {});
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "MISSING_ENV_SECRETS");
  assert.equal(body.error, true);
  assert.match(body.message, /\.dev\.vars/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:4173");
});

test("gateway handles preflight and echoes the local preview origin", async () => {
  const response = await handleGatewayRequest(new Request("https://worker.test/api/gateway", {
    method: "OPTIONS",
    headers: { Origin: "http://127.0.0.1:4173" },
  }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:4173");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization, X-Requested-With");

  const disallowed = await handleGatewayRequest(new Request("https://worker.test/api/gateway", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" },
  }), {});
  assert.equal(disallowed.status, 204);
  assert.equal(disallowed.headers.get("Access-Control-Allow-Origin"), null);
});

test("gateway rejects audio and video payloads with a transcription instruction", async () => {
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "Summarize this clip", video: "base64-data" }],
  }), { groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /ditranskripsikan atau diringkas menjadi teks/);
});

test("chat validates an empty model by selecting an available free model from the provider catalog", async (context) => {
  clearGatewayCatalogCache("groq");
  setFetch(context, async (url) => {
    assert.equal(String(url), "https://api.groq.com/openai/v1/models");
    return Response.json({ data: [
      { id: "llama-3.1-8b-instant", name: "Llama Free" },
      { id: "llama-3.3-70b-versatile", name: "Llama Pro" },
    ] });
  });
  const result = await validateChatBody({
    provider: "groq",
    model: "",
    messages: [{ role: "user", content: "hello" }],
    customInstructions: { profileInfo: "Developer", responseStyle: "Answer briefly." },
  }, { groq: "groq-secret" });
  assert.equal(result.model, "llama-3.1-8b-instant");
  assert.match(result.messages[0].content, /production-ready/);
  assert.match(result.messages[0].content, /About User: Developer/);
  assert.match(result.messages[0].content, /Preferred Response Style: Answer briefly/);
  assert.equal(result.messages[1].content, "hello");
});

test("legacy chat validation rejects direct Gemini models", async () => {
  await assert.rejects(validateChatBody({
    provider: "gemini",
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "Answer briefly." }],
  }, {}), /Provider ini harus digunakan melalui AI gateway/);
});

test("gateway returns upstream failures as readable SSE error events", async (context) => {
  clearGatewayCatalogCache("groq");
  setFetch(context, async (url) => {
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" }] });
    }
    return Response.json({ error: { message: "invalid api key" } }, { status: 401 });
  });
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "hello" }],
  }), { groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/event-stream/);
  assert.match(body, /"type":"provider-health","provider":"groq"/);
  assert.match(body, /"status":"ERROR"/);
  assert.match(body, /data: \{"error":"groq: API key ditolak\./);
  assert.match(body, /data: \[DONE\]/);
  assert.doesNotMatch(body, /groq-secret/);
});

test("gateway does not silently switch providers or retry a 401", async (context) => {
  const calls = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") return Response.json(openRouterCatalog());
    calls.push(target);
    return Response.json({ error: { message: "invalid key" } }, { status: 401 });
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    provider: "openrouter",
    model: "openai/gpt-4o",
    messages: [{ role: "user", content: "Say hello." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
  assert.match(stream, /API key ditolak/);
  assert.doesNotMatch(stream, /"provider":"groq"/);
});

test("gateway uses the Groq catalog and OpenAI-compatible stream", async (context) => {
  setFetch(context, async (url, options) => {
    if (String(url).endsWith("/models")) {
      assert.equal(options.headers.Authorization, "Bearer groq-secret");
      return Response.json({ data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" }] });
    }
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(JSON.parse(options.body).max_tokens, 4096);
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await handleGatewayRequest(request({ provider: "groq", model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hello" }] }), { groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"content":"hello"/);
  assert.match(body, /data: \[DONE\]/);
  assert.doesNotMatch(body, /groq-secret/);
});

test("gateway ignores invalid zero output-token metadata instead of sending max_tokens zero", async (context) => {
  clearGatewayCatalogCache("groq");
  setFetch(context, async (url, options) => {
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B Instant",
        max_completion_tokens: 0,
      }] });
    }
    const maxTokens = JSON.parse(options.body).max_tokens;
    assert.ok(Number.isSafeInteger(maxTokens) && maxTokens > 0);
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: "hello" }],
  }), { groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"content":"hello"/);
});

test("every gateway adapter sends a valid output-token value when catalog metadata is zero", async (context) => {
  const cases = [
    { provider: "claude", key: "claude-secret", model: "claude-3-5-haiku-latest" },
    { provider: "groq", key: "groq-secret", model: "llama-3.1-8b-instant" },
    { provider: "openrouter", key: "openrouter-secret", model: "meta/llama-3.1-8b-instruct:free" },
    { provider: "nvidia", key: "nvidia-secret", model: "nvidia/cosmos-reason2-8b" },
    { provider: "kimi", key: "kimi-secret", model: "moonshot-v1-8k" },
  ];
  const submitted = new Map();
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("models?pageSize=") || target.endsWith("/models") || target.includes("/v1/models?limit=")) {
      if (target.includes("api.anthropic.com")) {
        return Response.json({ data: [{ id: cases[0].model, display_name: "Claude Haiku", max_output_tokens: 0 }] });
      }
      const providerCase = cases.find((item) => {
        const providerOrigin = {
          groq: "api.groq.com",
          openrouter: "openrouter.ai",
          nvidia: "integrate.api.nvidia.com",
          kimi: "api.moonshot.cn",
        }[item.provider];
        return target.includes(providerOrigin);
      });
      assert.ok(providerCase, `Unexpected catalog URL ${target}`);
      const model = {
        id: providerCase.model,
        name: providerCase.model,
        top_provider: { max_completion_tokens: 0 },
      };
      if (providerCase.provider === "openrouter") {
        model.pricing = { prompt: "0", completion: "0" };
        model.architecture = { output_modalities: ["text"] };
      }
      return Response.json({ data: [model] });
    }

    const current = cases.find((item) => {
      const chatOrigin = {
        claude: "api.anthropic.com",
        groq: "api.groq.com",
        openrouter: "openrouter.ai",
        nvidia: "integrate.api.nvidia.com",
        kimi: "api.moonshot.cn",
      }[item.provider];
      return target.includes(chatOrigin);
    });
    assert.ok(current, `Unexpected chat URL ${target}`);
    const payload = JSON.parse(options.body);
    submitted.set(current.provider, payload);
    return Response.json({ error: { message: "provider request inspected" } }, { status: 400 });
  });

  for (const item of cases) {
    clearGatewayCatalogCache(item.provider);
    const response = await handleGatewayRequest(request({
      provider: item.provider,
      model: item.model,
      messages: [{ role: "user", content: "Check token limit." }],
    }), { [item.provider]: item.key }, PREMIUM_TEST_AUTH);
    assert.equal(response.status, 200, item.provider);
    const body = submitted.get(item.provider);
    assert.ok(body, `${item.provider} received no request`);
    const maxTokens = item.provider === "openrouter" ? body.max_tokens ?? 1 : body.max_tokens;
    assert.ok(Number.isSafeInteger(maxTokens) && maxTokens > 0, `${item.provider} sent invalid max tokens: ${maxTokens}`);
  }
});

test.skip("Legacy Hugging Face catalog and chat routing", async (context) => {
  clearGatewayCatalogCache("huggingface");
  setFetch(context, async (url, options) => {
    if (String(url).endsWith("/models")) {
      assert.equal(String(url), "https://router.huggingface.co/v1/models");
      assert.match(options.headers.Authorization, /^Bearer /);
      return Response.json({ data: [{ id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" }] });
    }
    assert.equal(String(url), "https://router.huggingface.co/v1/chat/completions");
    assert.match(options.headers.Authorization, /^Bearer /);
    assert.equal(JSON.parse(options.body).model, "meta-llama/Llama-3.1-8B-Instruct");
    return new Response('data: {"choices":[{"delta":{"content":"halo"}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await handleGatewayRequest(request({
    provider: "huggingface",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    messages: [{ role: "user", content: "Halo" }],
  }), { huggingface: "huggingface-secret" }, PREMIUM_TEST_AUTH);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"content":"halo"/);
  assert.match(body, /data: \[DONE\]/);
  assert.doesNotMatch(body, /huggingface-secret/);
});

test("OpenRouter output is uncapped by MyAI limits but respects the selected model maximum", async (context) => {
  const chatBodies = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "cohere/north-mini-code:free",
        name: "North Mini Code",
        pricing: { prompt: "0", completion: "0", request: "0" },
        architecture: { output_modalities: ["text"] },
        top_provider: { max_completion_tokens: 12000 },
      }] });
    }
    chatBodies.push(JSON.parse(options.body));
    return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const user = {
    sub: "maintenance-user",
    email: "ops@example.com",
    email_verified: true,
  };
  const env = { AI_ADMIN_EMAILS: "ops@example.com" };
  const keys = { openrouter: "openrouter-server-token" };
  const payload = {
    provider: "openrouter",
    model: "cohere/north-mini-code:free",
    messages: [{ role: "user", content: "Reply briefly." }],
    maxOutputTokens: 999_999,
  };

  clearGatewayCatalogCache("openrouter");
  const adminResponse = await handleGatewayRequest(request(payload), keys, { user, env });
  assert.equal(adminResponse.status, 200);
  await adminResponse.text();
  assert.equal(chatBodies[0].max_tokens, 12_000);

  clearGatewayCatalogCache("openrouter");
  const regularResponse = await handleGatewayRequest(request(payload), keys, {
    user: { sub: "regular-user", email: "user@example.com", email_verified: true },
    env,
  });
  assert.equal(regularResponse.status, 200);
  await regularResponse.text();
  assert.equal(chatBodies[1].max_tokens, 12_000);
});

test.skip("Legacy Hugging Face 402/403 fallback routing", async (context) => {
  let upstreamStatus = 402;
  const chatCalls = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://router.huggingface.co/v1/models") {
      return Response.json({ data: [{ id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    chatCalls.push(target);
    if (target === "https://router.huggingface.co/v1/chat/completions") {
      return Response.json({ error: { message: "provider access unavailable" } }, { status: upstreamStatus });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response('data: {"choices":[{"delta":{"content":"Fallback answer."}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });

  for (const status of [402, 403]) {
    upstreamStatus = status;
    chatCalls.length = 0;
    clearGatewayCatalogCache();
    const response = await handleGatewayRequest(request({
      provider: "huggingface",
      model: "meta-llama/Llama-3.1-8B-Instruct",
      messages: [{ role: "user", content: "Answer through a valid backup." }],
    }), {
      huggingface: "hf-server-token",
      groq: "groq-server-token",
    }, PREMIUM_TEST_AUTH);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(chatCalls, [
      "https://router.huggingface.co/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
    ]);
    assert.match(body, /Fallback answer\./);
    assert.match(body, /"provider":"huggingface","model":"meta-llama\/Llama-3\.1-8B-Instruct".*"status":"EXHAUSTED"/);
    assert.match(body, new RegExp(`HTTP ${status}`));
    assert.match(body, /"provider":"groq"/);

    const hfCatalog = await gatewayModelGroups({ huggingface: "hf-server-token" }, ["huggingface"]);
    assert.equal(hfCatalog.groups[0].models[0].availabilityStatus, status === 403 ? "permission-required" : "credit-required");

    const retry = await handleGatewayRequest(request({
      provider: "huggingface",
      model: "meta-llama/Llama-3.1-8B-Instruct",
      messages: [{ role: "user", content: "Stay on a valid provider." }],
    }), {
      huggingface: "hf-server-token",
      groq: "groq-server-token",
    }, PREMIUM_TEST_AUTH);
    assert.match(await retry.text(), /Fallback answer\./);
    assert.deepEqual(chatCalls.slice(2), ["https://api.groq.com/openai/v1/chat/completions"]);
  }
});

test.skip("Legacy Hugging Face circuit behavior", async (context) => {
  let chatCalls = 0;
  setFetch(context, async (url) => {
    if (String(url) === "https://router.huggingface.co/v1/models") {
      return Response.json({ data: [{ id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" }] });
    }
    chatCalls++;
    return Response.json({ error: { message: "credits unavailable" } }, { status: 402 });
  });
  clearGatewayCatalogCache();
  const keys = { huggingface: "hf-server-token" };
  const payload = {
    provider: "huggingface",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    messages: [{ role: "user", content: "Try a backup safely." }],
  };
  const first = await handleGatewayRequest(request(payload), keys, PREMIUM_TEST_AUTH);
  const firstBody = await first.text();
  const second = await handleGatewayRequest(request(payload), keys, PREMIUM_TEST_AUTH);
  const secondBody = await second.text();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(chatCalls, 1);
  assert.match(firstBody, /"status":"EXHAUSTED"/);
  assert.match(secondBody, /"status":"EXHAUSTED"/);
  assert.match(secondBody, /dinonaktifkan sementara/);
  assert.match(secondBody, /data: \[DONE\]/);
});

test("Claude Messages SSE is normalized and reports output truncation", async (context) => {
  clearGatewayCatalogCache("claude");
  setFetch(context, async (url, options) => {
    if (String(url).includes("/v1/models?limit=1000")) {
      assert.equal(options.headers["x-api-key"], "claude-secret");
      assert.equal(options.headers["anthropic-version"], "2023-06-01");
      return Response.json({ data: [{ id: "claude-3-5-haiku-latest", display_name: "Claude 3.5 Haiku" }] });
    }
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_tokens, 8192);
    return new Response([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"The response"}}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":8192}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
      "",
    ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await handleGatewayRequest(request({
    provider: "claude",
    model: "claude-3-5-haiku-latest",
    messages: [{ role: "user", content: "hello" }],
  }), { claude: "claude-secret" }, PREMIUM_TEST_AUTH);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"content":"The response"/);
  assert.match(body, /"truncated":true/);
  assert.match(body, /"prompt_tokens":5/);
  assert.match(body, /"completion_tokens":8192/);
  assert.doesNotMatch(body, /claude-secret/);
});

test("Kimi uses its OpenAI-compatible endpoint and reports output truncation", async (context) => {
  clearGatewayCatalogCache("kimi");
  setFetch(context, async (url, options) => {
    if (String(url).endsWith("/models")) {
      assert.match(options.headers.Authorization, /^Bearer /);
      return Response.json({ data: [{ id: "kimi-k2.5", name: "Kimi K2.5" }] });
    }
    assert.equal(url, "https://api.moonshot.cn/v1/chat/completions");
    assert.equal(JSON.parse(options.body).max_tokens, 8192);
    return new Response([
      'data: {"choices":[{"delta":{"content":"The answer"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
  });
  const catalog = await gatewayModelGroups({ kimi: "kimi-secret" }, ["kimi"]);
  assert.deepEqual(catalog.groups.flatMap((group) => group.models.map((model) => model.id)), ["kimi-k2.5"], JSON.stringify(catalog));
  const response = await handleGatewayRequest(request({
    provider: "kimi",
    model: "kimi-k2.5",
    messages: [{ role: "user", content: "hello" }],
  }), { kimi: "kimi-secret" }, PREMIUM_TEST_AUTH);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert.match(body, /"content":"The answer"/);
  assert.match(body, /"truncated":true/);
  assert.doesNotMatch(body, /kimi-secret/);
});

test("direct Gemini chat is rejected by the gateway adapter", async () => {
  const response = await handleGatewayRequest(request({
    provider: "gemini",
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "Find current information" }],
  }), {});
  assert.equal(response.status, 400);
});

test("OpenRouter gateway enables web search and preserves citation annotations", async (context) => {
  clearGatewayCatalogCache("openrouter");
  setFetch(context, async (url, options) => {
    if (String(url).endsWith("/models")) return Response.json(openRouterCatalog());
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.plugins, [{ id: "web", max_results: 10 }]);
    return new Response('data: {"choices":[{"delta":{"annotations":[{"type":"url_citation","url_citation":{"url":"https://example.org/report","title":"Report"}}]}}]}\n\ndata: {"choices":[{"delta":{"content":"Verified result."}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await handleGatewayRequest(request({
    provider: "openrouter",
    model: "openai/gpt-4o",
    messages: [{ role: "user", content: "Research this topic" }],
    webSearch: true,
    researchMode: true,
  }), { openrouter: "openrouter-secret" }, PREMIUM_TEST_AUTH);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"annotations":/);
  assert.match(body, /"content":"Verified result\."/);
  assert.match(body, /https:\/\/example\.org\/report/);
});

test("gateway rejects web searches for providers without search capability", async () => {
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "Search the web" }],
    webSearch: true,
  }), { groq: "groq-secret" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /Pilih OpenRouter/);
});

test("gateway routes NVIDIA through its OpenAI-compatible API", async (context) => {
  clearGatewayCatalogCache("nvidia");
  const providers = [
    {
      provider: "nvidia",
      key: "nvidia-secret",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      catalog: "https://integrate.api.nvidia.com/v1/models",
      chat: "https://integrate.api.nvidia.com/v1/chat/completions",
    },
  ];
  setFetch(context, async (url, options) => {
    const config = providers.find((item) => String(url) === item.catalog || String(url) === item.chat);
    assert.ok(config, `Unexpected provider URL: ${url}`);
    assert.equal(options.headers.Authorization, `Bearer ${config.key}`);
    if (String(url) === config.catalog) return Response.json({ data: [{ id: config.model, name: config.model }] });
    assert.equal(JSON.parse(options.body).model, config.model);
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  for (const config of providers) {
    const response = await handleGatewayRequest(request({
      provider: config.provider,
      model: config.model,
      messages: [{ role: "user", content: "hello" }],
    }), { [config.provider]: config.key }, PREMIUM_TEST_AUTH);
    const body = await response.text();
    assert.equal(response.status, 200, `${config.provider} status`);
    assert.match(body, /"content":"hello"/, `${config.provider} content`);
    assert.doesNotMatch(body, new RegExp(config.key), `${config.provider} secret`);
  }
});

test("Claude and GPT model IDs route through OpenRouter with one key", async (context) => {
  clearGatewayCatalogCache("openrouter");
  let calls = 0;
  setFetch(context, async (url, options) => {
    calls++;
    if (String(url).endsWith("/models")) {
      assert.equal(options.headers.Authorization, "Bearer openrouter-secret");
      return Response.json(openRouterCatalog());
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers["X-Title"], "MyAI");
    const body = JSON.parse(options.body);
    assert.ok(["anthropic/claude-sonnet-4", "openai/gpt-4o"].includes(body.model));
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  for (const model of ["anthropic/claude-sonnet-4", "openai/gpt-4o"]) {
    const response = await handleGatewayRequest(request({ provider: "openrouter", model, messages: [{ role: "user", content: "hello" }] }), { openrouter: "openrouter-secret" }, PREMIUM_TEST_AUTH);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /"content":"hello"/);
    assert.doesNotMatch(body, /openrouter-secret/);
  }
  assert.equal(calls, 3);
});

test("OpenRouter catalog orders OpenAI first and never returns the API key", async (context) => {
  clearGatewayCatalogCache();
  setFetch(context, async () => Response.json(openRouterCatalog()));
  const { groups, errors } = await gatewayModelGroups({ openrouter: "private-secret" }, ["openrouter"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(groups[0].models.map((model) => model.id), ["openai/gpt-4o", "anthropic/claude-sonnet-4", "meta/llama-4-scout"]);
  assert.equal(groups[0].models[1].priceTier, "check");
  assert.equal(groups[0].models[1].contextWindow, 200000);
  assert.deepEqual(groups[0].models.map((model) => model.accessTier), ["max", "max", "pro"]);
  assert.equal(JSON.stringify(groups).includes("private-secret"), false);
});

test("OpenRouter catalog returns all available text models without a display cap", async (context) => {
  const data = Array.from({ length: 150 }, (_, index) => ({
    id: `example/model-${index}`,
    name: `Model ${index}`,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    architecture: { output_modalities: ["text"] },
  }));
  setFetch(context, async () => Response.json({ data }));
  clearGatewayCatalogCache("openrouter");
  const { groups, errors } = await gatewayModelGroups({ openrouter: "private-secret" }, ["openrouter"]);
  assert.deepEqual(errors, []);
  assert.equal(groups[0].models.length, 150);
});

test("authenticated chat has no MyAI token ceiling and respects model output metadata", () => {
  const env = { AI_ADMIN_EMAILS: "maintenance@example.com, other@example.com" };
  assert.equal(isMaintenanceAdmin({
    email: " Maintenance@Example.com ",
    email_verified: true,
  }, env), true);
  assert.equal(outputTokenLimitForUser({ email: "maintenance@example.com", email_verified: true }, env), Number.MAX_SAFE_INTEGER);
  assert.equal(isMaintenanceAdmin({
    email: "maintenance@example.com.attacker.test",
    email_verified: true,
  }, env), false);
  assert.equal(isMaintenanceAdmin({
    email: "maintenance@example.com",
    email_verified: false,
  }, env), false);
  assert.equal(outputTokenLimitForUser({ email: "user@example.com", email_verified: true }, env), Number.MAX_SAFE_INTEGER);
  assert.equal(dailyLimitForUser({ email: "maintenance@example.com", email_verified: true }, env, "chat"), null);
  assert.equal(dailyLimitForUser({ email: "user@example.com", email_verified: true }, env, "chat"), null);
});

test("gateway uses an explicitly authorized Groq fallback for a limited OpenRouter model", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    calls.push({ url: target, body: JSON.parse(options.body) });
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Recovered."}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Say recovered." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[1].body.model, "llama-3.1-8b-instant");
  assert.match(stream, /"type":"fallback"/);
  assert.match(stream, /"provider":"groq"/);
  assert.match(stream, /HTTP 429/);
  assert.match(stream, /"model":"llama-3\.1-8b-instant"/);

  const { groups } = await gatewayModelGroups({ openrouter: "openrouter-secret", groq: "groq-secret" }, ["openrouter"]);
  assert.equal(groups[0].models[0].availabilityStatus, "limited-rate");
});

test("gateway does not continue fallback through direct Gemini after HTTP 400", async (context) => {
  const chatCalls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
        { id: "llama-3.2-3b-preview", name: "Llama 3.2 3B" },
      ] });
    }
    chatCalls.push({ url: target, body: JSON.parse(options.body) });
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      return Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 });
    }
    if (target === "https://api.groq.com/openai/v1/chat/completions") {
      assert.ok(Number.isSafeInteger(chatCalls.at(-1).body.max_tokens) && chatCalls.at(-1).body.max_tokens > 0);
      return Response.json({ error: { message: "`max_tokens` must be positive" } }, { status: 400 });
    }
    assert.fail(`Unexpected provider request after Gemini removal: ${target}`);
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Try another free provider." }],
  }), {
    openrouter: "openrouter-secret",
    groq: "groq-secret",
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.deepEqual(chatCalls.map(({ url }) => url), [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
  ]);
  assert.match(stream, /rate limit/i);
  assert.match(stream, /max_tokens.*positive/i);
  assert.doesNotMatch(stream, /"provider":"gemini"/);
});

test("gateway skips the rest of a provider's models after its first HTTP 400", async (context) => {
  const chatCalls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
        { id: "llama-3.2-3b-preview", name: "Llama 3.2 3B" },
      ] });
    }
    chatCalls.push(target);
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      return Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return Response.json({ error: { message: "`max_tokens` must be positive" } }, { status: 400 });
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Try a fallback model." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(chatCalls, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
  ]);
  assert.match(stream, /rate limit/i);
  assert.match(stream, /max_tokens.*positive/i);
});

test("gateway retries provider server errors and uses an explicitly authorized fallback", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    calls.push(target);
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      return Response.json({ error: { message: "temporarily unavailable" } }, { status: 500 });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Recovered from server error."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Recover from provider failure." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.deepEqual(calls, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
  ]);
  assert.match(stream, /Recovered from server error\./);
  assert.match(stream, /"provider":"groq"/);
  assert.match(stream, /HTTP 500/);
});

test("gateway does not retry invalid stream data but can use an explicitly authorized text fallback", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    calls.push({ url: target, body: JSON.parse(options.body) });
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      return new Response("data: this is not valid JSON\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Recovered from invalid stream."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Recover from invalid provider output." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[1].body.model, "llama-3.1-8b-instant");
  assert.match(stream, /Recovered from invalid stream\./);
  assert.match(stream, /"type":"fallback"/);
  assert.match(stream, /"provider":"groq"/);
  assert.match(stream, /stream yang tidak valid/);
});

test("gateway uses the built-in model catalog to fail over when a provider catalog is unavailable", async (context) => {
  const calls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ error: { message: "catalog temporarily unavailable" } }, { status: 503 });
    }
    calls.push({ url: target, body: JSON.parse(options.body) });
    if (target === "https://openrouter.ai/api/v1/chat/completions") {
      return Response.json({ error: { message: "temporarily unavailable" } }, { status: 503 });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(calls.at(-1).body.model, "llama-3.1-8b-instant");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Built-in fallback recovered."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Continue with a text response." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls.at(-1).body.model, "llama-3.1-8b-instant");
  assert.match(stream, /"type":"fallback"/);
  assert.match(stream, /Built-in fallback recovered\./);
});

test("gateway does not retry network failures but can use an explicitly authorized fallback", async (context) => {
  const calls = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma 4 (free)",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    calls.push(target);
    if (target === "https://openrouter.ai/api/v1/chat/completions") throw new TypeError("network unavailable");
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Recovered after network failure."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Recover from a network issue." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.deepEqual(calls, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
  ]);
  assert.match(stream, /Recovered after network failure\./);
  assert.match(stream, /"provider":"groq"/);
});

test("gateway fallback stops at supported providers and never routes directly to Gemini", async (context) => {
  const chatCalls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "google/gemma-4-26b-a4b-it:free",
        name: "Gemma Free",
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    chatCalls.push(target);
    if (target === "https://openrouter.ai/api/v1/chat/completions"
      || target === "https://api.groq.com/openai/v1/chat/completions") {
      return Response.json({ error: { message: "temporarily unavailable" } }, { status: 500 });
    }
    assert.fail(`Unexpected provider request after Gemini removal: ${target}`);
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Use the next healthy provider." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(chatCalls, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
  ]);
  assert.match(stream, /Fallback terakhir/);
  assert.doesNotMatch(stream, /"provider":"gemini"/);
  assert.match(stream, /"provider":"openrouter","model":"google\/gemma-4-26b-a4b-it:free"[^}]*"status":"ERROR"/);
  assert.match(stream, /"provider":"groq","model":"llama-3.1-8b-instant"[^}]*"status":"ERROR"/);
});

test("gateway uses a configured free model only after fallback is explicitly authorized", async (context) => {
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Recovered without the selected key."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "openai/removed-model",
    messages: [{ role: "user", content: "Use an available fallback." }],
  }), { groq: "groq-secret" });
  const stream = await response.text();
  assert.equal(response.status, 200, stream);
  assert.match(stream, /Recovered without the selected key\./);
  assert.match(stream, /"provider":"groq"/);
});

test("gateway removes a model from its live catalog temporarily after provider HTTP 404 and explicit fallback", async (context) => {
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://integrate.api.nvidia.com/v1/models") {
      return Response.json({ data: [{ id: "nvidia/legacy-model", name: "NVIDIA Legacy Model" }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    if (target === "https://integrate.api.nvidia.com/v1/chat/completions") {
      return Response.json({ error: { message: "model not found" } }, { status: 404 });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Available fallback."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "nvidia",
    model: "nvidia/legacy-model",
    messages: [{ role: "user", content: "Say available fallback." }],
  }), { nvidia: "nvidia-secret", groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Available fallback\./);
  const catalog = await gatewayModelGroups({ nvidia: "nvidia-secret" }, ["nvidia"]);
  assert.equal(catalog.groups.length, 0);
});

test("gateway reports a fallback when the requested model is absent and explicitly authorized", async (context) => {
  setFetch(context, async (url) => {
    const target = String(url);
    if (target === "https://integrate.api.nvidia.com/v1/models") {
      return Response.json({ data: [{ id: "nvidia/current-model", name: "NVIDIA Current Model" }] });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    return new Response(
      'data: {"choices":[{"delta":{"content":"Recovered from catalog miss."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "nvidia",
    model: "nvidia/retired-model",
    messages: [{ role: "user", content: "Say recovered." }],
  }), { nvidia: "nvidia-secret", groq: "groq-secret" });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /"type":"fallback"/);
  assert.match(stream, /"provider":"groq"/);
  assert.match(stream, /"model":"llama-3\.1-8b-instant"/);
  assert.match(stream, /Recovered from catalog miss\./);
});

test("gateway rejects models not present in the selected provider catalog", async (context) => {
  setFetch(context, async () => Response.json(openRouterCatalog()));
  const response = await handleGatewayRequest(request({ provider: "openrouter", model: "openai/unlisted-model", messages: [{ role: "user", content: "hello" }] }), { openrouter: "test-secret" });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error.message, /tidak tersedia pada katalog/);
});

test("gateway rejects histories without a user message", async () => {
  const response = await handleGatewayRequest(request({
    provider: "openrouter",
    model: "openai/gpt-4o",
    messages: [{ role: "system", content: "Only system." }],
  }), { openrouter: "test-secret" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /setidaknya satu pesan pengguna/);
});

test("gateway validates image support after resolving the catalog model", async (context) => {
  clearGatewayCatalogCache("groq");
  setFetch(context, async () => Response.json({
    data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" }],
  }));
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    messages: [{
      role: "user",
      content: "Describe this image.",
      images: ["data:image/png;base64,AA=="],
    }],
  }), { groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /tidak mencantumkan dukungan input gambar/);
});

test("gateway sends uploaded image data to a model that advertises vision support", async (context) => {
  clearGatewayCatalogCache("groq");
  let upstreamBody;
  setFetch(context, async (url, options) => {
    if (String(url) === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" }] });
    }
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    upstreamBody = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"Gambar menunjukkan seekor kucing."}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-4-scout-17b-16e-instruct",
    messages: [{
      role: "user",
      content: "Jelaskan gambar ini.",
      images: ["data:image/jpeg;base64,AA=="],
    }],
  }), { groq: "groq-secret" }, PREMIUM_TEST_AUTH);
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody.messages[0].content[1], {
    type: "image_url",
    image_url: { url: "data:image/jpeg;base64,AA==" },
  });
  assert.match(await response.text(), /Gambar menunjukkan seekor kucing/);
});

test("legacy non-Gemini image routes reject requests without contacting image providers", async (context) => {
  let upstreamCalls = 0;
  setFetch(context, async () => {
    upstreamCalls += 1;
    throw new Error("The Worker must not fetch Pollinations.");
  });
  const response = await worker.fetch(new Request("https://worker.test/guest/images/pollinations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:4173",
      "cf-connecting-ip": "203.0.113.10",
    },
    body: JSON.stringify({ prompt: "red robot", model: "flux", width: 1024, height: 1024 }),
  }));
  assert.equal(response.status, 410);
  const result = await response.json();
  assert.match(result.error.message, /hanya tersedia melalui Gemini Image di OpenRouter/i);
  assert.equal(upstreamCalls, 0);
});

let authTestKeys;
async function authorizedToken({
  email = "user@example.com",
  emailVerified = true,
  provider = "google.com",
  aud = "my-ai-69027",
  iss = "https://securetoken.google.com/my-ai-69027",
  expirationOffsetSeconds = 3600,
} = {}) {
  if (!authTestKeys) {
    const pair = await crypto.subtle.generateKey({
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    }, true, ["sign", "verify"]);
    const kid = `test-${crypto.randomUUID()}`;
    authTestKeys = {
      pair,
      jwk: { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid },
      kid,
    };
  }
  const { pair, jwk, kid } = authTestKeys;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode({
    aud,
    iss,
    sub: "test-user",
    email,
    email_verified: emailVerified,
    iat: issuedAt,
    exp: issuedAt + expirationOffsetSeconds,
    firebase: { sign_in_provider: provider },
  })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned));
  return { token: `${unsigned}.${Buffer.from(signature).toString("base64url")}`, jwk };
}

test("verified Google and GitHub accounts access server models without an email allowlist", async (context) => {
  const accounts = [
    await authorizedToken({ email: "new-google-user@example.com" }),
    await authorizedToken({ email: "new-github-user@example.com", provider: "github.com" }),
  ];
  const jwk = accounts[0].jwk;
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  for (const { token } of accounts) {
    const response = await worker.fetch(new Request("https://worker.test/api/models", {
      method: "POST",
      headers: { Authorization: ["Bearer", token].join(" "), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      MONID_API_KEY: "monid-secret",
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).providers, ["monid"]);
  }
});

test("the authenticated model endpoint excludes direct Gemini chat providers", async (context) => {
  clearGatewayCatalogCache();
  const { token, jwk } = await authorizedToken();
  const catalogs = new Map([
    ["https://integrate.api.nvidia.com/v1/models", { data: [{ id: "nvidia/nemotron-nano-30b", name: "Nemotron Nano" }] }],
    ["https://openrouter.ai/api/v1/models", {
      data: [{
        id: "meta-llama/llama-4-scout",
        name: "Llama 4 Scout",
        pricing: { prompt: "0.000001", completion: "0.000002" },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      }],
    }],
    ["https://api.groq.com/openai/v1/models", { data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" }] }],
    ["https://api.anthropic.com/v1/models?limit=1000", { data: [{ id: "claude-3-7-sonnet-latest", display_name: "Claude Sonnet" }] }],
    ["https://api.moonshot.cn/v1/models", { data: [{ id: "kimi-k2.5", name: "Kimi K2.5" }] }],
  ]);
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    const catalog = catalogs.get(target);
    assert.ok(catalog, `Unexpected catalog URL: ${target}`);
    return Response.json(catalog);
  });
  const response = await worker.fetch(new Request("https://worker.test/api/models", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ includeCatalog: true }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    NVIDIA_API_KEY: "nvidia-secret",
    GEMINI_LIVE_API_KEY: "gemini-live-secret",
    OPENROUTER_API_KEY: "openrouter-secret",
    GROQ_API_KEY: "groq-secret",
    CLAUDE_API_KEY: "claude-secret",
    KIMI_API_KEY: "kimi-secret",
    HF_TOKEN: "huggingface-secret",
  });
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.deepEqual(catalog.providers, ["openrouter", "groq", "nvidia", "claude", "kimi"]);
  assert.deepEqual(catalog.groups.map((group) => group.provider), [
    "gateway-nvidia",
    "gateway-openrouter",
    "gateway-groq",
    "gateway-claude",
    "gateway-kimi",
  ]);
  assert.ok(catalog.groups.every((group) => group.models.length === 1 && !group.models[0].catalogFallback));
  assert.doesNotMatch(JSON.stringify(catalog), /(?:nvidia|gemini-live|openrouter|groq|claude|kimi|huggingface)-secret/);
});

test("authenticated chat endpoints reject direct Gemini routing", async (context) => {
  const { token, jwk } = await authorizedToken();
  const upstreamRequests = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    upstreamRequests.push(target);
    throw new Error(`Unexpected provider request: ${target}`);
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GEMINI_LIVE_API_KEY: "gemini-live-secret",
    OPENROUTER_API_KEY: "openrouter-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  for (const [path, payload] of [
    ["/api/chat", { provider: "gemini", model: "gemini-2.5-flash", messages: [{ role: "user", content: "hello" }] }],
    ["/api/gateway", { provider: "gemini", model: "gemini-2.5-flash", messages: [{ role: "user", content: "hello" }] }],
  ]) {
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }), env);
    assert.equal(response.status, 400, path);
    assert.match((await response.json()).error.message, /provider|model/i, path);
  }
  assert.deepEqual(upstreamRequests, []);
});

test("Gemini Live reads only the dedicated Worker secret", async (context) => {
  const { token, jwk } = await authorizedToken();
  const upstreamRequests = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    upstreamRequests.push({ target, key: options.headers?.["x-goog-api-key"] });
    return Response.json({ name: "authTokens/ephemeral-token", expireTime: "2026-10-28T00:00:00Z" });
  });
  const response = await worker.fetch(new Request("https://worker.test/api/live/token", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    GEMINI_API_KEY: "legacy-secret-must-not-be-used",
    GEMINI_LIVE_API_KEY: "live-only-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    token: "authTokens/ephemeral-token",
    expireTime: "2026-10-28T00:00:00Z",
  });
  assert.deepEqual(upstreamRequests, [{
    target: "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
    key: "live-only-secret",
  }]);
});

test("password and phone accounts cannot use server models", async (context) => {
  const accounts = [
    await authorizedToken({ email: "password-user@example.com", provider: "password" }),
    await authorizedToken({ email: "phone-user@example.com", provider: "phone" }),
  ];
  const jwk = accounts[0].jwk;
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  for (const { token } of accounts) {
    const response = await worker.fetch(new Request("https://worker.test/api/models", {
      method: "POST",
      headers: { Authorization: ["Bearer", token].join(" "), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      MONID_API_KEY: "monid-secret",
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error.message, /Google atau GitHub/i);
  }
});

test("unverified accounts remain blocked from server models", async (context) => {
  const { token, jwk } = await authorizedToken({ email: "unverified@example.com", emailVerified: false });
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  const response = await worker.fetch(new Request("https://worker.test/api/models", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    MONID_API_KEY: "monid-secret",
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error.message, /Google atau GitHub yang sudah terverifikasi/i);
});

test("expired Firebase tokens and mismatched audience or issuer are rejected", async (context) => {
  const invalidTokens = [
    await authorizedToken({ expirationOffsetSeconds: -60 }),
    await authorizedToken({ aud: "another-project" }),
    await authorizedToken({ iss: "https://securetoken.google.com/another-project" }),
  ];
  const jwk = invalidTokens[0].jwk;
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  for (const { token } of invalidTokens) {
    const authHeaders = new Headers({ "Content-Type": "application/json" });
    authHeaders.set("Authorization", ["Bearer", token].join(" "));
    const response = await worker.fetch(new Request("https://worker.test/api/models", {
      method: "POST",
      headers: authHeaders,
      body: "{}",
    }), { FIREBASE_PROJECT_ID: "my-ai-69027", MONID_API_KEY: "monid-secret" });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error.message, /sesi Firebase tidak valid atau kedaluwarsa/i);
  }
});

test("Monid-only secret exposes the data service without requiring a chat provider key", async (context) => {
  const { token, jwk } = await authorizedToken();
  let monidAuthorization = "";
  setFetch(context, async (url, options = {}) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(String(url), "https://api.monid.ai/v1/discover/endpoints");
    monidAuthorization = options.headers.Authorization;
    assert.deepEqual(JSON.parse(options.body), {
      q: "recent weather data",
      limit: 5,
      minScore: 0.2,
      readonly: true,
    });
    return Response.json({ items: [{ provider: "example", endpoint: "/items" }], total: 1 });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    AI_PROVIDER_KEYS: JSON.stringify({ MONID_API_KEY: "monid-secret" }),
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const modelsResponse = await worker.fetch(new Request("https://worker.test/api/models", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }), env);
  assert.equal(modelsResponse.status, 200);
  const catalog = await modelsResponse.json();
  assert.deepEqual(catalog.providers, ["monid"]);
  assert.deepEqual(catalog.services, [{ provider: "monid", accessTier: "basic", kind: "data-tools" }]);
  assert.doesNotMatch(JSON.stringify(catalog), /monid-secret/);

  const discoverResponse = await worker.fetch(new Request("https://worker.test/api/monid/discover", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "recent weather data" }),
  }), env);
  assert.equal(discoverResponse.status, 200);
  assert.equal(monidAuthorization, "Bearer monid-secret");
  assert.deepEqual(await discoverResponse.json(), {
    items: [{ provider: "example", endpoint: "/items" }],
    total: 1,
    results: [{ provider: "example", endpoint: "/items" }],
  });
});

const AI_RATE_LIMIT_TEST_ROUTES = [
  ["image generation", "/api/images/generate", { prompt: "A simple landscape" }, "image-generate"],
  ["transcription", "/api/transcribe", new FormData(), "transcribe"],
  ["Monid discovery", "/api/monid/discover", { query: "weather" }, "monid-discover"],
  ["Monid inspect", "/api/monid/inspect", { provider: "example", endpoint: "/items" }, "monid-inspect"],
  ["Monid run", "/api/monid/run", { provider: "example", endpoint: "/items", input: {} }, "monid-run"],
  ["Monid get", "/api/monid/get", { runId: "run-id-12345678" }, "monid-get"],
  ["Gemini Live token", "/api/live/token", {}, "live-token"],
  ["email preview", "/api/send-email/preview", { to: "user@example.com", subject: "Test", body_markdown: "Test" }, "email-preview"],
  ["email send", "/api/send-email", { to: "user@example.com", subject: "Test", body_markdown: "Test" }, "email"],
];

test("AI routes enforce per-minute UID limits with Indonesian 429 responses", async (context) => {
  const { token, jwk } = await authorizedToken();
  const rateLimitKeys = [];
  setFetch(context, async (url) => {
    assert.match(String(url), /securetoken@system\.gserviceaccount\.com/);
    return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
  });
  for (const [label, path, payload, route] of AI_RATE_LIMIT_TEST_ROUTES) {
    const rateLimitBinding = {
      limit: async ({ key }) => {
        rateLimitKeys.push(key);
        return { success: false };
      },
    };
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...(payload instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      GEMINI_LIVE_API_KEY: "gemini-live-secret",
      AI_RATE_LIMITER: rateLimitBinding,
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 429, label);
    assert.match((await response.json()).error.message, /batas .* per menit/i, label);
    assert.equal(rateLimitKeys.at(-1), `${route}:test-user`, label);
  }
});

test("AI routes require login before applying either rate limit", async () => {
  const protectedRoutes = [
    ...AI_RATE_LIMIT_TEST_ROUTES,
    ["chat", "/api/chat", { provider: "gemini", model: "gemini-2.5-flash", messages: [{ role: "user", content: "hello" }] }],
  ];
  for (const [label, path, payload] of protectedRoutes) {
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
      method: "POST",
      headers: payload instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
    }), {});
    assert.equal(response.status, 401, label);
    assert.match((await response.json()).error.message, /masuk|akun|login/i, label);
  }
});

test("AI routes enforce per-day UID limits with Indonesian 429 responses", async (context) => {
  const { token, jwk } = await authorizedToken();
  const dailyCalls = [];
  setFetch(context, async (url) => {
    assert.match(String(url), /securetoken@system\.gserviceaccount\.com/);
    return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
  });
  for (const [label, path, payload, route] of AI_RATE_LIMIT_TEST_ROUTES) {
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...(payload instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      GEMINI_LIVE_API_KEY: "gemini-live-secret",
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(false, dailyCalls),
    });
    assert.equal(response.status, 429, label);
    assert.match((await response.json()).error.message, /batas harian .* tercapai/i, label);
    assert.equal(dailyCalls.at(-1).route, route, label);
    assert.equal(dailyCalls.at(-1).limit, AI_ROUTE_LIMITS[route].perDay, label);
  }
});

test("AI daily Durable Object increments each route independently and rejects at its configured limit", async () => {
  const values = new Map();
  const store = new AIRateLimitStore({
    storage: {
      transaction: async (callback) => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value),
      }),
    },
  });
  const makeRequest = (route) => new Request("https://ai-daily-rate-limit.internal/reserve", {
    method: "POST",
    body: JSON.stringify({ route, limit: AI_ROUTE_LIMITS[route].perDay }),
  });
  const chatFirst = await (await store.fetch(makeRequest("transcribe"))).json();
  const imageFirst = await (await store.fetch(makeRequest("image-generate"))).json();
  assert.equal(chatFirst.allowed, true);
  assert.equal(imageFirst.allowed, true);
  assert.equal(chatFirst.remaining, AI_ROUTE_LIMITS.transcribe.perDay - 1);
  assert.equal(imageFirst.remaining, AI_ROUTE_LIMITS["image-generate"].perDay - 1);
  for (let index = 1; index < AI_ROUTE_LIMITS.transcribe.perDay; index += 1) {
    await store.fetch(makeRequest("transcribe"));
  }
  const exhausted = await (await store.fetch(makeRequest("transcribe"))).json();
  assert.deepEqual(exhausted, { allowed: false, remaining: 0 });

  values.clear();
  const oneChatPerDay = new Request("https://ai-daily-rate-limit.internal/reserve", {
    method: "POST",
    body: JSON.stringify({ route: "transcribe", limit: 1 }),
  });
  const constrainedFirst = await (await store.fetch(oneChatPerDay.clone())).json();
  const constrainedSecond = await (await store.fetch(oneChatPerDay)).json();
  assert.equal(constrainedFirst.allowed, true);
  assert.deepEqual(constrainedSecond, { allowed: false, remaining: 0 });
});

test("Monid run requires a readable price within MONID_MAX_RUN_COST", async (context) => {
  const { token, jwk } = await authorizedToken();
  const calls = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    calls.push(target);
    if (target.endsWith("/inspect")) {
      return Response.json({
        provider: "example",
        endpoint: "/items",
        price: { amount: { value: 0.02, currency: "USD" } },
      });
    }
    if (target.endsWith("/run")) return Response.json({ runId: "run-id-12345678", status: "READY" });
    assert.fail(`Unexpected Monid request: ${target}`);
  });
  const response = await worker.fetch(new Request("https://worker.test/api/monid/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "example", endpoint: "/items", input: { query: "safe" } }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    AI_PROVIDER_KEYS: JSON.stringify({ MONID_API_KEY: "monid-secret" }),
    MONID_MAX_RUN_COST: "0.05",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { runId: "run-id-12345678", status: "READY" });
  assert.deepEqual(calls, ["https://api.monid.ai/v1/inspect", "https://api.monid.ai/v1/run"]);
});

test("Monid run rejects missing, unreadable, or over-limit inspect prices before run", async (context) => {
  const { token, jwk } = await authorizedToken();
  let inspection = {};
  let runCalls = 0;
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (target.endsWith("/inspect")) return Response.json(inspection);
    if (target.endsWith("/run")) {
      runCalls += 1;
      return Response.json({ runId: "run-id-12345678" });
    }
    assert.fail(`Unexpected Monid request: ${target}`);
  });
  const sendRun = () => worker.fetch(new Request("https://worker.test/api/monid/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "example", endpoint: "/items", input: {} }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    AI_PROVIDER_KEYS: JSON.stringify({ MONID_API_KEY: "monid-secret" }),
    MONID_MAX_RUN_COST: "0.05",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  let response = await sendRun();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /tidak memuat harga dan mata uang/i);
  inspection = { price: { amount: { value: 0.08, currency: "USD" } } };
  response = await sendRun();
  assert.equal(response.status, 402);
  assert.match((await response.json()).error.message, /melebihi batas/i);
  inspection = { price: { amount: { value: null, currency: "USD" } } };
  response = await sendRun();
  assert.equal(response.status, 503);
  assert.equal(runCalls, 0);
});

test("Explorium search uses the server secret and caps the request to one preview result", async (context) => {
  const { token, jwk } = await authorizedToken();
  let exploriumCalls = 0;
  setFetch(context, async (url, options = {}) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    exploriumCalls++;
    assert.equal(String(url), "https://api.explorium.ai/v1/businesses");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.api_key, "explorium-secret");
    assert.deepEqual(JSON.parse(options.body), {
      mode: "preview",
      size: 1,
      page_size: 1,
      filters: { company_name: { values: ["Example Inc"] } },
    });
    return Response.json({
      response_context: {},
      data: [{ business_id: "business-1", name: "Example Inc" }],
      total_results: 1,
      page: 1,
      total_pages: 1,
    });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    AI_PROVIDER_KEYS: JSON.stringify({ EXPLORIUM_API_KEY: "explorium-secret" }),
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };

  const modelsResponse = await worker.fetch(new Request("https://worker.test/api/models", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }), env);
  assert.equal(modelsResponse.status, 200);
  const catalog = await modelsResponse.json();
  assert.deepEqual(catalog.providers, ["explorium"]);
  assert.deepEqual(catalog.services, [{ provider: "explorium", accessTier: "basic", kind: "business-data" }]);
  assert.doesNotMatch(JSON.stringify(catalog), /explorium-secret/);

  const response = await worker.fetch(new Request("https://worker.test/api/explorium/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ company: "Example Inc" }),
  }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].name, "Example Inc");
  assert.doesNotMatch(JSON.stringify(result), /explorium-secret/);

  const invalidResponse = await worker.fetch(new Request("https://worker.test/api/explorium/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ company: "Example Inc", url: "https://attacker.example" }),
  }), env);
  assert.equal(invalidResponse.status, 400);
  assert.equal(exploriumCalls, 1);
});

test("provider connection test is authenticated, rate-limited, and never returns a Worker secret", async (context) => {
  const { token, jwk } = await authorizedToken();
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(String(url), "https://api.groq.com/openai/v1/models");
    return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
  });
  clearGatewayCatalogCache("groq");
  const response = await worker.fetch(new Request("https://worker.test/api/providers/test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "groq" }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.provider, "groq");
  assert.equal(result.status, "HEALTHY");
  assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
});

test("enhance-prompt uses the fastest available provider and accepts detailed output", async (context) => {
  const { token, jwk } = await authorizedToken();
  clearGatewayCatalogCache();
  let helperRequest;
  let upstreamCalls = 0;
  let rateLimited = false;
  const enhancedPrompt = `Buat rencana belajar Python dengan tujuan, tahapan, latihan, dan pemeriksaan hasil.\n${Array.from(
    { length: 300 },
    (_, index) => `- Tahap ${index + 1}: jelaskan kegiatan, hasil yang diharapkan, dan cara memeriksa pemahaman.`,
  ).join("\n")}`;
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (String(url) === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    if (String(url) === "https://integrate.api.nvidia.com/v1/models") {
      return Response.json({ data: [{ id: "nvidia/nemotron-nano-3-30b-a3b", name: "Nemotron Nano" }] });
    }
    assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
    upstreamCalls++;
    helperRequest = { headers: options.headers, body: JSON.parse(options.body), signal: options.signal };
    return Response.json({ choices: [{ message: { content: enhancedPrompt } }] });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    NVIDIA_API_KEY: "nvidia-secret",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async ({ key }) => ({ success: !rateLimited && key === "enhance-prompt:test-user" }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const makeRequest = (body) => new Request("https://worker.test/api/enhance-prompt", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify(body),
  });
  const sourcePrompt = `buat jadwal belajar python${" dengan detail yang relevan".repeat(300)}`;
  const response = await worker.fetch(makeRequest({ prompt: sourcePrompt }), env);
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.prompt, enhancedPrompt);
  assert.equal(responseBody.provider, "groq");
  assert.equal(responseBody.model, "llama-3.1-8b-instant");
  assert.ok(responseBody.prompt.length > 12_000);
  assert.equal(helperRequest.headers.Authorization, "Bearer groq-secret");
  assert.equal(helperRequest.body.model, "llama-3.1-8b-instant");
  assert.equal(helperRequest.body.stream, false);
  assert.equal(helperRequest.body.messages[1].content, sourcePrompt);
  assert.match(helperRequest.body.messages[0].content, /arbitrary word-count limit/);
  assert.doesNotMatch(JSON.stringify(responseBody), /nvidia-secret|groq-secret/);

  rateLimited = true;
  const limited = await worker.fetch(makeRequest({ prompt: "draft" }), env);
  assert.equal(limited.status, 429);
  assert.equal(upstreamCalls, 1);
  rateLimited = false;
  const invalid = await worker.fetch(makeRequest({ prompt: "   " }), env);
  assert.equal(invalid.status, 400);
  assert.equal(upstreamCalls, 1);
});

test("enhance-prompt falls through provider billing failures without retrying that provider", async (context) => {
  const { token, jwk } = await authorizedToken();
  clearGatewayCatalogCache();
  const chatCalls = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    if (target === "https://api.anthropic.com/v1/models?limit=1000") {
      return Response.json({ data: [{ id: "claude-3-5-haiku-20241022", display_name: "Claude Haiku" }] });
    }
    chatCalls.push(target);
    if (target === "https://api.groq.com/openai/v1/chat/completions") {
      return Response.json({ error: { message: "provider billing unavailable" } }, { status: 402 });
    }
    assert.equal(target, "https://api.anthropic.com/v1/messages");
    return Response.json({ content: [{ type: "text", text: "Buat rencana belajar yang lengkap dan terukur." }] });
  });
  const response = await worker.fetch(new Request("https://worker.test/enhance-prompt", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ prompt: "buat rencana belajar" }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    CLAUDE_API_KEY: "claude-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    prompt: "Buat rencana belajar yang lengkap dan terukur.",
    provider: "claude",
    model: "claude-3-5-haiku-20241022",
  });
  assert.deepEqual(chatCalls, [
    "https://api.groq.com/openai/v1/chat/completions",
    "https://api.anthropic.com/v1/messages",
  ]);
});

test("legacy Hugging Face secrets do not enable Rapikan or make provider API calls", async (context) => {
  const { token, jwk } = await authorizedToken();
  const outboundRequests = [];
  setFetch(context, async (url) => {
    const target = String(url);
    outboundRequests.push(target);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    throw new Error(`Unexpected outbound request: ${target}`);
  });
  const response = await worker.fetch(new Request("https://worker.test/enhance-prompt", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ prompt: "buat ringkasan jelas tiga poin" }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    HF_TOKEN: "legacy-secret",
  });
  assert.equal(response.status, 401);
  assert.equal(outboundRequests.length, 0);
});

test("enhance-prompt supports Claude and OpenAI-compatible Kimi without Gemini", async (context) => {
  const { token, jwk } = await authorizedToken();
  let activeProvider = "";
  const requests = [];
  const providerFixtures = {
    claude: {
      catalogUrl: "https://api.anthropic.com/v1/models?limit=1000",
      model: "claude-3-5-haiku-20241022",
      envKey: "CLAUDE_API_KEY",
      endpoint: "https://api.anthropic.com/v1/messages",
    },
    kimi: {
      catalogUrl: "https://api.moonshot.cn/v1/models",
      model: "moonshot-v1-8k",
      envKey: "KIMI_API_KEY",
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
    },
  };
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    const fixture = providerFixtures[activeProvider];
    if (target === fixture.catalogUrl) {
      if (activeProvider === "claude") {
        return Response.json({ data: [{ id: fixture.model, display_name: "Claude Haiku" }] });
      }
      return Response.json({ data: [{ id: fixture.model, name: "Kimi" }] });
    }
    assert.equal(target, fixture.endpoint);
    const body = JSON.parse(options.body);
    requests.push({ provider: activeProvider, url: target, headers: options.headers, body });
    if (activeProvider === "claude") {
      return Response.json({ content: [{ type: "text", text: "Buat rencana belajar lengkap dan terukur." }] });
    }
    return Response.json({ choices: [{ message: { content: "Buat rencana belajar lengkap dan terukur." } }] });
  });

  for (const [provider, fixture] of Object.entries(providerFixtures)) {
    activeProvider = provider;
    clearGatewayCatalogCache(provider);
    const response = await worker.fetch(new Request("https://worker.test/enhance-prompt", {
      method: "POST",
      headers: {
        Authorization: ["Bearer", token].join(" "),
        "Content-Type": "application/json",
        Origin: "https://myai-v3-firmansyah.pages.dev",
      },
      body: JSON.stringify({ prompt: "buat rencana belajar" }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      [fixture.envKey]: `${provider}-secret`,
      AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
      AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      prompt: "Buat rencana belajar lengkap dan terukur.",
      provider,
      model: fixture.model,
    });
  }

  assert.equal(requests.length, 2);
  const claude = requests.find(({ provider }) => provider === "claude");
  assert.equal(claude.headers["x-api-key"], "claude-secret");
  assert.equal(claude.body.max_tokens, 4096);
  const kimi = requests.find(({ provider }) => provider === "kimi");
  assert.equal(kimi.headers.Authorization, "Bearer kimi-secret");
  assert.equal(kimi.body.model, "moonshot-v1-8k");
  assert.doesNotMatch(JSON.stringify(requests.map(({ body }) => body)), /gemini-secret|claude-secret|kimi-secret/);
});

test.skip("Legacy Hugging Face token enabled signed-in Rapikan", async (context) => {
  const { token, jwk } = await authorizedToken();
  clearGatewayCatalogCache("huggingface");
  let completionRequest;
  setFetch(context, async (url, options = {}) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (String(url) === "https://router.huggingface.co/v1/models") {
      assert.match(options.headers.Authorization, /^Bearer /);
      return Response.json({ data: [
        { id: "meta-llama/Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" },
      ] });
    }
    assert.equal(String(url), "https://router.huggingface.co/v1/chat/completions");
    assert.match(options.headers.Authorization, /^Bearer /);
    completionRequest = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: "Tulis ringkasan yang jelas dengan tiga poin utama." } }] });
  });
  const response = await worker.fetch(new Request("https://worker.test/enhance-prompt", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ prompt: "buat ringkasan jelas tiga poin" }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    HUGGINGFACE_TOKEN: "huggingface-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    prompt: "Tulis ringkasan yang jelas dengan tiga poin utama.",
    provider: "huggingface",
    model: "meta-llama/Llama-3.1-8B-Instruct",
  });
  assert.equal(completionRequest.model, "meta-llama/Llama-3.1-8B-Instruct");
});

test("image prompt enhancement falls back to Groq and repairs invalid JSON (MOCK)", async (context) => {
  const { token, jwk } = await authorizedToken();
  clearGatewayCatalogCache();
  const requests = [];
  setFetch(context, async (url, options = {}) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (String(url) === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "openai/gpt-oss-20b", name: "GPT OSS 20B" }] });
    }
    assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    const content = requests.length === 1
      ? "not-json"
      : JSON.stringify({
        prompt: "A vivid Indonesian Independence Day celebration in a village square on the morning of August 17, a flag-raising ceremony with a large red-and-white Indonesian flag climbing a tall bamboo pole as a joyful crowd of generic Indonesian villagers in traditional batik and simple everyday clothes watches with pride, red-and-white bunting and small flags decorating the houses around the square, warm golden morning sunlight streaming from the east with soft long shadows, a gentle festive atmosphere with children cheering near the front, rich red, white, and warm earth tones with green foliage accents, wide cinematic composition with a low camera angle looking up at the flag, shallow depth of field, detailed textures of the flag fabric waving in a light breeze, polished editorial illustration style, no readable text.",
        negative: "unrelated portraits, incorrect flag colors, logos, watermark, text",
        aspect: "16:9",
        style: "Editorial illustration",
        assumptions: "Saya menafsirkan permintaan sebagai perayaan 17 Agustus.",
      });
    return Response.json({ choices: [{ message: { content } }] });
  });
  const response = await worker.fetch(new Request("https://worker.test/enhance-prompt", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ mode: "image", prompt: "tolong buatka gambar tentang kemerdekaan indonesia" }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.enhanced, true);
  assert.equal(result.enhancer, "groq");
  assert.equal(result.enhancerModel, "openai/gpt-oss-20b");
  assert.match(result.prompt, /Indonesian Independence Day/i);
  assert.match(result.prompt, /red-and-white/i);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.max_tokens <= 4096));
  assert.equal(requests[0].response_format.type, "json_object");
  assert.match(requests[1].messages[1].content, /repair/);
  assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
});

test("authenticated OpenRouter chat counts toward cloud chat quota and uses the catalog maximum when known", async (context) => {
  clearGatewayCatalogCache("openrouter");
  const { token, jwk } = await authorizedToken();
  let sentBody;
  let limiterCalls = 0;
  const dailyCalls = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (target === "https://openrouter.ai/api/v1/models") {
      return Response.json({ data: [{
        id: "openai/gpt-4o",
        name: "GPT-4o",
        pricing: { prompt: "0.0000025", completion: "0.00001" },
        context_length: 128_000,
        top_provider: { max_completion_tokens: 32_000 },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      }] });
    }
    assert.equal(target, "https://openrouter.ai/api/v1/chat/completions");
    sentBody = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"OpenRouter works."}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
      "X-Device-Id": "test-device-0001",
    },
    body: JSON.stringify({
      provider: "openrouter",
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "Say hello." }],
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    OPENROUTER_API_KEY: "openrouter-secret",
    AI_RATE_LIMITER: { limit: async () => { limiterCalls += 1; return { success: false }; } },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(true, dailyCalls),
  });
  assert.equal(response.status, 200);
  assert.equal(limiterCalls, 0);
  assert.equal(sentBody.max_tokens, 32_000);
  assert.match(await response.text(), /OpenRouter works/);
  assert.equal(dailyCalls.some((call) => call.limit === CLOUD_CHAT_DAILY_LIMIT), true);
  assert.equal(dailyCalls.some((call) => typeof call.deviceHash === "string" && call.maxDevices === MAX_ACCOUNT_DEVICES), true);
});

test("direct Groq chat caps output tokens at the model limit", async (context) => {
  clearGatewayCatalogCache("groq");
  const { token, jwk } = await authorizedToken();
  let sentBody;
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
    sentBody = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({
      provider: "groq",
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: "hello" }],
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    PREMIUM_ALLOWED_UIDS: "test-user",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  assert.equal(sentBody.max_tokens, 4096);
  assert.match(await response.text(), /"content":"hello"/);
});

test("chat Worker injects quality instructions into gateway model requests", async (context) => {
  clearGatewayCatalogCache("groq");
  const { token, jwk } = await authorizedToken();
  let sentMessages;
  let sentBody;
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" }] });
    }
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    sentBody = JSON.parse(options.body);
    sentMessages = sentBody.messages;
    return new Response('data: {"choices":[{"delta":{"content":"Here is the complete code."}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":42,"total_tokens":363}}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({
      provider: "gateway-groq",
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Keep the response in Indonesian." },
        { role: "user", content: "Write a complete page." },
      ],
      customInstructions: { profileInfo: "Web developer", responseStyle: "Answer concisely." },
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    PREMIUM_ALLOWED_UIDS: "test-user",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });
  assert.equal(response.status, 200);
  const responseText = await response.text();
  assert.match(responseText, /complete code/);
  assert.match(responseText, /"type":"usage","tokens":\{"prompt_tokens":321,"completion_tokens":42,"total_tokens":363\}/);
  assert.match(responseText, /"type":"metrics","tokens":363,"completion_tokens":42,"duration_ms":\d+(?:,"tokens_per_second":[\d.]+)?,"model":"llama-3\.3-70b-versatile"/);
  assert.ok(responseText.indexOf('"type":"metrics"') < responseText.indexOf("data: [DONE]"));
  assert.deepEqual(sentBody.stream_options, { include_usage: true });
  assert.equal(sentMessages[0].role, "system");
  assert.match(sentMessages[0].content, /production-ready/);
  assert.match(sentMessages[0].content, /Answer the latest request directly in the user's language/);
  assert.match(sentMessages[0].content, /Use the fewest tokens that fully solve the task/);
  assert.match(sentMessages[0].content, /Use app features and tools when available and relevant/);
  assert.match(sentMessages[0].content, /For Indonesian requests, make generated HTML\/CSS\/JavaScript visible text Indonesian/);
  assert.match(sentMessages[0].content, /Use structured artifact formats only when the user requests a supported document/);
  assert.match(sentMessages[0].content, /About User: Web developer/);
  assert.match(sentMessages[0].content, /Preferred Response Style: Answer concisely/);
  assert.match(sentMessages[0].content, /Keep the response in Indonesian/);
  assert.equal(sentMessages[1].content, "Write a complete page.");
});

test("legacy chat image requests are rejected without contacting image providers", async (context) => {
  const { token, jwk } = await authorizedToken();
  const unexpectedRequests = [];
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    unexpectedRequests.push(String(url));
    throw new Error(`Unexpected image provider request: ${url}`);
  });

  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({
      provider: "openrouter",
      model: "google/gemini-2.5-flash-image",
      imageGeneration: true,
      messages: [{ role: "user", content: "Create a mountain landscape." }],
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    OPENROUTER_API_KEY: "openrouter-secret",
  });

  const result = await response.json();
  assert.equal(response.status, 410, result.error.message);
  assert.match(result.error.message, /hanya tersedia melalui Gemini Image di OpenRouter/i);
  assert.deepEqual(unexpectedRequests, []);
});

test("chat Worker keeps website prompts with image placeholder requirements on the text route", async (context) => {
  clearGatewayCatalogCache("groq");
  const { token, jwk } = await authorizedToken();
  let chatRequests = 0;
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (target === "https://api.groq.com/openai/v1/models") {
      return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
    }
    assert.equal(target, "https://api.groq.com/openai/v1/chat/completions");
    chatRequests++;
    return new Response('data: {"choices":[{"delta":{"content":"Website brief accepted."}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });

  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", token].join(" "),
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({
      provider: "gateway-groq",
      model: "llama-3.1-8b-instant",
      messages: [{
        role: "user",
        content: `Peran: Developer front-end senior. Tugas: Buat website portofolio pribadi yang profesional dan siap dipublikasikan.
Konteks: nama [Nama lengkap], profesi [UI/UX Designer], target rekruter dan klien, tujuan mendapat pekerjaan, konten Bahasa Indonesia.
Tech stack: HTML, CSS, JavaScript murni; satu file jika memungkinkan, bersih dan mudah diedit.
Desain: editorial minimalis, pilih palet dan font yang cocok, hindari template generik, dukung light/dark mode.
Struktur: navbar sticky dan hamburger; hero dengan dua CTA; tentang saya dan fakta cepat; skill per kategori; 3-6 proyek dengan filter dan detail studi kasus; pengalaman dan pendidikan; testimoni; artikel; kontak dengan validasi; footer.
Konten kosong harus memakai placeholder yang ditandai <!-- GANTI: ... -->. Gambar placeholder memakai gradient atau SVG lokal.
Interaksi: scroll reveal, hover, smooth scroll, active section, theme toggle, reduced motion.
Responsif mobile-first, uji 360px, 768px, 1280px; aksesibel, keyboard, fokus jelas, kontras WCAG AA.
SEO: title, description, Open Graph, favicon; lazy-load; target Lighthouse 90+.
Output: kode lengkap, cara ganti konten/warna/font, deploy gratis, dan 3 ide lanjutan.`,
      }],
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    PREMIUM_ALLOWED_UIDS: "test-user",
    GROQ_API_KEY: "groq-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });

  assert.equal(response.status, 200);
  assert.equal(chatRequests, 1);
  assert.match(await response.text(), /Website brief accepted/);
});

test("image generation prompts remove Indonesian command prefixes and add the quality boost only once", () => {
  assert.equal(cleanImageGenerationPrompt("Buatkan gambar sampel: pegunungan saat matahari terbit."), "pegunungan saat matahari terbit");
  assert.equal(cleanImageGenerationPrompt("Generate image: a quiet lake at dawn"), "a quiet lake at dawn");
  assert.equal(cleanImageGenerationPrompt("kota yang indah dengan tema masa depan"), "kota yang indah dengan tema masa depan");
  assert.equal(
    boostImagePromptQuality("a quiet lake at dawn"),
    "a quiet lake at dawn, highly detailed, clear visual composition, professional lighting",
  );
  assert.equal(
    boostImagePromptQuality("a quiet lake, 8k resolution"),
    "a quiet lake, 8k resolution, highly detailed, clear visual composition, professional lighting",
  );
});

function emailActionStoreBinding({ dailyCount = 0 } = {}) {
  let preview = null;
  let count = dailyCount;
  let day = new Date().toISOString().slice(0, 10);
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (url, options) => {
        const action = new URL(url).pathname.split("/").at(-1);
        const body = JSON.parse(options.body);
        if (action === "preview") {
          preview = { tokenHash: body.tokenHash, payloadHash: body.payloadHash };
          return Response.json({ created: true });
        }
        if (action === "reserve-send") {
          if (!preview || preview.tokenHash !== body.tokenHash || preview.payloadHash !== body.payloadHash) {
            return Response.json({ confirmed: false, reserved: false });
          }
          const today = new Date().toISOString().slice(0, 10);
          if (today !== day) {
            day = today;
            count = 0;
          }
          if (count >= 20) return Response.json({ confirmed: true, reserved: false });
          preview = null;
          count += 1;
          return Response.json({ confirmed: true, reserved: true, remaining: 20 - count });
        }
        return new Response("Not found", { status: 404 });
      },
    }),
  };
}

function emailEndpointRequest(path, token, body, confirmationToken) {
  return new Request(`https://worker.test/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
      ...(confirmationToken ? { "X-Email-Confirmation": confirmationToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("email endpoint authenticates, requires preview confirmation, and sends through Resend", async (context) => {
  const { token, jwk } = await authorizedToken();
  const resendCalls = [];
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(url, "https://api.resend.com/emails");
    resendCalls.push({ headers: options.headers, body: JSON.parse(options.body) });
    return Response.json({ id: "email-test-id" });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    RESEND_API_KEY: "resend-private-key",
    RESEND_FROM_EMAIL: "MyAI <noreply@example.com>",
    EMAIL_RECIPIENT_ALLOWED_DOMAINS: "example.com",
    EMAIL_ACTION_STORE: emailActionStoreBinding(),
    AI_RATE_LIMITER: { limit: async ({ key }) => ({ success: key.endsWith(":test-user") }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const draft = { to: "user@example.com", subject: "Hello", body_markdown: "Plain text body" };
  const unconfirmed = await worker.fetch(emailEndpointRequest("send-email", token, draft), env);
  assert.equal(unconfirmed.status, 403);
  const previewResponse = await worker.fetch(emailEndpointRequest("send-email/preview", token, draft), env);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(typeof preview.confirmationToken, "string");
  const changedDraft = await worker.fetch(emailEndpointRequest("send-email", token, {
    ...draft,
    body_markdown: "Changed after the preview",
  }, preview.confirmationToken), env);
  assert.equal(changedDraft.status, 403);
  const response = await worker.fetch(new Request("https://worker.test/send-email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
      "X-Email-Confirmation": preview.confirmationToken,
    },
    body: JSON.stringify(draft),
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "email-test-id" });
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].headers.Authorization, "Bearer resend-private-key");
  assert.deepEqual(resendCalls[0].body, {
    from: "MyAI <noreply@example.com>",
    to: ["user@example.com"],
    subject: "Hello",
    text: "Plain text body",
  });

  const invalid = await worker.fetch(new Request("https://worker.test/send-email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ to: "not-an-email", subject: "Hello", body_markdown: "Body" }),
  }), env);
  assert.equal(invalid.status, 400);
  assert.equal(resendCalls.length, 1);
});

test("email endpoint rejects recipient domains outside the configured allowlist with 403", async (context) => {
  const { token, jwk } = await authorizedToken();
  let resendCalls = 0;
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    resendCalls += 1;
    return Response.json({ id: "unexpected-email-id" });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    RESEND_API_KEY: "resend-private-key",
    RESEND_FROM_EMAIL: "MyAI <noreply@example.com>",
    EMAIL_RECIPIENT_ALLOWED_DOMAINS: "example.com",
    EMAIL_ACTION_STORE: emailActionStoreBinding(),
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const response = await worker.fetch(emailEndpointRequest("send-email/preview", token, {
    to: "recipient@outside.test",
    subject: "Hello",
    body_markdown: "Plain text body",
  }), env);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error.message, /Domain penerima email tidak diizinkan/);
  assert.equal(resendCalls, 0);
});

test("email preview rejects malformed email addresses, line breaks, and invalid subjects", async (context) => {
  const { token, jwk } = await authorizedToken();
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    EMAIL_RECIPIENT_ALLOWED_DOMAINS: "example.com",
    EMAIL_ACTION_STORE: emailActionStoreBinding(),
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const invalidDrafts = [
    { to: "not-an-email", subject: "Hello", body_markdown: "Body" },
    { to: "name..part@example.com", subject: "Hello", body_markdown: "Body" },
    { to: ".name@example.com", subject: "Hello", body_markdown: "Body" },
    { to: "name@example", subject: "Hello", body_markdown: "Body" },
    { to: "name@example.com", subject: "Hello\r\nBcc: other@example.com", body_markdown: "Body" },
  ];
  for (const draft of invalidDrafts) {
    const response = await worker.fetch(emailEndpointRequest("send-email/preview", token, draft), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /email|subjek/i);
  }
});

test("email endpoint allows an explicitly confirmed external recipient in an allowlisted domain", async (context) => {
  const { token, jwk } = await authorizedToken();
  let sentTo;
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    sentTo = JSON.parse(options.body).to;
    return Response.json({ id: "email-external-test-id" });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    RESEND_API_KEY: "resend-private-key",
    RESEND_FROM_EMAIL: "MyAI <noreply@example.com>",
    EMAIL_RECIPIENT_ALLOWED_DOMAINS: "example.com",
    EMAIL_ACTION_STORE: emailActionStoreBinding(),
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const draft = {
    to: "colleague@example.com",
    subject: "Reviewed message",
    body_markdown: "Explicitly approved content",
  };
  const previewResponse = await worker.fetch(emailEndpointRequest("send-email/preview", token, draft), env);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const response = await worker.fetch(emailEndpointRequest("send-email", token, draft, preview.confirmationToken), env);
  assert.equal(response.status, 200);
  assert.deepEqual(sentTo, ["colleague@example.com"]);
});

test("email endpoint rejects sends over the daily UID quota with an Indonesian 429", async (context) => {
  const { token, jwk } = await authorizedToken();
  let resendCalls = 0;
  setFetch(context, async (url) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    resendCalls += 1;
    return Response.json({ id: "unexpected-email-id" });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    RESEND_API_KEY: "resend-private-key",
    RESEND_FROM_EMAIL: "MyAI <noreply@example.com>",
    EMAIL_RECIPIENT_ALLOWED_DOMAINS: "example.com",
    EMAIL_ACTION_STORE: emailActionStoreBinding({ dailyCount: 20 }),
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  };
  const draft = { to: "user@example.com", subject: "Hello", body_markdown: "Plain text body" };
  const previewResponse = await worker.fetch(emailEndpointRequest("send-email/preview", token, draft), env);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const response = await worker.fetch(emailEndpointRequest("send-email", token, draft, preview.confirmationToken), env);
  assert.equal(response.status, 429);
  assert.match((await response.json()).error.message, /Batas harian pengiriman email tercapai \(20 email per hari\)/);
  assert.equal(resendCalls, 0);
});

test("email action Durable Object enforces the daily limit without consuming a valid preview", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const values = new Map([["email-daily-count", { day: today, count: 20 }]]);
  const storage = {
    transaction: async (callback) => callback({
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
    }),
  };
  const store = new EmailActionStore({ storage });
  const hashes = { tokenHash: "a".repeat(64), payloadHash: "b".repeat(64) };
  const preview = await store.fetch(new Request("https://email-action.internal/preview", {
    method: "POST",
    body: JSON.stringify(hashes),
  }));
  assert.equal(preview.status, 200);
  const limited = await store.fetch(new Request("https://email-action.internal/reserve-send", {
    method: "POST",
    body: JSON.stringify(hashes),
  }));
  assert.deepEqual(await limited.json(), { confirmed: true, reserved: false });
  assert.equal(values.get("email-preview").tokenHash, hashes.tokenHash);
});

test("OpenRouter Gemini Image generation uses the dedicated Image API without Google API calls (MOCK)", async (context) => {
  const { token, jwk } = await authorizedToken();
  const imageRequests = [];
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(target, "https://openrouter.ai/api/v1/images");
    assert.equal(options.headers.Authorization, "Bearer openrouter-secret");
    imageRequests.push(JSON.parse(options.body));
    return Response.json({ data: [{ b64_json: "generated-image-base64", media_type: "image/png" }] });
  });

  const response = await worker.fetch(new Request("https://worker.test/images/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "kemerdekaan indonesia",
      verifyMatch: true,
      autoEnhance: false,
      plan: {
        prompt: "An Indonesian Independence Day celebration with a red-and-white flag.",
        negative: "unrelated subjects, text",
        aspect: "16:9",
        style: "editorial illustration",
        assumptions: "Perayaan kemerdekaan Indonesia.",
        enhanced: false,
        enhancer: "local",
      },
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    OPENROUTER_API_KEY: "openrouter-secret",
    GEMINI_LIVE_API_KEY: "live-only-secret-must-not-be-used",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(imageRequests.length, 1);
  assert.equal(imageRequests[0].model, "google/gemini-2.5-flash-image");
  assert.equal(imageRequests[0].n, 1);
  assert.equal(imageRequests[0].aspect_ratio, "16:9");
  assert.match(imageRequests[0].prompt, /A vivid Indonesian Independence Day celebration/);
  assert.equal(result.image, "generated-image-base64");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "google/gemini-2.5-flash-image");
  assert.deepEqual(result.verification, {
    status: "unavailable",
    reason: "Verifikasi kecocokan tambahan belum tersedia melalui OpenRouter.",
  });
  assert.doesNotMatch(JSON.stringify(result), /openrouter-secret|live-only-secret/);
});

test("OpenRouter Gemini Image sends the source photo as an image reference (MOCK)", async (context) => {
  const { token, jwk } = await authorizedToken();
  const sourceImage = "data:image/jpeg;base64,ZmFrZS1zb3VyY2U=";
  let generationRequest;
  setFetch(context, async (url, options = {}) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(target, "https://openrouter.ai/api/v1/images");
    assert.equal(options.headers.Authorization, "Bearer openrouter-secret");
    generationRequest = JSON.parse(options.body);
    return Response.json({ data: [{ b64_json: "edited-image", media_type: "image/png" }] });
  });
  const response = await worker.fetch(new Request("https://worker.test/images/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Haluskan kulit secara natural dan hangatkan pencahayaan.",
      sourceImage,
      autoEnhance: false,
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    OPENROUTER_API_KEY: "openrouter-secret",
    GEMINI_LIVE_API_KEY: "live-only-secret-must-not-be-used",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
    IMAGE_EDIT_QUEUE: imageEditQueueBinding(),
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(generationRequest.model, "google/gemini-2.5-flash-image");
  assert.equal(generationRequest.aspect_ratio, undefined);
  assert.match(generationRequest.prompt, /Edit the supplied source photo only; do not create a new image/);
  assert.match(generationRequest.prompt, /Preserve the subject's identity, facial features, body proportions, pose, clothing, background, and composition exactly/);
  assert.match(generationRequest.prompt, /Haluskan kulit secara natural/);
  assert.deepEqual(generationRequest.input_references, [{
    type: "image_url",
    image_url: { url: sourceImage },
  }]);
  assert.equal(result.image, "edited-image");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "google/gemini-2.5-flash-image");
  assert.equal(result.aspectRatio, "source");
  assert.doesNotMatch(JSON.stringify(result), /openrouter-secret|live-only-secret|ZmFrZS1zb3VyY2U=/);
});

test("OpenRouter Gemini Image quota errors are not retried or routed to another provider (MOCK)", async (context) => {
  const { token, jwk } = await authorizedToken();
  let mode = "success";
  const imageRequests = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(target, "https://openrouter.ai/api/v1/images");
    imageRequests.push(target);
    if (mode === "success") {
      return Response.json({ data: [{ b64_json: "image-data", media_type: "image/png" }] });
    }
    return Response.json({ error: { code: 402, message: "credits exhausted" } }, { status: 402 });
  });
  const invoke = () => worker.fetch(new Request("https://worker.test/images/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "bendera Merah Putih",
      autoEnhance: false,
      plan: {
        prompt: "A red-and-white Indonesian flag in a village square.",
        negative: "text, logos",
        aspect: "1:1",
        style: "editorial illustration",
        assumptions: "Bendera Merah Putih di lapangan desa.",
        enhanced: false,
        enhancer: "local",
      },
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    OPENROUTER_API_KEY: "openrouter-secret",
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AI_DAILY_RATE_LIMIT_STORE: aiDailyRateLimitBinding(),
  });

  const success = await invoke();
  assert.equal(success.status, 200);
  mode = "quota";
  for (let failure = 0; failure < 3; failure += 1) {
    const response = await invoke();
    assert.equal(response.status, 429);
  }
  const imageRequestsBeforeLastFailure = imageRequests.length;
  const lastFailure = await invoke();
  assert.equal(lastFailure.status, 429);
  assert.equal(imageRequests.length, imageRequestsBeforeLastFailure + 1);
  assert.deepEqual(imageRequests, Array(5).fill("https://openrouter.ai/api/v1/images"));
});
