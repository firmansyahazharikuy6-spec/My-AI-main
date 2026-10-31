const LANGUAGE_WORDS = {
  id: new Set([
    "aku", "air", "anda", "apa", "atau", "bagi", "bantu", "belajar", "belum", "berikan",
    "bisa", "buat", "bukan", "cara", "contoh", "dalam", "dampak", "dan", "dapat", "dengan",
    "dari", "dokumen", "gambar", "ingin", "ini", "jelaskan", "jika", "kamu", "ke", "kerja",
    "kesehatan", "lebih", "manfaat", "menjadi", "menjelaskan", "minum", "mohon", "pada",
    "perlu", "prompt", "putih", "rencana", "ringkas", "ringkasan", "saya", "sebagai", "sehat",
    "secara", "serta", "silakan", "tidak", "tolong", "tubuh", "untuk", "utama", "yang",
  ]),
  en: new Set([
    "a", "an", "and", "are", "as", "can", "create", "for", "help", "how", "i", "in", "is",
    "make", "me", "my", "of", "please", "the", "to", "with", "you", "your",
  ]),
};

const TASK_INTENTS = [
  {
    input: /\b(?:ringkas|rangkum|meringkas|merangkum|ringkasan|rangkuman|summari[sz]e|summary)\b/i,
    output: /\b(?:ringkas|rangkum|meringkas|merangkum|ringkasan|rangkuman|summari[sz]e|summary)\b/i,
  },
  {
    input: /\b(?:jelaskan|menjelaskan|uraikan|terangkan|explain|describe)\b/i,
    output: /\b(?:jelaskan|menjelaskan|uraikan|terangkan|explain|describe|explanation|description)\b/i,
  },
  {
    input: /\b(?:analisis|analisa|menganalisis|evaluasi|evaluate|analy[sz]e|analysis)\b/i,
    output: /\b(?:analisis|analisa|menganalisis|evaluasi|evaluate|analy[sz]e|analysis)\b/i,
  },
  {
    input: /\b(?:bandingkan|membandingkan|perbandingan|compare|comparison)\b/i,
    output: /\b(?:bandingkan|membandingkan|perbandingan|compare|comparison)\b/i,
  },
  {
    input: /\b(?:terjemahkan|terjemahan|translate|translation)\b/i,
    output: /\b(?:terjemahkan|terjemahan|translate|translation)\b/i,
  },
  {
    input: /\b(?:buat|bikin|ciptakan|rancang|susun|tulis|buatkan|create|make|write|draft|design|generate|plan)\b/i,
    output: /\b(?:buat|bikin|ciptakan|rancang|susun|tulis|buatkan|create|make|write|draft|design|generate|plan|rencana)\b/i,
  },
];

const PROMPT_HELPER_PROVIDER_ORDER = Object.freeze([
  "groq",
  "nvidia",
  "claude",
  "kimi",
  "openrouter",
]);

