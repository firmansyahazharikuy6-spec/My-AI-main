import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStructuredResponse,
  parsePresentationResponse,
  createPresentationFallback,
  isImageGenerationRequest,
  requestedPresentationSlideCount,
  shouldRequestStructuredResponse,
} from "./response-handler.js";

function parseFileOperation(operation, target_format) {
  return parseStructuredResponse(JSON.stringify({
    type: "file_converter",
    assigned_model: "groq-fast",
    summary: "Siap mengolah file",
    data: { operation, target_format, instructions: "Pilih file sumber." },
  }));
}

test("file-converter schema accepts ZIP and Office conversions with matching formats", () => {
  for (const [operation, targetFormat] of [
    ["zip_files", "zip"],
    ["word_to_excel", "xlsx"],
    ["excel_to_ppt", "pptx"],
  ]) {
    const response = parseFileOperation(operation, targetFormat);
    assert.equal(response.data.operation, operation);
    assert.equal(response.data.target_format, targetFormat);
  }
});

test("file-converter schema rejects mismatched output formats", () => {
  assert.throws(() => parseFileOperation("word_to_excel", "pptx"), /Format keluaran/);
});

test("reminder schema normalizes a timezone-aware future date", () => {
  const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const response = parseStructuredResponse(JSON.stringify({
    type: "tool_call",
    assigned_model: "groq-fast",
    summary: "Pengingat siap",
    data: {
      tool_name: "create_reminder",
      parameters: { title: "Kirim laporan", scheduled_at: scheduledAt, body: "Periksa lampiran." },
    },
  }));
  assert.equal(response.data.parameters.title, "Kirim laporan");
  assert.equal(response.data.parameters.scheduled_at, new Date(scheduledAt).toISOString());
});

test("reminder schema rejects ambiguous or past times", () => {
  const base = {
    type: "tool_call",
    assigned_model: "groq-fast",
    summary: "Pengingat",
    data: { tool_name: "create_reminder", parameters: { title: "Pengingat", scheduled_at: "" } },
  };
  assert.throws(() => parseStructuredResponse(JSON.stringify({
    ...base,
    data: { ...base.data, parameters: { ...base.data.parameters, scheduled_at: "2035-01-01T12:00:00" } },
  })), /zona waktu/);
  assert.throws(() => parseStructuredResponse(JSON.stringify({
    ...base,
    data: { ...base.data, parameters: { ...base.data.parameters, scheduled_at: "2020-01-01T12:00:00Z" } },
  })), /minimal satu menit/);
});

test("ordinary chat does not require a structured tool response", () => {
  assert.equal(shouldRequestStructuredResponse({ message: "Balas tepat: MyAI chat aktif." }), false);
  assert.equal(shouldRequestStructuredResponse({ message: "Jelaskan apa itu format JSON." }), false);
  assert.equal(shouldRequestStructuredResponse({ message: "Bagaimana cara menulis email yang baik?" }), false);
});

test("requested presentation slide count supports numeric and spoken counts", () => {
  assert.equal(requestedPresentationSlideCount("Buatkan file PPTX 5 slide tentang pegunungan."), 5);
  assert.equal(requestedPresentationSlideCount("Make a PowerPoint with ten slides."), 10);
  assert.equal(requestedPresentationSlideCount("Buatkan satu halaman presentasi."), 1);
  assert.equal(requestedPresentationSlideCount("Jelaskan isi slide 5."), null);
  assert.equal(requestedPresentationSlideCount("Buatkan 51 slide."), null);
});

test("PowerPoint artifact payload defaults to modern-gold and validates slide content", () => {
  const response = parseStructuredResponse(JSON.stringify({
    type: "ppt",
    assigned_model: "groq-fast",
    summary: "Presentasi siap",
    data: {
      title: "Energi Bersih",
      slides: [{ title: "Agenda", content: ["Konteks", "Peluang"] }],
    },
  }));
  assert.equal(response.data.theme, "modern-gold");
  assert.deepEqual(response.data.slides[0], {
    slide_number: 1,
    title: "Agenda",
    content: ["Konteks", "Peluang"],
    notes: "",
  });
});

