import assert from "node:assert/strict";
import test from "node:test";
import {
  getMemoryNotes, saveMemoryNote, deleteMemoryNote, memorySystemContext,
  memoryCandidateFromReply, MEMORY_LIMITS,
} from "./memory.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};

test("saving and listing memory notes round-trips sorted newest first", () => {
  storage.clear();
  assert.deepEqual(getMemoryNotes(), []);
  const first = saveMemoryNote({ label: "Gaya jawaban", text: "Suka jawaban ringkas" });
  assert.equal(first.ok, true);
  const second = saveMemoryNote({ label: "Proyek", text: "Aplikasi MyAI" });
  assert.equal(second.ok, true);
  const notes = getMemoryNotes();
  assert.equal(notes.length, 2);
  assert.equal(notes.some((note) => note.id === second.note.id), true);
  assert.equal(notes[0].createdAt >= notes[1].createdAt, true);
  assert.deepEqual(notes.map((note) => note.label).sort(), ["Gaya jawaban", "Proyek"]);
});

test("saving an empty note fails without touching storage", () => {
  storage.clear();
  const result = saveMemoryNote({ text: "   " });
  assert.equal(result.ok, false);
  assert.equal(getMemoryNotes().length, 0);
});

test("notes are capped to the configured length and count", () => {
  storage.clear();
  const longText = "x".repeat(MEMORY_LIMITS.maxText + 500);
  const longLabel = "l".repeat(MEMORY_LIMITS.maxLabel + 50);
  const saved = saveMemoryNote({ label: longLabel, text: longText });
  assert.equal(saved.ok, true);
  assert.equal(saved.note.text.length, MEMORY_LIMITS.maxText);
  assert.equal(saved.note.label.length, MEMORY_LIMITS.maxLabel);
  for (let index = 0; index < MEMORY_LIMITS.maxNotes + 5; index += 1) {
    saveMemoryNote({ text: `catatan ${index}` });
  }
  assert.equal(getMemoryNotes().length, MEMORY_LIMITS.maxNotes);
});

test("deleting a note removes only that note", () => {
  storage.clear();
  const a = saveMemoryNote({ text: "A" });
  const b = saveMemoryNote({ text: "B" });
  assert.equal(deleteMemoryNote(a.note.id).ok, true);
  assert.deepEqual(getMemoryNotes().map((note) => note.text), ["B"]);
  assert.equal(deleteMemoryNote(b.note.id).ok, true);
  assert.deepEqual(getMemoryNotes(), []);
  assert.equal(deleteMemoryNote("").ok, false);
});

test("memorySystemContext injects notes and honours the compact limit", () => {
  storage.clear();
  saveMemoryNote({ label: "Bahasa", text: "Selalu jawab dalam bahasa Indonesia" });
  saveMemoryNote({ label: "Nama", text: "Panggil saya Budi" });
  const context = memorySystemContext();
  assert.match(context, /\[Bahasa\] Selalu jawab/);
  assert.match(context, /\[Nama\] Panggil saya Budi/);
  const compact = memorySystemContext({ compact: true });
  assert.match(compact, /Bahasa/);
  assert.equal(memorySystemContext().length > 0, true);
  storage.clear();
  assert.equal(memorySystemContext(), "");
});

test("memoryCandidateFromReply trims whitespace and caps length", () => {
  const candidate = memoryCandidateFromReply("  Jawaban  penting \n untuk diingat.  ", "  Pertanyaan singkat?  ");
  assert.equal(candidate.text, "Jawaban penting untuk diingat.");
  assert.equal(candidate.label, "Pertanyaan singkat?");
  const long = memoryCandidateFromReply("x".repeat(3000));
  assert.equal(long.text.length, MEMORY_LIMITS.maxText);
  assert.equal(memoryCandidateFromReply("   "), null);
});

test("corrupted storage falls back to an empty list", () => {
  storage.clear();
  storage.set("myai_memory_notes_v1", "{bukan json");
  assert.deepEqual(getMemoryNotes(), []);
  storage.clear();
});