const PROMPT_DOMAINS = [
  {
    id: "web-development",
    match: /\b(?:web\s?site|web\s?app|landing\s?page|portfolio|portofolio|front[\s-]?end|frontend|web\s?page|situs\s?web|halaman\s?web|single[\s-]?page\s?app)\b/i,
    role: { en: "A senior front-end engineer and UI/UX designer", id: "Developer front-end senior sekaligus desainer UI/UX" },
    format: { en: "Deliver a complete, runnable website implementation, explain the key customization points, and include relevant verification and deployment guidance.", id: "Berikan implementasi website lengkap yang dapat dijalankan, jelaskan bagian penting untuk kustomisasi, dan sertakan verifikasi serta panduan deploy yang relevan." },
    success: { en: "Meet the stated requirements without omitting sections or interactions; ensure responsive, accessible, maintainable behavior; and be transparent about what was and was not tested.", id: "Penuhi persyaratan tanpa menghilangkan bagian atau interaksi; pastikan responsif, aksesibel, dan mudah dirawat; serta jelaskan dengan jujur hal yang sudah dan belum diuji." },
  },
  {
    id: "coding",
    match: /\b(?:code|coding|program|programming|debug|bug|function|api|software|test|refactor|kode|pemrograman|debug|galat|fungsi|uji|aplikasi)\b/i,
    role: { en: "A careful software engineer", id: "Insinyur perangkat lunak yang teliti" },
    format: { en: "Provide the requested implementation or diagnosis, focused reasoning, and relevant verification.", id: "Berikan implementasi atau diagnosis yang diminta, alasan seperlunya, dan verifikasi yang relevan." },
    success: { en: "Preserve existing behavior, state assumptions, and avoid claiming tests or execution that did not happen.", id: "Pertahankan perilaku yang ada, tandai asumsi, dan jangan mengaku telah menjalankan tes yang belum dijalankan." },
  },
  {
    id: "writing",
    match: /\b(?:write|writing|draft|edit|rewrite|email|blog|article|story|copy|caption|tulis|menulis|draf|sunting|artikel|cerita|konten|surat)\b/i,
    role: { en: "A thoughtful writer for the requested audience", id: "Penulis yang cermat untuk audiens yang diminta" },
    format: { en: "Deliver the requested text in its intended format and language.", id: "Hasilkan teks sesuai format dan bahasa yang diminta." },
    success: { en: "Preserve the intended message, audience, tone, and supplied facts; avoid filler.", id: "Pertahankan pesan, audiens, nada, dan fakta yang diberikan; hindari pengisi." },
  },
  {
    id: "summarization",
    match: /\b(?:ringkas|rangkum|meringkas|merangkum|ringkasan|rangkuman|summari[sz]e|summary)\b/i,
    role: { en: "A precise summarizer", id: "Penyusun ringkasan yang cermat" },
    format: { en: "Present a faithful summary in the requested length and format, with the most important points first.", id: "Sajikan ringkasan yang setia pada sumber dengan panjang dan format yang diminta, dimulai dari poin terpenting." },
    success: { en: "Preserve the source's main claims, decisions, evidence, and nuance; omit repetition, not material meaning.", id: "Pertahankan klaim utama, keputusan, bukti, dan nuansa sumber; hilangkan pengulangan, bukan makna penting." },
  },
  {
    id: "design",
    match: /\b(?:design|visual|image|illustrat|logo|brand|ui|ux|layout|gambar|desain|ilustrasi|merek|tampilan|antarmuka|poster)\b/i,
    role: { en: "A visual designer focused on the requested outcome", id: "Desainer visual yang berfokus pada hasil yang diminta" },
    format: { en: "Describe or produce the requested visual deliverable; follow explicit style, composition, and aspect requirements.", id: "Jelaskan atau buat hasil visual yang diminta; ikuti gaya, komposisi, dan rasio yang disebutkan." },
    success: { en: "Keep named subjects and relationships intact; do not add text, logos, or unrelated subjects unless requested.", id: "Pertahankan subjek dan relasi yang disebutkan; jangan menambah teks, logo, atau subjek lain tanpa diminta." },
  },
  {
    id: "business",
    match: /\b(?:business|market|marketing|sales|customer|revenue|campaign|strategy|bisnis|pasar|pemasaran|penjualan|pelanggan|pendapatan|kampanye|strategi)\b/i,
    role: { en: "A practical business analyst", id: "Analis bisnis yang praktis" },
    format: { en: "Organize recommendations around the stated business goal, audience, resources, and requested measures.", id: "Susun rekomendasi berdasarkan tujuan bisnis, audiens, sumber daya, dan ukuran yang disebutkan." },
    success: { en: "Separate supplied facts from assumptions; do not invent market data, performance, or customer evidence.", id: "Pisahkan fakta dari asumsi; jangan mengarang data pasar, kinerja, atau bukti pelanggan." },
  },
  {
    id: "learning",
    match: /\b(?:learn|learning|teach|study|lesson|explain|student|belajar|mengajar|pelajaran|studi|jelaskan|siswa|mahasiswa)\b/i,
    role: { en: "A patient educator", id: "Pengajar yang sabar" },
    format: { en: "Explain at the requested level with a clear sequence, a relevant example, and practice when useful.", id: "Jelaskan sesuai tingkat yang diminta dengan urutan jelas, contoh relevan, dan latihan bila berguna." },
    success: { en: "Define unfamiliar terms, distinguish facts from simplifications, and avoid assuming prior knowledge.", id: "Definisikan istilah baru, bedakan fakta dari penyederhanaan, dan jangan mengasumsikan pengetahuan awal." },
  },
  {
    id: "research-data",
    match: /\b(?:research|analy[sz]e|data|evidence|source|compare|report|riset|analisis|data|bukti|sumber|bandingkan|laporan)\b/i,
    role: { en: "A rigorous research and data analyst", id: "Analis riset dan data yang cermat" },
    format: { en: "Present findings, method or evidence, limitations, and sources when available and requested.", id: "Sajikan temuan, metode atau bukti, keterbatasan, dan sumber bila tersedia serta diminta." },
    success: { en: "Separate observation from inference and never fabricate citations, measurements, or source access.", id: "Pisahkan pengamatan dari inferensi dan jangan mengarang sitasi, pengukuran, atau akses sumber." },
  },
  {
    id: "productivity",
    match: /\b(?:task|schedule|prioriti[sz]e|workflow|meeting|action item|plan|jadwal|prioritas|alur kerja|rapat|tindak lanjut|rencana)\b/i,
    role: { en: "A practical planning assistant", id: "Asisten perencanaan yang praktis" },
    format: { en: "Turn the request into clear, prioritized actions and a usable plan.", id: "Ubah permintaan menjadi tindakan yang jelas, berprioritas, dan mudah digunakan." },
    success: { en: "Assign owners, deadlines, and dependencies only when supplied or explicitly marked as assumptions.", id: "Tentukan penanggung jawab, tenggat, dan dependensi hanya jika diberikan atau ditandai sebagai asumsi." },
  },
  {
    id: "career",
    match: /\b(?:career|resume|résumé|cv\b|interview|job|cover letter|karier|resume|wawancara|pekerjaan|lamaran)\b/i,
    role: { en: "A clear and ethical career coach", id: "Pendamping karier yang jelas dan etis" },
    format: { en: "Provide the requested career document, preparation, or next steps in a ready-to-use form.", id: "Berikan dokumen, persiapan, atau langkah karier yang diminta dalam bentuk siap pakai." },
    success: { en: "Use only the person's real experience and supplied details; never invent credentials or achievements.", id: "Gunakan hanya pengalaman dan detail yang diberikan; jangan mengarang kualifikasi atau pencapaian." },
  },
];