test("presentation parser accepts json:slides payloads with number or slide_number", () => {
  const response = parsePresentationResponse([
    "```json:slides",
    JSON.stringify({
      title: "Teknologi AI untuk UMKM",
      slides: [
        { number: 1, title: "Sampul", content: ["Teknologi AI untuk UMKM"] },
        { slide_number: 2, title: "Manfaat", content: ["Efisiensi", "Layanan pelanggan"] },
      ],
    }),
    "```",
  ].join("\n"));
  assert.equal(response.type, "ppt");
  assert.equal(response.data.title, "Teknologi AI untuk UMKM");
  assert.equal(response.data.theme, "modern-gold");
  assert.equal(response.data.slides[0].slide_number, 1);
  assert.equal(response.data.slides[1].slide_number, 2);
});

test("presentation parser accepts the canonical structured response and slide HTML", () => {
  const canonical = parsePresentationResponse(JSON.stringify({
    type: "ppt",
    assigned_model: "groq-fast",
    summary: "Presentasi siap",
    data: { title: "AI", slides: [{ title: "Manfaat", content: ["Menghemat waktu"] }] },
  }));
  assert.equal(canonical.data.slides[0].content[0], "Menghemat waktu");

  const html = parsePresentationResponse([
    "```html:slide",
    '<section class="slide-container"><h1>Manfaat AI</h1><ul><li>Efisiensi</li><li>Analitik</li></ul></section>',
    '<section class="slide-container"><h2>Penutup</h2><ul><li>Mulai bertahap</li></ul></section>',
    '<div class="slide-container"><h2>Ajakan</h2><ul><li>Mulai sekarang</li></ul></div>',
    "```",
  ].join("\n"));
  assert.equal(html.data.slides.length, 3);
  assert.equal(html.data.slides[0].title, "Manfaat AI");
  assert.deepEqual(html.data.slides[0].content, ["Efisiensi", "Analitik"]);
});

test("ordinary chat is not parsed as an artifact and malformed presentations get a one-slide fallback", () => {
  assert.equal(parsePresentationResponse("Halo, apa kabar?"), null);
  assert.equal(parsePresentationResponse("```json:slides\n{malformed}\n```"), null);

  const fallback = createPresentationFallback(
    "Buatkan PPT tentang AI untuk UMKM.",
    "AI membantu usaha kecil menghemat waktu dan memahami pelanggan.",
  );
  assert.equal(fallback.type, "ppt");
  assert.equal(fallback.data.title, "AI untuk UMKM");
  assert.equal(fallback.data.slides.length, 1);
  assert.match(fallback.data.slides[0].content[0], /menghemat waktu/);
});

test("explicit image creation prompts are detected without mistaking analysis for generation", () => {
  for (const prompt of [
    "Buatkan gambar animasi tentang pegunungan.",
    "Tolong buat sebuah gambar seekor kucing di taman.",
    "Generate image of a mountain at sunrise.",
    "Could you create an image of a quiet forest?",
    "Draw a red robot.",
    "Please draw a mountain landscape.",
    "Please create an illustration of a quiet forest.",
    "Lukiskan pemandangan pantai saat senja.",
  ]) {
    assert.equal(isImageGenerationRequest(prompt), true, prompt);
  }
  assert.equal(isImageGenerationRequest("Analisis gambar ini dan jelaskan objeknya."), false);
  assert.equal(isImageGenerationRequest("How do I draw a mountain?"), false);
  assert.equal(isImageGenerationRequest("Picture of a red robot in a garden."), true);
  assert.equal(isImageGenerationRequest("Tolong buat gambar dari foto ini."), true);
});

