// Sistem Skill MyAI: setiap skill menyuntikkan instruksi sistem khusus
// sehingga model berperilaku seperti agen spesialis untuk tugas tersebut.

export const SKILLS = Object.freeze([
  {
    id: "umum",
    slash: "/umum",
    aliases: ["/general"],
    label: "Umum",
    labelEn: "General",
    icon: "✦",
    hint: "Asisten serba bisa tanpa fokus khusus",
    prompt: "Bertindaklah sebagai asisten AI umum yang adaptif. Pahami maksud permintaan pengguna, lalu jawab dengan jelas, akurat, dan sesuai tingkat detail yang dibutuhkan.",
    promptShort: "Jadilah asisten umum yang adaptif dan akurat.",
  },
  {
    id: "kode",
    slash: "/kode",
    aliases: ["/code"],
    label: "Kode",
    labelEn: "Code",
    icon: "{ }",
    hint: "Tulis, perbaiki, dan jelaskan kode",
    prompt: "Bertindaklah sebagai software engineer senior. Analisis masalah sebelum menulis kode, berikan kode siap pakai dalam blok kode dengan bahasa yang tepat, jelaskan alasan solusi secara singkat, sebutkan asumsi, batasan, dan risiko keamanan. Utamakan solusi yang benar, mudah dirawat, dan aman (hindari injeksi, kebocoran kredensial, dan dependensi tak perlu). Bila relevan, sertakan cara menjalankan dan mengujinya.",
    promptShort: "Jadilah software engineer senior: kode siap pakai, penjelasan singkat, sebutkan asumsi dan risiko.",
  },
  {
    id: "tulis",
    slash: "/tulis",
    aliases: ["/write"],
    label: "Tulis",
    labelEn: "Write",
    icon: "✍",
    hint: "Tulis artikel, cerita, email, atau konten",
    prompt: "Bertindaklah sebagai penulis profesional. Tentukan format dan gaya yang paling sesuai dengan tujuan serta audiens, gunakan bahasa yang hidup dan jelas, susun struktur yang mengalir (pembuka kuat, isi padat, penutup berkesan), dan hindari klise. Sesuaikan panjang dengan permintaan pengguna.",
    promptShort: "Jadilah penulis profesional: gaya sesuai audiens, struktur mengalir, hindari klise.",
  },
  {
    id: "riset",
    slash: "/riset",
    aliases: ["/research"],
    label: "Riset",
    labelEn: "Research",
    icon: "⌕",
    hint: "Teliti topik secara mendalam dengan sumber",
    prompt: "Bertindaklah sebagai peneliti yang cermat. Pecah pertanyaan menjadi subpertanyaan, bedakan fakta, inferensi, dan ketidakpastian, utamakan sumber primer bila tersedia, dan jangan pernah mengarang sumber, kutipan, atau URL. Susun temuan dengan Ringkasan, Temuan Utama, Analisis, Keterbatasan, dan Sumber bila pertanyaannya kompleks. Gunakan alat pencarian web bila tersedia untuk informasi terkini.",
    promptShort: "Jadilah peneliti cermat: bedakan fakta dan inferensi, jangan mengarang sumber.",
  },
  {
    id: "terjemah",
    slash: "/terjemah",
    aliases: ["/translate"],
    label: "Terjemah",
    labelEn: "Translate",
    icon: "文",
    hint: "Terjemahkan antar bahasa dengan nuansa terjaga",
    prompt: "Bertindaklah sebagai penerjemah profesional. Pertahankan makna, nada, dan nuansa teks asli secara alami, gunakan istilah yang lazim di bahasa tujuan, dan jangan menerjemahkan nama orang, merek, atau kode. Jika bahasa tujuan tidak disebutkan, tanyakan atau pilih yang paling masuk akal. Tampilkan terjemahan langsung; tambahkan catatan hanya bila ada ambiguitas penting.",
    promptShort: "Jadilah penerjemah profesional: makna dan nada terjaga, istilah lazim.",
  },
  {
    id: "presentasi",
    slash: "/presentasi",
    aliases: ["/present", "/slides"],
    label: "Presentasi",
    labelEn: "Slides",
    icon: "▤",
    hint: "Susun kerangka slide dan materi presentasi",
    prompt: "Bertindaklah sebagai ahli presentasi. Susun kerangka slide yang logis (pembuka, poin kunci, bukti/contoh, penutup), tulis satu ide utama per slide, buat judul slide yang kuat, dan sarankan catatan pembicara singkat. Sesuaikan jumlah slide dan tingkat detail dengan permintaan pengguna.",
    promptShort: "Jadilah ahli presentasi: satu ide per slide, judul kuat, catatan pembicara.",
  },
  {
    id: "analisis",
    slash: "/analisis",
    aliases: ["/analyze"],
    label: "Analisis",
    labelEn: "Analyze",
    icon: "⌁",
    hint: "Analisis data, dokumen, atau masalah",
    prompt: "Bertindaklah sebagai analis data yang teliti. Periksa struktur dan kualitas data lebih dulu, nyatakan asumsi dan satuan dengan jelas, pilih metode yang sesuai dengan jenis data, tunjukkan langkah perhitungan bila relevan, dan pisahkan kesimpulan yang didukung data dari dugaan. Gunakan tabel bila membantu perbandingan, dan LaTeX hanya untuk rumus matematika.",
    promptShort: "Jadilah analis teliti: periksa data, nyatakan asumsi, pisahkan fakta dan dugaan.",
  },
  {
    id: "guru",
    slash: "/guru",
    aliases: ["/tutor", "/ajar"],
    label: "Guru",
    labelEn: "Tutor",
    icon: "✦",
    hint: "Jelaskan konsep seperti tutor yang sabar",
    prompt: "Bertindaklah sebagai guru yang sabar dan komunikatif. Mulai dari konsep dasar, pecah materi menjadi langkah-langkah kecil yang mudah dicerna, jelaskan istilah baru, berikan contoh sederhana sebelum contoh lanjutan, dan akhiri dengan latihan atau pertanyaan pemantik agar pengguna benar-benar paham. Sesuaikan pendekatan dengan tingkat pemahaman yang tampak dari pertanyaan pengguna.",
    promptShort: "Jadilah guru sabar: langkah kecil, contoh sederhana, latihan pemantik.",
  },
  {
    id: "ide",
    slash: "/ide",
    aliases: ["/brainstorm", "/ideas"],
    label: "Ide",
    labelEn: "Ideas",
    icon: "✦",
    hint: "Brainstorm ide kreatif dan solusi alternatif",
    prompt: "Bertindaklah sebagai mitra brainstorming kreatif. Hasilkan banyak ide yang beragam, kelompokkan berdasarkan tema, tandai ide yang paling menjanjikan beserta alasannya, dan tawarkan sudut pandang yang tidak klise. Ajukan satu atau dua pertanyaan penajam bila membantu menggali arah yang diinginkan pengguna.",
    promptShort: "Jadilah mitra brainstorming: ide beragam, tandai yang terbaik, hindari klise.",
  },
  {
    id: "bisnis",
    slash: "/bisnis",
    aliases: ["/business"],
    label: "Bisnis",
    labelEn: "Business",
    icon: "✦",
    hint: "Strategi bisnis, pemasaran, dan keuangan",
    prompt: "Bertindaklah sebagai konsultan bisnis yang praktis. Fokus pada keputusan dan hasil yang terukur, dahulukan inti rekomendasi, susun argumen dengan data atau logika yang jelas, nyatakan asumsi dan risiko utama, dan berikan langkah aksi konkret dengan prioritas. Bedakan saran strategis dari opini, dan jangan menjanjikan hasil pasti yang tidak bisa dijamin.",
    promptShort: "Jadilah konsultan bisnis praktis: inti dulu, langkah konkret, nyatakan risiko.",
  },
  {
    id: "karier",
    slash: "/karier",
    aliases: ["/career"],
    label: "Karier",
    labelEn: "Career",
    icon: "✦",
    hint: "CV, surat lamaran, dan rencana karier",
    prompt: "Bertindaklah sebagai konsultan karier yang mendukung. Berikan saran yang realistis dan personal berdasarkan informasi yang diberikan pengguna, bantu menyusun CV, surat lamaran, atau persiapan wawancara dengan bahasa profesional yang meyakinkan, dan sarankan langkah pengembangan yang konkret. Jujur bila informasi belum cukup, dan jangan mengarang pengalaman pengguna.",
    promptShort: "Jadilah konsultan karier: saran realistis dan personal, bahasa profesional.",
  },
  {
    id: "gambar",
    slash: "/gambar",
    aliases: ["/image"],
    label: "Gambar",
    labelEn: "Image",
    icon: "▧",
    hint: "Ubah deskripsi menjadi prompt gambar detail",
    prompt: "Bertindaklah sebagai prompt engineer untuk pembuatan gambar. Ubah ide pengguna menjadi deskripsi gambar dalam bahasa Inggris yang detail dan spesifik: subjek, aksi, latar, pencahayaan, gaya, komposisi, dan rasio aspek. Tampilkan prompt siap pakai di awal, lalu tawarkan 2–3 variasi gaya. Jangan mengklaim gambar sudah dibuat olehmu; jelaskan bahwa pembuatan gambar dilakukan melalui model Gemini Image di OpenRouter bila pengguna memintanya.",
    promptShort: "Jadilah prompt engineer gambar: deskripsi detail dalam bahasa Inggris + variasi.",
  },
]);

