# Changelog MyAI

Riwayat ini dipindahkan dari README lama dan dipertahankan sebagai arsip. Isi di bawah mencatat klaim/fitur yang ditulis pada saat itu; **bukan spesifikasi perilaku saat ini atau panduan konfigurasi**. Beberapa butir mungkin sudah berubah atau belum diverifikasi. Lihat [README](./README.md), [arsitektur](./docs/ARCHITECTURE.md), dan [setup Firebase](./docs/SETUP-FIREBASE.md) untuk panduan yang ditinjau terhadap kode saat ini. Urutan mengikuti README sumber, bukan kronologi rilis yang telah diverifikasi.

## Catatan versi saat ini

- `js/config.js` menyatakan versi aplikasi **5.47**. Riwayat perubahan khusus untuk v5.47 tidak tersedia di README sumber, sehingga perubahan versi ini belum dirinci di sini.
- **Pemilihan dan fallback model:** backend tidak memaksa rute ke NVIDIA. Request membawa provider/model yang dipilih; akses model non-gratis dibatasi backend kecuali UID tercantum pada `PREMIUM_ALLOWED_UIDS`. Kegagalan HTTP 402/429, atau opt-in `allowFallback`, dapat memicu fallback ke model gratis terverifikasi dan stream melaporkan provider/model pengganti. Karena itu, “model Premium tidak dipilih otomatis” bukan berarti tidak pernah ada fallback ke model lain.
- **Metode masuk:** README sumber di luar catatan versi pernah menyarankan Email/Password dan Phone. UI saat ini menawarkan Google/GitHub; Worker menolak provider `password` dan `phone` untuk API AI.
- **Harga:** label tier/harga dalam katalog bukan jaminan biaya nol, akses provider, atau ketersediaan. Verifikasi tarif serta syarat retensi pada provider yang benar-benar dipakai.
- **Provider langsung yang dihapus:** adapter Anthropic Claude dan Moonshot Kimi tidak lagi tersedia sebagai provider langsung pada UI atau Worker. Catatan lama tentang integrasi dan secret-nya di bawah dipertahankan untuk riwayat, bukan petunjuk setup aktif. Model dari brand tersebut mungkin masih dapat muncul dalam katalog agregat OpenRouter; itu bukan koneksi langsung ke Anthropic atau Moonshot dan tetap mengikuti provider OpenRouter.
- **Google Gemini:** chat, katalog, health check, dan fallback Gemini langsung dihapus. Hanya Gemini Live voice/video memakai secret Worker terpisah `GEMINI_LIVE_API_KEY`; model Gemini melalui OpenRouter tetap berjalan sebagai rute OpenRouter. Ganti secret lama `GEMINI_API_KEY` sebelum deploy agar Gemini Live tetap tersedia.

---

## Visibilitas tier, katalog WebGPU lokal, dan perbaikan CSP WebGPU (31 Oktober 2026)

- Matriks visibilitas tier diubah: FREE hanya menampilkan model AI lokal (WebGPU & Ollama) tanpa model API Groq/NVIDIA/OpenRouter; BASIC hanya menampilkan model tier basic; PRO menampilkan free+basic+pro; MAX menampilkan semua. Fallback otomatis dan pemilihan model kini juga dibatasi oleh tier dan provider yang diizinkan.
- Katalog "AI Lokal · WebGPU" diperluas dari 2 menjadi 62 model yang dapat diunduh (satu varian q4f16_1 per model dari daftar prebuilt `@mlc-ai/web-llm` 0.2.86; model embedding, vision, dan 70B dikecualikan). Model diunduh sekali lalu dibuka dari cache browser.
- Jalur trial (tanpa login) hanya menampilkan Llama 3.2 1B · Lite untuk WebGPU; model WebGPU lainnya muncul setelah login Google.
- Tombol "Unduh semua model" di grup AI Lokal · WebGPU (khusus pengguna login) mengunduh seluruh katalog ke cache browser sekaligus dengan progres dan opsi batal; model yang sudah tersimpan dilewati.
- CSP Pages diperbaiki agar model WebGPU berjalan: `https://raw.githubusercontent.com` diizinkan di `connect-src` (unduhan pustaka WASM) dan `'wasm-unsafe-eval'` ditambahkan ke `script-src` (kompilasi WebAssembly). Error WebGPU tidak lagi salah dilabeli sebagai gangguan Worker lokal.

---

## SaaS MyAI: kuota akun, mesin adaptif, 150 kemampuan, dan Download Center (31 Oktober 2026)

- **Kuota chat cloud berbasis akun + perangkat (bukan IP saja):** chat cloud (semua provider termasuk OpenRouter) dibatasi 3 per hari untuk akun non-admin; admin (email pada `AI_ADMIN_EMAILS`, login Google terverifikasi) tanpa batas. Identitas memakai kombinasi akun Firebase + ID perangkat aman (hash SHA-256 dari `X-Device-Id`, maksimal 5 perangkat terdaftar per akun, pruned setelah 90 hari idle) + IP hanya sebagai sinyal tambahan (ambang harian 200 per jaringan). Seluruh kuota divalidasi backend di Durable Object `AI_DAILY_RATE_LIMIT_STORE`; error `CLOUD_QUOTA_EXCEEDED` (429) dan `DEVICE_LIMIT_EXCEEDED` (403) dikembalikan dengan kode terpisah. AI Lokal tidak dibatasi.
- **Endpoint kuota:** `GET /api/quota` (login wajib) melaporkan sisa chat cloud harian, jumlah perangkat terdaftar, dan status admin. Indikator kuota tampil di menu akun dan diperbarui otomatis setelah chat cloud.
- **Alur upgrade setelah kuota habis:** dialog khusus mengarahkan ke AI Lokal (tanpa batas) atau paket upgrade — bukan mengakali lewat IP atau email; fallback otomatis setelah kuota habis hanya mencoba model AI Lokal.
- **Mesin Adaptif:** toggle di pemilih model (login wajib) yang memilih Cloud → WebGPU → Ollama otomatis sesuai kemampuan yang dipakai (skill), sisa kuota, dan ketersediaan mesin lokal. Hasil rute selalu diberi label transparan (mis. "Mesin adaptif memilih: AI Lokal · WebGPU").
- **Katalog 150 kemampuan:** daftar 150 kemampuan (bukan 150 model) dalam 12 kategori dengan pencarian, filter, dan label mesin (Cloud/WebGPU/Ollama) per kemampuan; dibuka dari tombol "150 Kemampuan" di sidebar.
- **Download Center:** tiga platform (Mobile, Desktop, Web App) dengan rekomendasi otomatis sesuai perangkat, opsi unduh satuan per platform, dan ZIP gabungan per platform. Installer Mobile & Desktop masih placeholder "Segera hadir"; Web App aktif.

