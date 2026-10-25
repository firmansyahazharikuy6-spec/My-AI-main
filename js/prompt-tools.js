const LANGUAGE_WORDS = {
  id: new Set([
    "aku", "anda", "apa", "atau", "bantu", "buat", "bisa", "dalam", "dan", "dengan", "dari",
    "belajar", "dokumen", "gambar", "ingin", "jika", "kamu", "ke", "kerja", "lebih", "mohon",
    "prompt", "rencana", "untuk", "pada", "saya", "sebagai", "silakan", "tolong", "yang",
  ]),
  en: new Set([
    "a", "an", "and", "are", "as", "can", "create", "for", "help", "how", "i", "in", "is",
    "make", "me", "my", "of", "please", "the", "to", "with", "you", "your",
  ]),
};

function normalizeSuggestion(value, maxWords = 8) {
  return String(value || "").trim()
    .replace(/^(["'])|(["'])$/g, "")
    .split(/\s+/)
    .slice(0, maxWords)
    .join(" ");
}

export function detectPromptLanguage(text, fallback = "en") {
  const words = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  const scores = Object.fromEntries(Object.entries(LANGUAGE_WORDS)
    .map(([language, dictionary]) => [language, words.filter((word) => dictionary.has(word)).length]));
  if (scores.id > 0 && scores.id > scores.en) return "id";
  if (scores.en >= 2 && scores.en > scores.id) return "en";
  return fallback;
}

export function promptLanguageInstruction(language) {
  if (language === "id") return "Bahasa wajib: Bahasa Indonesia. Pertahankan bahasa draft pengguna; seluruh hasil fitur ini harus berbahasa Indonesia.";
  if (language === "en") return "Required language: English. Preserve the user's draft language; all output from this helper must be in English.";
  return `Required language: ${language}. Preserve the user's draft language; all output from this helper must use ${language}.`;
}

export function promptOutputMatchesLanguage(text, language) {
  if (!["id", "en"].includes(language)) return true;
  const words = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  const scores = Object.fromEntries(Object.entries(LANGUAGE_WORDS)
    .map(([name, dictionary]) => [name, words.filter((word) => dictionary.has(word)).length]));
  return scores[language] > 0 || scores[language === "id" ? "en" : "id"] === 0;
}

export function promptHelperOutputIsUsable(text, prompt) {
  const output = String(text || "").trim();
  const maxLength = Math.min(12000, Math.max(2400, String(prompt || "").length * 5 + 1000));
  if (!output || output.length > maxLength) return false;
  if (/\b(?:mode kerja aktif|user name|user role|user profile|preferences)\s*:/i.test(output)) return false;

  const lines = output.split(/\r?\n/)
    .map((line) => line.toLowerCase().replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 40);
  return new Set(lines).size === lines.length;
}

export function parsePromptSuggestions(text) {
  const source = String(text || "").trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [fenced, source].filter(Boolean);
  for (const candidate of candidates) {
    const start = candidate.search(/[\[{]/);
    if (start < 0) continue;
    const opening = candidate[start];
    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const character = candidate[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === opening) depth += 1;
      else if (character === closing && --depth === 0) {
        try {
          const parsed = JSON.parse(candidate.slice(start, index + 1));
          const values = Array.isArray(parsed) ? parsed : parsed?.suggestions;
          if (Array.isArray(values)) {
            return [...new Set(values
              .filter((value) => typeof value === "string")
              .map((value) => normalizeSuggestion(value))
              .filter(Boolean))].slice(0, 3);
          }
        } catch {
          break;
        }
      }
    }
  }
  const matches = [...source.matchAll(/(?:^|\n)\s*(?:\*\*)?\d+[.)](?:\*\*)?\s*([\s\S]*?)(?=\n\s*(?:\*\*)?\d+[.)](?:\*\*)?\s*|$)/g)];
  return [...new Set(matches.map((match) => normalizeSuggestion(match[1])).filter(Boolean))].slice(0, 3);
}

export function localPromptContinuations(prompt, language = "en") {
  const indonesian = language === "id";
  return indonesian ? [
    "Tambahkan langkah praktis dan contoh relevan",
    "Sertakan batasan dan kriteria keberhasilan",
    "Susun hasil berdasarkan prioritas dan kebutuhan",
  ] : [
    "Add practical steps and relevant examples",
    "Include constraints and success criteria",
    "Prioritize the result around my needs",
  ];
}

export function localPromptSuggestions(prompt, language = "en") {
  if (language === "id") {
    return [
      `Selesaikan tugas berikut dengan mempertahankan maksud dan fakta yang saya berikan. Jika informasi penting belum tersedia, tanyakan terlebih dahulu.\n\n${prompt}`,
      `Susun hasil dengan tujuan yang jelas, langkah praktis, asumsi yang ditandai, dan format yang siap digunakan. Jangan menambahkan fakta yang tidak diberikan.\n\n${prompt}`,
      `Tinjau permintaan ini sebagai ahli yang sesuai. Berikan hasil yang akurat dan dapat ditindaklanjuti, jelaskan batasan penting, lalu rangkum langkah berikutnya.\n\n${prompt}`,
    ];
  }
  return [
    `Complete this task while preserving my intent and stated facts. Ask before proceeding only if essential information is missing.\n\n${prompt}`,
    `Structure the result around a clear goal, practical steps, labeled assumptions, and a ready-to-use format. Do not add facts I did not provide.\n\n${prompt}`,
    `Review this request as a relevant expert. Provide an accurate, actionable result, explain important limitations, and summarize the next steps.\n\n${prompt}`,
  ];
}

export function localImprovedPrompt(prompt, language = "en") {
  if (language === "id") {
    return `Tujuan: ${prompt}\n\nSusun hasil yang jelas, profesional, dan siap digunakan. Tambahkan konteks, batasan, contoh, serta format keluaran hanya jika relevan. Pertahankan fakta dan maksud pengguna; jangan mengarang detail. Jika informasi penting belum tersedia, ajukan pertanyaan klarifikasi.`;
  }
  return `Goal: ${prompt}\n\nMake the result clear, professional, and ready to use. Add context, constraints, examples, and an output format only when relevant. Preserve the user's intent and stated facts; do not invent details. Ask a clarifying question if essential information is missing.`;
}

export function localOfflineResponse(prompt, {
  language = "en",
  imageGeneration = false,
  documentFormat = "",
  limitation = "",
} = {}) {
  const request = String(prompt || "").trim().slice(0, 4000);
  const indonesian = language === "id";
  const limitationText = String(limitation || "").trim();
  if (imageGeneration) {
    return indonesian
      ? `**Mode offline — konsep gambar siap**\n\nGambar belum dirender karena layanan gambar memerlukan koneksi internet. Prompt visual yang bisa digunakan:\n\n> ${request || "Deskripsikan subjek, suasana, komposisi, dan gaya visual yang diinginkan."}\n\nSaat koneksi tersedia, kirim ulang permintaan ini dalam Mode Gambar.${limitationText ? `\n\nCatatan: ${limitationText}` : ""}`
      : `**Offline mode — image concept ready**\n\nThe image has not been rendered because image generation requires an internet connection. Ready-to-use visual prompt:\n\n> ${request || "Describe the subject, mood, composition, and visual style you want."}\n\nResend this request in Image mode when a connection is available.${limitationText ? `\n\nNote: ${limitationText}` : ""}`;
  }
  if (documentFormat === "pptx") {
    return indonesian
      ? `# ${request || "Rancangan Presentasi"}\n\n## Tujuan dan konteks\n- Jelaskan tujuan presentasi dan audiens.\n\n## Pokok pembahasan\n- Susun ide utama secara berurutan.\n\n## Contoh atau penerapan\n- Tambahkan contoh yang bersumber dari materi pengguna.\n\n## Ringkasan dan langkah berikutnya\n- Rangkum poin penting tanpa menambahkan fakta yang belum tersedia.${limitationText ? `\n\nCatatan mode offline: ${limitationText}` : "\n\nCatatan mode offline: ini kerangka awal, bukan hasil riset atau verifikasi fakta."}`
      : `# ${request || "Presentation Outline"}\n\n## Goal and context\n- State the presentation goal and audience.\n\n## Main points\n- Organize the key ideas in a logical sequence.\n\n## Example or application\n- Use examples grounded in the user's material.\n\n## Summary and next steps\n- Summarize the key points without adding unsupported facts.${limitationText ? `\n\nOffline note: ${limitationText}` : "\n\nOffline note: this is a starting outline, not researched or fact-checked content."}`;
  }
  const summary = request || (indonesian ? "Permintaan belum berisi teks." : "No request text was provided.");
  return indonesian
    ? `**Mode offline — draf kerja lokal**\n\nSaya sudah menyimpan inti permintaan ini untuk dilanjutkan:\n\n> ${summary}\n\nLangkah praktis:\n1. Tentukan hasil akhir dan audiens yang dituju.\n2. Tambahkan bahan, batasan, atau contoh yang perlu dipertahankan.\n3. Periksa fakta penting sebelum menggunakan hasil.\n\nJawaban ini disusun secara lokal; belum ada model online yang memproses atau memverifikasi isinya.${limitationText ? `\n\nCatatan: ${limitationText}` : ""}`
    : `**Offline mode — local working draft**\n\nI captured the core request for follow-up:\n\n> ${summary}\n\nPractical next steps:\n1. Define the intended deliverable and audience.\n2. Add source material, constraints, or examples to preserve.\n3. Verify important facts before using the result.\n\nThis response was prepared locally; no online model processed or verified its contents.${limitationText ? `\n\nNote: ${limitationText}` : ""}`;
}
