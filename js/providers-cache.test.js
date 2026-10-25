import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidateGuestModels,
  invalidateServerModels,
  loadSettings,
  listGuestModels,
  listServerModels,
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

test("server model catalogs persist per user without saving credentials", async (context) => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  const oldFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({
      providers: [{ id: "groq" }],
      groups: [{ provider: "gateway-groq", models: [{ id: "model-one" }] }],
      errors: [],
    });
  };
  context.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.fetch = oldFetch;
    invalidateServerModels();
  });
  invalidateServerModels();

  const first = await listServerModels("private-token-one", { cacheKey: "user-one" });
  assert.equal(first.groups[0].models[0].id, "model-one");
  invalidateServerModels();
  const second = await listServerModels("private-token-two", { cacheKey: "user-one" });
  assert.equal(second.groups[0].models[0].id, "model-one");
  assert.equal(requests, 1);
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  const stale = await listServerModels("private-token-two", { cacheKey: "user-one", force: true });
  assert.equal(stale.groups[0].models[0].id, "model-one");
  assert.equal(stale.errors.length, 1);
  const cachedJson = [...storage.values.values()].join("");
  assert.doesNotMatch(cachedJson, /private-token|secret|apiKey/i);
});

test("guest model catalog persists while ephemeral trial quota is not cached", async (context) => {
  const oldStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  const oldFetch = globalThis.fetch;
  globalThis.localStorage = storage;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({
      groups: [{ provider: "guest", models: [{ id: "guest-model" }] }],
      remaining: 2,
      errors: [],
    });
  };
  context.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.fetch = oldFetch;
    invalidateGuestModels();
  });
  invalidateGuestModels();

  assert.equal((await listGuestModels()).remaining, 2);
  invalidateGuestModels();
  const cached = await listGuestModels();
  assert.equal(cached.groups[0].models[0].id, "guest-model");
  assert.equal(cached.remaining, null);
  assert.equal(requests, 1);
  globalThis.fetch = async () => { throw new TypeError("offline"); };
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
    for await (const _chunk of streamChat("server-gemini-image", "gemini-3.1-flash-image", [
      { role: "user", content: "Write a portfolio website." },
    ], { imageGeneration: true }, new AbortController().signal)) {}
  }, /endpoint khusus gambar/i);
});

test("gateway SSE releases its reader lock and request guard after provider errors", async (context) => {
  const oldFetch = globalThis.fetch;
  let response;
  globalThis.fetch = async () => {
    response = new Response('data: {"error":{"message":"simulated provider error"}}\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
    return response;
  };
  context.after(() => { globalThis.fetch = oldFetch; });

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
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/gateway");
    return new Response([
      'data: {"choices":[{"delta":{"content":"Answer"}}]}',
      'data: {"type":"usage","tokens":{"prompt_tokens":120,"completion_tokens":9,"total_tokens":129}}',
      'data: {"type":"metrics","tokens":129,"completion_tokens":9,"duration_ms":700,"model":"test-model"}',
      'data: {"type":"provider-health","provider":"groq","model":"test-model","status":"HEALTHY","latencyMs":140}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { headers: { "Content-Type": "text/event-stream" } });
  };
  context.after(() => { globalThis.fetch = oldFetch; });

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

test("REST model responses forward provider-reported token usage", async (context) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(url, /\/chat$/);
    return Response.json({
      choices: [{ message: { content: "Answer" } }],
      usage: { prompt_tokens: 35, completion_tokens: 7, total_tokens: 42 },
    });
  };
  context.after(() => { globalThis.fetch = oldFetch; });

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
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Pollinations direct mode must not call fetch."); };
  context.after(() => { globalThis.fetch = oldFetch; });

  const chunks = [];
  for await (const chunk of streamChat("pollinations", "flux", [
    { role: "user", content: "draw a red robot" },
  ], { imageGeneration: true })) chunks.push(chunk);

  const imageUrl = new URL(chunks[0].image);
  assert.match(imageUrl.pathname, /^\/prompt\/A%20clear%2C%20concrete%20visual%20depiction/);
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
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "![Generated Image](https://image.pollinations.ai/prompt/robot?width=1024&height=1024&seed=1)",
    { headers: { "Content-Type": "text/markdown" } },
  );
  context.after(() => { globalThis.fetch = oldFetch; });

  const chunks = [];
  for await (const chunk of streamChat("gemini", "flux", [
    { role: "user", content: "create an image of a robot" },
  ], { authToken: "test-token", imageGeneration: true })) chunks.push(chunk);
  assert.equal(chunks[0].image, "https://image.pollinations.ai/prompt/robot?width=1024&height=1024&seed=1");

  globalThis.fetch = async () => new Response(
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
