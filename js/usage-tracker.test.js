import test from "node:test";
import assert from "node:assert/strict";
import { createUsageTracker } from "./usage-tracker.js";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("usage tracker accumulates conversation, tab-session, and daily totals", () => {
  const local = createStorage();
  const session = createStorage();
  const tracker = createUsageTracker({ local, session, now: () => Date.UTC(2026, 0, 2) });

  tracker.trackTokenUsage("gateway-groq", "llama", 12, 8, "chat-1");
  tracker.trackTokenUsage("openrouter", "google/gemma-free", 5, 7, "chat-1");
  const snapshot = tracker.getSnapshot("chat-1");

  assert.equal(snapshot.conversation.totalTokens, 32);
  assert.equal(snapshot.session.promptTokens, 17);
  assert.equal(snapshot.daily.completionTokens, 15);
  assert.equal(snapshot.daily.providers.groq.totalTokens, 20);
  assert.equal(snapshot.daily.providers.groq.models.llama.totalTokens, 20);
});

test("daily usage rolls over while tab-session usage remains available", () => {
  const local = createStorage();
  const session = createStorage();
  let timestamp = new Date(2026, 0, 2, 12).getTime();
  const tracker = createUsageTracker({ local, session, now: () => timestamp });
  tracker.trackTokenUsage("openrouter", "google/gemma-free", 6, 4, "chat-3");

  timestamp += 24 * 60 * 60 * 1000;
  const snapshot = tracker.getSnapshot("chat-3");
  assert.equal(snapshot.daily.totalTokens, 0);
  assert.equal(snapshot.session.totalTokens, 10);
});

test("usage survives tracker recreation using the same browser storages", () => {
  const local = createStorage();
  const session = createStorage();
  const options = { local, session, now: () => new Date(2026, 3, 8, 12).getTime() };
  createUsageTracker(options).trackTokenUsage("openrouter", "model-a", 9, 3, "chat-4");
  const restored = createUsageTracker(options).getSnapshot("chat-4");

  assert.equal(restored.daily.totalTokens, 12);
  assert.equal(restored.session.totalTokens, 12);
  assert.equal(restored.conversation.providers.openrouter.models["model-a"].totalTokens, 12);
});

test("usage tracker clamps invalid counts and retains health with expiring quota states", () => {
  const local = createStorage();
  let timestamp = 1000;
  const tracker = createUsageTracker({ local, session: createStorage(), now: () => timestamp });
  tracker.trackTokenUsage("groq", "llama", -2, Number.NaN, "chat-2");
  const longDetail = "Provider status details should remain readable when wrapped. ".repeat(5);
  tracker.markProviderStatus("gateway-groq", "EXHAUSTED", {
    detail: longDetail,
    model: "llama-3.1",
    latencyMs: 140,
    used: true,
  });
  assert.equal(tracker.getSnapshot("chat-2").conversation.totalTokens, 0);
  assert.equal(tracker.getHealth().groq.status, "EXHAUSTED");
  assert.equal(tracker.getHealth().groq.model, "llama-3.1");
  assert.equal(tracker.getHealth().groq.latencyMs, 140);
  assert.equal(tracker.getHealth().groq.detail, longDetail);

  timestamp = 31 * 60 * 1000;
  const recovered = createUsageTracker({ local, session: createStorage(), now: () => timestamp });
  assert.equal(recovered.getHealth().groq.status, "DEGRADED");
});

test("provider health supports idle, switching, and red error states", () => {
  const tracker = createUsageTracker({ local: createStorage(), session: createStorage(), now: () => 2000 });
  tracker.markProviderStatus("openrouter", "IDLE");
  assert.equal(tracker.getHealth().openrouter.status, "IDLE");
  tracker.markProviderStatus("openrouter", "DEGRADED", { detail: "Switching", model: "model-a", used: true });
  assert.equal(tracker.getHealth().openrouter.status, "DEGRADED");
  tracker.markProviderStatus("openrouter", "ERROR", { detail: "HTTP 503", latencyMs: 900, used: true });
  assert.equal(tracker.getHealth().openrouter.status, "ERROR");
  assert.equal(tracker.getHealth().openrouter.latencyMs, 900);
});

test("Gemini Live health is retained independently from chat providers", () => {
  const tracker = createUsageTracker({ local: createStorage(), session: createStorage(), now: () => 2000 });
  tracker.markProviderStatus("gemini-live", "HEALTHY", { detail: "Live session token issued." });
  assert.equal(tracker.getHealth()["gemini-live"].status, "HEALTHY");
  assert.equal(tracker.getHealth()["gemini-live"].detail, "Live session token issued.");
  assert.equal(tracker.getHealth().gemini, undefined);
});

