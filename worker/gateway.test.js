import assert from "node:assert/strict";
import test from "node:test";
import pagesWorker from "../pages/_worker.js";
import { clearGatewayCatalogCache, gatewayModelGroups, handleGatewayRequest, modelAccessTier, probeGatewayProvider, PROVIDER_ADAPTERS, streamResponse as gatewayStreamResponse, testGatewayProvider } from "./src/gateway.js";
import worker, { guestModelsForKeys, isAllowedOrigin, isImageEditRequest, readProviderKeys, streamResponse, validateChatBody, withCoreSystemInstruction, withUserPersonalization } from "./src/index.js";
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

function setFetch(context, handler) {
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  globalThis.fetch = handler;
}

test("provider secrets ignore removed Kimi and Anthropic keys and prefer supported Worker secrets", () => {
  const result = readProviderKeys(JSON.stringify({
    anthropic: "json-claude",
    moonshot: "json-kimi",
    nvidia_nim: "json-nvidia",
    openrouter_api_key: "json-openrouter",
    monid_api_key: "json-monid",
  }), {
    GEMINI_API_KEY: "gemini-worker",
    GROQ_API_KEY: "groq-worker",
    OPENROUTER_API_KEY: "openrouter-worker",
    ANTHROPIC_API_KEY: " ",
    CLAUDE_API_KEY: " claude-worker ",
    KIMI_API_KEY: "kimi-worker",
    NVIDIA_API_KEY: "",
    NVIDIA_NIM_API_KEY: "nvidia-worker",
    MONID_API_KEY: "monid-worker",
  });
  assert.deepEqual(result.keys, {
    gemini: "gemini-worker",
    groq: "groq-worker",
    monid: "monid-worker",
    nvidia: "nvidia-worker",
    openrouter: "openrouter-worker",
  });
  assert.deepEqual(result.warnings, [
    'Provider "anthropic" di AI_PROVIDER_KEYS tidak didukung Worker dan diabaikan.',
    'Provider "moonshot" di AI_PROVIDER_KEYS tidak didukung Worker dan diabaikan.',
  ]);
});