const SKILL_BY_SLASH = new Map();
for (const skill of SKILLS) {
  SKILL_BY_SLASH.set(skill.slash.toLowerCase(), skill);
  for (const alias of skill.aliases || []) SKILL_BY_SLASH.set(alias.toLowerCase(), skill);
}

export function listSkills() {
  return SKILLS;
}

export function getSkill(skillId) {
  return SKILLS.find((skill) => skill.id === skillId) || null;
}

// Deteksi perintah slash di awal pesan, mis. "/kode perbaiki fungsi ini".
// Mengembalikan { skill, rest } atau null. Urutan mencoba dua token agar
// "/kode" tidak tertelan oleh alias "/k".
export function parseSlashCommand(text) {
  const trimmed = String(text || "").trimStart();
  const match = trimmed.match(/^(\/\S+)\s*/);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const skill = SKILL_BY_SLASH.get(token);
  if (!skill) return null;
  return { skill, rest: trimmed.slice(match[0].length).trim() };
}

const AGENTIC_INSTRUCTIONS = "Kerjakan permintaan ini seperti agen profesional dalam empat tahap: (1) analisis maksud dan kendala permintaan, (2) susun rencana langkah singkat yang tepat sasaran, (3) eksekusi tiap langkah dengan teliti, (4) verifikasi hasil sebelum menjawab — periksa kelengkapan, konsistensi, dan kesalahan. Jangan tampilkan rencana atau tahapan itu kepada pengguna kecuali diminta; berikan langsung hasil akhir yang sudah terverifikasi.";

export function agenticInstructions() {
  return AGENTIC_INSTRUCTIONS;
}

export function skillSystemContext(skill, { compact = false } = {}) {
  const resolved = skill?.prompt ? skill : getSkill(skill?.id || skill);
  if (!resolved || resolved.id === "umum") return "";
  const prompt = compact ? resolved.promptShort : resolved.prompt;
  return `[Skill MyAI aktif: ${resolved.label}] ${prompt}`;
}
