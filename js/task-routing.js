const DOCUMENT_PROVIDERS = new Set(["openrouter", "gemini", "kimi", "moonshot", "groq", "nvidia"]);
const MAX_FALLBACK_ATTEMPTS = 4;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
const providerFailures = new Map();
const providerCircuitUntil = new Map();

export function canonicalProvider(provider) {
  return String(provider || "").replace(/^gateway-/, "").toLowerCase();
}

export function rankDocumentModels(groups, providerHealth = {}) {
  const models = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    const provider = canonicalProvider(group.provider);
    if (!DOCUMENT_PROVIDERS.has(provider)) continue;
    for (const model of Array.isArray(group.models) ? group.models : []) {
      if (!model?.id || model.imageOnly === true) continue;
      const id = String(model.id);
      const name = String(model.name || "");
      const priority = provider === "nvidia" ? 0
        : provider === "openrouter" && /(?:anthropic\/|claude)/i.test(`${id} ${name}`) ? 1
          : provider === "gemini" && /pro/i.test(`${id} ${name}`) ? 2
            : ["kimi", "moonshot"].includes(provider) ? 3
              : provider === "gemini" ? 4
                : provider === "openrouter" ? 5
                  : provider === "groq" ? 6 : 7;
      models.push({ ...model, provider: group.provider, priority });
    }
  }
  const isHealthy = (model) => {
    const provider = canonicalProvider(model.provider);
    return providerHealth[provider]?.status === "HEALTHY"
      || providerHealth[`gateway-${provider}`]?.status === "HEALTHY";
  };
  const isUnavailable = (model) => {
    const provider = canonicalProvider(model.provider);
    const status = providerHealth[provider]?.status || providerHealth[`gateway-${provider}`]?.status;
    return ["ERROR", "EXHAUSTED", "UNREACHABLE"].includes(status);
  };
  const nvidiaPriority = (model) => canonicalProvider(model.provider) === "nvidia"
    ? isUnavailable(model) ? 2 : 0
    : 1;
  models.sort((left, right) => nvidiaPriority(left) - nvidiaPriority(right)
    || Number(isHealthy(right)) - Number(isHealthy(left))
    || left.priority - right.priority
    || (Number(right.contextWindow) || 0) - (Number(left.contextWindow) || 0)
    || String(left.name || left.id).localeCompare(String(right.name || right.id)));
  const seen = new Set();
  return models.filter((model) => {
    const provider = canonicalProvider(model.provider);
    if (seen.has(provider)) return false;
    seen.add(provider);
    return true;
  });
}

export function recordProviderResult(provider, succeeded, now = Date.now()) {
  const key = canonicalProvider(provider);
  if (!key) return;
  if (succeeded) {
    providerFailures.delete(key);
    providerCircuitUntil.delete(key);
    return;
  }
  const failures = (providerFailures.get(key) || 0) + 1;
  providerFailures.set(key, failures);
  if (failures >= CIRCUIT_FAILURE_THRESHOLD) providerCircuitUntil.set(key, now + CIRCUIT_COOLDOWN_MS);
}

export function isProviderCircuitOpen(provider, now = Date.now()) {
  const key = canonicalProvider(provider);
  const until = providerCircuitUntil.get(key) || 0;
  if (until && until <= now) {
    providerCircuitUntil.delete(key);
    providerFailures.delete(key);
    return false;
  }
  return until > now;
}

export function resetProviderCircuits() {
  providerFailures.clear();
  providerCircuitUntil.clear();
}

export async function runProviderFallbacks(candidates, runModel, {
  maxAttempts = MAX_FALLBACK_ATTEMPTS,
  onAttempt = () => {},
  onFailure = () => {},
  now = Date.now,
} = {}) {
  let lastError;
  const attemptedProviders = new Set();
  let attempts = 0;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const provider = canonicalProvider(candidate?.provider);
    if (!provider || attemptedProviders.has(provider) || isProviderCircuitOpen(provider, now())) continue;
    attemptedProviders.add(provider);
    if (++attempts > maxAttempts) break;
    onAttempt(candidate, attempts);
    try {
      await runModel(candidate);
      recordProviderResult(provider, true, now());
      return candidate;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
      recordProviderResult(provider, false, now());
      onFailure(candidate, error, attempts);
    }
  }
  if (lastError) throw lastError;
  throw new Error("Tidak ada provider cadangan yang tersedia. Periksa katalog model dan status provider.");
}