test("all chat providers expose the shared server-side adapter contract", () => {
  assert.deepEqual(Object.keys(PROVIDER_ADAPTERS).sort(), ["gemini", "groq", "nvidia", "openrouter"]);
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

test("provider catalog test distinguishes working and rejected server-side secrets", async (context) => {
  clearGatewayCatalogCache();
  setFetch(context, async (url) => {
    assert.equal(String(url), "https://api.groq.com/openai/v1/models");
    return Response.json({ data: [{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }] });
  });
  const connected = await testGatewayProvider("groq", "server-secret");
  assert.equal(connected.status, "HEALTHY");
  assert.equal(connected.modelCount, 1);
  assert.doesNotMatch(JSON.stringify(connected), /server-secret/);

  globalThis.fetch = async () => Response.json({ error: { message: "invalid key" } }, { status: 401 });
  clearGatewayCatalogCache("groq");
  const rejected = await testGatewayProvider("groq", "server-secret");
  assert.equal(rejected.status, "ERROR");
  assert.equal(rejected.code, "INVALID_KEY_OR_PERMISSION");
  assert.doesNotMatch(JSON.stringify(rejected), /server-secret/);
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

  test("live Gemini probe prefers the known working Flash model", async (context) => {
    clearGatewayCatalogCache("gemini");
    const chatModels = [];
    const chatRequests = [];
    setFetch(context, async (url, options = {}) => {
      if (String(url).includes("/models?")) {
        return Response.json({ models: [
          { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3-flash-preview", displayName: "Gemini 3 Flash Preview", supportedGenerationMethods: ["generateContent"] },
        ] });
      }
      const model = String(url).match(/models\/([^:]+)/)?.[1];
      chatModels.push(model);
      chatRequests.push(JSON.parse(options.body));
      return Response.json({
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      });
    });
    const result = await probeGatewayProvider("gemini", "gemini-secret");
    assert.equal(result.status, "OK");
    assert.deepEqual(chatModels, ["gemini-3-flash-preview"]);
    assert.equal(chatRequests[0].generationConfig.maxOutputTokens, 64);
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
      GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.providers.groq.status, "OK");
    assert.deepEqual(result.providers.groq.usage, { promptTokens: 4, completionTokens: 1, totalTokens: 5 });
    assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
  });

  test("health route tests Monid and image engines without returning image bytes or credentials", async (context) => {
    const { token, jwk } = await authorizedToken();
    const imageModels = [];
    setFetch(context, async (url, options = {}) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      if (target.includes("api.monid.ai/v1/discover")) return Response.json({ results: [] });
      if (target.includes("image.pollinations.ai")) {
        return new Response("image bytes", { headers: { "Content-Type": "image/png" } });
      }
      const model = target.match(/models\/([^/]+):generateContent$/)?.[1];
      imageModels.push(model);
      assert.equal(options.method, "POST");
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.contents[0].parts[0].text, "Create a plain blue square, no text.");
      assert.deepEqual(requestBody.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
      assert.equal(requestBody.generationConfig.imageConfig.aspectRatio, "1:1");
      assert.equal(model, "gemini-3.1-flash-image");
      return Response.json({
        candidates: [{ content: { parts: [{ inlineData: { data: "generated-image-bytes", mimeType: "image/png" } }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 6, totalTokenCount: 9 },
      });
    });
    const response = await worker.fetch(new Request("https://worker.test/api/health", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ providers: ["monid", "pollinations", "server-gemini-image"] }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      GEMINI_API_KEY: "gemini-secret",
      MONID_API_KEY: "monid-secret",
      GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.providers.monid.status, "OK");
    assert.equal(result.providers.pollinations.status, "OK");
    assert.equal(result.providers["server-gemini-image"].status, "OK");
    assert.equal(result.providers["server-gemini-image"].model, "gemini-3.1-flash-image");
    assert.deepEqual(imageModels, ["gemini-3.1-flash-image"]);
    assert.deepEqual(result.providers["server-gemini-image"].usage, {
      promptTokens: 3,
      completionTokens: 6,
      totalTokens: 9,
    });
    assert.doesNotMatch(JSON.stringify(result), /gemini-secret|monid-secret|generated-image-bytes/);
  });

  test("Gemini image quota-zero failures are logged safely and do not retry another model", async (context) => {
    const { token, jwk } = await authorizedToken();
    const imageModels = [];
    const safeLogs = [];
    const originalWarn = console.warn;
    console.warn = (...args) => safeLogs.push(args);
    context.after(() => { console.warn = originalWarn; });
    setFetch(context, async (url) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      const model = target.match(/models\/([^/]+):generateContent$/)?.[1];
      imageModels.push(model);
      return Response.json({
        error: {
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [{
                quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaValue: "0",
              }],
            },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" },
          ],
        },
      }, { status: 429 });
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
      GEMINI_API_KEY: "gemini-secret",
      GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(response.status, 429);
    const result = await response.json();
    assert.match(result.error.message, /kuota|batas permintaan/i);
    assert.deepEqual(imageModels, ["gemini-3.1-flash-image"]);
    const diagnosticLog = JSON.stringify(safeLogs);
    assert.match(diagnosticLog, /RESOURCE_EXHAUSTED/);
    assert.match(diagnosticLog, /generativelanguage\.googleapis\.com\/generate_content_free_tier_requests/);
    assert.match(diagnosticLog, /"limit":"0"/);
    assert.match(diagnosticLog, /"retryDelay":"30s"/);
    assert.doesNotMatch(JSON.stringify(result) + diagnosticLog, /gemini-secret/);
  });

  test("Gemini Image upstream HTTP 500 is sanitized into a fallback-eligible error", async (context) => {
    const { token, jwk } = await authorizedToken();
    const imageModels = [];
    setFetch(context, async (url) => {
      const target = String(url);
      if (target.includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      imageModels.push(target.match(/models\/([^/]+):generateContent$/)?.[1]);
      return Response.json({
        error: { status: "INTERNAL", message: "provider-internal-detail-must-not-reach-client" },
      }, { status: 500 });
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
      GEMINI_API_KEY: "gemini-secret",
      GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.match(result.error.message, /Gemini Image sedang mengalami gangguan/i);
    assert.doesNotMatch(JSON.stringify(result), /provider-internal-detail|gemini-secret/);
    assert.deepEqual(imageModels, ["gemini-3.1-flash-image", "gemini-3.1-flash-image"]);
  });

  test("provider catalogs map models into the requested access tiers", () => {
  assert.equal(modelAccessTier("gemini", { id: "gemini-2.5-flash", name: "Gemini Flash" }), "free");
  assert.equal(modelAccessTier("gemini", { id: "gemini-2.5-flash-thinking", name: "Gemini Flash Thinking" }), "pro");
  assert.equal(modelAccessTier("gemini", { id: "gemini-2.5-pro", name: "Gemini Pro" }), "max");
  assert.equal(modelAccessTier("gemini", { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" }), "max");
  assert.equal(modelAccessTier("gemini", { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash" }), "free");
  assert.equal(modelAccessTier("gemini", { id: "gemini-4-argon", name: "Gemini Argon" }), "basic");
  assert.equal(modelAccessTier("groq", { id: "llama-3.1-8b-instant", name: "Llama 8B Instant" }), "free");
  assert.equal(modelAccessTier("groq", { id: "llama-3.3-70b-versatile", name: "Llama 70B" }), "pro");
  assert.equal(modelAccessTier("groq", { id: "llama-3.3-70b", name: "Llama 3.3" }), "pro");
  assert.equal(modelAccessTier("nvidia", { id: "nvidia/nemotron", name: "Nemotron" }), "pro");
  assert.equal(modelAccessTier("nvidia", { id: "nvidia/llama-3.1-405b", name: "Llama 3.1 405B" }), "max");
  assert.equal(modelAccessTier("openrouter", { id: "qwen/qwen3", name: "Qwen", priceTier: "free" }), "free");
  assert.equal(modelAccessTier("openrouter", { id: "meta/llama-4", name: "Llama" }), "pro");
  assert.equal(modelAccessTier("openrouter", { id: "meta/llama-4-scout", name: "Llama 4 Scout" }), "pro");
  assert.equal(modelAccessTier("openrouter", { id: "meta/llama-4-behemoth", name: "Llama 4 Behemoth", priceTier: "free" }), "free");
  assert.equal(modelAccessTier("openrouter", { id: "openai/gpt-4o", name: "GPT-4o" }), "max");
  assert.equal(modelAccessTier("openrouter", { id: "example/request-priced", name: "Request-priced", priceTier: "check" }), "basic");
});

test("text chat catalog excludes image-generation-only models", async (context) => {
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
        architecture: { output_modalities: ["text", "image"] },
      },
    ] });
  });
  clearGatewayCatalogCache();
  const { groups } = await gatewayModelGroups({ openrouter: "openrouter-secret" }, ["openrouter"]);
  assert.deepEqual(groups[0].models.map((model) => model.id), ["google/text-model"]);
});

test("core accuracy instructions are added once while preserving user system context and messages", () => {
  const input = [
    { role: "system", content: "Answer in Indonesian and follow the user's coding constraints." },
    { role: "user", content: "Write a complete HTML page." },
  ];
  const result = withCoreSystemInstruction(input);
  assert.equal(result.length, 2);
  assert.match(result[0].content, /world-class AI assistant/);
  assert.match(result[0].content, /headings, lists, bold emphasis/);
  assert.match(result[0].content, /appropriate language tag/);
  assert.match(result[0].content, /Skip generic openings/);
  assert.match(result[0].content, /distinguish verified facts from uncertainty/);
  assert.match(result[0].content, /Answer in Indonesian/);
  assert.deepEqual(result[1], input[1]);
  assert.equal(input[0].content, "Answer in Indonesian and follow the user's coding constraints.");
  const defaulted = withCoreSystemInstruction([{ role: "user", content: "hello" }]);
  assert.equal(defaulted[0].role, "system");
  assert.match(defaulted[0].content, /world-class AI assistant/);
  assert.match(defaulted[0].content, /When creating documents or visual content/);
  assert.match(defaulted[0].content, /complete, detailed, and usable/);
  assert.equal(withCoreSystemInstruction(defaulted).length, 2);
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
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://preview-branch.myai-v3-firmansyah.pages.dev");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization, X-Requested-With");

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
  assert.ok(body.indexOf('"type":"metrics"') < body.indexOf("data: [DONE]"));
});

test("Gemini and Groq catalogs exclude non-chat models and retain current text models", async (context) => {
  clearGatewayCatalogCache();
  setFetch(context, async () => Response.json({
    models: [
      { name: "models/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-flash-image-preview", displayName: "Gemini Image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-flash-preview-tts", displayName: "Gemini TTS", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-robotics-preview", displayName: "Gemini Robotics", supportedGenerationMethods: ["generateContent"] },
    ],
  }));
  const result = await gatewayModelGroups({ gemini: "configured" }, ["gemini"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.groups[0].models.map((model) => [model.id, model.accessTier]), [
    ["gemini-3.1-pro-preview", "max"],
    ["gemini-3.8-flash", "free"],
  ]);
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

test("guest models use current provider catalogs instead of hardcoded model IDs", () => {
  const models = guestModelsForKeys(
    { openrouter: "configured" },
    [
      {
        provider: "gateway-gemini",
        models: [
          { id: "gemini-current-flash", name: "Gemini Flash", accessTier: "free", imageSupport: true },
          { id: "gemini-current-pro", name: "Gemini Pro", accessTier: "max" },
        ],
      },
      {
        provider: "gateway-groq",
        models: [
          { id: "llama-current-8b", name: "Llama 8B", accessTier: "free" },
          { id: "llama-current-70b", name: "Llama 70B", accessTier: "pro" },
        ],
      },
    ],
    [{ id: "example/openrouter-free", name: "OpenRouter Free" }],
  );
  assert.deepEqual(models.map((model) => model.id), [
    "gemini::gemini-current-flash",
    "groq::llama-current-8b",
    "openrouter::example/openrouter-free",
  ]);
  assert.equal(models[0].priceTier, "check");
  assert.equal(models[0].accessTier, "free");
  assert.equal(models[0].imageSupport, true);
  assert.equal(models.some((model) => model.id.includes("3.8") || model.id.includes("qwen/qwen3-32b")), false);
});

test("gateway rejects unknown and removed Kimi and Anthropic providers before any upstream call", async () => {
  const response = await handleGatewayRequest(request({ provider: "unknown", model: "x", messages: [] }), {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /Provider gateway harus/);
  const kimiResponse = await handleGatewayRequest(request({ provider: "kimi", model: "kimi-k2", messages: [] }), {
    kimi: "unused-kimi-secret",
  });
  assert.equal(kimiResponse.status, 400);
  assert.match((await kimiResponse.json()).error.message, /Provider gateway harus/);
  const anthropicResponse = await handleGatewayRequest(request({ provider: "claude", model: "claude-sonnet", messages: [] }), {
    claude: "unused-anthropic-secret",
  });
  assert.equal(anthropicResponse.status, 400);
  assert.match((await anthropicResponse.json()).error.message, /Provider gateway harus/);
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
});

test("gateway rejects audio and video payloads with a transcription instruction", async () => {
  const response = await handleGatewayRequest(request({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: "Summarize this clip", video: "base64-data" }],
  }), { groq: "groq-secret" });
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
  }), { groq: "groq-secret" });
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
  }), { openrouter: "openrouter-secret", groq: "groq-secret" });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
  assert.match(stream, /API key ditolak/);
  assert.doesNotMatch(stream, /"provider":"groq"/);
});

test("gateway normalizes a Gemini SSE stream", async (context) => {
  setFetch(context, async (url, options) => {
    if (String(url).includes("pageSize=1000")) {
      assert.equal(options.headers["x-goog-api-key"], "gemini-secret");
      return Response.json({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] }] });
    }
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await handleGatewayRequest(request({ provider: "gemini", model: "gemini-2.5-flash", messages: [{ role: "user", content: "hello" }] }), { gemini: "gemini-secret" });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"content":"hello"/);
  assert.match(body, /data: \[DONE\]/);
  assert.doesNotMatch(body, /gemini-secret/);
});

test("gateway uses the Groq catalog and OpenAI-compatible stream", async (context) => {
  setFetch(context, async (url, options) => {
    if (String(url).endsWith("/models")) {
      assert.equal(options.headers.Authorization, "Bearer groq-secret");
      return Response.json({ data: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" }] });
    }
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await handleGatewayRequest(request({ provider: "groq", model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "hello" }] }), { groq: "groq-secret" });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"content":"hello"/);
  assert.match(body, /data: \[DONE\]/);
  assert.doesNotMatch(body, /groq-secret/);
});

test("Gemini gateway enables Google Search for web mode", async (context) => {
  clearGatewayCatalogCache("gemini");
  setFetch(context, async (url, options) => {
    if (String(url).includes("pageSize=1000")) {
      return Response.json({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent"] }] });
    }
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.tools, [{ googleSearch: {} }]);
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Current result."}]},"groundingMetadata":{"groundingChunks":[{"web":{"uri":"https://example.gov/source","title":"Official source"}}]}}]}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const response = await handleGatewayRequest(request({
    provider: "gemini",
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "Find current information" }],
    webSearch: true,
    researchMode: true,
  }), { gemini: "gemini-secret" });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"content":"Current result\."/);
  assert.match(body, /https:\/\/example\.gov\/source/);
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
  }), { openrouter: "openrouter-secret" });
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
  assert.match((await response.json()).error.message, /Pilih Gemini atau OpenRouter/);
});

