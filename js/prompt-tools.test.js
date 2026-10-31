import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutoPromptObject,
  detectPromptLanguage,
  localPromptContinuations,
  localImprovedPrompt,
  localOfflineResponse,
  localPromptSuggestions,
  localStarterPromptExamples,
  parsePromptSuggestions,
  promptLanguageInstruction,
  promptObjectInstruction,
  promptHelperOutputIsUsable,
  promptOutputMatchesLanguage,
  rankPromptHelperCandidates,
  selectGuestPromptHelperModel,
} from "./prompt-tools.js";

test("auto prompt objects cover the toolkit's task domains and preserve the original request", () => {
  const examples = [
    ["debug this function and add a test", "coding"],
    ["write a launch email for customers", "writing"],
    ["ringkas manfaat minum air putih", "summarization"],
    ["design a logo image for my cafe", "design"],
    ["create a marketing campaign for sales", "business"],
    ["teach me a lesson about algebra", "learning"],
    ["research evidence and compare these data sources", "research-data"],
    ["prioritize my tasks and build a schedule", "productivity"],
    ["review my resume for a job interview", "career"],
    ["what is the best way to organize my day?", "general"],
  ];
  for (const [request, expectedDomain] of examples) {
    const object = buildAutoPromptObject(request);
    assert.equal(object.domain, expectedDomain);
    assert.equal(object.action, request);
    assert.ok(object.schema.endsWith(".v1"));
    assert.ok(object.constraints.length >= 2);
    assert.ok(object.successCriteria);
    assert.ok(object.taskGuidance.length > 100);
  }
});

test("auto prompt mode can select a task domain without inventing user context", () => {
  const object = buildAutoPromptObject("Make this image warmer", { mode: "image", language: "en" });
  assert.equal(object.domain, "design");
  assert.match(object.context, /only conversation context/i);
  assert.equal(Object.hasOwn(object, "audience"), false);
  assert.match(object.action, /image warmer/);
  assert.equal(buildAutoPromptObject("Draw a coding API diagram", { mode: "image" }).domain, "design");
});

test("detailed portfolio website briefs become a complete front-end implementation specification", () => {
  const brief = `Buat website portofolio pribadi yang profesional dan siap dipublikasikan.
Konteks: nama [Nama lengkap], profesi [UI/UX Designer], target rekruter dan klien, tujuan mendapat pekerjaan, konten Bahasa Indonesia.
Tech stack: HTML, CSS, JavaScript murni; satu file jika memungkinkan, bersih dan mudah diedit.
Desain: editorial minimalis, pilih palet dan font yang cocok, hindari template generik, dukung light/dark mode.
Struktur: navbar sticky dan hamburger; hero dengan dua CTA; tentang saya dan fakta cepat; skill per kategori; 3-6 proyek dengan filter dan detail studi kasus; pengalaman dan pendidikan; testimoni; artikel; kontak dengan validasi; footer.
Konten kosong harus memakai placeholder yang ditandai <!-- GANTI: ... -->. Gambar gunakan gradient atau SVG lokal.
Interaksi: scroll reveal, hover, smooth scroll, active section, theme toggle, reduced motion.
Responsif mobile-first, uji 360px, 768px, 1280px; aksesibel, keyboard, fokus jelas, kontras WCAG AA.
SEO: title, description, Open Graph, favicon; lazy-load; target Lighthouse 90+.
Output: kode lengkap, cara ganti konten/warna/font, deploy gratis, dan 3 ide lanjutan.`;
  const object = buildAutoPromptObject(brief, { language: "id" });
  const prompt = localImprovedPrompt(brief, "id");
  assert.equal(object.domain, "web-development");
  assert.match(object.taskGuidance, /pada lebar yang diminta/);
  assert.match(object.taskGuidance, /target Lighthouse yang belum diverifikasi/);
  assert.ok(prompt.length > brief.length * 2);
  for (const requirement of [
    "360px", "768px", "1280px", "WCAG AA", "Open Graph",
    "lazy-load", "3-6 proyek", "theme toggle", "<!-- GANTI: ... -->",
    "deploy gratis", "3 ide lanjutan",
  ]) {
    assert.ok(prompt.includes(requirement), `Auto prompt omitted "${requirement}"`);
  }
});