---

## Perbaikan sign-in, terjemahan, dan pipeline gambar di v5.47 (30 Oktober 2026)

- CSP Pages (`pages/_headers`) kini mengizinkan `https://apis.google.com` di `script-src` dan `connect-src` serta `https://accounts.google.com` di `frame-src`, `img-src`, dan `connect-src`. Sebelumnya SDK Firebase Auth memuat GIS `api.js` yang diblokir CSP sehingga login gagal dengan `auth/internal-error`, dan ping `gen_204` Google Identity Services (cek ketersediaan cookie) diblokir `connect-src` sehingga handoff login bisa gagal diam-diam dan pengguna kembali ke halaman depan setelah selesai di Google.
- Status redirect login yang kedaluwarsa tidak lagi memunculkan dialog "Login Google belum selesai" palsu saat aplikasi dibuka. Error redirect hanya dilaporkan jika URL balikan benar-benar membawa parameter OAuth; kunci pending dibersihkan setelah popup login berhasil, dan pesan error dibuat lebih mudah ditindaklanjuti pengguna.
- Kunci terjemahan `tierPickerTitle` ditambahkan untuk English, Bahasa Indonesia, dan Español; sebelumnya badge pemilih tier menampilkan key mentah `tierPickerTitle: FREE` di ketiga bahasa.
- Antrean edit gambar (`IMAGE_EDIT_QUEUE` Durable Object, migrasi v4, cron per menit), modul skills dan memory, modul AI lokal, pembaruan UI web, rute gateway Pages, dan konfigurasi Android diperbarui.
- Worker `myai-v3-free-api` dan situs Pages `myai-v3-firmansyah` disebarkan ulang dengan perubahan ini; CI GitHub hijau, audit browser pada situs live bersih (konsol tanpa error, guest chat end-to-end berhasil), dan situs terpasang sebagai PWA.

---
## Pembaruan keamanan dan stabilitas di v3.6

- Website dan jalur `/api` tersedia di Cloudflare Pages; gateway Pages meneruskan permintaan ke Worker tanpa mengekspos key provider.
- Katalog OpenRouter Worker memuat model teks gratis terkini dan backend menolak chat yang tidak sesuai allowlist.
- Key yang tidak didukung tidak dipakai; nama provider tersebut ditampilkan sebagai peringatan, sementara provider yang didukung tetap bisa digunakan.
- Mode Umum, Coding, Flash, Pro, dan Max memilih model rekomendasi berbeda jika katalog menyediakan pilihan yang sesuai. Pilihan manual disimpan per mode; model aktif juga disimpan berdasarkan ID model agar pilihan tetap terikat saat katalog dimuat ulang.
- Semua chat model dan katalog server dipanggil melalui Cloudflare Worker; browser tidak mengunduh bobot model atau mengirim request chat langsung ke provider.
- Localhost memakai proxy Vite menuju Worker lokal; produksi memakai route same-origin `/api` di Cloudflare Pages.
- Akun Google atau GitHub dengan email terverifikasi diperlukan untuk memakai provider Worker; semua alamat email yang memenuhi syarat dapat login tanpa allowlist.
- AI guest tersedia tanpa login jika secret provider, binding rate limit, dan konfigurasi Turnstile sudah disiapkan di Worker. Bila tersedia, satu model NVIDIA NIM tier Basic ditampilkan pertama; dua penggunaan AI per kombinasi IP dan ID perangkat dapat menggunakan kuota/billing provider yang dikelola aplikasi.
- Login otomatis beralih ke redirect jika browser memblokir popup Google.
- Pemuatan katalog Worker memiliki batas waktu dan menjelaskan gangguan koneksi/DNS tanpa membuat tombol model terus menunggu.
- Backend memverifikasi token Firebase, provider masuk yang didukung, dan email terverifikasi sebelum menerima permintaan.
- Katalog Worker mengikuti konfigurasi model dan batas provider. Model berbayar/tarif tak diketahui dapat langsung digunakan tanpa konfirmasi biaya dan dapat menimbulkan tagihan provider.
- API key lama dari `localStorage` dibersihkan otomatis saat membuka versi ini.

## Pemilih model di v3.7

- Model dikelompokkan berdasarkan tier **Gratis** atau **Premium / cek tarif**, lalu berdasarkan brand model seperti NVIDIA, Google, Qwen, dan lainnya.
- Model gratis Worker Gemini/Groq hanya muncul jika secret provider tersedia di server. Pengguna tidak memasukkan API key sendiri, tetapi tetap perlu login Google dan koneksi internet; admin perlu deploy Worker terbaru.
- Harga OpenRouter berasal dari katalog; key Gemini/Groq pribadi ditandai **Premium / cek tarif** kecuali modelnya ada di allowlist gratis Worker.
- Model Premium meminta konfirmasi setiap kali dikirim atau dijawab ulang. Model Premium tidak dipilih otomatis.
- MyAI tidak menjalankan model secara lokal; model dijalankan oleh provider melalui Worker.

## SEO dan failover di v3.8

- Halaman menambahkan metadata description, canonical URL, Open Graph, Twitter card, dan structured data `SoftwareApplication`.
- Dialog dibuat lebih ringkas dengan batas tinggi dan scroll internal untuk layar kecil.
- Jika provider mengembalikan error kuota, key kedaluwarsa, atau stream kosong, aplikasi mencoba model Gratis lain yang terverifikasi, termasuk model gratis lain dari provider yang sama bila tersedia. Model Premium atau bertarif tak diketahui tidak dipakai sebagai fallback otomatis.
- Model Gratis cadangan yang berhasil akan menjadi pilihan aktif berikutnya. Jika semua cadangan gagal, aplikasi menampilkan ringkasan error dan tidak mengirim ke model Premium.

## AI Gratis tanpa login di v4.0

