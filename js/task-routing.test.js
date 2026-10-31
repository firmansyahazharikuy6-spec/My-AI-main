import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalProvider,
  isProviderCircuitOpen,
  imageTaskGroups,
  rankDocumentModels,
  recordProviderResult,
  resetProviderCircuits,
  runProviderFallbacks,
} from "./task-routing.js";

test("image tasks retain Gemini image models regardless of access tier and exclude other providers", () => {
  const groups = imageTaskGroups([
    { provider: "openrouter", models: [{ id: "google/gemini-2.5-flash-image", imageOnly: true, accessTier: "basic" }] },
    { provider: "gateway-openrouter", models: [{ id: "google/gemini-2.5-flash", imageOnly: false }] },
    { provider: "gemini", models: [{ id: "gemini-3.1-flash-image", imageOnly: true }] },
    { provider: "flux", models: [{ id: "flux-image", imageOnly: true }] },
  ]);
  assert.deepEqual(groups.map((group) => group.models.map((model) => model.id)), [["google/gemini-2.5-flash-image"]]);
  assert.equal(groups[0].models[0].provider, "openrouter");
});

test("image tasks use the authenticated Gemini fallback when the dynamic catalog has no image model", () => {
  const fallback = {
    provider: "openrouter",
    models: [{ id: "google/gemini-2.5-flash-image", name: "Gemini Image", imageOnly: true, accessTier: "basic" }],
  };
  const groups = imageTaskGroups([{ provider: "groq", models: [] }], fallback);
  assert.equal(groups[0].models[0].provider, "openrouter");
  assert.equal(groups[0].models[0].id, "google/gemini-2.5-flash-image");
  assert.deepEqual(imageTaskGroups([], { ...fallback, provider: "flux" }), []);
});

test("document routing uses only live catalog models and prefers long-context providers", () => {
  const ranked = rankDocumentModels([
    { provider: "gateway-groq", models: [{ id: "llama-fast", name: "Fast", contextWindow: 32768 }] },
    { provider: "gateway-openrouter", models: [
      { id: "anthropic/claude-sonnet", name: "Claude Sonnet", contextWindow: 200000 },
      { id: "google/gemini-flash", name: "Gemini Flash", contextWindow: 100000 },
    ] },
    { provider: "gemini", models: [{ id: "image-only", name: "Image", imageOnly: true }] },
  ]);
  assert.deepEqual(ranked.map(({ id }) => id), ["anthropic/claude-sonnet", "llama-fast"]);
  assert.deepEqual(rankDocumentModels([{ provider: "gateway-gemini", models: [{ id: "gemini-flash" }] }]), []);
});

test("document routing prioritizes supported providers that recently completed a live request", () => {
  const ranked = rankDocumentModels([
    { provider: "gateway-openrouter", models: [{ id: "claude", name: "Claude", contextWindow: 200000 }] },
    { provider: "gateway-groq", models: [{ id: "llama-flash", name: "Llama Flash", contextWindow: 100000 }] },
  ], { groq: { status: "HEALTHY" } });
  assert.deepEqual(ranked.map(({ id }) => id), ["llama-flash", "claude"]);
});

test("document routing prefers available NVIDIA NIM and falls back when it is unhealthy", () => {
  const groups = [
    { provider: "gateway-openrouter", models: [{ id: "google/gemma-3", name: "Gemma 3", contextWindow: 100000 }] },
    { provider: "gateway-nvidia", models: [{ id: "nvidia/nemotron", name: "Nemotron", contextWindow: 32768 }] },
    { provider: "gateway-groq", models: [{ id: "llama", name: "Llama", contextWindow: 32768 }] },
  ];
  assert.deepEqual(rankDocumentModels(groups).map(({ id }) => id), ["nvidia/nemotron", "google/gemma-3", "llama"]);
  assert.deepEqual(rankDocumentModels(groups, {
    nvidia: { status: "UNREACHABLE" },
    groq: { status: "HEALTHY" },
  }).map(({ id }) => id), ["llama", "google/gemma-3", "nvidia/nemotron"]);
});

test("fallback runs the next provider once after simulated 429 and labels its selection", async () => {
  resetProviderCircuits();
  const attempted = [];
  const selected = await runProviderFallbacks([
    { provider: "gateway-gemini", id: "gemini-a" },
    { provider: "gateway-openrouter", id: "google/gemma-free" },
    { provider: "gateway-groq", id: "groq-b" },
  ], async (model) => {
    attempted.push(model.provider);
    if (model.provider === "gateway-openrouter") throw new Error("HTTP 429: quota");
  }, {
    onAttempt: (model) => attempted.push(`label:${model.id}`),
  });
  assert.equal(selected.id, "groq-b");
  assert.deepEqual(attempted, ["label:google/gemma-free", "gateway-openrouter", "label:groq-b", "gateway-groq"]);
});

test("fallback never retries a failed provider and does not hide 401/403 or 5xx", async () => {
  for (const status of [401, 403, 500, 503]) {
    resetProviderCircuits();
    const attempts = [];
    const selected = await runProviderFallbacks([
      { provider: "groq", id: "primary" },
      { provider: "openrouter", id: "fallback" },
    ], async (model) => {
      attempts.push(model.provider);
      if (model.provider === "groq") throw new Error(`HTTP ${status}`);
    });
    assert.equal(selected.provider, "openrouter");
    assert.deepEqual(attempts, ["groq", "openrouter"]);
  }
});

test("provider circuit breaker opens after three consecutive failures and closes on success/expiry", () => {
  resetProviderCircuits();
  recordProviderResult("gateway-groq", false, 1000);
  recordProviderResult("gateway-groq", false, 1001);
  assert.equal(isProviderCircuitOpen("groq", 1002), false);
  recordProviderResult("groq", false, 1003);
  assert.equal(isProviderCircuitOpen("gateway-groq", 1004), true);
  recordProviderResult("groq", true, 1005);
  assert.equal(isProviderCircuitOpen("groq", 1006), false);
  for (let index = 0; index < 3; index++) recordProviderResult("groq", false, 2000 + index);
  assert.equal(isProviderCircuitOpen("groq", 62_002), false);
});

test("fallback propagates user cancellation without selecting another provider", async () => {
  resetProviderCircuits();
  let attempted = 0;
  await assert.rejects(runProviderFallbacks([
    { provider: "openrouter", id: "primary" },
    { provider: "groq", id: "fallback" },
  ], async () => {
    attempted += 1;
    throw new DOMException("cancelled", "AbortError");
  }), { name: "AbortError" });
  assert.equal(attempted, 1);
});