test("website briefs that mention image placeholders stay on the text-chat route", () => {
  const brief = `Peran: Developer front-end senior. Tugas: Buat website portofolio pribadi yang profesional dan siap dipublikasikan.
Konteks: nama [Nama lengkap], profesi [UI/UX Designer], target rekruter dan klien, tujuan mendapat pekerjaan, konten Bahasa Indonesia.
Tech stack: HTML, CSS, JavaScript murni; satu file jika memungkinkan, bersih dan mudah diedit.
Desain: editorial minimalis, pilih palet dan font yang cocok, hindari template generik, dukung light/dark mode.
Struktur: navbar sticky dan hamburger; hero dengan dua CTA; tentang saya dan fakta cepat; skill per kategori; 3-6 proyek dengan filter dan detail studi kasus; pengalaman dan pendidikan; testimoni; artikel; kontak dengan validasi; footer.
Konten kosong harus memakai placeholder yang ditandai <!-- GANTI: ... -->. Gambar placeholder memakai gradient atau SVG lokal.
Interaksi: scroll reveal, hover, smooth scroll, active section, theme toggle, reduced motion.
Responsif mobile-first, uji 360px, 768px, 1280px; aksesibel, keyboard, fokus jelas, kontras WCAG AA.
SEO: title, description, Open Graph, favicon; lazy-load; target Lighthouse 90+.
Output: kode lengkap, cara ganti konten/warna/font, deploy gratis, dan 3 ide lanjutan.`;
  assert.equal(isImageGenerationRequest(brief), false);
  assert.equal(isImageGenerationRequest("Gambar placeholder memakai gradient atau SVG untuk website."), false);
  assert.equal(isImageGenerationRequest("Tugas: Buatkan gambar seekor kucing di taman."), true);
  assert.equal(isImageGenerationRequest("Create a website with an image placeholder and a theme toggle."), false);
  assert.equal(isImageGenerationRequest("Tugas utama: Buatkan gambar seekor kucing di taman."), true);
});

test("structured responses are requested for visual, file, email, and reminder actions", () => {
  assert.equal(shouldRequestStructuredResponse({ imageGeneration: true }), true);
  assert.equal(shouldRequestStructuredResponse({ hasImages: true }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Kompres gambar ini ke WebP." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Konversi file Word ke PDF." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Ubah PDF ke Word." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Buat ZIP dari folder kerja." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Kirim email ke tim." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Buat pengingat rapat besok." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Buatkan slide presentasi tentang energi bersih." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Presentation deck for a product launch." }), true);
});

test("image compression requests trigger the compression tool for natural phrasing", () => {
  for (const message of [
    "Kompres gambar ini ke WebP.",
    "Tolong perkecil ukuran foto.",
    "Optimalkan ukuran gambar ini.",
    "Reduce the image size and save as JPEG.",
    "Shrink this photo.",
  ]) {
    assert.equal(shouldRequestStructuredResponse({ message }), true, message);
  }
});

test("image compression schema validates options and applies defaults", () => {
  const response = parseStructuredResponse(JSON.stringify({
    type: "image_compress",
    assigned_model: "groq-fast",
    summary: "Siap mengompres gambar",
    data: { action: "compress_image", message: "Pilih gambar." },
  }));
  assert.deepEqual(response.data, {
    action: "compress_image",
    target_quality: 0.7,
    max_width_or_height: 1920,
    output_format: "image/webp",
    message: "Pilih gambar.",
  });
  assert.throws(() => parseStructuredResponse(JSON.stringify({
    type: "image_compress",
    assigned_model: "groq-fast",
    summary: "Kompres",
    data: { action: "compress_image", target_quality: 0.95 },
  })), /Kualitas kompresi/);
});

test("structured parser ignores later JSON example blocks", () => {
  const response = parseStructuredResponse([
    "```json",
    JSON.stringify({
      type: "text",
      assigned_model: "groq-fast",
      summary: "Jawaban",
      data: { reply_markdown: "Contoh pertama." },
    }),
    "```",
    "Contoh tambahan:",
    "```json",
    "{\"type\":\"invalid\"}",
    "```",
  ].join("\n"));
  assert.equal(response.data.reply_markdown, "Contoh pertama.");
});

test("structured artifact parser ignores image payloads", () => {
  assert.equal(parseStructuredResponse(JSON.stringify({
    type: "image",
    assigned_model: "groq-fast",
    summary: "Gambar siap",
    data: { url: "https://example.test/image.png" },
  })), null);
});
