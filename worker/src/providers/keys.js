const PROVIDER_KEY_NAMES = ["openrouter", "gemini", "groq", "nvidia", "anthropic", "moonshot", "monid", "explorium"];

export function readProviderKeys(raw, env, HttpError) {
  const keys = {};
  const warnings = [];
  const firstConfiguredSecret = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim();
  const aliases = {
    nvidia_nim: "nvidia",
    nvidia_nim_api_key: "nvidia",
    nvidia_api_key: "nvidia",
    claude: "anthropic",
    anthropic_api_key: "anthropic",
    claude_api_key: "anthropic",
    kimi: "moonshot",
    moonshot_api_key: "moonshot",
    kimi_api_key: "moonshot",
    monid_api_key: "monid",
    explorium_api_key: "explorium",
    openrouter_api_key: "openrouter",
    gemini_api_key: "gemini",
    groq_api_key: "groq",
  };
  if (typeof raw === "string" && raw.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(500, "Konfigurasi AI_PROVIDER_KEYS harus berupa JSON yang valid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(500, "Konfigurasi AI_PROVIDER_KEYS harus berupa objek JSON.");
    }
    for (const [name, value] of Object.entries(parsed)) {
      const provider = aliases[name.toLowerCase()] || name.toLowerCase();
      if (!PROVIDER_KEY_NAMES.includes(provider)) {
        warnings.push(`Provider "${name}" di AI_PROVIDER_KEYS tidak didukung Worker dan diabaikan.`);
      } else if (typeof value === "string" && value.trim()) {
        keys[provider] = value.trim();
      }
    }
  }
  const individualSecrets = {
    openrouter: firstConfiguredSecret(env.OPENROUTER_API_KEY),
    gemini: firstConfiguredSecret(env.GEMINI_API_KEY),
    groq: firstConfiguredSecret(env.GROQ_API_KEY),
    nvidia: firstConfiguredSecret(env.NVIDIA_API_KEY, env.NVIDIA_NIM_API_KEY),
    anthropic: firstConfiguredSecret(env.CLAUDE_API_KEY, env.ANTHROPIC_API_KEY),
    moonshot: firstConfiguredSecret(env.KIMI_API_KEY, env.MOONSHOT_API_KEY),
    monid: firstConfiguredSecret(env.MONID_API_KEY),
    explorium: firstConfiguredSecret(env.EXPLORIUM_API_KEY),
  };
  for (const [name, value] of Object.entries(individualSecrets)) {
    if (typeof value === "string" && value.trim()) keys[name] = value.trim();
  }
  return { keys, warnings };
}
