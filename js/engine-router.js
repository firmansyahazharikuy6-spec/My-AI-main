// Adaptive Engine Router: memilih mesin (Cloud / WebGPU / Ollama) secara otomatis
// berdasarkan kemampuan yang dipakai, sisa kuota cloud, dan ketersediaan mesin lokal.
// Pemilihan bersifat transparan: hasil rute selalu diberi label agar user tidak bingung.

export const ENGINE_KINDS = Object.freeze({
  cloud: "cloud",
  webgpu: "webgpu",
  ollama: "ollama",
  guest: "guest",
  other: "other",
});

const CLOUD_PROVIDERS = new Set([
  "gemini",
  "groq",
  "nvidia",
  "openrouter",
  "gateway-nvidia",
  "gateway-groq",
  "gateway-openrouter",
]);

export function classifyEngineProvider(provider) {
  const normalized = String(provider || "");
  if (normalized === "local-webgpu") return ENGINE_KINDS.webgpu;
  if (normalized === "local-ollama") return ENGINE_KINDS.ollama;
  if (normalized === "guest") return ENGINE_KINDS.guest;
  if (CLOUD_PROVIDERS.has(normalized)) return ENGINE_KINDS.cloud;
  return ENGINE_KINDS.other;
}

const CAPABILITY_SKILL_MAP = Object.freeze({
  umum: "general",
  kode: "coding",
  tulis: "writing",
  riset: "research",
  terjemah: "translation",
  presentasi: "presentation",
  analisis: "analysis",
  guru: "tutor",
  ide: "ideas",
  bisnis: "business",
  karier: "career",
  gambar: "image",
});

export function capabilityForSkill(skillId) {
  return CAPABILITY_SKILL_MAP[String(skillId || "").toLowerCase()] || "general";
}

// Kata kunci yang menandai model cocok untuk kemampuan tertentu (cocok ID model).
const CAPABILITY_MODEL_HINTS = Object.freeze({
  coding: [/coder|deepseek|code/i],
  image: [/image|vision|vl/i],
  research: [/deepseek|gemini|gpt/i],
  writing: [/gemini|gpt|claude|mistral/i],
});

export function capabilityMatchScore(model, capability) {
  const haystack = `${model.id || ""} ${model.name || ""}`;
  const hints = CAPABILITY_MODEL_HINTS[capability] || [];
  return hints.filter((pattern) => pattern.test(haystack)).length;
}

export function compareModelPreference(left, right, capability, providerOrder) {
  const leftOrder = providerOrder?.indexOf(left.provider) ?? -1;
  const rightOrder = providerOrder?.indexOf(right.provider) ?? -1;
  const leftMatch = capabilityMatchScore(left, capability);
  const rightMatch = capabilityMatchScore(right, capability);
  if (leftMatch !== rightMatch) return rightMatch - leftMatch;
  const leftRank = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder;
  const rightRank = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.name || left.id).localeCompare(String(right.name || right.id));
}

export function routeAdaptiveModel({
  skillId = "umum",
  models = [],
  cloudRemaining = 0,
  webgpuSupported = false,
  ollamaAvailable = false,
  providerOrder = [],
} = {}) {
  const capability = capabilityForSkill(skillId);
  const byKind = { cloud: [], webgpu: [], ollama: [], other: [] };
  for (const model of models) {
    if (model?.chatSupport === false || model?.imageOnly === true) continue;
    const kind = classifyEngineProvider(model.provider);
    (byKind[kind] || byKind.other).push(model);
  }
  const rank = (list) => list.sort((a, b) => compareModelPreference(a, b, capability, providerOrder));
  const candidates = [];
  if (cloudRemaining > 0 && byKind.cloud.length) candidates.push(...rank(byKind.cloud));
  if (webgpuSupported && byKind.webgpu.length) candidates.push(...rank(byKind.webgpu));
  if (ollamaAvailable && byKind.ollama.length) candidates.push(...rank(byKind.ollama));
  if (byKind.other.length) candidates.push(...rank(byKind.other));
  return candidates;
}

export function engineRouteLabel(model, { cloudRemaining = 0 } = {}) {
  const kind = classifyEngineProvider(model?.provider);
  if (kind === ENGINE_KINDS.cloud) {
    return cloudRemaining > 0
      ? `Cloud · ${model?.name || model?.id || "model cloud"} (kuota tersisa ${cloudRemaining})`
      : `Cloud · ${model?.name || model?.id || "model cloud"}`;
  }
  if (kind === ENGINE_KINDS.webgpu) return "AI Lokal · WebGPU (tanpa internet)";
  if (kind === ENGINE_KINDS.ollama) return "AI Lokal · Ollama (tanpa internet)";
  return model?.name || model?.id || "Model";
}

export function adaptiveRouteSummary({ models = [], cloudRemaining = 0, webgpuSupported = false, ollamaAvailable = false } = {}) {
  const available = [
    cloudRemaining > 0 && models.some((model) => classifyEngineProvider(model.provider) === ENGINE_KINDS.cloud) ? "Cloud" : "",
    webgpuSupported && models.some((model) => classifyEngineProvider(model.provider) === ENGINE_KINDS.webgpu) ? "WebGPU" : "",
    ollamaAvailable && models.some((model) => classifyEngineProvider(model.provider) === ENGINE_KINDS.ollama) ? "Ollama" : "",
  ].filter(Boolean);
  return available.length ? available.join(" → ") : "";
}
