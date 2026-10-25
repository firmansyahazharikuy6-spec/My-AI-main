const LANGUAGE_LABELS = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  go: "Go",
  htm: "HTML",
  html: "HTML",
  java: "Java",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  md: "Markdown",
  mjs: "JavaScript",
  php: "PHP",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  scss: "SCSS",
  sh: "Shell",
  svg: "SVG",
  text: "Plaintext",
  ts: "TypeScript",
  tsx: "TSX",
  txt: "Plaintext",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
};

const EXTENSIONS = {
  bash: "sh", c: "c", cpp: "cpp", cs: "cs", css: "css", go: "go", htm: "html",
  html: "html", java: "java", js: "js", json: "json", jsx: "jsx", md: "md", mjs: "mjs",
  php: "php", py: "py", rb: "rb", rs: "rs", scss: "scss", sh: "sh", svg: "svg",
  text: "txt", ts: "ts", tsx: "tsx", txt: "txt", xml: "xml", yaml: "yaml", yml: "yml",
};

const PREVIEW_LANGUAGES = new Set(["css", "html", "htm", "js", "javascript", "md", "markdown", "mjs", "svg", "xml"]);
const KATEX_CDN = "https://cdn.jsdelivr.net";
const PREVIEW_CSP = `default-src 'none'; script-src 'unsafe-inline' ${KATEX_CDN}; style-src 'unsafe-inline' ${KATEX_CDN}; img-src data: blob:; font-src data: ${KATEX_CDN}; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const KATEX_HEAD = `<link rel="stylesheet" href="${KATEX_CDN}/npm/katex@0.16.8/dist/katex.min.css"><script src="${KATEX_CDN}/npm/katex@0.16.8/dist/katex.min.js"><\/script><script src="${KATEX_CDN}/npm/katex@0.16.8/dist/contrib/auto-render.min.js"><\/script>`;
const DISPLAY_MATH_DELIMITER = String.fromCharCode(36).repeat(2);
const KATEX_RENDER = '<script>document.addEventListener("DOMContentLoaded",function(){if(typeof renderMathInElement==="function"){renderMathInElement(document.body,{delimiters:[{left:"'
  + DISPLAY_MATH_DELIMITER + '",right:"' + DISPLAY_MATH_DELIMITER + '",display:true},{left:"$",right:"$",display:false}]});}});<\/script>';
const DEFAULT_DARK_STYLE = "body{background-color:#0f1015;color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;padding:2rem}";

function scriptSafe(source) {
  return String(source || "").replace(/<\/script/gi, "<\\/script");
}

function styleSafe(source) {
  return String(source || "").replace(/<\/style/gi, "<\\/style");
}

function hasPageBackground(source) {
  const text = String(source || "");
  const css = text.replace(/<[^>]*>/g, "\n");
  return /<(?:html|body)\b[^>]*\bstyle\s*=\s*["'][^"']*\bbackground(?:-color)?\s*:/i.test(text)
    || /(?:^|[{}])\s*(?:(?:html|body|:root|#app|\.app)\b[^{}]*)\{[^{}]*\bbackground(?:-color)?\s*:/i.test(css);
}

function injectHeadContent(source, markup) {
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${markup}</head>`);
  if (/<head(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${markup}`);
  }
  if (/<body(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<body(?:\s[^>]*)?>/i, (body) => `<head>${markup}</head>${body}`);
  }
  if (/<\/html>/i.test(source)) return source.replace(/<\/html>/i, `<head>${markup}</head></html>`);
  return `<head>${markup}</head>${source}`;
}

function htmlDocument(source) {
  const text = String(source || "").replace(/<meta\b(?=[^>]*http-equiv\s*=\s*["']?content-security-policy\b)[^>]*>/gi, "");
  const policy = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (/<html(?:\s[^>]*)?>/i.test(text)) {
    return injectHeadContent(text, policy);
  }
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">${policy}<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${text}</body></html>`;
}

function addLivePreviewSupport(source, hasBackground) {
  let document = injectHeadContent(source, `${KATEX_HEAD}<style>${hasBackground ? "" : DEFAULT_DARK_STYLE}</style>`);
  if (/<\/body>/i.test(document)) {
    document = document.replace(/<\/body>/i, () => `${KATEX_RENDER}</body>`);
  } else if (/<\/html>/i.test(document)) {
    document = /<body(?:\s[^>]*)?>/i.test(document)
      ? document.replace(/<\/html>/i, () => `${KATEX_RENDER}</html>`)
      : document.replace(/<\/html>/i, () => `<body>${KATEX_RENDER}</body></html>`);
  } else {
    document += `<body>${KATEX_RENDER}</body>`;
  }
  return document;
}

export function codeLanguageLabel(language) {
  const normalized = String(language || "").toLowerCase();
  return LANGUAGE_LABELS[normalized] || (normalized ? normalized.toUpperCase() : "Plaintext");
}

export function codeFileExtension(language) {
  return EXTENSIONS[String(language || "").toLowerCase()] || "txt";
}

export function supportsCodePreview(language, source = "") {
  const normalized = String(language || "").toLowerCase();
  return normalized === "xml"
    ? /<svg(?:\s|>)/i.test(String(source))
    : PREVIEW_LANGUAGES.has(normalized);
}

export function buildCodePreviewDocument(source, language) {
  const normalized = String(language || "").toLowerCase();
  const code = String(source || "");
  if (!supportsCodePreview(normalized, code)) {
    throw new Error("Bahasa kode ini tidak mendukung pratinjau.");
  }
  if (["html", "htm", "svg", "xml"].includes(normalized)) {
    return addLivePreviewSupport(htmlDocument(code), hasPageBackground(code));
  }
  if (normalized === "css") {
    return addLivePreviewSupport(htmlDocument(`<style>body{font:16px system-ui,sans-serif;padding:24px;background:#f4f6f8;color:#18202b}.preview-sample{max-width:640px;margin:24px auto;padding:24px;border-radius:18px;background:white;box-shadow:0 10px 30px #17203318}</style><main class="preview-sample"><h1>Pratinjau CSS</h1><p>Contoh konten untuk melihat gaya yang diterapkan.</p><button type="button">Contoh tombol</button></main><style>${styleSafe(code)}</style>`), true);
  }
  return addLivePreviewSupport(htmlDocument(`<main id="app"></main><script>${scriptSafe(code)}</script>`), false);
}

export function buildLiveArtifactDocument(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) {
    throw new Error("Tidak ada kode web yang dapat dipratinjau.");
  }
  const normalized = blocks.map((block) => ({
    lang: String(block?.lang || "").toLowerCase(),
    source: String(block?.source || ""),
  })).filter((block) => block.source.trim());
  if (!normalized.length || normalized.some((block) => !supportsCodePreview(block.lang, block.source))) {
    throw new Error("Artifact berisi bahasa kode yang tidak didukung untuk pratinjau web.");
  }

  const markdownBlocks = normalized.filter((block) => ["md", "markdown"].includes(block.lang));
  if (markdownBlocks.length === normalized.length) {
    const source = markdownBlocks.map((block) => block.source).join("\n\n");
    const escaped = source.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[character]);
    return htmlDocument(`<head><style>${DEFAULT_DARK_STYLE}</style></head><body><main><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escaped}</pre></main></body>`);
  }

  const htmlBlock = normalized.find((block) => ["html", "htm", "svg", "xml"].includes(block.lang));
  const hasBackground = normalized.some((block) => hasPageBackground(block.source));
  let document = htmlBlock
    ? htmlDocument(htmlBlock.source)
    : htmlDocument("<main id=\"app\"><h1>Pratinjau Artifact</h1></main>");
  const styles = normalized.filter((block) => ["css", "scss"].includes(block.lang))
    .map((block) => styleSafe(block.source)).join("\n");
  const scripts = normalized.filter((block) => ["js", "javascript", "mjs"].includes(block.lang))
    .map((block) => scriptSafe(block.source)).join("\n");
  const injectedStyles = `${hasBackground ? "" : DEFAULT_DARK_STYLE}${styles ? `\n${styles}` : ""}`;
  document = injectHeadContent(document, `<style>${styleSafe(injectedStyles)}</style>`);
  if (scripts) {
    const script = `<script>${scripts}</script>`;
    document = /<\/body>/i.test(document)
      ? document.replace(/<\/body>/i, `${script}</body>`)
      : document.replace(/<\/html>/i, `${script}</html>`);
  }
  document = addLivePreviewSupport(document, true);
  return document;
}