test("gateway routes NVIDIA through its OpenAI-compatible API", async (context) => {
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
    }), { [config.provider]: config.key });
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
    const response = await handleGatewayRequest(request({ provider: "openrouter", model, messages: [{ role: "user", content: "hello" }] }), { openrouter: "openrouter-secret" });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /"content":"hello"/);
    assert.doesNotMatch(body, /openrouter-secret/);
  }
  assert.equal(calls, 3);
});

test("OpenRouter catalog prioritizes Claude and GPT and never returns the API key", async (context) => {
  setFetch(context, async () => Response.json(openRouterCatalog()));
  const { groups, errors } = await gatewayModelGroups({ openrouter: "private-secret" }, ["openrouter"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(groups[0].models.map((model) => model.id), ["anthropic/claude-sonnet-4", "openai/gpt-4o", "meta/llama-4-scout"]);
  assert.equal(groups[0].models[0].priceTier, "check");
  assert.equal(groups[0].models[0].contextWindow, 200000);
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
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[1].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[2].body.model, "llama-3.1-8b-instant");
  assert.match(stream, /"type":"fallback"/);
  assert.match(stream, /"provider":"groq"/);
  assert.match(stream, /HTTP 429/);
  assert.match(stream, /"model":"llama-3\.1-8b-instant"/);

  const { groups } = await gatewayModelGroups({ openrouter: "openrouter-secret", groq: "groq-secret" }, ["openrouter"]);
  assert.equal(groups[0].models[0].availabilityStatus, "limited-rate");
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

test("gateway can use its built-in text fallback when explicitly authorized and catalog is unavailable", async (context) => {
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
  assert.match(stream, /Built-in fallback recovered\./);
  assert.match(stream, /"provider":"groq"/);
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

test("gateway follows the six-provider order only after fallback is explicitly authorized", async (context) => {
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
    if (target === "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000") {
      return Response.json({ models: [{
        name: "models/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        supportedGenerationMethods: ["generateContent"],
      }] });
    }
    chatCalls.push(target);
    if (target === "https://openrouter.ai/api/v1/chat/completions"
      || target === "https://api.groq.com/openai/v1/chat/completions") {
      return Response.json({ error: { message: "temporarily unavailable" } }, { status: 500 });
    }
    assert.equal(target, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Gemini fallback"}]}}]}\n\ndata: [DONE]\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  clearGatewayCatalogCache();
  const response = await handleGatewayRequest(request({
    allowFallback: true,
    provider: "openrouter",
    model: "google/gemma-4-26b-a4b-it:free",
    messages: [{ role: "user", content: "Use the next healthy provider." }],
  }), { openrouter: "openrouter-secret", groq: "groq-secret", gemini: "gemini-secret" });
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(chatCalls, [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
    "https://api.groq.com/openai/v1/chat/completions",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
  ]);
  assert.match(stream, /Gemini fallback/);
  assert.match(stream, /"provider":"openrouter","model":"google\/gemma-4-26b-a4b-it:free"[^}]*"status":"ERROR"/);
  assert.match(stream, /"provider":"groq","model":"llama-3.1-8b-instant"[^}]*"status":"ERROR"/);
  assert.match(stream, /"provider":"gemini","model":"gemini-2.5-flash","status":"HEALTHY"/);
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
  }), { nvidia: "nvidia-secret", groq: "groq-secret" });
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
  }), { groq: "groq-secret" });
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
  }), { groq: "groq-secret" });
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody.messages[0].content[1], {
    type: "image_url",
    image_url: { url: "data:image/jpeg;base64,AA==" },
  });
  assert.match(await response.text(), /Gambar menunjukkan seekor kucing/);
});

