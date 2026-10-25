export const TIER_STORAGE_KEY = "active_ai_tier";

export const TIER_CARDS = [
  {
    id: "free",
    name: "FREE",
    badge: "Mulai tanpa biaya",
    theme: "cyan",
    status: "Aktif",
    button: "Gunakan paket Free",
    features: ["Model gratis dari provider aktif", "Chat dan pembuatan gambar dasar", "Cocok untuk kebutuhan harian"],
    models: [{ name: "Gemini Flash / Groq", logo: "⚡" }, { name: "OpenRouter Free", logo: "◎" }],
  },
  {
    id: "basic",
    name: "BASIC",
    badge: "Dokumen & produktivitas",
    theme: "violet",
    status: "SIAP",
    button: "Pilih paket Basic",
    features: ["Model cloud ringan dan cepat", "Analisis file dan dokumen", "Cocok untuk pekerjaan rutin"],
    models: [{ name: "Monid Data Tools", logo: "⌕" }],
  },
  {
    id: "pro",
    name: "PRO",
    badge: "Penalaran & pekerjaan ahli",
    theme: "magenta",
    status: "SIAP",
    button: "Pilih paket Pro",
    features: ["Model reasoning dan coding", "Konteks kerja lebih kompleks", "Cocok untuk profesional"],
    models: [{ name: "Claude Haiku", logo: "◉" }, { name: "NVIDIA NIM", logo: "▣" }, { name: "OpenRouter Pro", logo: "◇" }, { name: "Coding Models", logo: "{ }" }],
  },
  {
    id: "max",
    name: "MAX",
    badge: "Kapasitas tertinggi",
    theme: "gold",
    status: "SIAP",
    button: "Aktifkan paket Max",
    unlockedFlag: "MAX",
    features: ["Model besar yang dikonfigurasi", "Penalaran dan konteks maksimum", "Cocok untuk tugas paling berat"],
    models: [
      { name: "Claude Sonnet", logo: "👑" },
      { name: "Gemini Pro", logo: "◆" },
      { name: "Flagship Models", logo: "👑" },
      { name: "Maximum Context", logo: "▣" },
    ],
  },
];

const VALID_TIERS = new Set(TIER_CARDS.map(({ id }) => id));
const TIER_ORDER = ["free", "basic", "pro", "max"];

export function getActiveTier() {
  const stored = localStorage.getItem(TIER_STORAGE_KEY)?.toLowerCase();
  return VALID_TIERS.has(stored) ? stored : "free";
}

export function saveActiveTier(tier) {
  const normalized = String(tier || "").toLowerCase();
  if (!VALID_TIERS.has(normalized)) throw new Error(`Unknown AI tier: ${tier}`);
  localStorage.setItem(TIER_STORAGE_KEY, normalized.toUpperCase());
  return normalized;
}

export function isTierAvailable(modelTier, activeTier = getActiveTier()) {
  const modelRank = TIER_ORDER.indexOf(modelTier);
  const activeRank = TIER_ORDER.indexOf(activeTier);
  return modelRank >= 0 && activeRank >= 0 && modelRank <= activeRank;
}