test("removed provider health is discarded during storage sanitization", () => {
  const local = createStorage();
  local.setItem("myai_usage_tracker_v1", JSON.stringify({
    version: 1,
    health: { huggingface: { status: "EXHAUSTED", detail: "HTTP 402" } },
  }));
  const tracker = createUsageTracker({ local, session: createStorage(), now: () => 2000 });
  assert.equal(tracker.getHealth().huggingface, undefined);
});

test("provider health persists bounded token throughput telemetry", () => {
  const local = createStorage();
  const tracker = createUsageTracker({ local, session: createStorage(), now: () => 2000 });
  tracker.markProviderStatus("nvidia", "HEALTHY", {
    latencyMs: 420,
    tokensPerSecond: 38.6,
    used: true,
  });
  assert.equal(tracker.getHealth().nvidia.latencyMs, 420);
  assert.equal(tracker.getHealth().nvidia.tokensPerSecond, 38.6);
  tracker.markProviderStatus("nvidia", "HEALTHY", { tokensPerSecond: 999999 });
  assert.equal(tracker.getHealth().nvidia.tokensPerSecond, 100000);
});

test("unreachable provider state persists and malformed telemetry is normalized", () => {
  const local = createStorage();
  const session = createStorage();
  local.setItem("myai_usage_tracker_v1", JSON.stringify({
    version: 1,
    days: { "2026-03-04": { promptTokens: "12", completionTokens: 3, providers: [] }, invalid: {} },
    conversations: { chat: { promptTokens: 8, completionTokens: 2 } },
    health: {
      groq: { status: "UNREACHABLE", updatedAt: 2000, used: true, detail: "Worker offline" },
      invalid: { status: "UNKNOWN" },
    },
  }));
  const tracker = createUsageTracker({ local, session, now: () => new Date(2026, 2, 4, 12).getTime() });
  tracker.sanitizeStorage();

  const snapshot = tracker.getSnapshot("chat");
  assert.equal(snapshot.daily.totalTokens, 15);
  assert.equal(snapshot.conversation.totalTokens, 10);
  assert.equal(snapshot.health.groq.status, "UNREACHABLE");
  assert.equal("invalid" in snapshot.health, false);
  assert.equal(JSON.parse(local.getItem("myai_usage_tracker_v1")).days.invalid, undefined);
});

test("unsupported legacy providers are removed from health and usage totals", () => {
  const local = createStorage();
  const session = createStorage();
  const retained = {
    promptTokens: 4,
    completionTokens: 2,
    totalTokens: 6,
    models: { llama: { promptTokens: 4, completionTokens: 2, totalTokens: 6 } },
  };
  const retired = {
    promptTokens: 90,
    completionTokens: 90,
    totalTokens: 180,
    models: { legacy: { promptTokens: 90, completionTokens: 90, totalTokens: 180 } },
  };
  const totals = (providers) => ({
    promptTokens: 94,
    completionTokens: 92,
    totalTokens: 186,
    providers,
  });
  local.setItem("myai_usage_tracker_v1", JSON.stringify({
    version: 1,
    days: { "2026-01-02": totals({ groq: retained, "retired-provider": retired }) },
    conversations: { chat: totals({ groq: retained, "retired-provider": retired }) },
    health: {
      groq: { status: "HEALTHY", updatedAt: 2000 },
      "retired-provider": { status: "ERROR", updatedAt: 2000 },
      unknown: { status: "ERROR", updatedAt: 2000 },
    },
  }));
  session.setItem("myai_usage_session_v1", JSON.stringify({
    version: 1,
    totals: totals({ groq: retained, "retired-provider": retired }),
  }));

  const tracker = createUsageTracker({
    local,
    session,
    now: () => new Date(2026, 0, 2, 12).getTime(),
  });
  tracker.sanitizeStorage();

  const snapshot = tracker.getSnapshot("chat");
  assert.equal(snapshot.daily.totalTokens, 6);
  assert.equal(snapshot.conversation.totalTokens, 6);
  assert.equal(snapshot.session.totalTokens, 6);
  assert.deepEqual(Object.keys(snapshot.health), ["groq"]);
  assert.equal(snapshot.health.groq.status, "HEALTHY");
  assert.doesNotMatch(local.getItem("myai_usage_tracker_v1"), /retired-provider|unknown/);
  assert.doesNotMatch(session.getItem("myai_usage_session_v1"), /retired-provider/);
});

test("reset clears usage counters but preserves provider health", () => {
  const tracker = createUsageTracker({ local: createStorage(), session: createStorage() });
  tracker.trackTokenUsage("openrouter", "google/gemma-free", 10, 4, "chat");
  tracker.markProviderStatus("openrouter", "DEGRADED");
  tracker.resetCounters();
  const snapshot = tracker.getSnapshot("chat");

  assert.equal(snapshot.daily.totalTokens, 0);
  assert.equal(snapshot.session.totalTokens, 0);
  assert.equal(snapshot.conversation.totalTokens, 0);
  assert.equal(snapshot.health.openrouter.status, "DEGRADED");
});