const DOMAIN_EXECUTION_GUIDANCE = {
  "web-development": {
    en: "Treat the request as a product brief and carry every supplied requirement into the implementation. Organize the work around: (1) audience, purpose, user action, content language, and supplied brand/content facts; (2) framework, file structure, dependencies, setup, and editability; (3) visual direction, color tokens, typography, spacing, layout, and distinctive personal details; (4) semantic page sections and complete content; (5) working navigation, theme persistence, mobile menu, filters, dialogs, forms, validation, and other explicitly requested interactions; (6) responsive behavior at the requested widths and practical breakpoints; (7) keyboard access, visible focus, labels, alt text, contrast, reduced motion, and semantic HTML; (8) metadata, social previews, icons, image loading, and performance; and (9) complete deliverables, how to run/edit them, deployment instructions, and any requested follow-up ideas. Implement all feasible requirements rather than returning a mockup or plan. Use local CSS, gradients, or inline SVG placeholders instead of unrequested external image dependencies. Clearly mark invented placeholder content for replacement, never fabricate personal credentials, testimonials, project results, or contact details. If the brief contains conflicting requirements, preserve the higher-priority intent and call out the conflict. Verify layout and interactions at the requested viewport sizes when tools are available; report unverified Lighthouse targets rather than claiming scores.",
    id: "Anggap permintaan sebagai brief produk dan bawa semua persyaratan yang diberikan ke implementasi. Susun pekerjaan berdasarkan: (1) audiens, tujuan, tindakan pengguna, bahasa konten, dan fakta merek/konten yang tersedia; (2) framework, struktur file, dependensi, cara menjalankan, dan kemudahan edit; (3) arah visual, token warna, tipografi, spasi, tata letak, serta detail personal yang membedakan; (4) section halaman dan konten lengkap; (5) navigasi, penyimpanan tema, menu mobile, filter, dialog, formulir, validasi, serta interaksi lain yang diminta dan benar-benar berfungsi; (6) perilaku responsif pada lebar yang diminta dan breakpoint praktis; (7) akses keyboard, focus yang terlihat, label, alt text, kontras, reduced motion, dan HTML semantik; (8) metadata, preview sosial, ikon, pemuatan gambar, dan performa; serta (9) seluruh file hasil, cara menjalankan/mengedit, panduan deploy, dan ide lanjutan bila diminta. Implementasikan semua persyaratan yang dapat dikerjakan, bukan hanya mockup atau rencana. Gunakan placeholder CSS lokal, gradient, atau SVG inline alih-alih dependensi gambar eksternal yang tidak diminta. Tandai konten placeholder realistis yang perlu diganti; jangan mengarang kredensial pribadi, testimoni, hasil proyek, atau detail kontak. Jika brief bertentangan, pertahankan maksud yang lebih penting dan jelaskan konfliknya. Uji tata letak dan interaksi pada ukuran viewport yang diminta bila alat tersedia; sebut target Lighthouse yang belum diverifikasi sebagai target, jangan mengklaim skor." ,
  },
  coding: {
    en: "Inspect the supplied code and constraints first. Identify the expected behavior and root cause before changing anything. Make a complete, minimal, maintainable fix; preserve unrelated behavior; cover relevant edge cases; add or update focused tests; and report exactly which checks were or were not run.",
    id: "Periksa kode dan batasan yang diberikan terlebih dahulu. Tentukan perilaku yang diharapkan dan akar masalah sebelum mengubah apa pun. Buat perbaikan minimal yang lengkap dan mudah dirawat; pertahankan perilaku yang tidak terkait; tangani kasus tepi yang relevan; tambahkan atau perbarui tes terfokus; dan laporkan dengan jujur pemeriksaan yang sudah maupun belum dijalankan.",
  },
  writing: {
    en: "Determine the purpose, audience, tone, channel, and format from the request or supplied context. Preserve the intended message and facts. Produce polished, ready-to-use copy with a fitting structure; include alternatives only when useful; never invent quotations, claims, or evidence.",
    id: "Tentukan tujuan, audiens, nada, kanal, dan format dari permintaan atau konteks yang tersedia. Pertahankan pesan dan fakta yang dimaksud. Hasilkan naskah matang yang siap dipakai dengan susunan yang sesuai; berikan alternatif hanya bila berguna; jangan mengarang kutipan, klaim, atau bukti.",
  },
  summarization: {
    en: "Identify the source and requested scope. Retain the central thesis, key supporting points, decisions, numbers, and caveats; preserve attribution and uncertainty; distinguish source statements from inference; and do not add facts absent from the source.",
    id: "Identifikasi sumber dan cakupan ringkasan yang diminta. Pertahankan gagasan utama, poin pendukung, keputusan, angka, dan catatan penting; jaga atribusi serta ketidakpastian; bedakan pernyataan sumber dari inferensi; jangan menambahkan fakta yang tidak ada di sumber.",
  },
  design: {
    en: "Translate the requested outcome into concrete requirements. Preserve named subjects and relationships; specify composition, hierarchy, color, typography, lighting, materials, and style only when relevant. For interfaces, address layout, states, accessibility, and responsive behavior. Do not add unrequested text, logos, or subjects.",
    id: "Ubah hasil yang diminta menjadi persyaratan konkret. Pertahankan subjek dan relasi yang disebutkan; uraikan komposisi, hierarki, warna, tipografi, pencahayaan, material, dan gaya bila relevan. Untuk antarmuka, perhatikan tata letak, status, aksesibilitas, dan perilaku responsif. Jangan menambah teks, logo, atau subjek yang tidak diminta.",
  },
  business: {
    en: "Anchor recommendations to the stated objective, audience, offer, resources, and constraints. Separate known facts, assumptions, and unknowns. Give a prioritized strategy, actionable implementation steps, measurable success indicators, risks, and practical next steps without promising outcomes or inventing market evidence.",
    id: "Dasarkan rekomendasi pada tujuan, audiens, penawaran, sumber daya, dan batasan yang disebutkan. Pisahkan fakta yang diketahui, asumsi, dan hal yang belum diketahui. Berikan strategi berprioritas, langkah pelaksanaan yang dapat dilakukan, indikator keberhasilan terukur, risiko, dan tindak lanjut praktis tanpa menjanjikan hasil atau mengarang bukti pasar.",
  },
  learning: {
    en: "Match the learner's stated level and goal. Organize the explanation from foundations to application, define essential terms, use accurate examples, point out common misconceptions when relevant, and include practice with answers or a way to check understanding when it helps.",
    id: "Sesuaikan dengan tingkat dan tujuan belajar yang disebutkan. Susun penjelasan dari dasar hingga penerapan, definisikan istilah penting, gunakan contoh yang akurat, jelaskan miskonsepsi umum bila relevan, dan sertakan latihan beserta jawaban atau cara mengecek pemahaman bila membantu.",
  },
  "research-data": {
    en: "State the research question and scope, identify what evidence or data is actually available, explain the method and comparisons, distinguish observations from inferences, and report findings with uncertainty, limitations, and verifiable sources when available. Never fabricate citations, measurements, or research.",
    id: "Nyatakan pertanyaan dan ruang lingkup riset, identifikasi bukti atau data yang benar-benar tersedia, jelaskan metode dan perbandingan, bedakan pengamatan dari inferensi, lalu sajikan temuan beserta ketidakpastian, keterbatasan, dan sumber yang dapat diverifikasi bila tersedia. Jangan mengarang sitasi, pengukuran, atau hasil riset.",
  },
  productivity: {
    en: "Convert the goal into an ordered, usable plan. Make priorities, dependencies, effort estimates, resources, milestones, and the first next action explicit when the available information supports them. Do not invent owners, deadlines, or commitments; label assumptions clearly.",
    id: "Ubah tujuan menjadi rencana berurutan yang siap digunakan. Perjelas prioritas, dependensi, perkiraan usaha, sumber daya, tahapan, dan tindakan pertama bila informasinya mendukung. Jangan mengarang penanggung jawab, tenggat, atau komitmen; tandai asumsi secara jelas.",
  },
  career: {
    en: "Tailor the result to the stated role and goal. Use only experience, achievements, skills, and qualifications actually supplied. Improve clarity and relevance, preserve an authentic voice, and flag missing evidence instead of inventing credentials or outcomes.",
    id: "Sesuaikan hasil dengan posisi dan tujuan yang disebutkan. Gunakan hanya pengalaman, pencapaian, keterampilan, dan kualifikasi yang benar-benar diberikan. Tingkatkan kejelasan dan relevansi, pertahankan suara yang autentik, dan tandai bukti yang belum tersedia alih-alih mengarang kredensial atau hasil.",
  },
  general: {
    en: "Break the request into its actual objective, deliverable, relevant context, and constraints. Complete every requested part, use a clear structure appropriate to the task, and check the result against the request before returning it. Ask only for essential missing information; otherwise label reasonable assumptions.",
    id: "Uraikan permintaan menjadi tujuan, hasil akhir, konteks relevan, dan batasan yang benar-benar ada. Selesaikan setiap bagian yang diminta, gunakan susunan yang sesuai dengan tugas, dan cocokkan hasil dengan permintaan sebelum menyajikannya. Tanyakan hanya informasi penting yang belum tersedia; selain itu, tandai asumsi yang wajar.",
  },
};

