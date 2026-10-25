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
  assert.equal(promptHelperOutputIsUsable("Tentu, berikut prompt yang diperbaiki:", "buat jadwal belajar"), false);
  assert.equal(promptHelperOutputIsUsable("This sentence is repeated as model filler and should not be shown.\nThis sentence is repeated as model filler and should not be shown.", "make a plan"), false);
  assert.equal(promptHelperOutputIsUsable("x".repeat(2500), "short prompt"), false);
  assert.equal(promptHelperOutputIsUsable("Tujuan: buat jadwal belajar Python selama 4 minggu.", "buat jadwal belajar Python selama 4 minggu"), true);
});

test("suggestion parser accepts fenced JSON and explanatory text", () => {
  const result = parsePromptSuggestions('Berikut saran:\n```json\n{"suggestions":["Tambahkan contoh praktis yang relevan","Sertakan batasan dan kriteria keberhasilan","Susun hasil berdasarkan prioritas dan kebutuhan"]}\n```\nSemoga membantu.');
  assert.deepEqual(result, [
    "Tambahkan contoh praktis yang relevan",
    "Sertakan batasan dan kriteria keberhasilan",
    "Susun hasil berdasarkan prioritas dan kebutuhan",
  ]);
});

test("suggestion parser accepts numbered text and caps results at three", () => {
  assert.deepEqual(parsePromptSuggestions([
    "1. Tambahkan contoh praktis yang relevan",
    "2. Sertakan batasan dan kriteria keberhasilan",
    "3. Susun hasil berdasarkan prioritas dan kebutuhan",
    "4. Uraikan tujuan dan langkah berikutnya",
  ].join("\n")), [
    "Tambahkan contoh praktis yang relevan",
    "Sertakan batasan dan kriteria keberhasilan",
    "Susun hasil berdasarkan prioritas dan kebutuhan",
  ]);
});

test("suggestions contain five or six words in model and local fallbacks", () => {
  const parsed = parsePromptSuggestions(JSON.stringify([
    "Tambahkan contoh praktis yang relevan",
    "Susun langkah kerja berdasarkan prioritas",
    "Jelaskan hasil dengan kriteria keberhasilan",
  ]));
  assert.equal(parsed.length, 3);
  assert.ok(parsed.every((suggestion) => [5, 6].includes(suggestion.split(/\s+/).length)));
  assert.ok(localPromptContinuations("prompt", "id").every((suggestion) => [5, 6].includes(suggestion.split(/\s+/).length)));
  assert.ok(localPromptContinuations("prompt", "en").every((suggestion) => [5, 6].includes(suggestion.split(/\s+/).length)));
  assert.deepEqual(parsePromptSuggestions(JSON.stringify(["Satu dua tiga empat", "Tambahkan contoh praktis yang relevan", "Susun hasil berdasarkan prioritas dan kebutuhan"])), [
    "Tambahkan contoh praktis yang relevan",
    "Susun hasil berdasarkan prioritas dan kebutuhan",
  ]);
});

test("local helper fallbacks preserve Indonesian and the user's prompt", () => {
  const improved = localImprovedPrompt("buat rencana belajar coding", "id");
  const suggestions = localPromptSuggestions("buat rencana belajar coding", "id");
  assert.match(improved, /Tugas: buat rencana belajar coding/);
  assert.match(improved, /Susun hasil yang jelas, profesional, dan siap digunakan/);
  assert.match(improved, /Format keluaran:/);
  assert.doesNotMatch(improved, /\?/);
  assert.doesNotMatch(improved, /\[[^\]]+\]/);
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((suggestion) => suggestion.includes("buat rencana belajar coding")));
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
