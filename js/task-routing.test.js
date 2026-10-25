import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalProvider,
  isProviderCircuitOpen,
  rankDocumentModels,
  recordProviderResult,
  resetProviderCircuits,
  runProviderFallbacks,
} from "./task-routing.js";

test("document routing uses only live catalog models and prefers long-context providers", () => {
  const ranked = rankDocumentModels([
    { provider: "gateway-groq", models: [{ id: "llama-fast", name: "Fast", contextWindow: 32768 }] },
    { provider: "gateway-openrouter", models: [
      { id: "anthropic/claude-sonnet", name: "Claude Sonnet", contextWindow: 200000 },
      { id: "google/gemini-flash", name: "Gemini Flash", contextWindow: 100000 },
    ] },
    { provider: "server-gemini-image", models: [{ id: "image-only", name: "Image", imageOnly: true }] },
  ]);
  assert.deepEqual(ranked.map(({ id }) => id), ["anthropic/claude-sonnet", "llama-fast"]);
  assert.equal(canonicalProvider("gateway-gemini"), "gemini");
});

test("fallback runs the next provider once after simulated 429 and labels its selection", async () => {
  resetProviderCircuits();
  const attempted = [];
  const selected = await runProviderFallbacks([
    { provider: "gateway-gemini", id: "gemini-a" },
    { provider: "gateway-groq", id: "groq-b" },
  ], async (model) => {
    attempted.push(model.provider);
    if (model.provider.includes("gemini")) throw new Error("HTTP 429: quota");
  }, {
    onAttempt: (model) => attempted.push(`label:${model.id}`),
  });
  assert.equal(selected.id, "groq-b");
  assert.deepEqual(attempted, ["label:gemini-a", "gateway-gemini", "label:groq-b", "gateway-groq"]);
});

test("fallback never retries a failed provider and does not hide 401/403 or 5xx", async () => {
  for (const status of [401, 403, 500, 503]) {
    resetProviderCircuits();
    const attempts = [];
    const selected = await runProviderFallbacks([
      { provider: "gemini", id: "primary" },
      { provider: "openrouter", id: "fallback" },
    ], async (model) => {
      attempts.push(model.provider);
      if (model.provider === "gemini") throw new Error(`HTTP ${status}`);
    });
    assert.equal(selected.provider, "openrouter");
    assert.deepEqual(attempts, ["gemini", "openrouter"]);
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
    { provider: "gemini", id: "primary" },
    { provider: "groq", id: "fallback" },
  ], async () => {
    attempted += 1;
    throw new DOMException("cancelled", "AbortError");
  }), { name: "AbortError" });
  assert.equal(attempted, 1);
});