- Tombol **Mulai Chat Gratis** memilih AI guest server tanpa meminta login atau API key dari pengguna.
- Admin harus mengatur secret provider AI, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, dan binding rate limit guest di Cloudflare Worker. Tanpa secret Turnstile, route guest ditolak dengan pesan konfigurasi (fail closed).
- Jika katalog model gagal dimuat, MyAI tetap memilih model guest server sehingga pengguna dapat mencoba fitur gratis dan melihat error yang dikembalikan Worker bila konfigurasi server belum siap.
- Admin harus menyiapkan secret Gemini atau Groq dan deploy `worker/wrangler.toml` terbaru, termasuk rate limit guest 5 request per 60 detik. Atur `TURNSTILE_SITE_KEY` sebagai Worker variable dan simpan secret private menggunakan `npx wrangler secret put TURNSTILE_SECRET_KEY`; daftarkan hostname situs di Cloudflare Turnstile.
- Guest dibatasi 6.000 karakter dan 512 token jawaban. Fitur gambar menerima satu PNG/JPG/WebP per chat dan memerlukan secret Gemini.
- Bila Gemini guest terkena kuota atau gagal, Worker mencoba Groq gratis; jika keduanya gagal, aplikasi menampilkan error. Semua penggunaan tetap memerlukan internet.
- Gambar guest diproses di browser menjadi JPEG kecil, hanya berada di memori tab, dan tidak disimpan pada draft `localStorage`.
- Kuota OpenRouter free berlaku pada satu key server bersama. Dokumentasi OpenRouter mencatat batas default 20 request/menit dan 50/hari jika akun belum pernah membeli kredit; ambang dan batas dapat berubah, jadi pengguna guest berbagi kuota itu.

## Fallback OpenRouter guest di v4.1

- Jika Gemini dan Groq guest gagal, Worker mencoba model OpenRouter hanya setelah katalog memverifikasi harga nol.
- Batas OpenRouter free berlaku pada key server bersama seluruh pengguna, bukan kredit harian terpisah per akun. Batas default yang didokumentasikan OpenRouter saat akun belum membeli kredit adalah 20 request/menit dan 50/hari; angka dan kelayakan dapat berubah.
- Cerebras Free Trial adalah kredit $5 satu kali yang kedaluwarsa setelah 30 hari, bukan kredit harian berulang. GitHub Copilot Free adalah kuota dalam layanan Copilot, bukan endpoint API umum untuk dipasang sebagai provider di MyAI.

## Percakapan suara langsung di v5.8

- Tekan ikon mikrofon untuk berbicara bergantian dengan model yang sedang dipilih. MyAI mengenali ucapan, mengirimnya sebagai chat biasa, lalu membacakan jawaban melalui suara browser; sesi dibatasi 10 menit dan dapat dijeda atau diakhiri kapan saja.
- Perlu HTTPS/localhost, izin mikrofon, serta browser yang mendukung Speech Recognition dan Speech Synthesis. Bahasa pengenalan dapat mengikuti perangkat atau dipilih antara Indonesia dan English (US); ketersediaan suara mengikuti browser/perangkat.
- Ini bukan sambungan audio real-time langsung ke model. Respons tetap menggunakan provider/model chat yang dipilih, sehingga memerlukan koneksi dan kuota provider.

## Percakapan video dan kontrol chat di v5.33

