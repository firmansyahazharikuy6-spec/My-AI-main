const IMAGE_NOUN = "(?:gambar|foto|ilustrasi|lukisan|logo|poster|wallpaper|ikon|icon|stiker|sticker|karikatur|kartun|avatar|banner|image|picture|photo|illustration|drawing|painting|artwork)";
const IMAGE_CREATION_VERB = "(?:buat(?:kan)?|bikin|hasilkan|ciptakan|generate|create|make)";
const REQUEST_PREFIX = "^(?:(?:tolong|please|kindly|silakan|coba)\\s+)*(?:(?:can|could) you\\s+|bisa(?:kah)?\\s+)?";

export function isImageGenerationRequest(message = "") {
  const text = String(message || "").trim();
  if (!text) return false;
  if (/^(?:how|what|why|when|where|analisis|analisa|analyze|analyse|describe|jelaskan|explain|identify|identifikasi)\b/i.test(text)) {
    return false;
  }

  const task = text.match(/^(?:tugas(?: utama)?|task|request)\s*:\s*([\s\S]*)/i)?.[1]?.trim() || text;
  const noun = IMAGE_NOUN;
  const creationVerb = IMAGE_CREATION_VERB;
  const prefix = REQUEST_PREFIX;
  return new RegExp(`${prefix}${creationVerb}\\s+(?:(?:me|aku|saya|sebuah|satu|seekor|a|an|the|kan)\\s+){0,3}${noun}\\b`, "i").test(task)
    || new RegExp(`${prefix}(?:lukis(?:kan)?|gambar(?:kan)?|draw|paint|illustrate|render)\\s+(?:(?:me|aku|saya|sebuah|seekor|a|an|the)\\s+)?(?!placeholder\\b|contoh\\b|referensi\\b|terlampir\\b|ini\\b|tersebut\\b)[a-z0-9]`, "i").test(task)
    || new RegExp(`${prefix}(?:${IMAGE_NOUN})\\s+of\\b`, "i").test(task)
    || new RegExp(`${prefix}gambar\\s+dari\\b`, "i").test(task);
}