test("starter prompt examples cover every supported auto-prompt category", () => {
  const examples = localStarterPromptExamples("en");
  assert.equal(examples.length, 8);
  assert.ok(examples.some((example) => /code or technology/.test(example)));
  assert.ok(examples.some((example) => /visual or interface/.test(example)));
  assert.ok(examples.some((example) => /evidence/.test(example)));
  assert.equal(localStarterPromptExamples("id", "coding").length, 1);
  assert.equal(localStarterPromptExamples("en", "image").length, 1);
  assert.equal(localStarterPromptExamples("en", "research").length, 1);
});

test("prompt language follows the user's draft before the interface language", () => {
  assert.equal(detectPromptLanguage("tolong buat rencana belajar coding", "en"), "id");
  assert.equal(detectPromptLanguage("Please make a study plan for coding", "id"), "en");
  assert.equal(detectPromptLanguage("Ringkas manfaat minum air putih.", "en"), "id");
});

test("prompt helper language instruction is explicit", () => {
  assert.match(promptLanguageInstruction("id"), /Bahasa Indonesia/);
  assert.match(promptLanguageInstruction("en"), /English/);
  assert.match(promptObjectInstruction("id"), /jangan meringkas hingga langkah penting hilang/);
});

test("language guard rejects English output for an Indonesian draft", () => {
  assert.equal(promptOutputMatchesLanguage("Goal: Make a learning plan for coding", "id"), false);
  assert.equal(promptOutputMatchesLanguage("Tujuan: Buat rencana belajar coding dengan langkah yang jelas", "id"), true);
});

test("language guard rejects mixed Arabic output and short accidental language matches", () => {
  assert.equal(promptOutputMatchesLanguage(
    "Berguna minum air putih: يسلط هذا الموضوع الضوء على الفوائد الصحية المرتبطة بتناول الماء النقي.",
    "id",
  ), false);
  assert.equal(promptOutputMatchesLanguage("This is a plan.", "id"), false);
});

test("guest prompt helper prefers the fastest available model in the loaded guest catalog", () => {
  const guestModels = [{ id: "groq::model-a" }, { id: "nvidia::model-b" }];
  assert.equal(selectGuestPromptHelperModel(guestModels, "nvidia::model-b"), "groq::model-a");
  assert.equal(selectGuestPromptHelperModel(guestModels, "groq::stale-model"), "groq::model-a");
  assert.equal(selectGuestPromptHelperModel([], "nvidia::model-b"), "");
});

test("prompt helper ranks fast cloud models and can fall back across every configured provider", () => {
  const candidates = [
    { group: { provider: "gateway-openrouter" }, model: { id: "meta/llama-3.1-8b-instruct" } },
    { group: { provider: "gateway-kimi" }, model: { id: "kimi-k2" } },
    { group: { provider: "gateway-claude" }, model: { id: "claude-3-5-haiku" } },
    { group: { provider: "gateway-nvidia" }, model: { id: "nvidia/nemotron-nano" } },
    { group: { provider: "gateway-groq" }, model: { id: "llama-3.1-8b-instant" } },
  ];
  assert.deepEqual(
    rankPromptHelperCandidates(candidates).map(({ group }) => group.provider),
    ["gateway-groq", "gateway-claude", "gateway-nvidia", "gateway-openrouter", "gateway-kimi"],
  );
});