const STARTER_PROMPT_EXAMPLES = [
  {
    domain: "coding",
    en: "Fix [problem] in [code or technology], give the smallest safe change, and include verification steps.",
    id: "Perbaiki [masalah] pada [kode atau teknologi], berikan perubahan aman minimal, dan sertakan langkah verifikasi.",
  },
  {
    domain: "writing",
    en: "Write a [content type] for [audience] to achieve [goal], using a [tone] tone and [format].",
    id: "Tulis [jenis konten] untuk [audiens] demi [tujuan], dengan nada [gaya] dan format [format].",
  },
  {
    domain: "design",
    en: "Design [visual or interface] for [audience], showing [subject] in [style] with [constraints].",
    id: "Rancang [visual atau antarmuka] untuk [audiens], tampilkan [subjek] bergaya [gaya] dengan [batasan].",
  },
  {
    domain: "business",
    en: "Build a [business plan or campaign] for [audience] with [budget or resources] and measurable [goal].",
    id: "Susun [rencana bisnis atau kampanye] untuk [audiens] dengan [anggaran atau sumber daya] dan [tujuan] terukur.",
  },
  {
    domain: "learning",
    en: "Teach me [topic] at [level], using a practical example and a short practice exercise.",
    id: "Ajari saya [topik] pada tingkat [level], dengan contoh praktis dan latihan singkat.",
  },
  {
    domain: "research-data",
    en: "Research [question] using [sources or data], compare the evidence, and state limits and uncertainty.",
    id: "Riset [pertanyaan] memakai [sumber atau data], bandingkan buktinya, dan jelaskan batas serta ketidakpastian.",
  },
  {
    domain: "productivity",
    en: "Turn [goal or notes] into prioritized actions, a realistic schedule, and a clear next step.",
    id: "Ubah [tujuan atau catatan] menjadi tindakan berprioritas, jadwal realistis, dan langkah berikutnya.",
  },
  {
    domain: "career",
    en: "Improve my [resume or interview answer] for [role], using only my real experience: [details].",
    id: "Perbaiki [CV atau jawaban wawancara] untuk [posisi], gunakan hanya pengalaman nyata saya: [detail].",
  },
];

export function localStarterPromptExamples(language = "en", mode = "auto") {
  const indonesian = language === "id";
  const examples = STARTER_PROMPT_EXAMPLES.filter((example) => mode === "auto"
    || mode === "pro" || mode === "max" || mode === "chat"
    || mode === example.domain
    || mode === "research" && example.domain === "research-data"
    || mode === "image" && example.domain === "design");
  return examples.map((example) => {
    const guide = {
      coding: indonesian
        ? "Periksa kode dan konteks yang diberikan sebelum menyarankan perubahan. Jelaskan akar masalah, berikan solusi terkecil yang aman, tangani kasus tepi, dan sertakan tes serta cara menjalankannya. Jangan mengaku telah menjalankan verifikasi yang belum dilakukan."
        : "Inspect the supplied code and context before proposing changes. Explain the root cause, make the smallest safe fix, cover edge cases, and include tests and commands to run them. Never claim verification that was not performed.",
      writing: indonesian
        ? "Tetapkan tujuan, audiens, nada, format, dan panjang berdasarkan informasi yang tersedia. Susun draf dengan struktur yang sesuai, pembuka yang relevan, isi yang jelas, dan penutup atau ajakan yang tepat. Jangan mengarang fakta atau kutipan."
        : "Use the supplied goal, audience, tone, format, and length. Structure the draft with a relevant opening, clear body, and appropriate ending or call to action. Do not invent facts or quotations.",
      design: indonesian
        ? "Jabarkan subjek, tujuan visual, komposisi, hierarki, warna, pencahayaan, gaya, rasio, dan batasan hanya sejauh diminta atau diberikan. Pertahankan semua subjek dan relasi penting; jangan menambah teks, logo, atau elemen yang tidak diminta."
        : "Specify the subject, visual goal, composition, hierarchy, color, lighting, style, aspect ratio, and constraints only when requested or supplied. Preserve important subjects and relationships; do not add unrequested text, logos, or elements.",
      business: indonesian
        ? "Susun rekomendasi berdasarkan tujuan, audiens, penawaran, sumber daya, dan batasan yang diberikan. Tampilkan strategi, langkah pelaksanaan, ukuran keberhasilan, risiko, serta asumsi yang perlu dikonfirmasi. Bedakan data nyata dari perkiraan."
        : "Base recommendations on the supplied goal, audience, offer, resources, and constraints. Include strategy, execution steps, success measures, risks, and assumptions to confirm. Separate known facts from estimates.",
      learning: indonesian
        ? "Sesuaikan penjelasan dengan tingkat pengetahuan yang disebutkan. Ajarkan konsep secara bertahap, definisikan istilah penting, berikan contoh yang relevan, lalu latihan singkat beserta kunci atau cara memeriksa pemahaman."
        : "Match the stated knowledge level. Teach the concept in clear steps, define important terms, give a relevant example, then add a short exercise with an answer key or way to check understanding.",
      "research-data": indonesian
        ? "Uraikan pertanyaan riset, bukti dan jenis sumber yang diperlukan, metode perbandingan, temuan, keterbatasan, serta ketidakpastian. Cantumkan sitasi yang dapat diverifikasi jika sumber tersedia; jangan pernah mengarang sumber, angka, atau hasil penelusuran."
        : "Define the research question, evidence and source types needed, comparison method, findings, limitations, and uncertainty. Provide verifiable citations when sources are available; never fabricate sources, figures, or research.",
      productivity: indonesian
        ? "Ubah tujuan menjadi daftar tindakan terurut dengan prioritas, dependensi, estimasi waktu, sumber daya, dan jadwal yang realistis. Tentukan langkah pertama yang dapat dilakukan. Jangan mengarang tenggat atau penanggung jawab."
        : "Turn the goal into prioritized actions with dependencies, time estimates, resources, and a realistic schedule. Identify the first actionable step. Do not invent deadlines or owners.",
      career: indonesian
        ? "Sesuaikan hasil dengan posisi dan kebutuhan yang disebutkan. Gunakan hanya pengalaman, capaian, dan kualifikasi nyata yang diberikan; tonjolkan bukti yang relevan dan berikan perbaikan yang bisa langsung diterapkan tanpa mengarang kredensial."
        : "Tailor the result to the stated role and needs. Use only real experience, achievements, and qualifications supplied; emphasize relevant evidence and give ready-to-use improvements without inventing credentials.",
    }[example.domain];
    return `${example[indonesian ? "id" : "en"]}\n\n${indonesian ? "Konteks dan bahan" : "Context and materials"}: [${indonesian ? "tambahkan bahan yang relevan" : "add relevant source material"}]\n\n${indonesian ? "Persyaratan" : "Requirements"}:\n- ${guide}\n- ${indonesian ? "Pertahankan maksud, fakta, dan batasan yang diberikan." : "Preserve the supplied intent, facts, and constraints."}\n- ${indonesian ? "Jika informasi penting tidak tersedia, tandai sebagai asumsi atau tanyakan sebelum mengarangnya." : "If essential information is missing, label an assumption or ask instead of inventing it."}\n\n${indonesian ? "Hasil yang diminta" : "Deliverable"}: ${indonesian ? "Berikan hasil akhir dalam format yang siap digunakan, lalu lakukan pemeriksaan singkat terhadap ketepatan dan kelengkapannya." : "Provide a ready-to-use result, then briefly check it for accuracy and completeness."}`;
  });
}

