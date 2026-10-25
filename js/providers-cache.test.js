import assert from "node:assert/strict";
import test from "node:test";
import { setFetch } from "../test/set-fetch.js";
import {
  invalidateGuestModels,
  invalidateServerModels,
  isRateLimitOrQuotaError,
  enhanceImagePrompt,
  loadSettings,
  listGuestModels,
  listServerModels,
  normalizeChatMessages,
  regeneratePollinationsUrl,
  saveSettings,
  streamChat,
} from "./providers.js";

class MemoryStorage {
  values = new Map();

  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

test("chat message normalization merges system context and drops stale assistant replies after the latest user", () => {
  const messages = normalizeChatMessages([
    { role: "system", content: "Answer naturally." },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "system", content: "Answer naturally." },
    { role: "system", content: "Use LaTeX only for requested math." },
    { role: "user", content: "Hei mau tanya" },
    { role: "assistant", content: "Stale technical response" },
  ]);
  assert.deepEqual(messages, [
    { role: "system", content: "Answer naturally.\n\nUse LaTeX only for requested math." },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "Hei mau tanya" },
  ]);
  assert.throws(() => normalizeChatMessages([{ role: "developer", content: "invalid" }]), /tidak valid/i);
});

test("provider errors identify HTTP rate limits and quota messages without classifying unrelated failures", () => {
  assert.equal(isRateLimitOrQuotaError(new Error("HTTP 429: too many requests")), true);
  assert.equal(isRateLimitOrQuotaError(new Error("Batas penggunaan provider tercapai.")), true);
  assert.equal(isRateLimitOrQuotaError(new Error("Quota exceeded for this account")), true);
  assert.equal(isRateLimitOrQuotaError(new Error("HTTP 503: upstream unavailable")), false);
  assert.equal(isRateLimitOrQuotaError(new Error("Model tidak ditemukan (HTTP 404).")), false);
});

test("server model catalogs persist per user without saving credentials", async (context) => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  let requests = 0;
  let fetchHandler = async () => {
    requests++;
    return Response.json({
      providers: [{ id: "groq" }],
      groups: [{ provider: "gateway-groq", models: [{ id: "model-one" }] }],
      errors: [],
    });
  };
  setFetch(context, (...args) => fetchHandler(...args));
  context.after(() => {
    globalThis.localStorage = oldStorage;
    invalidateServerModels();
  });
  invalidateServerModels();

  const first = await listServerModels("private-token-one", { cacheKey: "user-one" });
  assert.equal(first.groups[0].models[0].id, "model-one");
  invalidateServerModels();
  const second = await listServerModels("private-token-two", { cacheKey: "user-one" });
  assert.equal(second.groups[0].models[0].id, "model-one");
  assert.equal(requests, 1);
  fetchHandler = async () => { throw new TypeError("offline"); };
  const stale = await listServerModels("private-token-two", { cacheKey: "user-one", force: true });
  assert.equal(stale.groups[0].models[0].id, "model-one");
  assert.equal(stale.errors.length, 1);
  const cachedJson = [...storage.values.values()].join("");
  assert.doesNotMatch(cachedJson, /private-token|secret|apiKey/i);
});

test("guest model catalog persists while ephemeral trial quota is not cached", async (context) => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  const oldDocument = globalThis.document;
  const oldTurnstile = globalThis.turnstile;
  globalThis.localStorage = storage;
  let requests = 0;
  globalThis.document = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      remove() {},
    }),
    body: { append() {} },
  };
  globalThis.turnstile = {
    render: (_container, options) => {
      globalThis.guestTurnstileCallback = options.callback;
      return "test-widget";
    },
    execute: () => globalThis.guestTurnstileCallback("valid-guest-token"),
    remove() {},
  };
  let fetchHandler = async (url, options = {}) => {
    if (String(url).endsWith("/guest/config")) {
      return Response.json({ turnstileSiteKey: "test-site-key" });
    }
    requests++;
    assert.equal(options.headers["X-Turnstile-Token"], "valid-guest-token");
    assert.match(options.headers["X-Guest-Device-Id"], /^[0-9a-f-]{36}$/i);
    return Response.json({
      groups: [{ provider: "guest", models: [{ id: "guest-model" }] }],
      remaining: 2,
      errors: [],
    });
  };
  setFetch(context, (...args) => fetchHandler(...args));
  context.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.document = oldDocument;
    globalThis.turnstile = oldTurnstile;
    delete globalThis.guestTurnstileCallback;
    invalidateGuestModels();
  });
  invalidateGuestModels();

  assert.equal((await listGuestModels()).remaining, 2);
  invalidateGuestModels();
  const cached = await listGuestModels();
  assert.equal(cached.groups[0].models[0].id, "guest-model");
  assert.equal(cached.remaining, null);
  assert.equal(requests, 1);
  fetchHandler = async () => { throw new TypeError("offline"); };
  const stale = await listGuestModels({ force: true });
  assert.equal(stale.groups[0].models[0].id, "guest-model");
  assert.equal(stale.errors.length, 1);
});