test("prompt helper rejects leaked profile context and repeated lines without imposing an output-length cap", () => {
  assert.equal(promptHelperOutputIsUsable("Mode kerja aktif: flash\nUser Name: [Your Name]", "buat jadwal belajar"), false);
  assert.equal(promptHelperOutputIsUsable("Tentu, berikut prompt yang diperbaiki:", "buat jadwal belajar"), false);
  assert.equal(promptHelperOutputIsUsable("This sentence is repeated as model filler and should not be shown.\nThis sentence is repeated as model filler and should not be shown.", "make a plan"), false);
  const detailedPrompt = `Buat rencana belajar coding dengan hasil yang dapat diperiksa.\n${Array.from(
    { length: 400 },
    (_, index) => `- Langkah ${index + 1}: jelaskan tindakan yang relevan, hasil yang diharapkan, dan cara memeriksa kualitasnya.`,
  ).join("\n")}`;
  assert.ok(detailedPrompt.length > 12000);
  assert.equal(promptHelperOutputIsUsable(detailedPrompt, "buat rencana belajar coding"), true);
  assert.equal(parsePromptSuggestions(JSON.stringify([detailedPrompt])).length, 1);
  assert.equal(promptHelperOutputIsUsable("Tujuan: buat jadwal belajar Python selama 4 minggu.", "buat jadwal belajar Python selama 4 minggu"), true);
  assert.equal(promptHelperOutputIsUsable(
    "Bersamaan dengan minuman lain, manfaat minum air putih juga bervariasi. Silakan tuliskan manfaat-manfaat yang khusus dari minum air putih sebagai tugas saya.",
    "Ringkas manfaat minum air putih.",
  ), false);
  assert.equal(promptHelperOutputIsUsable(
    "Berskala kurang, manfaat minum air putih: Laporkan manfaat yang dapat diperoleh dari minum air putih. Ekspresi ringkas dan konsentrasi pada konten yang akan ditulis.",
    "Ringkas manfaat minum air putih.",
  ), false);
  assert.equal(promptHelperOutputIsUsable(
    "Apakah Anda ingin membahas manfaat minum air putih secara ringkas?",
    "Ringkas manfaat minum air putih.",
  ), false);
  assert.equal(promptHelperOutputIsUsable(
    "Tugas: Ringkas manfaat minum air putih. Susun ringkasan singkat berdasarkan fakta yang tersedia.",
    "Ringkas manfaat minum air putih.",
  ), true);
});

test("suggestion parser accepts complete prompts in fenced JSON and explanatory text", () => {
  const prompts = [
    "Bertindak sebagai pengajar yang sabar. Tugas: jelaskan fotosintesis untuk siswa SMP. Berikan urutan konsep, contoh sederhana, latihan, dan periksa ketepatan tanpa mengarang fakta.",
    "Bertindak sebagai tutor sains. Jelaskan fotosintesis untuk tingkat SMP menggunakan bahasa yang jelas, contoh sehari-hari, dan rangkuman singkat. Tandai istilah penting dan jangan mengasumsikan pengetahuan lanjutan.",
    "Jelaskan proses fotosintesis untuk siswa SMP secara bertahap. Sertakan definisi, contoh, latihan pemahaman, dan jawaban latihan. Gunakan fakta yang akurat dan hindari informasi yang tidak didukung.",
  ];
  const result = parsePromptSuggestions(`Berikut saran:\n\`\`\`json\n{"suggestions":${JSON.stringify(prompts)}}\n\`\`\`\nSemoga membantu.`);
  assert.deepEqual(result, [
    ...prompts,
  ]);
});

test("suggestion parser rejects short fragments and caps complete prompt results at three", () => {
  const prompts = [
    "Act as a careful analyst. Analyze the supplied data, state the goal and method, distinguish facts from assumptions, and return a clear report with findings, limitations, and next steps.",
    "Act as a practical analyst. Review the supplied evidence, compare relevant results, identify uncertainty, and organize an accurate report that preserves the user's question and facts.",
    "Act as a research analyst. Answer the supplied question using available evidence, label assumptions, describe limitations, and present concise findings in a useful format.",
  ];
  assert.deepEqual(parsePromptSuggestions(JSON.stringify([
    "Tambahkan contoh praktis yang relevan",
    ...prompts,
    "A fourth full prompt that should not be included because the interface only presents three complete prompt alternatives to the user.",
  ])), prompts);
});

