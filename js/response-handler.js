import { isImageGenerationRequest } from "../shared/image-intent.js?v=20261029-v5.130";

export const STRUCTURED_RESPONSE_INSTRUCTIONS = `Untuk tugas yang memerlukan payload terstruktur aplikasi, keluarkan tepat satu objek JSON valid dalam satu blok \`\`\`json ... \`\`\` tanpa teks di luarnya. Ini adalah protokol internal yang akan divalidasi dan dirender menjadi artefak UI; jangan pernah menampilkan atau menjelaskan JSON mentah kepada pengguna. Untuk jawaban percakapan biasa, jangan gunakan pembungkus JSON. Skema tingkat atas: {"type":"text|image_generation|image_compress|file_converter|vision_analysis|ppt|doc|excel|tool_call","assigned_model":"gemini-vision|gemini-image|groq-fast|claude-analysis","summary":"Pratinjau singkat dalam bahasa pengguna","data":{...}}. assigned_model adalah label tujuan tugas, bukan klaim bahwa aplikasi mengganti model pilihan pengguna. Semua teks yang dibaca pengguna wajib mengikuti bahasa prompt pengguna; hanya enhanced_prompt untuk gambar yang wajib berbahasa Inggris. Gunakan text untuk tanya-jawab umum dengan data.reply_markdown Markdown. Gunakan vision_analysis jika gambar diunggah untuk dianalisis/OCR: data berisi analysis_summary, detected_objects (array teks), extracted_text (boleh kosong), followup_action_suggested (image_generation|doc|ppt|excel|none), dan suggested_prompt (boleh kosong). Gunakan image_compress saat pengguna meminta mengecilkan ukuran atau dimensi gambar: data berisi action=compress_image, target_quality (0,1–0,9; default 0,7), max_width_or_height (default 1920), output_format (image/webp|image/jpeg|image/png), dan message; aplikasi menyediakan pemilih gambar, kompresi lokal, pratinjau, dan unduhan. Gunakan file_converter saat pengguna meminta mengonversi, menggabungkan, memisahkan, mengompres atau mengarsipkan file; data berisi operation (word_to_pdf|pdf_to_word|excel_to_pdf|pdf_to_images|merge_pdf|split_pdf|compress_pdf|image_to_pdf|zip_files|word_to_excel|excel_to_ppt), target_format (pdf|docx|xlsx|pptx|zip|png|jpg|txt), dan instructions. Aplikasi meminta file di UI dan memprosesnya di browser; operasi excel_to_ppt hanya menyusun outline lokal, lalu membuat dan mengekspor presentasi melalui Canva Connect API di server. Jika pengguna meminta membuat atau mengubah gambar, gunakan image_generation dengan data.enhanced_prompt, aspect_ratio (16:9|1:1|9:16), negative_prompt; Worker menjalankan pembuatan gambar melalui OpenRouter Image API dengan model Google Gemini Image, bukan Google Gemini API langsung. Jika analisis gambar meminta gambar baru, gunakan image_generation dan gabungkan deskripsi visual yang diperlukan dari gambar sumber ke enhanced_prompt. Untuk ppt, data berisi title, theme (enterprise-dark|modern-gold|clean-light), slides berupa array {slide_number,title,content:[...],notes}; gunakan modern-gold sebagai tema default kecuali pengguna meminta tema lain. Untuk doc, data berisi title dan content_markdown. Untuk excel, data berisi sheet_name, headers, rows; formula hanya boleh memakai SUM, AVERAGE, MIN, MAX, COUNT dengan satu rentang sel sederhana. Untuk tool_call, data berisi tool_name dan parameters; hanya keluarkan tindakan yang secara eksplisit diminta pengguna. Aplikasi meminta persetujuan sebelum tindakan eksternal; tool tanpa backend tidak dapat dijalankan.`;

const MAX_TEXT_LENGTH = 100_000;
const TOOL_NAMES = new Set(["send_email", "web_search", "create_reminder"]);
const ASSIGNED_MODELS = new Set(["gemini-vision", "gemini-image", "groq-fast", "claude-analysis"]);
const PRESENTATION_THEMES = new Set(["enterprise-dark", "modern-gold", "clean-light", "modern-dark", "enterprise-gold"]);
const SPOKEN_SLIDE_COUNTS = new Map([
  ["satu", 1], ["one", 1],
  ["dua", 2], ["two", 2],
  ["tiga", 3], ["three", 3],
  ["empat", 4], ["four", 4],
  ["lima", 5], ["five", 5],
  ["enam", 6], ["six", 6],
  ["tujuh", 7], ["seven", 7],
  ["delapan", 8], ["eight", 8],
  ["sembilan", 9], ["nine", 9],
  ["sepuluh", 10], ["ten", 10],
]);

