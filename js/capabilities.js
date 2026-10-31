// Katalog 150 Kemampuan MyAI (bukan 150 model): setiap kemampuan dipetakan ke
// mesin yang bisa melayaninya — Cloud, WebGPU (lokal), atau Ollama (lokal).
// Format baris: [kategori, id, label, deskripsi, mesin]
// Kode mesin: c = cloud, w = webgpu, o = ollama.

const RAW_CAPABILITIES = [
  // ── Percakapan & Asisten ────────────────────────────────────────────────
  ["Percakapan & Asisten", "tanya-jawab", "Tanya jawab umum", "Menjawab pertanyaan sehari-hari dan pengetahuan umum.", "cwo"],
  ["Percakapan & Asisten", "percakapan-santai", "Ngobrol santai", "Percakapan ringan dan ramah tanpa format khusus.", "cwo"],
  ["Percakapan & Asisten", "asisten-harian", "Asisten harian", "Membantu rencana harian, ide kecil, dan pengingat.", "cwo"],
  ["Percakapan & Asisten", "ringkas-teks", "Merangkum teks", "Meringkas artikel, catatan, atau dokumen menjadi poin inti.", "cwo"],
  ["Percakapan & Asisten", "tanya-lanjutan", "Tanya lanjutan", "Menjawab pertanyaan lanjutan dengan konteks percakapan.", "cwo"],
  ["Percakapan & Asisten", "penjelasan-cepat", "Penjelasan cepat", "Menjelaskan topik rumit dengan bahasa sederhana (ELI5).", "cwo"],
  ["Percakapan & Asisten", "saran-produk", "Rekomendasi & saran", "Memberi rekomendasi produk, alat, atau pilihan dengan alasan.", "cw"],
  ["Percakapan & Asisten", "curah-pendapat", "Curah pendapat cepat", "Menghasilkan banyak ide cepat untuk satu topik.", "cwo"],
  ["Percakapan & Asisten", "motivasi", "Motivasi & refleksi", "Dukungan motivasi dan refleksi diri yang membangun.", "cwo"],
  ["Percakapan & Asisten", "roleplay", "Simulasi percakapan", "Berlatih percakapan lewat roleplay (wawancara, negosiasi, dll).", "cwo"],
  ["Percakapan & Asisten", "persona-asisten", "Persona khusus", "Menjawab sebagai karakter atau persona yang ditentukan.", "cwo"],
  ["Percakapan & Asisten", "jawab-multibahasa", "Jawab multibahasa", "Menjawab dan beralih bahasa sesuai permintaan.", "cwo"],
  ["Percakapan & Asisten", "klarifikasi", "Klarifikasi pertanyaan", "Mengenali pertanyaan ambigu dan meminta klarifikasi tepat.", "cwo"],

  // ── Koding & Teknologi ──────────────────────────────────────────────────
  ["Koding & Teknologi", "tulis-kode", "Menulis kode baru", "Menulis kode siap pakai dalam bahasa yang diminta.", "cw"],
  ["Koding & Teknologi", "perbaiki-bug", "Perbaiki bug", "Mencari akar masalah error dan memberi perbaikan.", "cw"],
  ["Koding & Teknologi", "jelaskan-kode", "Menjelaskan kode", "Menjelaskan cara kerja potongan kode langkah demi langkah.", "cwo"],
  ["Koding & Teknologi", "review-kode", "Review kode", "Menilai kualitas, keterbacaan, dan keamanan kode.", "cw"],
  ["Koding & Teknologi", "refactor-kode", "Refactor & optimasi", "Menyederhanakan dan mempercepat kode tanpa mengubah perilaku.", "cw"],
  ["Koding & Teknologi", "tes-unit", "Menulis unit test", "Membuat test otomatis untuk fungsi atau modul.", "cw"],
  ["Koding & Teknologi", "sql-query", "Menulis query SQL", "Menyusun query SQL untuk membaca atau mengubah data.", "cw"],
  ["Koding & Teknologi", "regex", "Membuat regex", "Membuat pola regex beserta penjelasannya.", "cwo"],
  ["Koding & Teknologi", "algoritma", "Algoritma & struktur data", "Menjelaskan dan menulis algoritma serta struktur data.", "cwo"],
  ["Koding & Teknologi", "api-integrasi", "Integrasi API", "Membantu memanggil dan mengolah respons API.", "cw"],
  ["Koding & Teknologi", "desain-sistem", "Desain sistem", "Merancang arsitektur sistem berskala dengan trade-off.", "c"],
  ["Koding & Teknologi", "devops-ci", "Skrip DevOps & CI/CD", "Menyusun pipeline CI/CD dan skrip otomasi deploy.", "cw"],
  ["Koding & Teknologi", "keamanan-web", "Audit keamanan web", "Meninjau kerentanan umum (injeksi, XSS, auth) dan perbaikannya.", "c"],
  ["Koding & Teknologi", "konversi-bahasa", "Konversi bahasa program", "Menerjemahkan kode antar bahasa pemrograman.", "cw"],
  ["Koding & Teknologi", "dokumentasi-kode", "Dokumentasi kode", "Menulis komentar, docstring, dan README yang jelas.", "cwo"],

  // ── Menulis & Konten ────────────────────────────────────────────────────
  ["Menulis & Konten", "artikel", "Artikel & blog", "Menulis artikel terstruktur dengan pembuka, isi, dan penutup.", "cw"],
  ["Menulis & Konten", "cerpen", "Cerita pendek", "Menulis cerita fiksi dengan alur dan karakter hidup.", "cw"],
  ["Menulis & Konten", "email", "Email profesional", "Menyusun email formal atau semi-formal yang efektif.", "cwo"],
  ["Menulis & Konten", "media-sosial", "Caption media sosial", "Menulis caption dan postingan untuk platform sosial.", "cwo"],
  ["Menulis & Konten", "iklan-teks", "Copywriting iklan", "Menulis teks iklan persuasif untuk produk atau layanan.", "cw"],
  ["Menulis & Konten", "skenario-video", "Skenario video", "Menyusun naskah video pendek, YouTube, atau reel.", "cw"],
  ["Menulis & Konten", "puisi", "Puisi & sastra", "Menulis puisi dan karya sastra sesuai gaya yang diminta.", "cw"],
  ["Menulis & Konten", "esai", "Esai & opini", "Menulis esai argumentatif dengan struktur yang kuat.", "cw"],
  ["Menulis & Konten", "proposal", "Proposal & pengajuan", "Menyusun proposal proyek, dana, atau kerja sama.", "cw"],
  ["Menulis & Konten", "laporan", "Laporan & ringkasan eksekutif", "Merangkum hasil kerja menjadi laporan yang rapi.", "cw"],
  ["Menulis & Konten", "perbaiki-tulisan", "Edit & poles tulisan", "Memperbaiki tata bahasa, alur, dan gaya tulisan.", "cwo"],
  ["Menulis & Konten", "parafrase", "Parafrase", "Menulis ulang kalimat dengan makna sama tanpa plagiat.", "cwo"],
  ["Menulis & Konten", "judul-menarik", "Judul & headline", "Membuat judul menarik untuk artikel atau konten.", "cwo"],
  ["Menulis & Konten", "naskah-pidato", "Naskah pidato", "Menyusun pidato atau sambutan dengan nada yang tepat.", "cw"],
  ["Menulis & Konten", "newsletter", "Newsletter", "Menulis konten rutin untuk buletin email.", "cw"],

  // ── Riset & Informasi ───────────────────────────────────────────────────
  ["Riset & Informasi", "riset-web", "Riset dengan sumber", "Meneliti topik dengan pencarian web dan sitasi sumber.", "c"],
  ["Riset & Informasi", "perbandingan", "Perbandingan", "Membandingkan produk, konsep, atau pilihan secara objektif.", "cw"],
  ["Riset & Informasi", "fakta-cek", "Cek fakta", "Memverifikasi klaim dengan sumber yang dapat ditelusuri.", "c"],
  ["Riset & Informasi", "tren-terkini", "Tren & berita", "Merangkum perkembangan dan tren terbaru suatu topik.", "c"],
  ["Riset & Informasi", "paper-akademik", "Bantuan makalah akademik", "Membantu struktur, argumen, dan tinjauan pustaka makalah.", "c"],
  ["Riset & Informasi", "kutipan-sumber", "Sitasi & daftar pustaka", "Menyusun kutipan dan daftar pustaka sesuai gaya (APA, MLA).", "c"],
  ["Riset & Informasi", "deep-research", "Riset mendalam", "Riset multi-langkah: pecah pertanyaan, telusuri, sintesis.", "c"],
  ["Riset & Informasi", "definisi-istilah", "Istilah & konsep", "Menjelaskan istilah teknis dengan contoh sederhana.", "cwo"],
  ["Riset & Informasi", "sejarah", "Konteks sejarah", "Menjelaskan peristiwa sejarah dan konteksnya.", "cwo"],
  ["Riset & Informasi", "hukum-regulasi", "Info hukum umum", "Menjelaskan aturan umum; bukan pengganti nasihat hukum.", "c"],
  ["Riset & Informasi", "sains-populer", "Sains populer", "Menjelaskan fenomena sains dengan bahasa sehari-hari.", "cwo"],
  ["Riset & Informasi", "pasar-riset", "Riset pasar", "Menyusun gambaran pasar, segmen, dan kompetitor.", "c"],
  ["Riset & Informasi", "roadmap-topic", "Roadmap belajar", "Menyusun peta belajar bertahap untuk satu topik.", "cwo"],

  // ── Analisis & Data ─────────────────────────────────────────────────────
  ["Analisis & Data", "analisis-data", "Analisis data", "Membaca pola dan menarik kesimpulan dari data.", "c"],
  ["Analisis & Data", "statistik", "Statistik deskriptif", "Menghitung rata-rata, median, dan ukuran sebaran.", "cw"],
  ["Analisis & Data", "excel-formula", "Formula Excel/Sheets", "Menyusun formula spreadsheet yang benar.", "cwo"],
  ["Analisis & Data", "visualisasi-data", "Saran visualisasi", "Menyarankan grafik yang tepat untuk data tertentu.", "cw"],
  ["Analisis & Data", "klasifikasi-teks", "Klasifikasi teks", "Mengelompokkan teks ke kategori yang ditentukan.", "cw"],
  ["Analisis & Data", "sentimen", "Analisis sentimen", "Menilai nada positif, negatif, atau netral sebuah teks.", "cw"],
  ["Analisis & Data", "ekstraksi-data", "Ekstraksi data", "Mengambil data terstruktur dari teks bebas.", "cw"],
  ["Analisis & Data", "prediksi-sederhana", "Estimasi sederhana", "Estimasi kuantitatif dengan asumsi yang jelas.", "cw"],
  ["Analisis & Data", "cleaning-data", "Pembersihan data", "Merapikan data duplikat, kosong, atau tidak konsisten.", "cw"],
  ["Analisis & Data", "laporan-data", "Narasi dari angka", "Mengubah angka menjadi cerita dan rekomendasi.", "cw"],
  ["Analisis & Data", "csv-json", "Olah CSV/JSON", "Mengubah, memfilter, dan meringkas data CSV/JSON.", "cw"],
  ["Analisis & Data", "tabel-perbandingan", "Tabel perbandingan", "Menyusun tabel perbandingan yang mudah dibaca.", "cwo"],
  ["Analisis & Data", "keputusan", "Analisis keputusan", "Menimbang pro-kontra dan risiko sebuah keputusan.", "cw"],

  // ── Pendidikan & Belajar ────────────────────────────────────────────────
  ["Pendidikan & Belajar", "tutor-matematika", "Tutor matematika", "Menjelaskan konsep dan soal matematika langkah demi langkah.", "cw"],
  ["Pendidikan & Belajar", "tutor-bahasa", "Belajar bahasa asing", "Latihan kosakata, tata bahasa, dan percakapan bahasa asing.", "cwo"],
  ["Pendidikan & Belajar", "jelaskan-konsep", "Penjelasan konsep", "Menguraikan materi pelajaran dengan contoh sederhana.", "cwo"],
  ["Pendidikan & Belajar", "latihan-soal", "Latihan soal", "Membuat latihan soal beserta kunci jawabannya.", "cw"],
  ["Pendidikan & Belajar", "flashcard", "Flashcard & hafalan", "Membuat kartu hafalan dan ringkasan poin kunci.", "cwo"],
  ["Pendidikan & Belajar", "fisika-kimia", "Fisika & kimia", "Menjelaskan konsep fisika dan kimia beserta rumusnya.", "cw"],
  ["Pendidikan & Belajar", "biologi-kesehatan", "Biologi & kesehatan umum", "Menjelaskan biologi dan info kesehatan umum (bukan diagnosis).", "cw"],
  ["Pendidikan & Belajar", "sejarah-pelajaran", "Materi sejarah", "Menyusun materi sejarah dengan kronologi yang jelas.", "cwo"],
  ["Pendidikan & Belajar", "ekonomi-akuntansi", "Ekonomi & akuntansi dasar", "Menjelaskan konsep ekonomi dan pencatatan akuntansi dasar.", "cw"],
  ["Pendidikan & Belajar", "persiapan-ujian", "Persiapan ujian", "Menyusun strategi dan simulasi persiapan ujian.", "cw"],
  ["Pendidikan & Belajar", "belajar-mandiri", "Rencana belajar mandiri", "Membuat jadwal dan target belajar yang realistis.", "cwo"],
  ["Pendidikan & Belajar", "literasi-digital", "Literasi digital", "Menjelaskan keamanan internet dan penggunaan alat digital.", "cwo"],
  ["Pendidikan & Belajar", "coding-pemula", "Belajar coding pemula", "Mengajarkan dasar pemrograman dengan contoh bertahap.", "cw"],

  // ── Bisnis & Karier ─────────────────────────────────────────────────────
  ["Bisnis & Karier", "rencana-bisnis", "Rencana bisnis", "Menyusun rencana bisnis: visi, model, pasar, keuangan.", "c"],
  ["Bisnis & Karier", "strategi-pemasaran", "Strategi pemasaran", "Merancang strategi pemasaran dan saluran promosi.", "cw"],
  ["Bisnis & Karier", "analisis-swot", "Analisis SWOT", "Menyusun kekuatan, kelemahan, peluang, dan ancaman.", "cw"],
  ["Bisnis & Karier", "cv-lamaran", "CV & surat lamaran", "Menyusun CV dan surat lamaran yang meyakinkan.", "cw"],
  ["Bisnis & Karier", "persiapan-wawancara", "Simulasi wawancara", "Latihan tanya jawab wawancara kerja beserta umpan balik.", "cw"],
  ["Bisnis & Karier", "negosiasi", "Persiapan negosiasi", "Menyiapkan argumen dan skenario negosiasi.", "cw"],
  ["Bisnis & Karier", "pitch-deck", "Kerangka pitch deck", "Menyusun alur slide untuk presentasi ke investor.", "c"],
  ["Bisnis & Karier", "keuangan-pribadi", "Keuangan pribadi", "Edukasi pengelolaan keuangan; bukan nasihat investasi personal.", "cw"],
  ["Bisnis & Karier", "harga-produk", "Strategi harga", "Membantu menentukan strategi harga produk atau layanan.", "cw"],
  ["Bisnis & Karier", "email-bisnis", "Email bisnis", "Menulis email bisnis, follow-up, dan balasan klien.", "cwo"],
  ["Bisnis & Karier", "manajemen-proyek", "Perencanaan proyek", "Menyusun timeline, milestone, dan pembagian tugas.", "cw"],
  ["Bisnis & Karier", "kpi-okr", "Susun KPI/OKR", "Merumuskan target terukur untuk tim atau pribadi.", "cw"],
  ["Bisnis & Karier", "deskripsi-pekerjaan", "Deskripsi pekerjaan", "Menulis deskripsi lowongan dan kriteria kandidat.", "cw"],
  ["Bisnis & Karier", "roadmap-karier", "Rencana karier", "Menyusun rencana pengembangan karier bertahap.", "cw"],

  // ── Kreativitas & Desain ────────────────────────────────────────────────
  ["Kreativitas & Desain", "ide-nama", "Nama brand & produk", "Mencari nama yang unik, mudah diingat, dan bermakna.", "cwo"],
  ["Kreativitas & Desain", "slogan", "Slogan & tagline", "Membuat slogan pendek yang melekat di ingatan.", "cwo"],
  ["Kreativitas & Desain", "ide-konten", "Ide konten", "Menyusun ide dan kalender konten mingguan/bulanan.", "cw"],
  ["Kreativitas & Desain", "konsep-kampanye", "Konsep kampanye", "Merancang tema dan pesan utama sebuah kampanye.", "cw"],
  ["Kreativitas & Desain", "storyboard", "Storyboard & shot list", "Menyusun urutan adegan dan daftar pengambilan gambar.", "cw"],
  ["Kreativitas & Desain", "desain-prompt", "Prompt desain", "Menulis deskripsi detail untuk alat desain dan AI gambar.", "cw"],
  ["Kreativitas & Desain", "ide-produk", "Ide produk baru", "Brainstorm fitur dan produk dari masalah pengguna.", "cw"],
  ["Kreativitas & Desain", "lirik-lagu", "Lirik lagu", "Menulis lirik dengan rima dan tema yang diminta.", "cw"],
  ["Kreativitas & Desain", "ide-acara", "Konsep acara", "Merancang tema, rundown, dan konsep sebuah acara.", "cw"],
  ["Kreativitas & Desain", "worldbuilding", "Worldbuilding", "Membangun dunia fiksi: aturan, sejarah, dan budaya.", "cw"],
  ["Kreativitas & Desain", "karakter-fiksi", "Karakter fiksi", "Mengembangkan profil dan motivasi karakter cerita.", "cw"],
  ["Kreativitas & Desain", "moodboard-deskripsi", "Deskripsi moodboard", "Menyusun deskripsi referensi visual untuk moodboard.", "cw"],

  // ── Gambar & Visual ─────────────────────────────────────────────────────
  ["Gambar & Visual", "prompt-gambar", "Prompt gambar detail", "Mengubah ide menjadi deskripsi gambar yang spesifik.", "cw"],
  ["Gambar & Visual", "edit-gambar", "Instruksi edit gambar", "Menjelaskan langkah edit foto atau ilustrasi.", "c"],
  ["Gambar & Visual", "deskripsi-gambar", "Deskripsi gambar", "Mendeskripsikan isi gambar yang dilampirkan (vision).", "c"],
  ["Gambar & Visual", "ocr-teks", "Baca teks dari gambar", "Mengekstrak teks dari foto atau tangkapan layar (OCR).", "c"],
  ["Gambar & Visual", "analisis-visual", "Analisis visual", "Menganalisis grafik, diagram, atau foto yang dilampirkan.", "c"],
  ["Gambar & Visual", "palet-warna", "Palet warna", "Menyusun skema warna yang harmonis untuk proyek.", "cwo"],
  ["Gambar & Visual", "rasio-komposisi", "Komposisi & rasio", "Memberi saran komposisi dan rasio aspek visual.", "cwo"],
  ["Gambar & Visual", "gaya-seni", "Eksplorasi gaya seni", "Menjelaskan dan menyarankan gaya seni visual.", "cw"],
  ["Gambar & Visual", "ui-ux-copy", "Copy UI/UX", "Menulis microcopy tombol, pesan error, dan panduan.", "cw"],
  ["Gambar & Visual", "infografis", "Kerangka infografis", "Menyusun alur dan poin untuk infografis.", "cw"],
  ["Gambar & Visual", "logo-konsep", "Konsep logo", "Menjabarkan konsep logo: bentuk, simbol, dan warna.", "cw"],
  ["Gambar & Visual", "variasi-gambar", "Variasi prompt gambar", "Membuat beberapa variasi gaya dari satu ide gambar.", "cw"],

  // ── Suara & Media ───────────────────────────────────────────────────────
  ["Suara & Media", "transkripsi-audio", "Transkripsi suara", "Mengubah rekaman suara menjadi teks.", "c"],
  ["Suara & Media", "voice-assistant", "Asisten suara langsung", "Percakapan suara real-time (Gemini Live).", "c"],
  ["Suara & Media", "teks-ke-ucapan", "Naskah untuk TTS", "Menyusun teks yang enak dibaca saat diucapkan.", "cwo"],
  ["Suara & Media", "subtitle-video", "Subtitle video", "Menyusun takarir dan terjemahan subtitle.", "cw"],
  ["Suara & Media", "naskah-podcast", "Naskah podcast", "Menulis naskah episode podcast dengan alur.", "cw"],
  ["Suara & Media", "analisis-audio", "Ringkas isi audio", "Meringkas isi rapat atau rekaman yang ditranskripsi.", "c"],
  ["Suara & Media", "pengisi-suara", "Arah pengisi suara", "Menulis catatan arah nada untuk pengisi suara.", "cw"],
  ["Suara & Media", "efek-suara", "Deskripsi efek suara", "Mendeskripsikan efek suara untuk produksi audio/video.", "cw"],
  ["Suara & Media", "musik-teori", "Teori musik", "Menjelaskan teori musik, akor, dan progresi.", "cwo"],
  ["Suara & Media", "media-rencana", "Rencana produksi media", "Menyusun rencana produksi konten audio/video.", "cw"],

  // ── Dokumen & File ──────────────────────────────────────────────────────
  ["Dokumen & File", "rangkum-pdf", "Ringkas PDF/dokumen", "Meringkas isi file PDF atau dokumen panjang.", "c"],
  ["Dokumen & File", "buat-pptx", "Susun slide presentasi", "Menyusun presentasi PPTX siap unduh.", "c"],
  ["Dokumen & File", "buat-docx", "Susun dokumen Word", "Menyusun dokumen DOCX terstruktur siap unduh.", "c"],
  ["Dokumen & File", "buat-xlsx", "Susun spreadsheet", "Menyusun tabel XLSX dengan formula dasar.", "c"],
  ["Dokumen & File", "terjemah-dokumen", "Terjemahkan dokumen", "Menerjemahkan dokumen dengan nuansa terjaga.", "cw"],
  ["Dokumen & File", "ekstrak-tabel", "Ekstrak tabel dari PDF", "Mengambil data tabel dari dokumen menjadi teks.", "c"],
  ["Dokumen & File", "konversi-format", "Konversi format teks", "Mengubah teks antar format (Markdown, HTML, CSV).", "cwo"],
  ["Dokumen & File", "periksa-kontrak", "Tinjau kontrak umum", "Menandai poin penting kontrak; bukan nasihat hukum.", "c"],
  ["Dokumen & File", "rapat-risalah", "Risalah rapat", "Menyusun notulen rapi dari catatan atau transkrip.", "cw"],
  ["Dokumen & File", "arsip-label", "Label & arsip file", "Menyarankan penamaan dan struktur folder arsip.", "cwo"],
  ["Dokumen & File", "dokumen-kolaborasi", "Draft kolaborasi", "Menyusun draft yang siap dikomentari tim.", "cw"],
  ["Dokumen & File", "template-dokumen", "Template dokumen", "Membuat template surat, laporan, atau formulir.", "cw"],

  // ── Produktivitas & Alat ────────────────────────────────────────────────
  ["Produktivitas & Alat", "to-do", "Pecah tugas jadi to-do", "Mengubah tugas besar menjadi langkah kecil yang jelas.", "cwo"],
  ["Produktivitas & Alat", "manajemen-waktu", "Jadwal & waktu", "Menyusun jadwal harian yang realistis.", "cwo"],
  ["Produktivitas & Alat", "prioritas-tugas", "Prioritas tugas", "Memilah tugas dengan matriks penting-mendesak.", "cwo"],
  ["Produktivitas & Alat", "email-draft", "Draft balasan email", "Membuat draft balasan email dari pesan yang diterima.", "cwo"],
  ["Produktivitas & Alat", "rapat-agenda", "Agenda rapat", "Menyusun agenda rapat yang fokus dan terukur.", "cwo"],
  ["Produktivitas & Alat", "keputusan-cepat", "Keputusan cepat", "Membandingkan pro-kontra untuk keputusan harian.", "cwo"],
  ["Produktivitas & Alat", "catatan-rapi", "Rapikan catatan", "Merapikan catatan acak menjadi terstruktur.", "cwo"],
  ["Produktivitas & Alat", "template-balasan", "Template balasan umum", "Membuat template balasan pesan yang sopan dan cepat.", "cwo"],
];

const ENGINE_BY_CODE = { c: "cloud", w: "webgpu", o: "ollama" };

export const CAPABILITIES = Object.freeze(RAW_CAPABILITIES.map(([category, id, label, hint, codes]) => Object.freeze({
  category,
  id,
  label,
  hint,
  engines: Object.freeze([...codes].map((code) => ENGINE_BY_CODE[code])),
})));

export const CAPABILITY_COUNT = CAPABILITIES.length;

export function listCapabilities() {
  return CAPABILITIES;
}

export function capabilityCategories() {
  return [...new Set(CAPABILITIES.map((capability) => capability.category))];
}

export function searchCapabilities(query = "", category = "") {
  const needle = String(query || "").trim().toLowerCase();
  return CAPABILITIES.filter((capability) => (
    (!category || capability.category === category)
    && (!needle
      || capability.label.toLowerCase().includes(needle)
      || capability.hint.toLowerCase().includes(needle)
      || capability.id.toLowerCase().includes(needle))
  ));
}