test("local prompt suggestions and starters are complete, distinct, and preserve the draft", () => {
  const parsed = parsePromptSuggestions(JSON.stringify(localPromptSuggestions("Buat rencana belajar coding", "id")));
  assert.equal(parsed.length, 3);
  assert.ok(parsed.every((suggestion) => suggestion.includes("Buat rencana belajar coding")));
  assert.ok(parsed.every((suggestion) => suggestion.length > 300));
  assert.equal(new Set(parsed).size, 3);
  assert.ok(localPromptContinuations("make a study plan", "en").every((suggestion) => suggestion.length > 300));
  assert.ok(localStarterPromptExamples("id", "coding")[0].includes("Jangan mengaku telah menjalankan verifikasi"));
  assert.ok(localStarterPromptExamples("en", "research").every((suggestion) => suggestion.length > 400));
});

test("local helper fallbacks preserve Indonesian and the user's prompt", () => {
  const improved = localImprovedPrompt("Ringkas manfaat minum air putih.", "id");
  const improvedEnglish = localImprovedPrompt("Write a concise project update email.", "en");
  const suggestions = localPromptSuggestions("buat rencana belajar coding", "id");
  assert.match(improved, /Tugas utama: Ringkas manfaat minum air putih\./);
  assert.match(improved, /Panduan khusus untuk tugas summarization/);
  assert.match(improved, /gagasan utama, poin pendukung, keputusan, angka, dan catatan penting/);
  assert.match(improved, /periksa kelengkapan, konsistensi, ketepatan, keterbacaan/);
  assert.match(improved, /Hasil akhir harus akurat, lengkap, spesifik terhadap tugas/);
  assert.match(improved, /Jangan mengarang fakta, data, sumber/);
  assert.match(improved, /pengulangan/);
  assert.match(improved, /Konteks dan bahan:/);
  assert.match(improved, /Format hasil:/);
  assert.match(improved, /Kriteria keberhasilan:/);
  assert.doesNotMatch(improved, /\?/);
  assert.doesNotMatch(improved, /\[[^\]]+\]/);
  assert.ok(improved.length > 500);
  for (const section of ["Primary task:", "Task-specific guidance", "Work method:", "Constraints:", "Output format:", "Success criteria:"]) {
    assert.ok(improvedEnglish.includes(section), `English prompt is missing ${section}`);
  }
  assert.match(improvedEnglish, /audience, tone, channel, and format/);
  assert.ok(improvedEnglish.length > 1000);
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((suggestion) => suggestion.includes("buat rencana belajar coding")));
});

test("local prompt improvement does not wrap an already complete suggestion a second time", () => {
  const [suggestion] = localPromptSuggestions("Buat website portofolio yang responsif.", "id", "auto");
  assert.equal(localImprovedPrompt(suggestion, "id"), suggestion);
  assert.equal(localImprovedPrompt("Role: A careful writer.\n\nPrimary task: Draft a project update.\n\nSuccess criteria: Preserve facts and be clear.", "en"),
    "Role: A careful writer.\n\nPrimary task: Draft a project update.\n\nSuccess criteria: Preserve facts and be clear.");
});

test("local prompt optimizer turns casual greetings into a request without replying to them", () => {
  const result = localImprovedPrompt("Hai, saya mau tanya", "id");
  assert.match(result, /tawarkan bantuan/);
  assert.match(result, /jangan mengasumsikan topiknya/);
  assert.doesNotMatch(result, /^(?:Hai|Halo|Berikut)/i);
  assert.doesNotMatch(result, /\?/);
});

test("offline response stays honest and useful for chat, image, and presentation requests", () => {
  const chat = localOfflineResponse("Buat jadwal belajar Python.", { language: "id" });
  assert.match(chat, /Mode offline/);
  assert.match(chat, /Buat jadwal belajar Python/);
  assert.match(chat, /belum ada model online/);

  const image = localOfflineResponse("buat gambar kucing", { language: "id", imageGeneration: true });
  assert.match(image, /Gambar belum dirender/);
  assert.match(image, /buat gambar kucing/);

  const slides = localOfflineResponse("Rencana pemasaran", { language: "id", documentFormat: "pptx" });
  assert.match(slides, /^# Rencana pemasaran/);
  assert.match(slides, /## Pokok pembahasan/);
});