test("legacy Pollinations image routes never fetch images from the Worker", async (context) => {
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
  assert.equal(upstreamCalls, 0);
});

let authTestKeys;
async function authorizedToken() {
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
    aud: "my-ai-69027",
    iss: "https://securetoken.google.com/my-ai-69027",
    sub: "test-user",
    email: "user@example.com",
    email_verified: true,
    iat: issuedAt,
    exp: issuedAt + 3600,
    firebase: { sign_in_provider: "google.com" },
  })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned));
  return { token: `${unsigned}.${Buffer.from(signature).toString("base64url")}`, jwk };
}

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
    GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
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
    GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.provider, "groq");
  assert.equal(result.status, "HEALTHY");
  assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
});

test("enhance-prompt authenticates and routes short prompt rewrites to fast Groq", async (context) => {
  const { token, jwk } = await authorizedToken();
  let groqRequest;
  let upstreamCalls = 0;
  let rateLimited = false;
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    upstreamCalls++;
    groqRequest = { headers: options.headers, body: JSON.parse(options.body), signal: options.signal };
    return Response.json({ choices: [{ message: { content: "Buat rencana belajar Python empat minggu dengan target mingguan dan latihan harian." } }] });
  });
  const env = {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    GUEST_AI_LIMITER: { limit: async ({ key }) => ({ success: !rateLimited && key === "enhance-prompt:test-user" }) },
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
  const response = await worker.fetch(makeRequest({ prompt: "buat jadwal belajar python" }), env);
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.deepEqual(responseBody, {
    prompt: "Buat rencana belajar Python empat minggu dengan target mingguan dan latihan harian.",
  });
  assert.equal(groqRequest.headers.Authorization, "Bearer groq-secret");
  assert.equal(groqRequest.body.model, "openai/gpt-oss-20b");
  assert.equal(groqRequest.body.stream, false);
  assert.equal(groqRequest.body.messages[1].content, "buat jadwal belajar python");
  assert.match(groqRequest.body.messages[0].content, /same language as the input/);
  assert.doesNotMatch(JSON.stringify(responseBody), /groq-secret/);

  rateLimited = true;
  const limited = await worker.fetch(makeRequest({ prompt: "draft" }), env);
  assert.equal(limited.status, 429);
  assert.equal(upstreamCalls, 1);
  rateLimited = false;
  const invalid = await worker.fetch(makeRequest({ prompt: "   " }), env);
  assert.equal(invalid.status, 400);
  assert.equal(upstreamCalls, 1);
});

