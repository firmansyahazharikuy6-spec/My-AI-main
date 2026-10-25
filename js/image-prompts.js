const IMAGE_COMMAND_PREFIX = /^(?:(?:tolong|mohon|please|bantu(?:lah)?|coba)\s+)*(?:(?:buat(?:kan|ka|k|in)?|bikin(?:kan)?|hasilkan|ciptakan|generate|create|make|draw|paint|lukis(?:kan)?|gambar(?:kan)?)\s+)?(?:(?:aku|saya|gue|me|us)\s+)?(?:(?:sebuah|satu|seekor|an?|the)\s+)?(?:gambar|image|ilustrasi|illustration|foto|photo|picture|lukisan|drawing)\s+(?:(?:tentang|mengenai|soal|dari|of|about)\s+)?/i;
const VERB_COMMAND_PREFIX = /^(?:(?:tolong|mohon|please|bantu(?:lah)?|coba)\s+)*(?:buat(?:kan|ka|k|in)?|bikin(?:kan)?|hasilkan|ciptakan|generate|create|make|draw|paint|lukis(?:kan)?|gambar(?:kan)?)\s+(?:(?:aku|saya|gue|me|us)\s+)?(?:(?:sebuah|satu|seekor|an?|the)\s+)?/i;
const QUALITY_TAGS = [
  "highly detailed",
  "clear visual composition",
  "professional lighting",
];