export function requestedPresentationSlideCount(message = "") {
  const match = String(message).match(/\b(\d{1,2}|satu|one|dua|two|tiga|three|empat|four|lima|five|enam|six|tujuh|seven|delapan|eight|sembilan|nine|sepuluh|ten)\s*(?:slide|slides|halaman)\b/i);
  if (!match) return null;
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : SPOKEN_SLIDE_COUNTS.get(match[1].toLowerCase());
  return Number.isInteger(count) && count >= 1 && count <= 50 ? count : null;
}

export { isImageGenerationRequest };

function extractJson(source) {
  const text = source.trim();
  const fenceStart = text.search(/```json\b/i);
  if (fenceStart >= 0) {
    const fencedText = text.slice(fenceStart);
    const opening = fencedText.match(/^```json[^\r\n]*(?:\r?\n|$)/i);
    const closing = opening ? fencedText.indexOf("```", opening[0].length) : -1;
    if (!opening || closing < 0) {
      throw new Error("Blok JSON respons AI belum ditutup.");
    }
    return fencedText.slice(opening[0].length, closing).trim();
  }
  if (!text.startsWith("{")) return "";
  const start = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error("Jawaban berisi JSON yang belum lengkap.");
}

export function shouldRequestStructuredResponse({ imageGeneration = false, hasImages = false, message = "" } = {}) {
  if (imageGeneration || hasImages) return true;
  const text = String(message);
  const mentionsFile = /\b(?:file|berkas|folder|gambar|foto|image|picture|photo|pdf|word|docx|excel|xlsx|pptx|spreadsheet|arsip|zip)\b/i.test(text);
  const requestsFileOperation = /\b(?:compress|kompres|resize|ubah ukuran|kecilkan|perkecil|optimalkan|optimize|shrink|reduce|convert|konversi|ubah format|zip|archive|arsipkan|merge|gabungkan|split|pisahkan)\b/i.test(text)
    || /\b(?:pdf|word|docx|excel|xlsx|pptx)\s+(?:ke|to)\s+(?:pdf|word|docx|excel|xlsx|pptx)\b/i.test(text)
    || /\b(?:buat|buatkan|create|make)\b.{0,30}\b(?:zip|arsip)\b/i.test(text);
  const requestsEmail = /\b(?:kirim|send)\s+(?:kan\s+)?(?:email|e-mail|surel)\b/i.test(text);
  const requestsReminder = /\b(?:buat|buatkan|jadwalkan|set|create|schedule)\b.{0,30}\b(?:pengingat|alarm|reminder)\b|\b(?:ingatkan|remind)\s+(?:saya|aku|me)\b/i.test(text);
  const requestsPresentation = /\b(?:buat|buatkan|bikin|susun|rancang|create|make|design|generate|prepare)\b.{0,70}\b(?:pptx?|power\s?point|presentasi|slides?|slideshow|deck)\b/i.test(text)
    || /\bpresentation\s+deck\s+(?:for|about|on)\b/i.test(text);
  return (mentionsFile && requestsFileOperation) || requestsEmail || requestsReminder || requestsPresentation;
}

