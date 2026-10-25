const STORAGE_KEY = "myai_usage_tracker_v1";
const SESSION_KEY = "myai_usage_session_v1";
const EXHAUSTED_TTL_MS = 30 * 60 * 1000;
const DEGRADED_TTL_MS = 5 * 60 * 1000;

function emptyTotals() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, providers: Object.create(null) };
}

function safeTokenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function addUsage(totals, provider, model, promptTokens, completionTokens) {
  const prompt = safeTokenCount(promptTokens);
  const completion = safeTokenCount(completionTokens);
  totals.promptTokens += prompt;
  totals.completionTokens += completion;
  totals.totalTokens += prompt + completion;
  const providerTotals = totals.providers[provider] ||= emptyTotals();
  providerTotals.promptTokens += prompt;
  providerTotals.completionTokens += completion;
  providerTotals.totalTokens += prompt + completion;
  const modelName = String(model || "unknown").slice(0, 120);
  const modelTotals = providerTotals.models ||= Object.create(null);
  const entry = modelTotals[modelName] ||= { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  entry.promptTokens += prompt;
  entry.completionTokens += completion;
  entry.totalTokens += prompt + completion;
}

function readObject(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    console.warn("MyAI usage tracker data could not be read.", error);
    return null;
  }
}

function writeObject(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("MyAI usage tracker data could not be saved.", error);
  }
}

function normalizeProvider(provider) {
  return String(provider || "unknown").replace(/^gateway-/, "").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
}

function normalizeTotals(value) {
  const totals = emptyTotals();
  if (!value || typeof value !== "object") return totals;
  totals.promptTokens = safeTokenCount(value.promptTokens);
  totals.completionTokens = safeTokenCount(value.completionTokens);
  totals.totalTokens = totals.promptTokens + totals.completionTokens;
  for (const [provider, counts] of Object.entries(value.providers || {})) {
    const normalized = emptyTotals();
    normalized.promptTokens = safeTokenCount(counts?.promptTokens);
    normalized.completionTokens = safeTokenCount(counts?.completionTokens);
    normalized.totalTokens = normalized.promptTokens + normalized.completionTokens;
    normalized.models = Object.create(null);
    for (const [model, modelCounts] of Object.entries(counts?.models || {})) {
      normalized.models[String(model).slice(0, 120)] = {
        promptTokens: safeTokenCount(modelCounts?.promptTokens),
        completionTokens: safeTokenCount(modelCounts?.completionTokens),
        totalTokens: safeTokenCount(modelCounts?.promptTokens) + safeTokenCount(modelCounts?.completionTokens),
      };
    }
    totals.providers[normalizeProvider(provider)] = normalized;
  }
  return totals;
}

function healthTtl(status) {
  if (status === "EXHAUSTED") return EXHAUSTED_TTL_MS;
  if (status === "DEGRADED" || status === "ERROR" || status === "UNREACHABLE") return DEGRADED_TTL_MS;
  return 0;
}

function localDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createUsageTracker({
  local = globalThis.localStorage,
  session = globalThis.sessionStorage,
  now = () => Date.now(),
} = {}) {
  const dateKey = () => localDayKey(now());

  function readPersistent() {
    const saved = readObject(local, STORAGE_KEY);
    if (saved?.version !== 1) return { version: 1, days: {}, conversations: {}, health: {} };
    return {
      version: 1,
      days: saved.days && typeof saved.days === "object" ? saved.days : {},
      conversations: saved.conversations && typeof saved.conversations === "object" ? saved.conversations : {},
      health: saved.health && typeof saved.health === "object" ? saved.health : {},
    };
  }

  function readSession() {
    const saved = readObject(session, SESSION_KEY);
    return saved?.version === 1 ? normalizeTotals(saved.totals) : emptyTotals();
  }

  function writeSession(totals) {
    writeObject(session, SESSION_KEY, { version: 1, totals });
  }

  function savePersistent(data) {
    const cutoff = localDayKey(now() - 29 * 24 * 60 * 60 * 1000);
    data.days = Object.fromEntries(Object.entries(data.days).filter(([day]) => day >= cutoff));
    const conversations = Object.entries(data.conversations);
    data.conversations = Object.fromEntries(conversations.slice(-500));
    writeObject(local, STORAGE_KEY, data);
  }

  function trackTokenUsage(provider, model, promptTokens, completionTokens, conversationId = "") {
    const name = normalizeProvider(provider);
    const prompt = safeTokenCount(promptTokens);
    const completion = safeTokenCount(completionTokens);
    if (!prompt && !completion) return getSnapshot(conversationId);

    const sessionTotals = readSession();
    addUsage(sessionTotals, name, model, prompt, completion);
    writeSession(sessionTotals);

    const data = readPersistent();
    const today = dateKey();
    const dailyTotals = normalizeTotals(data.days[today]);
    addUsage(dailyTotals, name, model, prompt, completion);
    data.days[today] = dailyTotals;
    if (conversationId) {
      const conversationTotals = normalizeTotals(data.conversations[conversationId]);
      addUsage(conversationTotals, name, model, prompt, completion);
      data.conversations[conversationId] = conversationTotals;
    }
    savePersistent(data);
    return getSnapshot(conversationId);
  }

  function markProviderStatus(provider, status, details = {}) {
    const name = normalizeProvider(provider);
    const allowed = ["IDLE", "CHECKING", "HEALTHY", "DEGRADED", "ERROR", "EXHAUSTED", "UNREACHABLE"];
    if (!allowed.includes(status)) throw new TypeError(`Unsupported provider health status: ${status}`);
    const timestamp = now();
    const ttl = healthTtl(status);
    const data = readPersistent();
    const options = typeof details === "string" ? { detail: details } : details || {};
    data.health[name] = {
      status,
      updatedAt: timestamp,
      ...(ttl ? { expiresAt: timestamp + ttl } : {}),
      ...(options.detail ? { detail: String(options.detail).slice(0, 600) } : {}),
      ...(options.model ? { model: String(options.model).slice(0, 120) } : {}),
      ...(Number.isFinite(options.latencyMs) ? { latencyMs: Math.max(0, Math.round(options.latencyMs)) } : {}),
      ...(options.used === true ? { used: true } : {}),
    };
    savePersistent(data);
    return data.health[name];
  }

  function getHealth() {
    const data = readPersistent();
    let changed = false;
    for (const [provider, state] of Object.entries(data.health)) {
      if (state?.expiresAt && state.expiresAt <= now()) {
        data.health[provider] = {
          status: state.used ? "DEGRADED" : "IDLE",
          updatedAt: now(),
          ...(state.model ? { model: state.model } : {}),
          ...(Number.isFinite(state.latencyMs) ? { latencyMs: state.latencyMs } : {}),
          ...(state.used ? { used: true } : {}),
        };
        changed = true;
      }
    }
    if (changed) savePersistent(data);
    return { ...data.health };
  }

  function getSnapshot(conversationId = "") {
    const data = readPersistent();
    return {
      session: readSession(),
      daily: normalizeTotals(data.days[dateKey()]),
      conversation: normalizeTotals(conversationId ? data.conversations[conversationId] : null),
      health: getHealth(),
    };
  }

  function resetCounters() {
    const data = readPersistent();
    data.days = {};
    data.conversations = {};
    savePersistent(data);
    writeSession(emptyTotals());
  }

  function sanitizeStorage() {
    const saved = readObject(local, STORAGE_KEY);
    if (saved?.version !== 1) return;
    const data = readPersistent();
    data.days = Object.fromEntries(Object.entries(data.days)
      .filter(([day, totals]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && totals && typeof totals === "object" && !Array.isArray(totals))
      .map(([day, totals]) => [day, normalizeTotals(totals)]));
    data.conversations = Object.fromEntries(Object.entries(data.conversations)
      .filter(([id, totals]) => id.length > 0 && totals && typeof totals === "object" && !Array.isArray(totals))
      .map(([id, totals]) => [id.slice(0, 160), normalizeTotals(totals)]));
    const allowed = new Set(["IDLE", "CHECKING", "HEALTHY", "DEGRADED", "ERROR", "EXHAUSTED", "UNREACHABLE"]);
    data.health = Object.fromEntries(Object.entries(data.health)
      .filter(([, state]) => state && typeof state === "object" && allowed.has(state.status))
      .map(([provider, state]) => [normalizeProvider(provider), {
        status: state.status,
        updatedAt: Number.isFinite(Number(state.updatedAt)) ? Number(state.updatedAt) : now(),
        ...(state.expiresAt != null && Number.isFinite(Number(state.expiresAt)) ? { expiresAt: Number(state.expiresAt) } : {}),
        ...(typeof state.detail === "string" ? { detail: state.detail.slice(0, 160) } : {}),
        ...(typeof state.model === "string" ? { model: state.model.slice(0, 120) } : {}),
        ...(state.latencyMs != null && Number.isFinite(Number(state.latencyMs)) ? { latencyMs: Math.max(0, Math.round(Number(state.latencyMs))) } : {}),
        ...(state.used === true ? { used: true } : {}),
      }]));
    savePersistent(data);
    const sessionState = readObject(session, SESSION_KEY);
    if (sessionState?.version === 1) writeSession(normalizeTotals(sessionState.totals));
  }

  return { trackTokenUsage, markProviderStatus, getHealth, getSnapshot, resetCounters, sanitizeStorage };
}
