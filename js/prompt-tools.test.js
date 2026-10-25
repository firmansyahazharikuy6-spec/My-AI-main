import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPromptLanguage,
  localPromptContinuations,
  localImprovedPrompt,
  localOfflineResponse,
  localPromptSuggestions,
  parsePromptSuggestions,
  promptLanguageInstruction,
  promptHelperOutputIsUsable,
  promptOutputMatchesLanguage,
} from "./prompt-tools.js";

test("prompt language follows the user's draft before the interface language", () => {
  assert.equal(detectPromptLanguage("tolong buat rencana belajar coding", "en"), "id");
  assert.equal(detectPromptLanguage("Please make a study plan for coding", "id"), "en");
});

test("prompt helper language instruction is explicit", () => {
  assert.match(promptLanguageInstruction("id"), /Bahasa Indonesia/);
  assert.match(promptLanguageInstruction("en"), /English/);
});

test("language guard rejects English output for an Indonesian draft", () => {
  assert.equal(promptOutputMatchesLanguage("Goal: Make a learning plan for coding", "id"), false);
  assert.equal(promptOutputMatchesLanguage("Tujuan: Buat rencana belajar coding dengan langkah yang jelas", "id"), true);
});

test("prompt helper rejects leaked profile context, excessive output, and repeated lines", () => {
  assert.equal(promptHelperOutputIsUsable("Mode kerja aktif: flash\nUser Name: [Your Name]", "buat jadwal belajar"), false);
  assert.equal(promptHelperOutputIsUsable("This sentence is repeated as model filler and should not be shown.\nThis sentence is repeated as model filler and should not be shown.", "make a plan"), false);
  assert.equal(promptHelperOutputIsUsable("x".repeat(2500), "short prompt"), false);
  assert.equal(promptHelperOutputIsUsable("Tujuan: buat jadwal belajar Python selama 4 minggu.", "buat jadwal belajar Python selama 4 minggu"), true);
});

test("suggestion parser accepts fenced JSON and explanatory text", () => {
  const result = parsePromptSuggestions('Berikut saran:\n```json\n{"suggestions":["Satu","Dua","Tiga"]}\n```\nSemoga membantu.');
  assert.deepEqual(result, ["Satu", "Dua", "Tiga"]);
});

test("suggestion parser accepts numbered text and caps results at three", () => {
  assert.deepEqual(parsePromptSuggestions("1. Alpha\n2. Beta\n3. Gamma\n4. Delta"), ["Alpha", "Beta", "Gamma"]);
});

test("suggestions are limited to eight words in model and local fallbacks", () => {
  const parsed = parsePromptSuggestions(JSON.stringify([
    "Tambahkan contoh praktis yang relevan dengan kebutuhan dan konteks pengguna",
    "Susun langkah kerja yang jelas berdasarkan prioritas dan batasan",
    "Jelaskan hasil dengan format ringkas dan kriteria keberhasilan terukur",
  ]));
  assert.equal(parsed.length, 3);
  assert.ok(parsed.every((suggestion) => suggestion.split(/\s+/).length <= 8));
  assert.ok(localPromptContinuations("prompt", "id").every((suggestion) => suggestion.split(/\s+/).length <= 8));
  assert.ok(localPromptContinuations("prompt", "en").every((suggestion) => suggestion.split(/\s+/).length <= 8));
});

test("local helper fallbacks preserve Indonesian and the user's prompt", () => {
  const improved = localImprovedPrompt("buat rencana belajar coding", "id");
  const suggestions = localPromptSuggestions("buat rencana belajar coding", "id");
  assert.match(improved, /Tujuan: buat rencana belajar coding/);
  assert.match(improved, /Susun hasil yang jelas, profesional, dan siap digunakan/);
  assert.doesNotMatch(improved, /\[[^\]]+\]/);
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((suggestion) => suggestion.includes("buat rencana belajar coding")));
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