function requireString(value, field, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Format respons tidak valid: "${field}" harus berupa teks (maksimal ${maxLength} karakter).`);
  }
  return value.trim();
}

function validateResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["text", "image_generation", "image_compress", "file_converter", "vision_analysis", "ppt", "doc", "excel", "tool_call"].includes(value.type)) {
    throw new Error("Format respons AI tidak valid: tipe respons tidak dikenal.");
  }
  if (!ASSIGNED_MODELS.has(value.assigned_model)) {
    throw new Error("Format respons AI tidak valid: assigned_model tidak dikenal.");
  }
  const assignedModel = value.assigned_model;
  const summary = requireString(value.summary, "summary", 4000);
  const data = value.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Format respons AI tidak valid: data harus berupa objek.");
  }

  switch (value.type) {
    case "text":
      return { type: value.type, assigned_model: assignedModel, summary, data: { reply_markdown: requireString(data.reply_markdown, "data.reply_markdown") } };
    case "image_generation": {
      const aspectRatio = ["16:9", "1:1", "9:16"].includes(data.aspect_ratio) ? data.aspect_ratio : "1:1";
      return {
        type: value.type,
        assigned_model: assignedModel,
        summary,
        data: {
          enhanced_prompt: requireString(data.enhanced_prompt, "data.enhanced_prompt", 6000),
          aspect_ratio: aspectRatio,
          negative_prompt: typeof data.negative_prompt === "string" ? data.negative_prompt.slice(0, 1000) : "",
        },
      };
    }
    case "image_compress": {
      if (data.action !== "compress_image") {
        throw new Error("Permintaan kompresi gambar tidak valid: action harus compress_image.");
      }
      const quality = data.target_quality === undefined ? 0.7 : data.target_quality;
      const maxDimension = data.max_width_or_height === undefined ? 1920 : data.max_width_or_height;
      const outputFormat = data.output_format === undefined ? "image/webp" : data.output_format;
      if (typeof quality !== "number" || !Number.isFinite(quality) || quality < 0.1 || quality > 0.9) {
        throw new Error("Kualitas kompresi harus berupa angka antara 0,1 dan 0,9.");
      }
      if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 8192) {
        throw new Error("Dimensi maksimum harus berupa bilangan bulat antara 1 dan 8192 piksel.");
      }
      if (!["image/webp", "image/jpeg", "image/png"].includes(outputFormat)) {
        throw new Error("Format kompresi harus image/webp, image/jpeg, atau image/png.");
      }
      return {
        type: value.type,
        assigned_model: assignedModel,
        summary,
        data: {
          action: "compress_image",
          target_quality: quality,
          max_width_or_height: maxDimension,
          output_format: outputFormat,
          message: typeof data.message === "string" ? data.message.slice(0, 2000) : "",
        },
      };
    }
    case "file_converter": {
      const operations = new Set([
        "word_to_pdf", "pdf_to_word", "excel_to_pdf", "pdf_to_images",
        "merge_pdf", "split_pdf", "compress_pdf", "image_to_pdf",
        "zip_files", "word_to_excel", "excel_to_ppt",
      ]);
      const targetFormats = new Set(["pdf", "docx", "xlsx", "pptx", "zip", "png", "jpg", "txt"]);
      if (!operations.has(data.operation) || !targetFormats.has(data.target_format)) {
        throw new Error("Permintaan alat file tidak valid: operasi atau format keluaran tidak didukung.");
      }
      const expectedFormats = {
        word_to_pdf: "pdf",
        pdf_to_word: "docx",
        excel_to_pdf: "pdf",
        merge_pdf: "pdf",
        split_pdf: "pdf",
        compress_pdf: "pdf",
        image_to_pdf: "pdf",
        zip_files: "zip",
        word_to_excel: "xlsx",
        excel_to_ppt: "pptx",
      };
      if ((data.operation === "pdf_to_images" && !["png", "jpg"].includes(data.target_format))
        || (expectedFormats[data.operation] && data.target_format !== expectedFormats[data.operation])) {
        throw new Error("Format keluaran tidak sesuai dengan operasi file yang dipilih.");
      }
      return {
        type: value.type,
        assigned_model: assignedModel,
        summary,
        data: {
          operation: data.operation,
          target_format: data.target_format,
          instructions: typeof data.instructions === "string" ? data.instructions.slice(0, 2000) : "",
        },
      };
    }
    case "vision_analysis": {
      if (!Array.isArray(data.detected_objects) || data.detected_objects.length > 100) {
        throw new Error("Analisis gambar tidak valid: detected_objects harus berupa array teks.");
      }
      if (!["image_generation", "doc", "ppt", "excel", "none"].includes(data.followup_action_suggested)) {
        throw new Error("Analisis gambar tidak valid: tindakan lanjutan tidak dikenal.");
      }
      return {
        type: value.type,
        assigned_model: assignedModel,
        summary,
        data: {
          analysis_summary: requireString(data.analysis_summary, "data.analysis_summary"),
          detected_objects: data.detected_objects.map((item, index) => requireString(item, `detected_objects[${index}]`, 300)),
          extracted_text: typeof data.extracted_text === "string" ? data.extracted_text.slice(0, 20_000) : "",
          followup_action_suggested: data.followup_action_suggested,
          suggested_prompt: typeof data.suggested_prompt === "string" ? data.suggested_prompt.slice(0, 6000) : "",
        },
      };
    }
    case "ppt": {
      const title = requireString(data.title, "data.title", 200);
      const theme = data.theme === undefined ? "modern-gold" : data.theme;
      if (!PRESENTATION_THEMES.has(theme)) {
        throw new Error("Format PowerPoint tidak valid: tema tidak dikenal.");
      }
      if (!Array.isArray(data.slides) || !data.slides.length || data.slides.length > 50) {
        throw new Error("Format PowerPoint tidak valid: jumlah slide harus 1–50.");
      }
      const slides = data.slides.map((slide, index) => {
        if (!slide || typeof slide !== "object" || !Array.isArray(slide.content) || slide.content.length > 30) {
          throw new Error(`Format PowerPoint tidak valid pada slide ${index + 1}.`);
        }
        return {
          slide_number: Number.isInteger(slide.slide_number) ? slide.slide_number : index + 1,
          title: requireString(slide.title, `slides[${index}].title`, 300),
          content: slide.content.map((line, lineIndex) => requireString(line, `slides[${index}].content[${lineIndex}]`, 2000)),
          notes: typeof slide.notes === "string" ? slide.notes.slice(0, 4000) : "",
        };
      });
      return { type: value.type, assigned_model: assignedModel, summary, data: { title, theme, slides } };
    }
    case "doc":
      return {
        type: value.type,
        assigned_model: assignedModel,
        summary,
        data: {
          title: requireString(data.title, "data.title", 200),
          content_markdown: requireString(data.content_markdown, "data.content_markdown"),
        },
      };
    case "excel": {
      const headers = data.headers;
      const rows = data.rows;
      if (!Array.isArray(headers) || !headers.length || headers.length > 50 || !Array.isArray(rows) || rows.length > 2000
        || rows.length * headers.length > 25_000) {
        throw new Error("Format Excel tidak valid: periksa jumlah kolom dan baris.");
      }
      if (!rows.every((row) => Array.isArray(row) && row.length <= headers.length)) {
        throw new Error("Format Excel tidak valid: susunan baris tidak cocok dengan header.");
      }
      const checkedRows = rows.map((row) => row.map((cell) => {
        if (cell === null || ["number", "boolean"].includes(typeof cell)) return cell;
        if (typeof cell !== "string") throw new Error("Format Excel tidak valid: tipe sel tidak didukung.");
        if (!cell.startsWith("=")) return cell;
        if (!/^=(?:SUM|AVERAGE|MIN|MAX|COUNT)\([A-Z]{1,3}\d{1,7}:[A-Z]{1,3}\d{1,7}\)$/i.test(cell)) {
          throw new Error("Formula Excel tidak didukung. Gunakan SUM, AVERAGE, MIN, MAX, atau COUNT dengan rentang sel sederhana.");
        }
        return { formula: cell.slice(1) };
      }));
      return {
        type: value.type,
        assigned_model: assignedModel,
        summary,
        data: {
          sheet_name: requireString(data.sheet_name, "data.sheet_name", 31),
          headers: headers.map((cell, index) => requireString(cell, `headers[${index}]`, 1000)),
          rows: checkedRows,
        },
      };
    }
    case "tool_call": {
      if (!TOOL_NAMES.has(data.tool_name) || !data.parameters || typeof data.parameters !== "object" || Array.isArray(data.parameters)) {
        throw new Error("Permintaan tindakan AI tidak valid.");
      }
      if (data.tool_name === "create_reminder") {
        const title = requireString(data.parameters.title, "parameters.title", 100);
        const scheduledAt = requireString(data.parameters.scheduled_at, "parameters.scheduled_at", 40);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt)) {
          throw new Error("Pengingat harus memakai waktu ISO 8601 dengan zona waktu yang jelas.");
        }
        const timestamp = Date.parse(scheduledAt);
        const now = Date.now();
        if (!Number.isFinite(timestamp) || timestamp < now + 60_000 || timestamp > now + 366 * 24 * 60 * 60 * 1000) {
          throw new Error("Waktu pengingat harus minimal satu menit dan maksimal satu tahun dari sekarang.");
        }
        const body = typeof data.parameters.body === "string" ? data.parameters.body.trim().slice(0, 500) : "";
        return {
          type: value.type,
          assigned_model: assignedModel,
          summary,
          data: { tool_name: data.tool_name, parameters: { title, scheduled_at: new Date(timestamp).toISOString(), body } },
        };
      }
      return { type: value.type, assigned_model: assignedModel, summary, data: { tool_name: data.tool_name, parameters: data.parameters } };
    }
    default:
      throw new Error("Tipe respons AI belum didukung.");
  }
}

export function parseStructuredResponse(source) {
  const text = String(source || "").trim();
  const json = extractJson(text);
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`JSON respons AI tidak dapat dibaca: ${error.message}`);
  }
  if (parsed?.type === "image") return null;
  return validateResponse(parsed);
}

export function parsePresentationResponse(source) {
  const text = String(source || "").trim();
  let json = "";
  try {
    json = extractJson(text);
  } catch {
    return null;
  }
  if (json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
    if (parsed?.type === "ppt") {
      try {
        return validateResponse(parsed);
      } catch {
        return null;
      }
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.slides)) {
      const slides = parsed.slides.map((slide, index) => ({
        slide_number: Number.isInteger(slide?.slide_number) ? slide.slide_number
          : Number.isInteger(slide?.number) ? slide.number : index + 1,
        title: slide?.title,
        content: slide?.content,
        notes: slide?.notes || "",
      }));
      try {
        return validateResponse({
          type: "ppt",
          assigned_model: "groq-fast",
          summary: String(parsed.summary || parsed.title || "Presentasi siap"),
          data: {
            title: parsed.title,
            theme: parsed.theme || "modern-gold",
            slides,
          },
        });
      } catch {
        return null;
      }
    }
  }

  if (!/```html(?::slide)?\b/i.test(text)
    && !/<(?:section|article)\b/i.test(text)
    && !/<div\b[^>]*class=["'][^"']*\bslide-container\b/i.test(text)) return null;
  const html = text.replace(/^```html(?::slide)?\s*/i, "").replace(/\s*```$/, "");
  const slideMarkup = [...html.matchAll(/<(section|article)\b[^>]*>([\s\S]*?)<\/\1\s*>|<div\b(?=[^>]*class=["'][^"']*\bslide-container\b[^"']*["'])[^>]*>([\s\S]*?)<\/div\s*>/gi)]
    .map((match) => match[2] || match[3])
    .filter((markup) => /<(?:h[1-6]|header)\b/i.test(markup));
  if (!slideMarkup.length) return null;
  const decode = (value) => value.replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
  const slides = slideMarkup.slice(0, 50).map((markup, index) => {
    const heading = markup.match(/<(?:h[1-6]|header)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|header)>/i)?.[1] || "";
    const content = [...markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((item) => decode(item[1]))
      .filter(Boolean);
    return { slide_number: index + 1, title: decode(heading), content: content.length ? content : [decode(markup)] };
  });
  const title = slides[0]?.title;
  if (!title) return null;
  try {
    return validateResponse({
      type: "ppt",
      assigned_model: "groq-fast",
      summary: "Presentasi siap",
      data: { title, theme: "modern-gold", slides },
    });
  } catch {
    return null;
  }
}

export function createPresentationFallback(prompt, responseText) {
  const requestedTitle = String(prompt || "").match(/\b(?:tentang|mengenai|about|on)\s+(.+?)(?:[.!?]|$)/i)?.[1]?.trim();
  const title = (requestedTitle || "Ringkasan Presentasi").slice(0, 200);
  const source = String(responseText || "");
  const content = /^\s*(?:```(?:json|html)\b|\{)/i.test(source)
    ? `Ringkasan materi untuk ${title}.`
    : source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return {
    type: "ppt",
    assigned_model: "groq-fast",
    summary: "Presentasi ringkas siap",
    data: {
      title,
      theme: "modern-gold",
      slides: [{
        slide_number: 1,
        title,
        content: [content || "Materi presentasi dapat dilengkapi dari topik yang diminta."],
        notes: "",
      }],
    },
  };
}

function markdownCell(value) {
  if (value && typeof value === "object" && typeof value.formula === "string") return `=${value.formula}`;
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function structuredDocumentContent(response) {
  const { type, data } = response;
  if (type === "doc") return `# ${data.title}\n\n${data.content_markdown}`;
  if (type === "excel") {
    const table = [
      `# ${data.sheet_name}`,
      "",
      `| ${data.headers.map(markdownCell).join(" | ")} |`,
      `| ${data.headers.map(() => "---").join(" | ")} |`,
      ...data.rows.map((row) => `| ${data.headers.map((_, index) => markdownCell(row[index])).join(" | ")} |`),
    ];
    return table.join("\n");
  }
  if (type === "ppt") {
    return [
      `# ${data.title}`,
      "",
      ...data.slides.flatMap((slide, index) => [
        `## ${slide.slide_number || index + 1}. ${slide.title}`,
        ...slide.content.map((point) => `- ${point}`),
        "",
      ]),
    ].join("\n");
  }
  return "";
}
