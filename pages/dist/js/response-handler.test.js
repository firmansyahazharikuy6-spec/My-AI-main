import assert from "node:assert/strict";
import test from "node:test";
import { parseStructuredResponse, shouldRequestStructuredResponse } from "./response-handler.js";

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

test("structured responses are requested for visual, file, email, and reminder actions", () => {
  assert.equal(shouldRequestStructuredResponse({ imageGeneration: true }), true);
  assert.equal(shouldRequestStructuredResponse({ hasImages: true }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Kompres gambar ini ke WebP." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Konversi file Word ke PDF." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Ubah PDF ke Word." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Buat ZIP dari folder kerja." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Kirim email ke tim." }), true);
  assert.equal(shouldRequestStructuredResponse({ message: "Buat pengingat rapat besok." }), true);
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
