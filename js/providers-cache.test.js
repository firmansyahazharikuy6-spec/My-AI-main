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

test("Pollinations and chat providers cannot generate images", async () => {
  for (const [provider, options] of [
    ["pollinations", {}],
    ["gemini", { imageGeneration: true }],
    ["groq", { generateImage: true }],
  ]) {
    await assert.rejects(async () => {
      for await (const _chunk of streamChat(provider, "test-model", [
        { role: "user", content: "Create an image of a robot." },
      ], options, new AbortController().signal)) {}
    }, /hanya tersedia melalui Gemini Image/i);
  }
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

test("gateway stream forwards answer, truncation, and usage events", async (context) => {
  setFetch(context, async (url, options) => {
    assert.equal(url, "/api/gateway");
    assert.equal(JSON.parse(options.body).allowFallback, true);
    return new Response([
      'data: {"choices":[{"delta":{"content":"Answer"}}]}',
      'data: {"type":"truncated","truncated":true}',
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
    { truncated: true },
    { usage: { promptTokens: 120, completionTokens: 9, totalTokens: 129 } },
    { metrics: { tokens: 129, completionTokens: 9, durationMs: 700, model: "test-model" } },
    { providerHealth: { provider: "groq", model: "test-model", status: "HEALTHY", detail: "", latencyMs: 140 } },
  ]);
});

test("direct Gemini chat is blocked before the browser makes an API request", async () => {
  await assert.rejects(async () => {
    for await (const _chunk of streamChat(
      "gateway-gemini",
      "gemini-test",
      [{ role: "user", content: "Try a fallback." }],
      { authToken: "test-token" },
    )) {}
  }, /Chat langsung Google Gemini tidak tersedia/);
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
      prompt: "A majestic mountain range at sunrise, the first golden light breaking over jagged peaks and spilling across a high alpine valley, soft morning mist pooling in the valleys below, a winding trail leading toward the slopes, scattered pine trees on the lower ridges, warm amber and rose light against cool blue shadows, layered ridgelines fading into the distance, dramatic wide cinematic composition, crisp atmospheric depth, photorealistic landscape, no text.",
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

test("image prompt enhancement preserves metadata for every supported cloud provider", async (context) => {
  setFetch(context, async () => Response.json({
    prompt: "A sweeping panoramic landscape of rolling green hills under a bright blue sky, a calm river winding through the valley toward a distant village with small red-roofed houses, scattered oak trees casting long soft shadows, wildflowers in white and yellow dotting the meadows in the foreground, warm afternoon sunlight streaming from the left with gentle golden highlights, a few birds gliding high above the treeline, a light breeze moving through the tall grass, golden light glittering on the water surface, soft cumulus clouds drifting slowly across the sky, the distant hills layered in hazy blue tones for depth, a dirt path curving along the riverbank, rich green and gold palette with cool blue accents, wide cinematic composition with a low horizon line, deep depth of field keeping both the foreground flowers and the distant village sharp, natural atmosphere, gentle reflections of the clouds on the calm water, warm earthy tones in the dirt path, dewy grass sparkling in the sunlight, a wooden fence running along the hillside, the peaceful mood of a late summer afternoon, photorealistic landscape photography style, no text.",
    negative: "",
    aspect: "16:9",
    style: "cinematic",
    assumptions: "Pemandangan umum.",
    enhanced: true,
    enhancer: "groq",
    enhancerModel: "llama-3.1-8b-instant",
  }));

  const result = await enhanceImagePrompt("buat pemandangan", { authToken: "test-token" });
  assert.equal(result.enhanced, true);
  assert.equal(result.enhancer, "groq");
  assert.equal(result.enhancerModel, "llama-3.1-8b-instant");
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

test("settings migrate known default prompts but preserve user custom instructions", () => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  try {
    storage.setItem("myai_settings", JSON.stringify({
      systemPrompt: "Jawablah secara ramah, jelas, dan natural. Utamakan jawaban yang sesuai kebutuhan pengguna.",
    }));
    assert.match(loadSettings().systemPrompt, /Ikuti instruksi inti MyAI/);

    storage.setItem("myai_settings", JSON.stringify({ systemPrompt: "Always answer in concise Indonesian." }));
    assert.equal(loadSettings().systemPrompt, "Always answer in concise Indonesian.");
  } finally {
    globalThis.localStorage = oldStorage;
  }
});