export function buildAutoPromptObject(prompt, { mode = "auto", language = "" } = {}) {
  const request = String(prompt || "").trim();
  const detectedLanguage = language || detectPromptLanguage(request, "en");
  const indonesian = detectedLanguage === "id";
  const forcedDomain = mode === "coding" ? "coding"
    : mode === "image" ? "design"
      : mode === "research" ? "research-data" : "";
  const domain = PROMPT_DOMAINS.find((entry) => entry.id === forcedDomain)
    || PROMPT_DOMAINS.find((entry) => entry.match.test(request))
    || {
      id: "general",
      role: { en: "A capable assistant for the requested task", id: "Asisten yang cakap untuk tugas yang diminta" },
      format: { en: "Follow the requested deliverable and format; choose a concise, useful structure if none is specified.", id: "Ikuti hasil dan format yang diminta; pilih susunan ringkas yang berguna bila belum ditentukan." },
      success: { en: "Answer the actual request, preserve intent, and do not invent missing facts.", id: "Jawab permintaan sebenarnya, pertahankan maksud, dan jangan mengarang fakta yang tidak tersedia." },
    };
  const guidance = DOMAIN_EXECUTION_GUIDANCE[domain.id] || DOMAIN_EXECUTION_GUIDANCE.general;
  return {
    schema: "myai.auto-prompt.v1",
    domain: domain.id,
    role: domain.role[indonesian ? "id" : "en"],
    action: request,
    context: indonesian
      ? "Gunakan hanya konteks percakapan dan bahan yang benar-benar diberikan pengguna."
      : "Use only conversation context and materials actually supplied by the user.",
    constraints: indonesian
      ? ["Pertahankan maksud dan fakta yang diberikan.", "Jangan mengarang detail yang hilang; nyatakan ketidakpastian penting."]
      : ["Preserve the user's intent and supplied facts.", "Do not invent missing details; state material uncertainty."],
    format: domain.format[indonesian ? "id" : "en"],
    tone: indonesian ? "Gunakan bahasa pengguna dan nada yang sesuai tugas." : "Use the user's language and a tone appropriate to the task.",
    successCriteria: domain.success[indonesian ? "id" : "en"],
    taskGuidance: guidance[indonesian ? "id" : "en"],
  };
}

export function promptObjectInstruction(language, mode = "auto") {
  const indonesian = language === "id";
  const domainNames = PROMPT_DOMAINS.map(({ id }) => id).join(", ");
  return indonesian
    ? `Baca objek JSON myai.auto-prompt.v1 berikut. Domain tersedia: ${domainNames}, general. Susun menjadi satu prompt siap jalankan yang benar-benar lengkap, spesifik, dan cukup terperinci untuk kompleksitas tugasnya; jangan meringkas hingga langkah penting hilang. Pertahankan action, maksud, bahasa, dan fakta. Gunakan role, context, constraints, format, tone, taskGuidance, dan successCriteria sebagai arahan, bukan boilerplate yang wajib disalin. Jadikan persyaratan operasional taskGuidance terlihat jelas dan sertakan metode kerja serta pemeriksaan hasil yang relevan. Jangan menjawab tugas sekarang, jangan mengarang fakta/asumsi yang tidak ditandai, dan keluarkan hanya prompt final tanpa pembuka atau Markdown. Mode: ${mode}.`
    : `Read the following myai.auto-prompt.v1 JSON object. Turn it into one complete, specific, sufficiently detailed, ready-to-run prompt proportionate to the task; do not compress away important steps. Preserve action, intent, language, and facts. Use role, context, constraints, format, tone, taskGuidance, and successCriteria as guidance rather than boilerplate to copy. Make the task-specific guidance actionable and include a relevant work method and quality checks. Do not answer the task, invent facts or hide assumptions. Return only the final prompt with no preface or Markdown. Mode: ${mode}.`;
}

