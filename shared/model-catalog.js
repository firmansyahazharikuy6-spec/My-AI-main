export const MODEL_MENU_PROVIDERS = Object.freeze([
  "nvidia",
  "openrouter",
  "groq",
  "claude",
  "kimi",
  "local-webgpu",
  "local-ollama",
]);

const GUEST_MODEL_MENU_PROVIDERS = new Set(["nvidia", "openrouter", "groq"]);

export function isOpenRouterProvider(provider) {
  const normalized = String(provider || "")
    .toLowerCase()
    .replace(/^gateway-/, "")
    .replace(/^server-/, "");
  return normalized === "openrouter" || normalized === "openrouter-image";
}

export const MODEL_CATALOG_FALLBACKS = Object.freeze({
  nvidia: Object.freeze([
    Object.freeze({ id: "nvidia/cosmos-reason2-8b", name: "Cosmos Reason2 8B" }),
  ]),
  openrouter: Object.freeze([
    Object.freeze({
      id: "google/gemma-4-26b-a4b-it:free",
      name: "Gemma 4 26B A4B (Free)",
      priceTier: "free",
    }),
    Object.freeze({
      id: "qwen/qwen3-8b:free",
      name: "Qwen3 8B",
      priceTier: "free",
    }),
    Object.freeze({
      id: "qwen/qwq-32b:free",
      name: "QwQ 32B",
      priceTier: "free",
    }),
  ]),
  groq: Object.freeze([
    Object.freeze({ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" }),
  ]),
});

function menuProviderFor(group) {
  const provider = String(group?.provider || "").toLowerCase();
  if (provider === "openrouter-image") return "openrouter";
  return provider.replace(/^gateway-/, "").replace(/^server-/, "");
}

export function filterModelGroupsForMenu(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => {
    if (!group || !Array.isArray(group.models)) return [];
    if (group.provider === "guest") {
      const models = group.models.filter((model) =>
        GUEST_MODEL_MENU_PROVIDERS.has(String(model?.backendProvider || "").toLowerCase()));
      return models.length ? [{ ...group, models }] : [];
    }
    if (!MODEL_MENU_PROVIDERS.includes(menuProviderFor(group))) return [];
    return group.models.length ? [group] : [];
  });
}