const KNOWN_SCENES = [
  {
    match: /\bposter\b.{0,80}\b(?:17\s*agustus|kemerdekaan|indonesia|retro)\b|\b(?:17\s*agustus|kemerdekaan|indonesia)\b.{0,80}\bposter\b/i,
    prompt: "A vertical retro Indonesian Independence Day poster for August 17, with red-and-white flags, festive community celebration motifs, authentic vintage screen-print texture, bold but balanced graphic composition, no readable text.",
    negative: "unrelated portraits, incorrect flag colors, modern 3D rendering, logos, watermark, garbled text",
    style: "Retro screen print",
    assumptions: "Saya menafsirkan permintaan sebagai poster vertikal bertema perayaan 17 Agustus.",
    required: ["indonesian independence", "poster"],
    aspect: "9:16",
  },
  {
    match: /\b(?:kemerdekaan|kemerdekan|independence)\b.{0,50}\b(?:indonesia|indonesian)\b|\b(?:indonesia|indonesian)\b.{0,50}\b(?:kemerdekaan|kemerdekan|independence)\b|\b17\s*agustus\b/i,
    prompt: "A vivid Indonesian Independence Day celebration on August 17 in a village square, prominent red-and-white Indonesian flags and a flag-raising ceremony, a joyful crowd of generic Indonesian people, subtle historical 1945 atmosphere, warm morning sunlight, wide cinematic composition, polished editorial illustration, no readable text.",
    negative: "unrelated portraits, feathers, fantasy costumes, incorrect flag colors, extra flags from other countries, logos, watermark, unreadable lettering",
    style: "Editorial illustration",
    assumptions: "Saya menafsirkan tema ini sebagai perayaan kemerdekaan Indonesia pada 17 Agustus dengan bendera Merah Putih.",
    required: ["indonesian independence", "red-and-white", "flag-raising"],
    aspect: "16:9",
  },
  {
    match: /\bkucing\b.{0,100}\b(?:oren|oranye|jingga|orange|hujan|jendela|tidur)\b|\b(?:oren|oranye|jingga|orange|hujan|jendela|tidur)\b.{0,100}\bkucing\b/i,
    prompt: "A sleepy orange tabby cat curled up on a wooden windowsill beside a rain-streaked window, soft raindrops visible on the glass and a cozy warm interior contrasting with cool rainy daylight, intimate composition, detailed orange fur, gentle storybook illustration.",
    negative: "unrelated people, feathers, extra limbs, distorted anatomy, duplicate cats, text, logos, watermark",
    style: "Cozy storybook illustration",
    assumptions: "Saya mempertahankan kucing oren yang tidur di dekat jendela saat hujan.",
    required: ["orange tabby cat", "windowsill", "rain"],
    aspect: "1:1",
  },
  {
    match: /\bkucing\b|\bcat\b/i,
    prompt: "A clearly visible cat as the main subject, naturally posed in a coherent everyday scene, expressive but realistic anatomy, balanced composition, soft directional light, detailed fur, refined storybook illustration.",
    negative: "unrelated people, extra limbs, distorted anatomy, duplicate animals, text, logos, watermark",
    style: "Storybook illustration",
    assumptions: "Saya mempertahankan kucing sebagai subjek utama dan menafsirkan detail adegan dari permintaan.",
    required: ["cat"],
    aspect: "1:1",
  },
  {
    match: /\b(?:poster|17\s*agustus)\b/i,
    prompt: "A vertical retro Indonesian Independence Day poster for August 17, with red-and-white flags, festive community celebration motifs, authentic vintage screen-print texture, bold but balanced graphic composition, no readable text.",
    negative: "unrelated portraits, incorrect flag colors, modern 3D rendering, logos, watermark, garbled text",
    style: "Retro screen print",
    assumptions: "Saya menafsirkan permintaan sebagai poster vertikal bertema perayaan 17 Agustus.",
    required: ["indonesian independence", "poster"],
    aspect: "9:16",
  },
  {
    match: /\b(?:sawah|rice\s*paddy|rice\s*field)\b/i,
    prompt: "A peaceful Indonesian rice paddy at early morning, neat green rice terraces reflecting a thin layer of water, gentle mist above the fields, distant hills, first golden sunlight, tranquil wide landscape photograph.",
    negative: "urban buildings, unrelated people in foreground, text, logos, watermark",
    style: "Cinematic landscape photography",
    assumptions: "Saya memilih suasana pagi yang tenang dan lanskap sawah Indonesia.",
    required: ["rice paddy"],
    aspect: "16:9",
  },
  {
    match: /\b(?:hutan|forest)\b/i,
    prompt: "A wide tropical rainforest just after the rain, a clear river winding between dense green trees, soft morning mist drifting above the water, golden sunbeams passing through the canopy, vivid wet leaves, peaceful cinematic landscape, no people or text.",
    negative: "urban buildings, unrelated people, muddy or polluted water, logos, watermark, lettering",
    style: "Cinematic rainforest landscape",
    assumptions: "Saya mempertahankan hutan, sungai, dan suasana setelah hujan dengan cahaya pagi.",
    required: ["tropical rainforest", "clear river", "morning mist"],
    aspect: "16:9",
  },
  {
    match: /\b(?:logo\s+)?kopi\b|\bcoffee\b/i,
    prompt: "A minimal, original coffee logo mark built from a simple coffee bean and cup silhouette, clean geometric vector shapes, restrained warm brown and cream palette, strong negative space, centered on a plain background, no words or lettering.",
    negative: "photorealistic mockup, extra objects, gradients, clutter, brand names, letters, watermark",
    style: "Minimal vector logo",
    assumptions: "Saya membuat simbol kopi generik tanpa nama merek atau tulisan karena tidak diminta.",
    required: ["coffee", "logo"],
    aspect: "1:1",
  },
  {
    match: /\bkebebasan\b|\bfreedom\b|\bliberty\b/i,
    prompt: "A lone person seen from behind standing on an open mountain ridge at sunrise, looking toward a vast unobstructed horizon, wind moving their coat, expansive sky and distant clouds, visual metaphor for freedom and possibility, cinematic natural light, no text.",
    negative: "prison bars, chains, weapons, unrelated objects, text, logos, watermark",
    style: "Cinematic conceptual landscape",
    assumptions: "Saya menafsirkan kebebasan secara simbolis sebagai seseorang yang memandang cakrawala terbuka.",
    required: ["freedom", "horizon"],
    aspect: "16:9",
  },
  {
    match: /\b(?:gunung|mountain|pegunungan|mountains)\b/i,
    prompt: "A quiet mountain landscape at sunset, layered ridgelines fading into the distance, a still lake reflecting warm amber light, natural color palette, cinematic wide composition, no text.",
    negative: "city skyline, unrelated people, text, logos, watermark",
    style: "Cinematic landscape",
    assumptions: "Saya memilih suasana senja dan komposisi lanskap lebar.",
    required: ["mountain"],
    aspect: "16:9",
  },
];
const SUBJECT_TERMS = /\b(?:kucing|cat|robot|anjing|dog|burung|bird|orang|person|woman|man|girl|boy|mobil|car|kapal|ship|gunung|mountain|danau|lake|kopi|coffee|sawah|rice\s*paddy|rumah|house|bunga|flower)\b/gi;

function normalizePromptText(prompt) {
  return String(prompt || "")
    .normalize("NFKC")
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bkemerdekan\b/gi, "kemerdekaan")
    .replace(/\bindonesai\b/gi, "indonesia")
    .replace(/\bbuatka\b/gi, "buatkan")
    .replace(/\bgambarkn\b/gi, "gambar");
}

