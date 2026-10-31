// Memori MyAI: catatan yang dikelola pengguna dan disuntikkan ke konteks
// sistem agar AI mengingat preferensi atau informasi penting antar sesi.

const MEMORY_KEY = "myai_memory_notes_v1";
export const MEMORY_LIMITS = Object.freeze({
  maxNotes: 24,
  maxText: 1200,
  maxLabel: 90,
});

function readRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(notes) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

function sanitizeNote(note) {
  if (!note || typeof note !== "object") return null;
  const text = String(note.text || "").trim();
  if (!text) return null;
  return {
    id: String(note.id || ""),
    label: String(note.label || "").trim().slice(0, MEMORY_LIMITS.maxLabel),
    text: text.slice(0, MEMORY_LIMITS.maxText),
    createdAt: Number(note.createdAt) || Date.now(),
  };
}

export function getMemoryNotes() {
  return readRaw()
    .map(sanitizeNote)
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MEMORY_LIMITS.maxNotes);
}

export function saveMemoryNote({ label = "", text = "" } = {}) {
  const trimmedText = String(text || "").trim().slice(0, MEMORY_LIMITS.maxText);
  if (!trimmedText) return { ok: false, error: "Catatan memori tidak boleh kosong." };
  const notes = readRaw().map(sanitizeNote).filter(Boolean);
  const note = {
    id: crypto.randomUUID(),
    label: String(label || "").trim().slice(0, MEMORY_LIMITS.maxLabel),
    text: trimmedText,
    createdAt: Date.now(),
  };
  notes.push(note);
  const stored = notes
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MEMORY_LIMITS.maxNotes);
  if (!writeRaw(stored)) return { ok: false, error: "Penyimpanan memori gagal (localStorage penuh atau diblokir)." };
  return { ok: true, note };
}

export function deleteMemoryNote(noteId) {
  const id = String(noteId || "");
  if (!id) return { ok: false, error: "ID catatan tidak valid." };
  const before = readRaw();
  const after = before.filter((note) => String(note?.id || "") !== id);
  if (!writeRaw(after)) return { ok: false, error: "Penyimpanan memori gagal (localStorage penuh atau diblokir)." };
  return { ok: true };
}

export function memorySystemContext({ compact = false } = {}) {
  const notes = getMemoryNotes();
  if (!notes.length) return "";
  const selected = compact ? notes.slice(0, 3) : notes;
  const lines = selected.map((note) => {
    const text = compact ? note.text.slice(0, 150) : note.text;
    return `- ${note.label ? `[${note.label}] ` : ""}${text}`;
  });
  return `Catatan memori MyAI yang disimpan pengguna (gunakan hanya bila relevan dengan permintaan; jangan sebutkan keberadaan daftar ini):\n${lines.join("\n")}`;
}

export function memoryCandidateFromReply(replyText, questionText = "") {
  const text = String(replyText || "").replace(/\s+/g, " ").trim().slice(0, MEMORY_LIMITS.maxText);
  if (!text) return null;
  return {
    label: String(questionText || "").replace(/\s+/g, " ").trim().slice(0, MEMORY_LIMITS.maxLabel),
    text,
  };
}