- Satu tombol mikrofon pada composer membuka percakapan langsung. Pilih atau ganti mode suara/video dari tombol di dalam ruang percakapan; mode video baru meminta izin kamera setelah dipilih.
- Ruang percakapan menyesuaikan area aman dan viewport dinamis perangkat, dengan pratinjau kamera tegak yang lebih besar pada layar ponsel portrait.
- Ruang video Gemini Live menampilkan pratinjau kamera lokal, avatar sesuai bidang, dan audio dua arah realtime. Frame JPEG dikirim maksimal sekali per detik sesuai batas Live API; kamera tidak direkam atau disimpan.
- Ruang suara hanya menampilkan orb bulat; ruang video menampilkan kamera dan avatar yang bergerak saat AI berbicara. Avatar adalah animasi antarmuka, bukan video manusia yang dihasilkan AI.
- Percakapan video memerlukan HTTPS/localhost, izin kamera/mikrofon, login, secret Gemini di Worker, koneksi, dan kuota Gemini. Mengakhiri sesi menutup koneksi dan mematikan kamera.
- Format frame video mengikuti dokumentasi [Gemini Live API](https://ai.google.dev/gemini-api/docs/live): `realtimeInput.video` dengan gambar JPEG.
- Tombol kirim mengirim pesan; saat jawaban berlangsung tombol yang sama berubah menjadi berhenti dan membatalkan permintaan. Enter mengirim pesan (Shift+Enter membuat baris baru); perilaku dapat diubah di Personalisasi.

## Prompt helper, keamanan API, dan bahasa UI di v5.36

- Bahasa antarmuka default adalah English; pengguna dapat beralih ke Bahasa Indonesia dari halaman pembuka atau top bar. Pilihan disimpan di perangkat.
- Tombol ✨ mengirim draft ke route Cloudflare Worker `/api/enhance-prompt`, memprioritaskan NVIDIA NIM lalu memakai Groq sebagai fallback saat NIM tidak tersedia/gagal. Route memerlukan sesi akun dan rate limit; hasil gambar memakai schema validation serta template lokal jika provider tidak dapat digunakan.
- Tombol **Saran** meminta tiga alternatif prompt. Respons JSON yang disertai teks penjelas tetap diparse; hasil yang tidak valid, berulang, atau membocorkan konteks internal diganti dengan alternatif lokal. Pilih satu untuk mengganti draft, lalu sunting manual bila perlu.
- **Saran** memakai NVIDIA NIM sebagai provider utama chat (atau template lokal); key provider tetap berada di secret Worker, tidak di browser.
- Model dan katalog akun dimuat otomatis saat aplikasi memulai atau akun masuk. Tombol pembaruan katalog tetap tersedia sebagai opsi manual, bukan prasyarat untuk memakai model.
- API key provider tidak boleh ditanam dalam HTML/JavaScript publik. Semua key chat berada di secret Cloudflare Worker; browser hanya mengirim request ke backend terautentikasi.
- Permintaan REST Gemini mengirim key melalui header API, bukan parameter URL, agar key tidak ikut tercatat di URL request.
- Gateway Worker menolak request browser dari asal yang tidak diizinkan; situs Pages mengizinkan akses kamera dan mikrofon hanya dari origin situs itu sendiri.

## Code Artifacts dan pratinjau sandbox

- Blok HTML, CSS, JavaScript, SVG, dan Markdown dari jawaban terbaru otomatis membuka panel Artifacts di samping chat. Panel dapat diubah lebarnya, menjalankan ulang pratinjau, menyalin kode, atau mengunduh hasil HTML; Markdown ditampilkan sebagai teks aman, bukan dieksekusi.
- Blok kode jawaban juga dirender sebagai kotak kode kaca dengan label bahasa, tombol salin, unduh file, dan pratinjau. Format kode lain tetap dapat disalin atau diunduh.
- Pratinjau berjalan dalam iframe sandbox tanpa akses origin yang sama. Content Security Policy memblokir koneksi jaringan, frame turunan, form, dan resource eksternal; hanya skrip/style inline dan aset data/blob yang diizinkan agar contoh kode lokal bisa dirender.
- Worker menambahkan instruksi kualitas dan kelengkapan kode ke system prompt setiap provider sembari mempertahankan konteks system prompt yang diberikan aplikasi.
- Markdown, sanitasi HTML, syntax highlighting, dan render matematika memakai `marked`, `DOMPurify`, `highlight.js`, serta KaTeX yang dibundel lokal; tabel GFM, heading, daftar, kutipan, kode, dan rumus tidak bergantung pada CDN.
- File PDF, teks, tabel, Office, arsip, dan source code diekstrak secara lokal sebelum konteks percakapan dikirim ke Worker; riwayat mengikuti ukuran konteks model, termasuk Kimi dan Gemini, dengan batas keselamatan tetap diterapkan.
- Instruksi khusus, preferensi gaya, dan persona termasuk Coding partner serta Researcher disimpan di localStorage dan ditambahkan ke konteks setiap permintaan chat.
- Jawaban stream dibatch maksimal sekitar 20 kali per detik untuk mengurangi render ulang dan pergeseran tata letak, lalu selalu dirender ulang lengkap setelah stream selesai.
- Gambar hasil generate dan gambar/SVG inline memiliki kartu pratinjau serta unduh. PDF dapat dipratinjau sebagai file PDF hasil render; format dokumen lain menampilkan isi Markdown. Dokumen dapat dibuat ulang dari percakapan tersimpan tanpa meminta AI menulis ulang.
- Katalog model disimpan di localStorage setelah pemuatan awal, dipisahkan untuk pengguna dan mode guest. Gunakan **Status provider AI → perbarui katalog** untuk mengambil daftar terbaru; katalog tersimpan tetap dipakai jika jaringan gagal. Kuota guest tidak di-cache.
- Metadata riwayat unduhan mengikuti pesan chat. Biner gambar/kode tersimpan di IndexedDB pada perangkat yang membuatnya; file gambar tersedia kembali dari riwayat lokal, sedangkan dokumen dapat diunduh ulang dengan membuat ulang file dari isi chat. Aset IndexedDB dihapus saat chat dihapus.
- Cache startup hanya berisi URL API publik, prompt default frontend, dan katalog model; API key, token sesi, serta system prompt internal Worker tidak disimpan ke localStorage.
- Toast sambutan yang tidak penting dinonaktifkan dan pesan yang sama berulang dalam waktu singkat tidak ditampilkan berulang. Aplikasi tidak meminta izin push/browser notification.

## Perbaikan inisialisasi Firebase di v5.9

- Login Google menunggu SDK Firebase selesai dimuat, sehingga klik login saat halaman baru dibuka tidak lagi gagal hanya karena inisialisasi masih berlangsung.
- Jika SDK gagal dimuat, dialog login menampilkan penyebab pemuatan alih-alih pesan umum "Auth belum siap". Pastikan browser dapat menjangkau `www.gstatic.com` dan hostname situs ada di **Firebase Console → Authentication → Settings → Authorized domains**.
- Untuk pengujian lokal, gunakan `http://localhost`, bukan `http://127.0.0.1`; untuk deploy Pages, izinkan `myai-v3-firmansyah.pages.dev`.

## Voice chat, avatar, dan kamera di v5.11

- Tombol percakapan suara tampil bulat di sebelah kanan tombol kirim. Dialog suara memiliki avatar animasi dan pilihan bidang: umum, kesehatan, pendidikan, bisnis, teknologi, hukum, keuangan, kreatif, karier, serta kebugaran.
- Pada v5.11 kamera dapat mengirim cuplikan gambar per giliran ke model vision yang dipilih. Kamera belum didukung dalam sesi Gemini Live di v5.23.
- Katalog yang kosong menjelaskan apakah API server tidak dapat dijangkau atau belum memiliki provider aktif.
- API key provider bukan bagian dari frontend: source code hanya memuat Firebase Web config publik. Key Gemini, Groq, OpenRouter, NVIDIA, Claude, dan Kimi disimpan sebagai secret Cloudflare Worker (`AI_PROVIDER_KEYS` atau secret provider individual). **Status AI Worker** hanya menampilkan provider yang aktif.
- Jika tidak ada model, buka **＋ → Status provider AI** dan periksa pesan status; untuk model server, pastikan Worker dapat dijangkau serta admin sudah memasang secret provider. Semua akun Google/GitHub terverifikasi dapat memakai API, dengan rate limit per UID.
- Avatar adalah ilustrasi antarmuka animasi, bukan manusia/video yang dibuat AI. Untuk percakapan video/audio real-time dua arah dibutuhkan API/provider yang menyediakan sesi real-time dan konfigurasi backend tambahan.

## Logo orbital, intro login, dan perbaikan dialog di v5.13

- Logo orbital My AI dari aset branding digunakan pada halaman awal, dialog login, ikon menu, chat kosong, favicon, dan metadata berbagi.
- Setelah Firebase mengonfirmasi login akun Google, layar intro logo tampil penuh dengan animasi lembut lalu memudar untuk memperlihatkan aplikasi. Untuk pengguna yang sudah login, intro juga tampil saat sesi dipulihkan setelah membuka ulang aplikasi.
- Intro dibuat dari aset gambar dan animasi CSS; tidak memerlukan file video tambahan.
- Dialog terpusat dan dibatasi tinggi viewport agar tetap dapat digunakan pada layar pendek/kecil. Untuk pengujian lokal, gunakan `http://localhost`, bukan `http://127.0.0.1`; hostname domain produksi tetap harus diizinkan pada Authorized domains Firebase.
- Pada versi sebelum v5.23, voice chat memakai pengenalan dan sintesis suara browser per giliran; sejak v5.23, tombol percakapan suara memulai sesi audio realtime Gemini Live.
- Tombol salin mencoba Clipboard API lalu fallback browser; tombol salin dan pratinjau kode ditempatkan sesudah blok kode. DOCX/XLSX dan ekspor PPTX manual untuk Canva dibuat di browser; desain Canva otomatis tetap memakai Canva Connect server-side.

## Integrasi Monid dan Gemini Live realtime di v5.25

- Dialog **＋ → Status AI Worker** menampilkan provider server aktif. Gemini Live menggunakan secret `GEMINI_API_KEY` pada Worker; API key jangka panjang tidak dikirim atau disimpan di browser.
- Worker membuat token Gemini Live sekali pakai dan berumur pendek setelah sesi Firebase terverifikasi. WebSocket realtime memakai token tersebut.
- **Cari data Monid** tersedia dari tombol Monid di sidebar maupun menu lampiran. Fitur ini memakai secret `MONID_API_KEY` dari Cloudflare Worker untuk mencari endpoint, memeriksa skema dan harga, menjalankan endpoint, serta mengambil hasil run asinkron. Secret dapat disimpan sendiri atau sebagai properti `monid_api_key` di secret JSON `AI_PROVIDER_KEYS`. Eksekusi dapat menggunakan saldo Monid tanpa dialog konfirmasi; periksa skema dan biaya sebelum menjalankan endpoint.
- Monid bukan provider model chat. Key Monid tidak menambahkan model ke pemilih chat dan tidak dijalankan otomatis oleh percakapan. Jalankan hanya endpoint yang dipahami; setiap run dapat memakai saldo Monid.
- Buat key melalui [Monid API key management](https://app.monid.ai/access/api-keys). Permintaan Monid dapat memakai saldo atau menimbulkan biaya per eksekusi; periksa wallet dan biaya di dashboard sebelum menjalankan endpoint.

- Voice chat memakai WebSocket Gemini Live dengan audio mikrofon PCM 16 kHz dan audio balasan PCM 24 kHz; bukan alur Speech Recognition → model teks → Speech Synthesis. Interupsi audio dan transkrip suara didukung.
- Mode ini perlu login, secret `GEMINI_API_KEY` di Worker, izin mikrofon, HTTPS/localhost, koneksi internet, serta akses/kuota Gemini Live. Worker meminta token sekali pakai; tarif dan kuota mengikuti Google AI Studio/provider dan tidak dijamin gratis.
- Percakapan Live memakai Gemini Live meskipun model chat teks lain dipilih; chat teks biasa tidak berubah. Transkrip per giliran ditambahkan ke chat aktif dan tersimpan seperti pesan lainnya.
- Jika pengenalan atau pemutaran audio gagal, aplikasi menampilkan error alih-alih diam-diam kembali ke mode turn-based. Browser Chrome/Edge terbaru dan izin mikrofon direkomendasikan.
- API key dengan batasan HTTP referrer perlu mengizinkan domain MyAI dan akses Gemini API. Jika token atau sesi ditolak, periksa konfigurasi key/API, kuota/billing, dukungan model di wilayah akun, serta izin mikrofon.

## AI gratis selalu siap di v5.6

- Pengguna baru langsung mendapat model **AI Umum Gratis** tanpa Google login dan tanpa memasukkan API key. Tombol **Mulai Chat Gratis** juga memilih model tersebut.
- AI gratis dijalankan melalui Cloudflare Worker dan memakai secret provider yang dikelola admin; kuota server dibatasi bersama dan perlu koneksi internet. Ini bukan model offline.
- Fitur guest tidak memanggil endpoint teks Pollinations yang meminta token Turnstile; bila provider Worker belum disiapkan, aplikasi menampilkan error layanan.

## Katalog, guest, dan ekspor di v5.7

- Sebelum login, pengguna mendapat **maksimal dua penggunaan AI** (chat atau transkripsi) per kombinasi IP dan ID perangkat acak yang disimpan di `localStorage`. Turnstile diverifikasi server-side untuk setiap route guest; request ditolak jika secret/site key belum dikonfigurasi. Rate limit 5 request per menit tetap diterapkan pada IP dan juga pada ID perangkat. Penghitung persisten memakai Durable Object; tidak ada reset otomatis. Jika provider gagal sebelum menghasilkan jawaban/teks transkripsi, Worker mengembalikan jatah. Masuk Google untuk melanjutkan. Deploy Worker terbaru beserta binding/migrasi `GUEST_TRIAL_COUNTER` sebelum mengaktifkan perubahan ini.
- Daftar guest memilih satu model NVIDIA NIM tier Basic terlebih dahulu, lalu Gemini/Groq dan sebagian model OpenRouter yang katalog harganya menyatakan gratis. Guest dibatasi dua penggunaan AI per kombinasi IP/perangkat; pemakaian NVIDIA/Gemini/Groq memakai key aplikasi dan dapat memakai kuota atau menimbulkan biaya provider. Hanya model OpenRouter dengan harga prompt/completion/request nol yang ditandai gratis terverifikasi. NIM hanya ditambahkan ke katalog guest jika model Basic tersedia dan tidak sedang ditandai kuota/saldo terbatas.
- Kategori **Free / Basic / Pro / Max** mengelompokkan model berdasarkan harga/kinerja dan **bukan paket langganan atau hak akses berbayar MyAI**. Harga model di luar Free tetap mengikuti provider.
- Mode AI offline WebGPU telah dihapus. Tidak ada tombol atau alur chat yang mengunduh bobot model ke browser.
- DOCX dan XLSX menerima format tabel serta tipografi/warna dasar yang lebih teratur. Presentasi PowerPoint dapat dibuat otomatis melalui Canva Connect atau diunduh sebagai PPTX modern-gold dua slide untuk diimpor manual ke Canva.
- Pages menambahkan `nosniff`, kebijakan referrer, dan pembatasan izin browser yang tetap mengizinkan mikrofon satu-origin. CSP sengaja tidak ditambahkan karena aplikasi memuat Firebase dan pustaka ekspor dari CDN.
- Pada localhost, API diarahkan langsung ke Worker supaya tidak melewati preflight Pages gateway yang saat ini bermasalah; produksi tetap memakai route same-origin `/api`.

## Personalisasi dan bahasa di v5.4

- Menu **Personalisasi** di sidebar menyimpan informasi tentang pengguna dan gaya jawaban AI yang disukai, tanpa panel pengaturan lanjutan. Fitur pengelolaan data chat tetap tersedia dalam bagian lipat di dialog tersebut.
- Bahasa jawaban otomatis memakai bahasa utama perangkat/browser. Pengguna tetap bisa meminta bahasa lain langsung di chat; kemampuan tiap bahasa bergantung pada model yang dipilih. Teks bawaan lama diperbarui tanpa mengganti gaya khusus yang pernah ditulis sendiri.
- Mode **Ngobrol** memberi instruksi pada model untuk merespons dengan hangat dan santai, menjaga konteks percakapan yang tersedia, dan bertanya lanjut bila memang membantu. Mode ini tetap memakai model/provider yang dipilih; tidak ada model atau biaya terpisah.

## Multi-model AI Gateway

- Arsitektur inference menggunakan alur **Browser → Cloudflare Pages Functions → Cloudflare Worker → provider upstream**. Pages Functions mem-proxy request/stream; Worker mengelola autentikasi, katalog/cache, adapter protokol, dan routing berdasarkan provider/model yang dipilih pengguna. Worker tidak mengalihkan request secara diam-diam ke NVIDIA; NVIDIA NIM dijalankan oleh layanan NVIDIA, bukan di-host di Worker MyAI.
- Worker terautentikasi menyediakan satu endpoint `POST /gateway` untuk Gemini, Groq, NVIDIA NIM, OpenRouter, Anthropic Claude, dan Moonshot Kimi. Masing-masing adapter memakai format request/auth provider yang sesuai; katalog model diambil dari endpoint provider dan di-cache singkat di Worker.
- Secret yang didukung adalah `GEMINI_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY` (alias `NVIDIA_NIM_API_KEY`), `OPENROUTER_API_KEY`, `CLAUDE_API_KEY` (alias `ANTHROPIC_API_KEY`), dan `KIMI_API_KEY` (alias `MOONSHOT_API_KEY`), atau key provider yang sama di JSON secret `AI_PROVIDER_KEYS`. `PREMIUM_ALLOWED_UIDS` adalah daftar UID Firebase yang dipisahkan koma dan dikonfigurasi sebagai Worker variable untuk memberi akses model premium; tanpa UID yang cocok, model premium ditolak backend. Jangan menaruh API key di source, `.env`, frontend, atau chat.
- Panel **Status AI Worker** membedakan secret terpasang dari koneksi yang sudah diuji. **Tes koneksi** dan **Tes semua provider** mengirim prompt chat singkat, menguji Monid lewat `discover`, serta meminta satu gambar kecil dari Pollinations. Gemini Image memakai secret dan status provider Google Gemini yang sama; tidak ditampilkan sebagai server/provider terpisah. Tes Pollinations dapat memakai kuota dan tidak menyimpan gambarnya. Pollinations tidak melaporkan token, dan Monid bukan provider chat.
- Dropdown dapat merekomendasikan model NVIDIA NIM sebagai pilihan awal bila tersedia pada tier aktif; pilihan provider/model tersebut tetap dikirim secara eksplisit oleh UI dan pilihan manual pengguna per mode tetap disimpan. Backend memakai provider/model yang dipilih, termasuk untuk helper prompt dan input vision yang didukung; NVIDIA tidak menggantikan provider lain secara otomatis. Pencarian web tetap memakai Gemini/OpenRouter yang mendukung grounding, sedangkan pembuatan gambar memakai engine gambar khusus karena NIM gateway ini digunakan untuk chat/vision, bukan image generation. Stream melaporkan provider/model aktual; badge NVIDIA/Groq tidak menampilkan latency atau throughput untuk respons di bawah 100 ms. Biaya dan kuota NIM mengikuti akun NVIDIA.
- Jika provider mengembalikan HTTP 402/429, Worker dapat mencoba maksimal lima kandidat model FREE yang terverifikasi dari katalog aktif provider; kandidat fallback tanpa verifikasi katalog tidak digunakan. Stream mengidentifikasi provider dan model pengganti, dan UI memberi tahu pengguna sebelum menampilkan jawaban fallback. Harga nol OpenRouter harus diverifikasi dari katalog; penggunaan key Gemini/Groq/NVIDIA/provider lain tetap mengikuti kuota dan billing akun masing-masing.
- Semua route pemakaian AI login menggunakan satu tabel konfigurasi `AI_ROUTE_LIMITS` di Worker, Cloudflare Rate Limiting binding `AI_RATE_LIMITER` untuk batas per menit, dan Durable Object `AI_DAILY_RATE_LIMIT_STORE` untuk kuota harian per UID. Batas awal (per menit/per hari UTC): chat **5/100**, gambar via chat **5/10**, gambar **5/10**, transkripsi **5/30**, Monid discover **5/20**, inspect **5/30**, run **5/10**, get/status **5/120**, token Live **5/10**, optimasi prompt **5/60**, koneksi Canva **5/10**, presentasi **5/10**, Explorium **5/10**, tes kesehatan provider **5/30**, tes koneksi provider **5/30**, pratinjau email **5/20**, dan email **5/20**. Penolakan batas mengembalikan HTTP 429 dengan pesan Bahasa Indonesia; route terautentikasi tetap menolak pengguna tanpa login dengan HTTP 401.
- Sebelum setiap `POST /monid/run`, Worker memanggil `/inspect` dan hanya menjalankan endpoint jika `price.amount.value` dan `price.amount.currency` valid serta harga tidak melebihi `MONID_MAX_RUN_COST`. Nilai batas memakai satuan mata uang yang dilaporkan inspect; default `0` di `worker/wrangler.toml` hanya mengizinkan endpoint tanpa biaya. Harga yang hilang/tidak valid atau batas yang tidak dikonfigurasi menghentikan run dengan error, tanpa memanggil `/run`.
- **Migrasi binding rate limit:** ganti `GUEST_AI_LIMITER` menjadi `AI_RATE_LIMITER` di konfigurasi/deployment Cloudflare dan deploy Worker agar binding runtime baru tersedia. `namespace_id` rate limiter dipertahankan. Migrasi Durable Object `v3` menambahkan `AI_DAILY_RATE_LIMIT_STORE`; pertahankan deklarasi migrasi `v1`/`v2` yang sudah ada. Key per menit kini dipartisi per route, sehingga penghitung route mulai dengan namespace key baru setelah deploy.
- NVIDIA NIM memakai `https://integrate.api.nvidia.com/v1` dengan Bearer token serta `/models` dan `/chat/completions`, sesuai [referensi resmi NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/meta-muse-glimmer-30b-infer). Adapter lainnya mengikuti dokumentasi resmi [Gemini](https://ai.google.dev/api/generate-content), [Groq](https://console.groq.com/docs/api-reference#chat-create), [OpenRouter](https://openrouter.ai/docs/api_reference/overview), dan [Monid](https://docs.monid.ai/). Claude memakai adapter Anthropic langsung dengan secret `CLAUDE_API_KEY` atau `ANTHROPIC_API_KEY`; Kimi memakai Moonshot dengan `KIMI_API_KEY` atau `MOONSHOT_API_KEY`. Dokumentasi Pollinations tidak berhasil diverifikasi; tesnya memakai endpoint gambar yang sudah ada di aplikasi dan tetap **BUTUH VERIFIKASI resmi**.
- Endpoint terautentikasi `POST /health` menerima `{ "providers": ["groq"] }` atau tanpa daftar untuk menguji seluruh layanan di panel. Chat memakai model yang dipilih dari katalog provider dan batas 8 token; Monid health check hanya melakukan discover, sedangkan tes engine gambar membuat satu gambar kecil. Respons hanya berisi status, latensi, model, dan usage yang dilaporkan. Tidak ada key atau respons upstream mentah yang dikirim ke browser.
- Semua panggilan gateway memerlukan sesi Firebase valid dari akun Google/GitHub terverifikasi dan dibatasi rate limit per UID akun; tidak ada allowlist email tunggal. Pengguna login dapat memilih paket FREE, BASIC, PRO, atau MAX. Biaya serta kuota tetap mengikuti model/provider; OpenRouter free ditandai berdasarkan data harga katalog. Model berbayar tidak lagi meminta konfirmasi sebelum digunakan.
- Chat model gateway dikirim langsung ke route `/gateway` agar tidak melewati parsing ulang route `/chat`; Pages meneruskan stream SSE tanpa membuffer isi jawaban. Cache katalog edge berlaku lima menit, dan konteks chat dibatasi pada 20 pesan/40.000 karakter (100.000 karakter untuk Gemini), selain batas khusus guest.
- Worker mengizinkan origin Pages produksi/preview (`*.pages.dev`), `localhost`, dan origin tambahan eksplisit `APP_ORIGINS`; preflight mengembalikan `204` dengan metode `GET, POST, OPTIONS`. Upstream chat memiliki timeout 30 detik saat menunggu koneksi dan idle timeout 30 detik setelah stream dimulai, dengan komentar SSE heartbeat setiap 15 detik.
- Tombol globe **Search web / Cari di web** di composer mengaktifkan pencarian untuk pesan berikutnya. Gemini memakai Google Search grounding dan OpenRouter memakai plugin web; keduanya mengembalikan kutipan sumber yang ditampilkan sebagai tautan di bawah jawaban. Jika tool pencarian gagal sebelum model mulai menjawab, MyAI mencoba ulang tanpa pencarian.
- Pustaka markdown/sanitizer dibundel bersama aplikasi; Worker juga menyisipkan instruksi inti untuk akurasi, struktur, kelengkapan kode/dokumen, adaptasi gaya, dan menghindari kalimat pembuka generik.
- Domain Pages utama diizinkan otomatis; domain produksi tambahan dapat ditulis sebagai daftar origin dipisahkan koma pada variable Worker `APP_ORIGINS`.
- Setelah kode Worker diperbarui, deploy dari direktori `worker` dengan `npx wrangler deploy --config wrangler.toml`, lalu deploy Pages. Frontend meneruskan `/api/gateway` ke Worker tanpa mengekspos secret.
- Vite mem-proxy `/api` ke Cloudflare Pages gateway secara default, yang meneruskan request ke Worker produksi. Atur `MYAI_WORKER_URL=http://127.0.0.1:8787` untuk memakai Wrangler lokal; `.env.example` berisi URL Pages default. Seluruh kredensial provider tetap berada di Cloudflare Worker secrets atau file `.dev.vars` lokal yang diabaikan Git.

## Buat gambar, PPT, Word, Excel otomatis di v5.2

- Cukup tulis permintaan biasa, mis. "buatkan gambar kucing astronot", "buat PPT tentang pemanasan global 8 slide", "buatkan surat lamaran dalam format Word", atau "bikin Excel daftar gaji karyawan". MyAI mendeteksi jenis permintaan dan mengarahkannya ke AI yang mampu tanpa perlu ganti mode.
- Respons AI terstruktur `image_generation` dan mode **Gambar** untuk akun yang masuk menggunakan Gemini melalui endpoint Worker resmi yang terautentikasi. Pollinations juga dipanggil melalui endpoint Worker tervalidasi—terautentikasi untuk akun dan dibatasi per IP untuk guest—sehingga browser tidak menghubungi provider gambar secara langsung. Pemakaian server Gemini dapat mengonsumsi kuota atau biaya provider.
- **PowerPoint / Word / Excel / PDF**: model teks aktif diberi instruksi format khusus. Ekspor Canva otomatis mengirim outline ke Worker dan memerlukan Canva OAuth; opsi PowerPoint modern-gold membuat file dua slide lokal untuk impor manual ke Canva. Word, Excel, dan PDF tetap diekspor oleh browser.
- **Pratinjau proyek**: tombol tutup menggunakan dialog native agar tetap dapat menutup preview walaupun skrip proyek di dalam iframe mengalami error; Escape dan klik backdrop juga menutup dialog.
- Jika katalog AI guest sedang gagal dimuat, MyAI tetap menampilkan pilihan AI guest agar pengguna bisa mencoba layanan server dan menerima pesan error yang jelas jika Worker belum dikonfigurasi.
- Deteksi tidak aktif di mode Coding, dan tidak terpicu untuk pertanyaan seperti "cara membuat PPT", "kode Python untuk membaca Excel", atau "ringkas PDF ini".
- Tombol cepat **Buat gambar / Buat PPT / Buat Word / Buat Excel** tersedia di layar sambutan.

## Yang baru di v5.0

- **Kirim file lebih lengkap**: seret & lepas file/folder ke jendela, tempel gambar langsung (Ctrl/⌘+V), pilih banyak gambar sekaligus, chip lampiran dengan thumbnail & ukuran, deteksi duplikat, dan pesan error yang jelas.
- **Format baru**: Excel `.xls/.xlsx/.ods` (per lembar), OpenDocument `.odt/.odp`, `.rtf`, ZIP berisi daftar isi + file di dalamnya. PDF dibaca hingga 60 halaman dengan baris tetap utuh; PDF hasil scan otomatis dikirim sebagai gambar ke model vision. Batas 20 MB untuk dokumen/gambar, 8 MB untuk teks.
- **Mode tamu**: boleh melampirkan file teks/dokumen + 1 gambar per chat; percakapan panjang dipangkas otomatis agar tidak ditolak server.
- Mode **Gambar** untuk pengguna login memakai endpoint Gemini Worker; gambar gratis Pollinations untuk akun maupun guest juga diproksikan melalui Worker dan tetap dapat dibatasi oleh layanan upstream.
- **Pesan**: edit & kirim ulang pertanyaan, salin pesan, bacakan jawaban (🔊), rumus matematika (KaTeX), pratinjau HTML/SVG langsung dari blok kode, label bahasa pada kode, tautan terbuka di tab baru.
- **Konteks pintar**: tanggal/waktu dan profil "Tentang kamu" dikirim ke AI, riwayat dipangkas sesuai kapasitas model, gambar lama tidak dikirim ke model teks, dan otomatis beralih ke model vision bila ada gambar.
- **Riwayat chat**: dikelompokkan per tanggal, cari juga isi pesan, ganti nama (klik ✎ atau klik ganda), salin/unduh percakapan (.md) dari bilah atas.
- **Personalisasi** (✦ di menu kiri): simpan informasi profil di `myai_user_profile` dan gaya jawaban di `myai_custom_instructions`. Nilai yang tersimpan dikirimkan sebagai konteks preferensi melalui Worker ke model chat, dibatasi panjangnya, dan ditandai dengan badge **Personalized ON**; keduanya tetap berada di penyimpanan lokal sampai pengguna mengirim chat.
- **Input suara realtime** 🎙 melalui Gemini Live (perlu login dan secret Gemini Worker), tombol gulir ke bawah, dan pintasan: Ctrl/⌘+Shift+O chat baru, Ctrl/⌘+K cari, Esc hentikan jawaban.
- Build di macOS/Linux: `bash pages/build.sh` (Windows tetap memakai `pages/build.ps1`). Perubahan personalisasi ini juga mengubah Worker: deploy ulang Worker dan Pages agar injeksi instruksi dan antarmuka terbaru sama-sama aktif.

## Ekspor dokumen di v4.2

- Setelah AI menjawab, tekan **Ekspor** di bawah balasan. Pilih PowerPoint melalui Canva Connect untuk tautan edit/unduhan, atau PowerPoint modern-gold untuk mengunduh PPTX dua slide dan mengimpornya manual ke Canva. Word (`.docx`), Excel (`.xlsx`), dan PDF juga tersedia.
- Untuk PowerPoint yang rapi, minta AI membuat judul dan isi per slide. Untuk Excel, minta tabel dengan nama kolom dan nilai yang jelas. Ekspor menyertakan judul, daftar, tabel, dan sumber yang tersedia.
- DOCX/XLSX/PDF serta PPTX modern-gold dua slide dibuat di browser. Ekspor Canva Connect di Worker tetap tersedia untuk desain otomatis dan tautan edit.
- Ekspor mengubah jawaban yang ada; ia tidak membuat konten baru dan tidak menambahkan gambar AI ke slide.

Percakapan bisa dikelompokkan ke folder kerja di menu kiri. Tekan tombol **＋** di samping Folder kerja untuk membuat folder, lalu tekan ikon folder di baris chat untuk memindahkannya atau mengembalikannya ke **Obrolan biasa**. Folder tersimpan di browser; penempatan chat juga ikut tersimpan bersama chat dan dapat tersinkronkan jika Firebase aktif.

Percakapan dapat dikelompokkan ke folder kerja dari menu kiri. Buat folder melalui tombol **＋** di bagian Folder kerja, lalu gunakan ikon folder pada percakapan untuk memindahkan atau mengembalikannya ke **Obrolan biasa**. Nama folder disimpan di browser; penempatan folder pada percakapan ikut tersimpan bersama chat.

## Tampilan dan keamanan

- Login Google Firebase diperlukan untuk provider AI server dan digunakan untuk menyinkronkan riwayat chat.
- Tombol tema gelap/terang; pilihan tema disimpan di browser.
- Secret Worker tidak dikirim ke frontend. Chat AI berjalan melalui Worker terautentikasi; sesi akun tetap harus dijaga karena dapat mengakses kuota provider.

## Yang baru di v2.1

- **Logo & nama rapi tiap model**: Claude, GPT, Gemini, Qwen, DeepSeek, Llama, Mistral, Grok, Kimi, dll tampil dengan logonya (ikon dari [LobeHub Icons](https://github.com/lobehub/lobe-icons)).
- **Hanya versi terbaru**: versi lama otomatis disembunyikan (misal hanya Claude 5.5, bukan 3/4), tapi semua ukuran dari versi terbaru tetap ada (misal Qwen3.5 0.8B sampai 9B di mode lokal).
- **Pemilih model baru** dengan kotak pencarian dan pengelompokan per layanan.
- **Logo My AI** dari gambar `assets/myai-orbital-logo.png` di halaman pembuka/login dan area chat.
- **Composer satu kartu** dengan pemilih mode/model, lampiran file-folder, serta draft terpisah per mode agar tidak hilang saat berpindah mode.
- `kotak-prompt-myai.html` disertakan sebagai contoh prompt-box mandiri; `myai-repair-patch.md` berisi catatan perbaikan.

---

## Yang baru di v3.0

- **Tampilan ala Kimi**: sapaan dan kotak prompt terpusat saat chat kosong, chip saran di bawah prompt, sidebar abu muda, gelembung pengguna lembut, toast pil di atas, dan tema gelap yang selaras.
- **Mode AI terpisah** untuk Umum, Coding, dan Gambar. Mengirim saat file masih dibaca akan mengantre dan terkirim otomatis.
- Beranda kini tanpa contoh pertanyaan dan kartu petunjuk; composer ditempatkan lebih rendah agar layar chat lebih rapi.
- **Chip lampiran ringkas**: nama file tampil sebagai kartu kecil berikon di gelembung pengguna; isi file tetap dikirim ke model tetapi tidak ditampilkan di layar.
- Menu **+** ringkas untuk menambah file atau folder. Klik chip lampiran untuk membuka pratinjau.
- **Animasi loading AI**: teks shimmer dengan ikon bintang berputar.
- **Jawab ulang** pada balasan terakhir, tombol kirim dengan status warna (abu/hitam/merah), menu model yang terbuka otomatis pada model aktif, dan menu lampiran yang tertutup dengan Escape.

## Perbaikan sebelumnya di v2.2

- Isi file/folder tidak lagi ditampilkan sebagai teks panjang di balon chat; yang terlihat hanya pertanyaan dan ringkasan jumlah lampiran. Isi tetap dikirim ke model saat menganalisis file.
- Indikator animasi muncul saat file/folder dibaca dan saat AI sedang menyiapkan jawaban.
- Folder besar tetap ringkas di composer, dan proses unggah memberi ringkasan file yang berhasil dibaca/dilewati.
- Folder dependensi dan file berpotensi rahasia seperti `.env` atau private key dilewati otomatis. Konteks lampiran dibatasi agar permintaan tidak membengkak.
- Jawaban AI memiliki tombol **Salin jawaban**.
- Isi file tidak disimpan di riwayat permanen; isi lampiran tersedia untuk pertanyaan lanjutan hanya selama tab yang sama masih terbuka.