export function cleanImageGenerationPrompt(prompt) {
  const normalized = normalizePromptText(prompt);
  const cleaned = normalized
    .replace(IMAGE_COMMAND_PREFIX, "")
    .replace(VERB_COMMAND_PREFIX, "")
    .replace(/^(?:image|gambar)\s*[:,-]\s*/i, "")
    .replace(/^(?:sampel|contoh|prompt)\s*[:,-]\s*/i, "")
    .replace(/^\s*[:,-]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
  return cleaned || normalized;
}

function inferAspect(prompt) {
  if (/\b(?:poster|potret|portrait|vertikal|vertical|story|9:16)\b/i.test(prompt)) return "9:16";
  if (/\b(?:panorama|landscape|lanskap|wide|lebar|banner|wallpaper desktop|16:9|pemandangan|pegunungan|sawah)\b/i.test(prompt)) return "16:9";
  return "1:1";
}

export function buildFallbackImagePromptPlan(rawPrompt) {
  const cleaned = cleanImageGenerationPrompt(rawPrompt);
  const subjects = new Set(cleaned.match(SUBJECT_TERMS)?.map((term) => term.toLowerCase()) || []);
  const isSingleLandscape = [...subjects].every((term) => ["gunung", "mountain", "danau", "lake"].includes(term));
  const known = subjects.size > 1 && !isSingleLandscape
    ? null
    : KNOWN_SCENES.find((scene) => scene.match.test(cleaned));
  if (known) {
    const styleMatch = cleaned.match(/\b(?:gaya|style)\s+(cat air|watercolou?r|sketsa|anime|pixel art|minimalis|minimalist)\b/i);
    const requestedStyle = styleMatch?.[1]?.toLowerCase();
    const style = requestedStyle === "cat air" ? "watercolor"
      : requestedStyle === "minimalis" ? "minimalist"
        : requestedStyle || known.style;
    const mountainAtSunrise = known.style === "Cinematic landscape"
      && /\b(?:matahari terbit|sunrise|dawn|pagi)\b/i.test(cleaned);
    const scenePrompt = mountainAtSunrise
      ? "A quiet mountain landscape at sunrise, the first golden light appearing behind layered peaks and reflecting across a still lake, soft morning mist, natural colors, cinematic wide composition, no text."
      : known.prompt;
    return {
      prompt: requestedStyle && !known.style.toLowerCase().includes(style)
        ? `${scenePrompt} Render the same requested scene in ${style} style without changing its main subject.`
        : scenePrompt,
      negative: known.negative,
      aspect: known.aspect,
      style: style === known.style.toLowerCase() ? known.style : style[0].toUpperCase() + style.slice(1),
      assumptions: mountainAtSunrise
        ? "Saya menafsirkan permintaan sebagai matahari terbit di balik gunung dengan danau tenang."
        : known.assumptions,
    };
  }
  const subject = cleaned || "a clear, coherent subject";
  return {
    prompt: `A clear, concrete visual depiction of ${subject}. Keep the requested subject prominent and faithful to the request; establish a fitting setting, a readable action or visual relationship, natural atmosphere, balanced composition, and soft directional light. Use a polished editorial illustration style. Do not add unrelated main subjects or readable text.`,
    negative: "unrelated main subjects, distorted anatomy, clutter, logos, watermark, unintended text",
    aspect: inferAspect(cleaned),
    style: "Polished editorial illustration",
    assumptions: "Saya mempertahankan subjek yang diminta dan memilih adegan editorial yang netral.",
  };
}

export function validateImagePromptPlan(value, rawPrompt) {
  const fallback = buildFallbackImagePromptPlan(rawPrompt);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const fields = ["prompt", "negative", "aspect", "style", "assumptions"];
  if (fields.some((field) => typeof value[field] !== "string")
    || !value.prompt.trim()
    || value.prompt.length > 2400
    || value.negative.length > 800
    || value.style.length > 160
    || value.assumptions.length > 500
    || !["16:9", "1:1", "9:16"].includes(value.aspect)) return fallback;

  const known = KNOWN_SCENES.find((scene) => scene.match.test(cleanImageGenerationPrompt(rawPrompt)));
  if (known && known.required.some((term) => !value.prompt.toLowerCase().includes(term))) return fallback;
  return {
    prompt: value.prompt.trim(),
    negative: value.negative.trim() || fallback.negative,
    aspect: value.aspect,
    style: value.style.trim() || fallback.style,
    assumptions: value.assumptions.trim() || fallback.assumptions,
  };
}

export function boostImagePromptQuality(prompt) {
  const cleaned = cleanImageGenerationPrompt(prompt);
  if (!cleaned) return "";
  const missingTags = QUALITY_TAGS.filter((tag) => !new RegExp(`\\b${tag}\\b`, "i").test(cleaned));
  return missingTags.length ? `${cleaned}, ${missingTags.join(", ")}` : cleaned;
}