test("image prompt enhancement repairs invalid Groq JSON once and returns its actual route metadata (MOCK)", async (context) => {
  const { token, jwk } = await authorizedToken();
  const requests = [];
  setFetch(context, async (url, options = {}) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    const content = requests.length === 1
      ? "not-json"
      : JSON.stringify({
        prompt: "A vivid Indonesian Independence Day flag-raising ceremony with prominent red-and-white flags in a village square, warm morning light, and a joyful community, editorial illustration, no text.",
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
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ mode: "image", prompt: "tolong buatka gambar tentang kemerdekaan indonesia" }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.enhanced, true);
  assert.equal(result.enhancer, "groq");
  assert.equal(result.enhancerModel, "openai/gpt-oss-20b");
  assert.match(result.prompt, /Indonesian Independence Day/i);
  assert.match(result.prompt, /red-and-white/i);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, "json_object");
  assert.match(requests[1].messages[1].content, /repair/);
  assert.doesNotMatch(JSON.stringify(result), /groq-secret/);
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
    GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(response.status, 200);
  const responseText = await response.text();
  assert.match(responseText, /complete code/);
  assert.match(responseText, /"type":"usage","tokens":\{"prompt_tokens":321,"completion_tokens":42,"total_tokens":363\}/);
  assert.match(responseText, /"type":"metrics","tokens":363,"completion_tokens":42,"duration_ms":\d+,"model":"llama-3\.3-70b-versatile"/);
  assert.ok(responseText.indexOf('"type":"metrics"') < responseText.indexOf("data: [DONE]"));
  assert.deepEqual(sentBody.stream_options, { include_usage: true });
  assert.equal(sentMessages[0].role, "system");
  assert.match(sentMessages[0].content, /production-ready/);
  assert.match(sentMessages[0].content, /Reply in the same language as the user's latest request/);
  assert.match(sentMessages[0].content, /HTML ARTIFACT LANGUAGE/);
  assert.match(sentMessages[0].content, /visible titles, headings, labels, buttons/);
  assert.match(sentMessages[0].content, /hides the raw payload/);
  assert.match(sentMessages[0].content, /AUTOMATIC ACTION ROUTER/);
  assert.match(sentMessages[0].content, /1280x720 HTML\/CSS slide carousel/);
  assert.match(sentMessages[0].content, /json:slides/);
  assert.match(sentMessages[0].content, /"number":1/);
  assert.match(sentMessages[0].content, /About User: Web developer/);
  assert.match(sentMessages[0].content, /Preferred Response Style: Answer concisely/);
  assert.match(sentMessages[0].content, /Keep the response in Indonesian/);
  assert.equal(sentMessages[1].content, "Write a complete page.");
});

test("chat generateImage returns a direct Pollinations URL and never fetches image bytes", async (context) => {
  const { token, jwk } = await authorizedToken();
  let optimizedPrompt = "";
  let enhancerRequestBody;
  let limiterKey = "";
  setFetch(context, async (url, options) => {
    if (String(url).includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    if (String(url) === "https://api.groq.com/openai/v1/chat/completions") {
      enhancerRequestBody = JSON.parse(options.body);
      optimizedPrompt = JSON.stringify({
        prompt: "A sunrise over mountain peaks, golden dawn light reflecting on a still lake, cinematic wide landscape.",
        negative: "unrelated objects, text, logos, watermark",
        aspect: "16:9",
        style: "Cinematic landscape",
        assumptions: "Saya mempertahankan gunung dan suasana matahari terbit.",
      });
      return Response.json({ choices: [{ message: { content: optimizedPrompt } }] });
    }
    assert.fail(`Unexpected Worker upstream request: ${url}`);
  });

  const verifyUploadedImageEdit = async (childContext) => {
    const { token, jwk } = await authorizedToken();
    let visionRequest;
    setFetch(childContext, async (url, options) => {
      if (String(url).includes("securetoken@system.gserviceaccount.com")) {
        return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
      }
      if (String(url) === "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000") {
        return Response.json({ models: [{
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          supportedGenerationMethods: ["generateContent"],
        }] });
      }
      assert.match(String(url), /models\/gemini-2\.5-flash:generateContent$/);
      assert.equal(options.headers["x-goog-api-key"], "gemini-secret");
      visionRequest = JSON.parse(options.body);
      return Response.json({ candidates: [{ content: { parts: [{ text: "A realistic, softly lit portrait with natural skin tones and balanced warm lighting" }] } }] });
    });
    clearGatewayCatalogCache("gemini");
    const response = await worker.fetch(new Request("https://worker.test/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: "https://myai-v3-firmansyah.pages.dev",
      },
      body: JSON.stringify({
        provider: "gemini",
        model: "flux",
        messages: [{
          role: "user",
          content: "Perbaiki pencahayaannya agar tampak realistis.",
          images: ["data:image/jpeg;base64,ZmFrZS1pbWFnZQ=="],
        }],
      }),
    }), {
      FIREBASE_PROJECT_ID: "my-ai-69027",
      AUTHORIZED_EMAILS: "user@example.com",
      GEMINI_API_KEY: "gemini-secret",
      GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
    });
    assert.equal(response.status, 200);
    assert.match(visionRequest.contents[0].parts[0].text, /Perbaiki pencahayaannya/);
    assert.deepEqual(visionRequest.contents[0].parts[1], {
      inlineData: { mimeType: "image/jpeg", data: "ZmFrZS1pbWFnZQ==" },
    });
    const result = await response.text();
    assert.match(result, /^!\[Generated Image\]\(https:\/\/image\.pollinations\.ai\/prompt\/A%20realistic/);
  };

  const verifyImageEditIntent = () => {
    assert.equal(isImageEditRequest("Perbaiki pencahayaannya agar tampak realistis."), true);
    assert.equal(isImageEditRequest("Ubah gaya jadi anime."), true);
    assert.equal(isImageEditRequest("Jelaskan apa yang terlihat pada gambar ini."), false);
  };
  const response = await worker.fetch(new Request("https://worker.test/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({
      provider: "gemini",
      model: "flux",
      imageWidth: 1280,
      imageHeight: 720,
      messages: [{ role: "user", content: "Buatkan gambar sampel: pegunungan saat matahari terbit." }],
    }),
  }), {
    FIREBASE_PROJECT_ID: "my-ai-69027",
    AUTHORIZED_EMAILS: "user@example.com",
    GROQ_API_KEY: "groq-secret",
    GUEST_AI_LIMITER: { limit: async ({ key }) => {
      limiterKey = key;
      return { success: true };
    } },
  });
  assert.equal(response.status, 200);
  assert.equal(limiterKey, "pollinations:test-user");
  assert.match(response.headers.get("Content-Type"), /^text\/markdown/);
  assert.ok(optimizedPrompt, "the mocked Groq image prompt enhancer was not called");
  assert.equal(enhancerRequestBody.model, "openai/gpt-oss-20b");
  assert.equal(JSON.parse(enhancerRequestBody.messages[1].content).request, "pegunungan saat matahari terbit");
  assert.match(enhancerRequestBody.messages[0].content, /Turn abstract concepts into a concrete scene/);
  const result = await response.text();
  assert.match(result, /^!\[Generated Image\]\(https:\/\/image\.pollinations\.ai\/prompt\/A%20sunrise%20over%20mountain%20peaks/);
  assert.match(result, /\?width=1280&height=720&nologo=true&enhance=false&seed=\d+\)$/);
  assert.match(result, /Avoid%3A%20unrelated%20objects%2C%20text/);
  assert.equal(decodeURIComponent(optimizedPrompt).includes("mountain"), true);
  await context.test("chat improves an uploaded image through Gemini Vision before returning a new image URL", verifyUploadedImageEdit);
  await context.test("image edit intent recognizes common Indonesian requests without classifying ordinary analysis", verifyImageEditIntent);
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