function normalizeSuggestion(value) {
  const suggestion = String(value || "").trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(["'])|(["'])$/g, "")
    .replace(/[ \t]+/g, " ");
  return suggestion.length >= 80 ? suggestion : "";
}

export function detectPromptLanguage(text, fallback = "en") {
  const words = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  const scores = Object.fromEntries(Object.entries(LANGUAGE_WORDS)
    .map(([language, dictionary]) => [language, words.filter((word) => dictionary.has(word)).length]));
  if (scores.id > 0 && scores.id > scores.en) return "id";
  if (scores.en >= 2 && scores.en > scores.id) return "en";
  return fallback;
}

export function promptLanguageInstruction(language) {
  if (language === "id") return "Bahasa wajib: Bahasa Indonesia. Pertahankan bahasa draft pengguna; seluruh hasil fitur ini harus berbahasa Indonesia.";
  if (language === "en") return "Required language: English. Preserve the user's draft language; all output from this helper must be in English.";
  return `Required language: ${language}. Preserve the user's draft language; all output from this helper must use ${language}.`;
}

export function promptOutputMatchesLanguage(text, language) {
  if (!["id", "en"].includes(language)) return true;
  const output = String(text || "");
  const letters = output.match(/\p{L}/gu) || [];
  const latinLetters = output.match(/\p{Script=Latin}/gu) || [];
  if (!letters.length || latinLetters.length / letters.length < 0.95) return false;
  const words = output.toLowerCase().match(/[a-z]+/g) || [];
  const scores = Object.fromEntries(Object.entries(LANGUAGE_WORDS)
    .map(([name, dictionary]) => [name, words.filter((word) => dictionary.has(word)).length]));
  const otherLanguage = language === "id" ? "en" : "id";
  const minimumMatches = Math.max(2, Math.ceil(words.length * 0.025));
  return scores[language] >= minimumMatches && scores[language] > scores[otherLanguage];
}

export function selectGuestPromptHelperModel(guestModels, selectedModelId = "") {
  if (!Array.isArray(guestModels)) return "";
  const available = guestModels.filter((model) => typeof model?.id === "string" && model.id.trim());
  return rankPromptHelperCandidates(available.map((model) => ({
    group: { provider: "guest" },
    model,
  })), selectedModelId)[0]?.model.id || "";
}

function promptHelperProvider(candidate) {
  const provider = String(candidate?.group?.provider || candidate?.model?.backendProvider || candidate?.model?.provider || "")
    .toLowerCase()
    .replace(/^gateway-/, "")
    .replace(/^server-/, "");
  if (provider === "guest") {
    return String(candidate?.model?.id || "").split("::", 1)[0].toLowerCase();
  }
  return provider;
}

function promptHelperSpeedScore(candidate) {
  const provider = promptHelperProvider(candidate);
  const identity = `${candidate?.model?.id || ""} ${candidate?.model?.name || ""}`.toLowerCase();
  const providerIndex = PROMPT_HELPER_PROVIDER_ORDER.indexOf(provider);
  const providerScore = providerIndex < 0 ? 0 : PROMPT_HELPER_PROVIDER_ORDER.length - providerIndex;
  const modelScore = /\binstant\b/.test(identity) ? 600
    : /\bflash\b/.test(identity) ? 550
      : /\bhaiku\b/.test(identity) ? 500
        : /\bnano\b/.test(identity) ? 450
          : /\b(?:mini|lite|small|fast)\b/.test(identity) ? 350
            : /(?:^|[-./])(?:7|8|9)b(?:[-.:/]|$)/.test(identity) ? 250 : 0;
  return providerScore + modelScore;
}

export function rankPromptHelperCandidates(candidates, selectedModelKey = "") {
  if (!Array.isArray(candidates)) return [];
  const isSelected = (candidate) => {
    const modelId = String(candidate?.model?.id || "");
    return selectedModelKey === modelId
      || selectedModelKey === `${promptHelperProvider(candidate)}::${modelId}`;
  };
  return candidates
    .filter((candidate) => typeof candidate?.model?.id === "string" && candidate.model.id.trim())
    .sort((left, right) =>
      promptHelperSpeedScore(right) - promptHelperSpeedScore(left)
      || Number(isSelected(right)) - Number(isSelected(left))
      || `${promptHelperProvider(left)}::${left.model.id}`.localeCompare(`${promptHelperProvider(right)}::${right.model.id}`));
}

export function promptHelperOutputIsUsable(text, prompt) {
  const output = String(text || "").trim();
  const source = String(prompt || "");
  if (!output) return false;
  if (/\b(?:mode kerja aktif|user name|user role|user profile|preferences)\s*:/i.test(output)) return false;
  if (/^(?:tentu\b|berikut(?: adalah)?\b|ini dia\b|saya telah\b|sure\b|here(?: is|'s)\b|the improved prompt\b|prompt yang diperbaiki\b)/i.test(output)) return false;
  if (/^(?:apakah (?:anda|kamu) ingin|do you want|would you like|can you (?:tell|specify)|please (?:specify|provide|tell me)|silakan (?:tuliskan|jelaskan kembali)|harap (?:tuliskan|jelaskan kembali))/i.test(output)) return false;
  const intent = TASK_INTENTS.find(({ input }) => input.test(source));
  const firstSentence = output.split(/[\n.!?]/, 1)[0];
  if (intent && !intent.output.test(firstSentence)) return false;

  const lines = output.split(/\r?\n/)
    .map((line) => line.toLowerCase().replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 40);
  return new Set(lines).size === lines.length;
}

export function parsePromptSuggestions(text) {
  const source = String(text || "").trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [fenced, source].filter(Boolean);
  for (const candidate of candidates) {
    const start = candidate.search(/[\[{]/);
    if (start < 0) continue;
    const opening = candidate[start];
    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const character = candidate[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === opening) depth += 1;
      else if (character === closing && --depth === 0) {
        try {
          const parsed = JSON.parse(candidate.slice(start, index + 1));
          const values = Array.isArray(parsed) ? parsed : parsed?.suggestions;
          if (Array.isArray(values)) {
            return [...new Set(values
              .filter((value) => typeof value === "string")
              .map((value) => normalizeSuggestion(value))
              .filter(Boolean))].slice(0, 3);
          }
        } catch {
          break;
        }
      }
    }
  }
  const matches = [...source.matchAll(/(?:^|\n)\s*(?:\*\*)?\d+[.)](?:\*\*)?\s*([\s\S]*?)(?=\n\s*(?:\*\*)?\d+[.)](?:\*\*)?\s*|$)/g)];
  return [...new Set(matches.map((match) => normalizeSuggestion(match[1])).filter(Boolean))].slice(0, 3);
}

export function localPromptContinuations(prompt, language = "en") {
  return localPromptSuggestions(prompt, language);
}

export function localPromptSuggestions(prompt, language = "en", mode = "auto") {
  const object = buildAutoPromptObject(prompt, { mode, language });
  const indonesian = language === "id";
  const request = object.action || (indonesian ? "[Tulis permintaanmu]" : "[Write your request]");
  const contextHeading = indonesian ? "Konteks dan bahan" : "Context and materials";
  const constraintsHeading = indonesian ? "Persyaratan dan batasan" : "Requirements and constraints";
  const outputHeading = indonesian ? "Format hasil" : "Output format";
  const qualityHeading = indonesian ? "Pemeriksaan kualitas" : "Quality checks";
  const roleHeading = indonesian ? "Peran" : "Role";
  const taskHeading = indonesian ? "Tugas" : "Task";
  const taskGuidanceHeading = indonesian ? "Panduan khusus tugas" : "Task-specific guidance";
  const context = indonesian
    ? "Gunakan hanya konteks percakapan dan bahan yang benar-benar diberikan. Jika informasi penting belum ada, ajukan pertanyaan yang spesifik atau tandai asumsi sebelum melanjutkan."
    : "Use only conversation context and materials actually supplied. If essential information is missing, ask a focused question or label an assumption before proceeding.";
  const constraints = indonesian
    ? "- Pertahankan maksud, fakta, nama, dan batasan dalam permintaan asli.\n- Jangan mengarang data, sumber, pengalaman, atau hasil yang tidak diberikan.\n- Kerjakan tugas secara langsung; jangan sekadar menjelaskan cara mengerjakannya kecuali diminta."
    : "- Preserve the intent, facts, names, and constraints in the original request.\n- Do not invent data, sources, experience, or results that were not supplied.\n- Perform the task directly; do not merely explain how unless asked.";
  const criteria = indonesian
    ? "- Hasil harus akurat, relevan, lengkap, dan langsung dapat digunakan.\n- Sesuaikan kedalaman dengan cakupan tugas; hindari pengulangan dan pengisi.\n- Nyatakan keterbatasan atau ketidakpastian yang penting."
    : "- Make the result accurate, relevant, complete, and ready to use.\n- Match depth to the task; avoid repetition and filler.\n- State material limitations or uncertainty.";
  const taskFormat = object.format;
  const taskQuality = object.successCriteria;
  const taskGuidance = object.taskGuidance;
  return [
    `${roleHeading}: ${object.role}\n\n${taskHeading}: ${request}\n\n${indonesian ? "Tujuan" : "Goal"}: Selesaikan permintaan secara menyeluruh dan berikan hasil akhir yang langsung dapat digunakan.\n\n${contextHeading}: ${context}\n\n${taskGuidanceHeading}: ${taskGuidance}\n\n${indonesian ? "Langkah kerja" : "Work method"}:\n1. ${indonesian ? "Identifikasi semua hasil, sub-tugas, dan batasan yang secara eksplisit diminta." : "Identify every explicitly requested deliverable, subtask, and constraint."}\n2. ${indonesian ? "Gunakan konteks serta bahan yang tersedia; bedakan fakta, inferensi, dan asumsi." : "Use the available context and materials; distinguish facts, inferences, and assumptions."}\n3. ${indonesian ? "Selesaikan tiap bagian dengan kedalaman dan format yang sesuai, sertakan contoh atau langkah hanya bila relevan." : "Complete each part at appropriate depth and format; include examples or steps when relevant."}\n4. ${indonesian ? "Periksa kembali kelengkapan, ketepatan, dan kesesuaian seluruh hasil dengan permintaan." : "Check every deliverable for completeness, accuracy, and alignment with the request."}\n\n${constraintsHeading}:\n${constraints}\n\n${outputHeading}: ${taskFormat}\n\n${qualityHeading}:\n${criteria}\n- ${taskQuality}`,
    `${taskHeading}: ${request}\n\n${roleHeading}: ${indonesian ? `Bertindak sebagai ${object.role.toLowerCase()}.` : `Act as ${object.role.toLowerCase()}.`}\n\n${taskGuidanceHeading}: ${taskGuidance}\n\n${indonesian ? "Cara kerja" : "Workflow"}:\n1. ${indonesian ? "Pahami tujuan dan setiap hasil akhir yang diminta." : "Identify the goal and every requested deliverable."}\n2. ${indonesian ? "Gunakan konteks dan bahan yang tersedia; pisahkan fakta dari asumsi." : "Use available context and materials; distinguish facts from assumptions."}\n3. ${indonesian ? "Selesaikan setiap bagian dengan detail dan struktur yang sesuai." : "Complete each part with appropriate detail and structure."}\n4. ${indonesian ? "Periksa hasil terhadap seluruh persyaratan sebelum menyajikannya." : "Check the result against every requirement before presenting it."}\n\n${contextHeading}: ${context}\n\n${constraintsHeading}:\n${constraints}\n\n${outputHeading}: ${taskFormat}\n\n${qualityHeading}: ${criteria}`,
    `${roleHeading}: ${object.role}\n\n${taskHeading}: ${request}\n\n${indonesian ? "Tujuan dan ruang lingkup" : "Goal and scope"}: ${taskFormat}\n\n${contextHeading}: ${context}\n\n${taskGuidanceHeading}: ${taskGuidance}\n\n${indonesian ? "Yang harus disertakan" : "Include"}:\n- ${indonesian ? "Setiap bagian hasil yang diminta secara eksplisit, dengan detail yang cukup untuk langsung digunakan." : "Every explicitly requested deliverable, with enough detail to use it immediately."}\n- ${indonesian ? "Metode, langkah, contoh, atau alasan yang relevan dengan tugas." : "Methods, steps, examples, or rationale relevant to the task."}\n- ${indonesian ? "Batasan, ketidakpastian, dan tindak lanjut praktis bila relevan." : "Relevant constraints, uncertainty, and practical next steps."}\n\n${constraintsHeading}:\n${constraints}\n\n${qualityHeading}:\n${criteria}\n- ${taskQuality}`,
  ];
}

export function localImprovedPrompt(prompt, language = "en") {
  const draft = String(prompt || "").trim();
  if (/^(?:peran|role)\s*:/im.test(draft)
    && /^(?:tugas(?: utama)?|primary task|task)\s*:/im.test(draft)
    && /^(?:kriteria keberhasilan|success criteria|pemeriksaan kualitas|quality checks)\s*:/im.test(draft)) {
    return draft;
  }
  if (/^(?:hai|halo|hello|hi|hey)(?:[\s,!.?]+.*)?$/i.test(draft)
    && /\b(?:tanya|bertanya|ask|question|help|bantu)\b/i.test(draft)) {
    return language === "id"
      ? "Sapa saya dengan ramah dan tawarkan bantuan secara singkat. Tunggu sampai saya menjelaskan pertanyaan atau kebutuhan; jangan mengasumsikan topiknya."
      : "Greet me warmly and offer brief help. Wait for me to explain my question or need; do not assume the topic.";
  }
  const object = buildAutoPromptObject(draft, { language });
  if (language === "id") {
    return `Peran: ${object.role}.\n\nTugas utama: ${draft}\n\nTujuan dan hasil akhir: Selesaikan seluruh permintaan, termasuk sub-tugas yang dinyatakan, lalu berikan hasil dalam bentuk yang siap digunakan.\n\nKonteks dan bahan: ${object.context} Pertahankan semua nama, angka, fakta, contoh, preferensi, serta batasan yang diberikan. Jangan menganggap informasi yang tidak disebutkan sebagai fakta.\n\nPanduan khusus untuk tugas ${object.domain}: ${object.taskGuidance}\n\nMetode kerja:\n1. Uraikan permintaan menjadi tujuan, bagian-bagian tugas, dan kriteria hasil yang diminta; jangan menghilangkan bagian kecil yang penting.\n2. Tinjau konteks dan bahan yang tersedia. Pisahkan fakta dari inferensi; bila informasi penting kurang, tanyakan secara spesifik atau tandai asumsi yang diperlukan.\n3. Kerjakan setiap bagian secara berurutan dan cukup mendalam. Gunakan langkah, contoh, perhitungan, atau struktur hanya bila membantu tujuan.\n4. Gunakan bahasa Indonesia yang jelas dan natural. Ikuti panduan penyajian berikut: ${object.format}\n5. Sebelum menjawab, periksa kelengkapan, konsistensi, ketepatan, keterbacaan, dan kesesuaian dengan semua persyaratan.\n\nBatasan:\n- ${object.constraints.join("\n- ")}\n- Jangan mengarang fakta, data, sumber, kutipan, pengalaman, hasil verifikasi, atau detail yang belum diberikan.\n- Jangan mengubah maksud, nama, angka, atau batasan dalam permintaan.\n- Hindari jawaban dangkal, langkah generik yang tidak relevan, pengulangan, dan pengisi.\n\nFormat hasil: ${object.format} Sertakan setiap bagian yang diminta dan detail pendukung yang relevan agar hasil dapat langsung dipakai.\n\nKriteria keberhasilan: ${object.successCriteria} Hasil akhir harus akurat, lengkap, spesifik terhadap tugas, mudah diperiksa, dan langsung berguna. Nyatakan keterbatasan penting secara jujur.`;
  }
  return `Role: ${object.role}.\n\nPrimary task: ${draft}\n\nGoal and deliverable: Complete every requested part, including stated subtasks, and provide a ready-to-use result.\n\nContext and materials: ${object.context} Preserve all supplied names, numbers, facts, examples, preferences, and constraints. Do not treat unstated information as fact.\n\nTask-specific guidance for ${object.domain}: ${object.taskGuidance}\n\nWork method:\n1. Break the request into its objective, requested components, and success criteria; do not omit important sub-parts.\n2. Review available context and materials. Separate facts from inference; ask a focused question or label a necessary assumption if essential information is missing.\n3. Complete each part in a logical order and at sufficient depth. Use steps, examples, calculations, or structure only when they serve the goal.\n4. Use clear, natural English. Follow this presentation guidance: ${object.format}\n5. Before responding, check completeness, consistency, accuracy, readability, and alignment with every requirement.\n\nConstraints:\n- ${object.constraints.join("\n- ")}\n- Do not invent facts, data, sources, quotations, experience, verification results, or details that were not supplied.\n- Do not alter the request's intent, names, numbers, or constraints.\n- Avoid shallow answers, irrelevant generic steps, repetition, and filler.\n\nOutput format: ${object.format} Include every requested component and enough relevant supporting detail for immediate use.\n\nSuccess criteria: ${object.successCriteria} The final result must be accurate, complete, task-specific, easy to verify, and directly useful. State material limitations honestly.`;
}

export function localOfflineResponse(prompt, {
  language = "en",
  imageGeneration = false,
  documentFormat = "",
  limitation = "",
} = {}) {
  const request = String(prompt || "").trim().slice(0, 4000);
  const indonesian = language === "id";
  const limitationText = String(limitation || "").trim();
  if (imageGeneration) {
    return indonesian
      ? `**Mode offline — konsep gambar siap**\n\nGambar belum dirender karena layanan gambar memerlukan koneksi internet. Prompt visual yang bisa digunakan:\n\n> ${request || "Deskripsikan subjek, suasana, komposisi, dan gaya visual yang diinginkan."}\n\nSaat koneksi tersedia, kirim ulang permintaan ini dalam Mode Gambar.${limitationText ? `\n\nCatatan: ${limitationText}` : ""}`
      : `**Offline mode — image concept ready**\n\nThe image has not been rendered because image generation requires an internet connection. Ready-to-use visual prompt:\n\n> ${request || "Describe the subject, mood, composition, and visual style you want."}\n\nResend this request in Image mode when a connection is available.${limitationText ? `\n\nNote: ${limitationText}` : ""}`;
  }
  if (documentFormat === "pptx") {
    return indonesian
      ? `# ${request || "Rancangan Presentasi"}\n\n## Tujuan dan konteks\n- Jelaskan tujuan presentasi dan audiens.\n\n## Pokok pembahasan\n- Susun ide utama secara berurutan.\n\n## Contoh atau penerapan\n- Tambahkan contoh yang bersumber dari materi pengguna.\n\n## Ringkasan dan langkah berikutnya\n- Rangkum poin penting tanpa menambahkan fakta yang belum tersedia.${limitationText ? `\n\nCatatan mode offline: ${limitationText}` : "\n\nCatatan mode offline: ini kerangka awal, bukan hasil riset atau verifikasi fakta."}`
      : `# ${request || "Presentation Outline"}\n\n## Goal and context\n- State the presentation goal and audience.\n\n## Main points\n- Organize the key ideas in a logical sequence.\n\n## Example or application\n- Use examples grounded in the user's material.\n\n## Summary and next steps\n- Summarize the key points without adding unsupported facts.${limitationText ? `\n\nOffline note: ${limitationText}` : "\n\nOffline note: this is a starting outline, not researched or fact-checked content."}`;
  }
  const summary = request || (indonesian ? "Permintaan belum berisi teks." : "No request text was provided.");
  return indonesian
    ? `**Mode offline — draf kerja lokal**\n\nSaya sudah menyimpan inti permintaan ini untuk dilanjutkan:\n\n> ${summary}\n\nLangkah praktis:\n1. Tentukan hasil akhir dan audiens yang dituju.\n2. Tambahkan bahan, batasan, atau contoh yang perlu dipertahankan.\n3. Periksa fakta penting sebelum menggunakan hasil.\n\nJawaban ini disusun secara lokal; belum ada model online yang memproses atau memverifikasi isinya.${limitationText ? `\n\nCatatan: ${limitationText}` : ""}`
    : `**Offline mode — local working draft**\n\nI captured the core request for follow-up:\n\n> ${summary}\n\nPractical next steps:\n1. Define the intended deliverable and audience.\n2. Add source material, constraints, or examples to preserve.\n3. Verify important facts before using the result.\n\nThis response was prepared locally; no online model processed or verified its contents.${limitationText ? `\n\nNote: ${limitationText}` : ""}`;
}