test("image generation providers cannot be used by the text chat pipeline", async () => {
  await assert.rejects(async () => {
    for await (const _chunk of streamChat("pollinations", "flux", [
      { role: "user", content: "Write a portfolio website." },
    ], {}, new AbortController().signal)) {}
  }, /tidak dapat digunakan untuk chat teks/i);

  await assert.rejects(async () => {
    for await (const _chunk of streamChat("pollinations", "flux", [
      { role: "user", content: "Write a portfolio website." },
    ], {}, new AbortController().signal)) {}
  }, /tidak dapat digunakan untuk chat teks/i);
});

test("gateway SSE releases its reader lock and request guard after provider errors", async (context) => {
  let response;
  setFetch(context, async () => {
    response = new Response('data: {"error":{"message":"simulated provider error"}}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
    return response;
  });

  await assert.rejects(async () => {
    for await (const _chunk of streamChat(
      "gateway-groq",
      "test-model",
      [{ role: "user", content: "test" }],
      { authToken: "test-token" },
      new AbortController().signal,
    )) {}
  }, /simulated provider error/);
  assert.equal(response.body.locked, false);
});

test("gateway SSE releases its reader lock after a normal stream terminator", async (context) => {
  let response;
  setFetch(context, async () => {
    response = new Response("data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
    return response;
  });

  for await (const _chunk of streamChat(
    "gateway-groq",
    "test-model",
    [{ role: "user", content: "test" }],
    { authToken: "test-token" },
    new AbortController().signal,
  )) {}
  assert.equal(response.body.locked, false);
});

test("custom AI personas survive local settings reload", (context) => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  context.after(() => { globalThis.localStorage = oldStorage; });

  saveSettings({ ...loadSettings(), persona: "researcher" });
  assert.equal(loadSettings().persona, "researcher");
  saveSettings({ ...loadSettings(), persona: "general" });
  assert.equal(loadSettings().persona, "general");
});

test("gateway stream forwards reported usage without dropping answer content", async (context) => {
  setFetch(context, async (url, options) => {
    assert.equal(url, "/api/gateway");
    assert.equal(JSON.parse(options.body).allowFallback, true);
    return new Response([
      'data: {"choices":[{"delta":{"content":"Answer"}}]}',
      'data: {"type":"usage","tokens":{"prompt_tokens":120,"completion_tokens":9,"total_tokens":129}}',
      'data: {"type":"metrics","tokens":129,"completion_tokens":9,"duration_ms":700,"model":"test-model"}',
      'data: {"type":"provider-health","provider":"groq","model":"test-model","status":"HEALTHY","latencyMs":140}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
  });

  const chunks = [];
  for await (const chunk of streamChat("gateway-groq", "test-model", [], { authToken: "test-token" })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [
    { content: "Answer" },
    { usage: { promptTokens: 120, completionTokens: 9, totalTokens: 129 } },
    { metrics: { tokens: 129, completionTokens: 9, durationMs: 700, model: "test-model" } },
    { providerHealth: { provider: "groq", model: "test-model", status: "HEALTHY", detail: "", latencyMs: 140 } },
  ]);
});

test("gateway stream forwards routing metadata and token throughput", async (context) => {
  setFetch(context, async (url, options) => {
    assert.equal(url, "/api/gateway");
    assert.equal(JSON.parse(options.body).promptHelper, true);
    return new Response([
      'data: {"type":"route","fromProvider":"openrouter","fromModel":"selected-model","provider":"nvidia","model":"nvidia/fast-model","modelName":"NVIDIA Fast","message":"Routed to NIM"}',
      'data: {"type":"metrics","tokens":12,"completion_tokens":8,"duration_ms":200,"tokens_per_second":40,"model":"nvidia/fast-model"}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
  });

  const chunks = [];
  for await (const chunk of streamChat(
    "gateway-groq",
    "selected-model",
    [{ role: "user", content: "Polish this prompt." }],
    { authToken: "test-token", promptHelper: true },
  )) chunks.push(chunk);

  assert.deepEqual(chunks, [
    {
      route: {
        provider: "nvidia",
        model: "nvidia/fast-model",
        modelName: "NVIDIA Fast",
        fromProvider: "openrouter",
        fromModel: "selected-model",
        message: "Routed to NIM",
      },
    },
    {
      metrics: {
        tokens: 12,
        completionTokens: 8,
        durationMs: 200,
        tokensPerSecond: 40,
        model: "nvidia/fast-model",
      },
    },
  ]);
});

test("image prompt enhancement preserves NVIDIA NIM route metadata", async (context) => {
  setFetch(context, async (url, options) => {
    assert.match(url, /\/enhance-prompt$/);
    assert.equal(JSON.parse(options.body).mode, "image");
    return Response.json({
      prompt: "A detailed golden-hour landscape with mountains and a reflective lake.",
      negative: "text, watermark",
      aspect: "16:9",
      style: "cinematic",
      assumptions: "Pemandangan lanskap.",
      enhanced: true,
      enhancer: "nvidia",
      enhancerModel: "nvidia/nemotron-nano",
    });
  });

  const result = await enhanceImagePrompt("gunung saat matahari terbit", { authToken: "test-token" });
  assert.equal(result.enhanced, true);
  assert.equal(result.enhancer, "nvidia");
  assert.equal(result.enhancerModel, "nvidia/nemotron-nano");
});

test("REST model responses forward provider-reported token usage", async (context) => {
  setFetch(context, async (url) => {
    assert.match(url, /\/chat$/);
    return Response.json({
      choices: [{ message: { content: "Answer" } }],
      usage: { prompt_tokens: 35, completion_tokens: 7, total_tokens: 42 },
    });
  });

  const chunks = [];
  for await (const chunk of streamChat("modelscope", "test-model", [
    { role: "user", content: "test" },
  ], { authToken: "test-token" })) chunks.push(chunk);

  assert.deepEqual(chunks, [
    { usage: { promptTokens: 35, completionTokens: 7, totalTokens: 42 } },
    { content: "Answer" },
  ]);
});

test("Pollinations model returns a direct image URL without calling the API server", async (context) => {
  setFetch(context, async () => { throw new Error("Pollinations direct mode must not call fetch."); });

  const chunks = [];
  for await (const chunk of streamChat("pollinations", "flux", [
    { role: "user", content: "draw a red robot" },
  ], { imageGeneration: true })) chunks.push(chunk);

  const imageUrl = new URL(chunks[0].image);
  assert.match(decodeURIComponent(imageUrl.pathname), /^\/prompt\/A clear, coherent illustration centered on/);
  assert.match(imageUrl.pathname, /red%20robot/i);
  assert.equal(imageUrl.searchParams.get("model"), "flux");
  assert.match(imageUrl.search, /width=1024&height=1024/);
  assert.equal(imageUrl.searchParams.get("enhance"), "false");
  assert.match(chunks[1].content, /red robot/);
});

test("Pollinations image retry changes only the seed on a trusted image URL", () => {
  const oldRandom = Math.random;
  Math.random = () => 0.123456;
  try {
    const retryUrl = new URL(regeneratePollinationsUrl(
      "https://image.pollinations.ai/prompt/robot?width=1024&height=1024&seed=12&enhance=true",
    ));
    assert.equal(retryUrl.hostname, "image.pollinations.ai");
    assert.equal(retryUrl.pathname, "/prompt/robot");
    assert.equal(retryUrl.searchParams.get("width"), "1024");
    assert.equal(retryUrl.searchParams.get("height"), "1024");
    assert.equal(retryUrl.searchParams.get("enhance"), "true");
    assert.equal(retryUrl.searchParams.get("seed"), "123456");
  } finally {
    Math.random = oldRandom;
  }
  assert.throws(() => regeneratePollinationsUrl("https://attacker.example/prompt/robot"), /URL Pollinations yang valid/);
});

test("image-generation chat accepts only Markdown URLs from Pollinations", async (context) => {
  let fetchHandler = async () => new Response(
    "![Generated Image](https://image.pollinations.ai/prompt/robot?width=1024&height=1024&seed=1)",
    { headers: { "Content-Type": "text/markdown" } },
  );
  setFetch(context, (...args) => fetchHandler(...args));

  const chunks = [];
  for await (const chunk of streamChat("gemini", "flux", [
    { role: "user", content: "create an image of a robot" },
  ], { authToken: "test-token", imageGeneration: true })) chunks.push(chunk);
  assert.equal(chunks[0].image, "https://image.pollinations.ai/prompt/robot?width=1024&height=1024&seed=1");

  fetchHandler = async () => new Response(
    "![Generated Image](https://attacker.example/image.png)",
    { headers: { "Content-Type": "text/markdown" } },
  );
  await assert.rejects(async () => {
    for await (const _chunk of streamChat("gemini", "flux", [
      { role: "user", content: "create an image of a robot" },
    ], { authToken: "test-token", imageGeneration: true })) {}
  }, /URL gambar Pollinations yang valid/);
});

test("performance analytics preference defaults on and persists when turned off", () => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  try {
    const defaults = loadSettings();
    assert.equal(defaults.showPerformanceAnalytics, true);
    saveSettings({ ...defaults, showPerformanceAnalytics: false });
    assert.equal(loadSettings().showPerformanceAnalytics, false);
    saveSettings({ ...loadSettings(), showPerformanceAnalytics: true });
    assert.equal(loadSettings().showPerformanceAnalytics, true);
  } finally {
    globalThis.localStorage = oldStorage;
  }
});