test("email endpoint authenticates, rate-limits, validates and sends through Resend", async (context) => {
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
    GUEST_AI_LIMITER: { limit: async ({ key }) => ({ success: key === "email:test-user" }) },
  };
  const response = await worker.fetch(new Request("https://worker.test/send-email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "https://myai-v3-firmansyah.pages.dev",
    },
    body: JSON.stringify({ to: "recipient@example.com", subject: "Hello", body_markdown: "Plain text body" }),
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "email-test-id" });
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].headers.Authorization, "Bearer resend-private-key");
  assert.deepEqual(resendCalls[0].body, {
    from: "MyAI <noreply@example.com>",
    to: ["recipient@example.com"],
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

test("Gemini Image circuit breaker opens after three consecutive provider failures (MOCK)", async (context) => {
  const { token, jwk } = await authorizedToken();
  let mode = "success";
  const imageModels = [];
  setFetch(context, async (url) => {
    const target = String(url);
    if (target.includes("securetoken@system.gserviceaccount.com")) {
      return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
    }
    const model = target.match(/models\/([^/]+):generateContent$/)?.[1];
    imageModels.push(model);
    if (mode === "success") {
      return Response.json({
        candidates: [{ content: { parts: [{ inlineData: { data: "image-data", mimeType: "image/png" } }] } }],
      });
    }
    return Response.json({
      error: {
        status: "RESOURCE_EXHAUSTED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaMetric: "test-quota", quotaValue: "0" }],
        }],
      },
    }, { status: 429 });
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
    GEMINI_API_KEY: "gemini-secret",
    GUEST_AI_LIMITER: { limit: async () => ({ success: true }) },
  });

  const success = await invoke();
  assert.equal(success.status, 200);
  mode = "quota";
  for (let failure = 0; failure < 3; failure += 1) {
    const response = await invoke();
    assert.equal(response.status, 429);
  }
  const callsBeforeOpenCircuit = imageModels.length;
  const openCircuitResponse = await invoke();
  assert.equal(openCircuitResponse.status, 503);
  assert.match((await openCircuitResponse.json()).error.message, /dilewati|cadangan/i);
  assert.equal(imageModels.length, callsBeforeOpenCircuit);
  assert.deepEqual(imageModels, Array(4).fill("gemini-3.1-flash-image"));
});
