const ICON_BASE = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.1/icons/";

// Urutan penting: pola yang lebih spesifik di atas.
const BRANDS = [
  [/claude|anthropic/, "claude-color"],
  [/nano-banana|google|gemini/, "gemini-color"],
  [/gemma/, "gemma-color"],
  [/qwen|qwq/, "qwen-color"],
  [/deepseek/, "deepseek-color"],
  [/grok|x-ai\//, "grok"],
  [/\bgroq\b/, "groq"],
  [/kimi|moonshot/, "kimi-color"],
  [/llama|meta[-/]/, "meta-color"],
  [/mistral|ministral|mixtral|devstral|codestral|magistral|pixtral/, "mistral-color"],
  [/\bphi|microsoft/, "microsoft-color"],
  [/nemotron|nvidia/, "nvidia-color"],
  [/glm|z-ai|zhipu/, "zhipu-color"],
  [/minimax/, "minimax-color"],
  [/cohere|command-|north-/, "cohere-color"],
  [/smollm|huggingface/, "huggingface-color"],
  [/olmo|allenai/, "ai2-color"],
  [/liquid|lfm/, "liquid"],
  [/poolside|laguna/, "poolside-color"],
  [/hermes|nous/, "nousresearch"],
  [/ernie|baidu/, "baidu-color"],
  [/hunyuan|tencent/, "hunyuan-color"],
  [/doubao|bytedance|seed-/, "doubao-color"],
  [/stepfun|step-\d/, "stepfun-color"],
  [/amazon|nova-/, "nova-color"],
  [/ibm|granite/, "ibm"],
  [/perplexity|sonar/, "perplexity-color"],
  [/xiaomi|mimo/, "xiaomimimo"],
  [/sakana/, "sakana-color"],
  [/upstage|solar/, "upstage-color"],
  [/arcee/, "arcee-color"],
  [/aion[-\s]?labs/, "aionlabs-color"],
  [/meituan|longcat/, "longcat-color"],
  [/inception|mercury/, "inception"],
  [/fireworks/, "fireworks-color"],
  [/morph/, "morph-color"],
  [/relace/, "relace"],
  [/reka/, "reka"],
  [/perceptron/, "perceptron"],
  [/dots-|dots[- ]?studio/, "dotsstudio"],
  [/inference-net|inference\//, "inference"],
  [/gpt|openai|\bo[134](-|$)/, "openai"],
  [/openrouter/, "openrouter"],
];

const MODEL_BRAND_NAMES = [
  [/deep[-\s]?research/, "Deep Research"],
  [/nvidia|nemotron/, "NVIDIA"],
  [/claude|anthropic/, "Anthropic"],
  [/gemini|gemma|google/, "Google"],
  [/qwen|qwq/, "Qwen"],
  [/gpt|openai|\bo[134](-|\s|$)/, "OpenAI"],
  [/deepseek/, "DeepSeek"],
  [/grok|x-ai/, "xAI"],
  [/kimi|moonshot/, "Moonshot / Kimi"],
  [/llama|meta[-/]/, "Meta"],
  [/mistral|ministral|mixtral|codestral|devstral/, "Mistral"],
  [/glm|z-ai|zhipu/, "Z.ai / GLM"],
  [/minimax/, "MiniMax"],
  [/cohere|command-/, "Cohere"],
  [/perplexity|sonar/, "Perplexity"],
  [/phi|microsoft/, "Microsoft"],
  [/granite|ibm/, "IBM"],
  [/nova|amazon/, "Amazon"],
  [/allenai|olmo|ai2/, "AI2"],
  [/liquid|lfm/, "Liquid"],
  [/ernie|baidu/, "Baidu"],
  [/hunyuan|tencent/, "Tencent"],
  [/doubao|bytedance|seed-/, "ByteDance"],
  [/stepfun|step-\d/, "StepFun"],
  [/xiaomi|mimo/, "Xiaomi"],
  [/sakana/, "Sakana AI"],
  [/upstage|solar/, "Upstage"],
  [/arcee/, "Arcee"],
  [/hermes|nous/, "Nous Research"],
  [/ai21|jamba/, "AI21"],
  [/01-ai|yi-/, "01.AI"],
  [/falcon|tii-org/, "TII"],
];

export function brandOf(text) {
  const t = text.toLowerCase();
  for (const [re, icon] of BRANDS) {
    if (re.test(t)) return { src: ICON_BASE + icon + ".svg", mono: !icon.endsWith("-color") };
  }
  return null;
}

export function modelBrandName(model, provider = model?.provider) {
  const identity = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  const matchedBrand = MODEL_BRAND_NAMES.find(([pattern]) => pattern.test(identity))?.[1];
  if (matchedBrand) return matchedBrand;
  const normalizedProvider = String(provider || "")
    .toLowerCase()
    .replace(/^gateway-/, "")
    .replace(/^server-/, "");
  if (normalizedProvider === "openrouter" || normalizedProvider === "openrouter-image") {
    const publisher = modelPublisherName(model);
    return publisher.toLowerCase() === "openrouter" ? "OpenRouter" : publisher || "OpenRouter";
  }
  return "";
}

export function modelPublisherName(model) {
  const id = typeof model?.id === "string" ? model.id.trim() : "";
  const namespace = id.includes("/") ? id.split("/", 1)[0] : "";
  if (!namespace) return "";
  const knownNames = {
    "01-ai": "01.AI",
    "ai2": "AI2",
    "meta-llama": "Meta",
    "x-ai": "xAI",
    "z-ai": "Z.ai",
    "nousresearch": "Nous Research",
  };
  const normalized = namespace.toLowerCase();
  if (knownNames[normalized]) return knownNames[normalized];
  return namespace
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

const SIZE_TOKEN = /^(?:[ae]?\d+(?:\.\d+)?[bmt]|\d+e|\d+k)$/i;

export function prettify(id) {
  const s = id.split("/").pop().replace(/-q\d+f\d+(_\d+)?-MLC.*$/i, "").replace(/-MLC.*$/i, "").replace(/(\d)_(\d)/g, "$1.$2");
  const allLower = s === s.toLowerCase();
  const out = s
    .split("-")
    .filter((t) => t && !/^(instruct|it|chat|hf|bf16)$/i.test(t))
    .map((t) => {
      if (SIZE_TOKEN.test(t)) return t.toUpperCase();
      if (!allLower) return t;
      if (/^(gpt|oss|glm|r1|vl|ai)$/.test(t)) return t.toUpperCase();
      return t[0].toUpperCase() + t.slice(1);
    })
    .join(" ");
  return out[0].toUpperCase() + out.slice(1);
}

const NOISE = new Set(["instruct", "it", "chat", "hf", "bf16"]);

// Memecah ID model menjadi "lini" (nama tanpa angka versi), versi, dan ukuran.
// Contoh: "meta/llama-3.3-70b" -> lini "llama#", versi [3.3], ukuran "70b".
function parse(id) {
  const parts = id.toLowerCase().split("/");
  const author = parts.length > 1 ? parts[0] : "";
  const slug = parts
    .pop()
    .replace(/:.*$/, "")
    .replace(/-q\d+f\d+(_\d+)?-mlc.*$/, "")
    .replace(/-mlc.*$/, "")
    .replace(/(\d)_(\d)/g, "$1.$2");

  const core = [];
  const size = [];
  let unstable = false;
  let afterDate = false;
  for (const t of slug.split("-")) {
    if (/^(preview|exp|experimental)$/.test(t)) {
      unstable = true;
      break;
    }
    if (/^(\d{4}|\d{6}|\d{8})$/.test(t)) {
      afterDate = true;
      continue;
    }
    if (afterDate && /^\d{2}$/.test(t)) continue;
    afterDate = false;
    if (NOISE.has(t)) continue;
    if (SIZE_TOKEN.test(t)) {
      size.push(t);
      continue;
    }
    core.push(t);
  }
  const coreStr = core.join("-");
  const ver = (coreStr.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  let line = coreStr.replace(/\d+(?:\.\d+)?/g, "#").replace(/-#/g, "#");
  // Model tanpa nomor versi (mis. "gemma-2b") dianggap generasi pertama dari lininya.
  if (!ver.length) line += "#";
  return { author, line, ver: ver.length ? ver : [0], size: size.join("|"), unstable };
}

function cmpVer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function better(a, b) {
  if (a.created && b.created && a.created !== b.created) return a.created > b.created;
  if (a._p.unstable !== b._p.unstable) return !a._p.unstable;
  return a.id.length < b.id.length;
}

const STALE_SECONDS = 183 * 86400;
const MAX_AGE_SECONDS = 600 * 86400;

// Hanya menyisakan versi terbaru per lini model (semua ukuran dari versi itu tetap ada).
export function latestOnly(models) {
  models = models.filter((m) => !/latest/i.test(m.id));
  const lines = new Map();
  for (const m of models) {
    m._p = parse(m.id);
    const key = m._p.author + "|" + m._p.line;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(m);
  }

  let kept = [];
  for (const list of lines.values()) {
    const best = list.reduce((a, b) => (cmpVer(b._p.ver, a._p.ver) > 0 ? b : a))._p.ver;
    const bySize = new Map();
    for (const m of list) {
      if (cmpVer(m._p.ver, best) !== 0) continue;
      const cur = bySize.get(m._p.size);
      if (!cur || better(m, cur)) bySize.set(m._p.size, m);
    }
    kept.push(...bySize.values());
  }

  // Lini yang sudah lama tidak diperbarui (dibanding model terbaru dari pembuat yang sama) dibuang.
  const newest = {};
  for (const m of kept) if (m.created) newest[m._p.author] = Math.max(newest[m._p.author] || 0, m.created);
  const tooOld = Date.now() / 1000 - MAX_AGE_SECONDS;
  kept = kept.filter((m) => !m.created || (m.created >= newest[m._p.author] - STALE_SECONDS && m.created >= tooOld));

  const keep = new Set(kept);
  return models.filter((m) => keep.has(m)).map(({ _p, ...m }) => m);
}
