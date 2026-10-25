# MyAI — AI Chat Pribadimu (mirip ChatGPT / Claude / Gemini)

Website chat AI pribadi dengan frontend statis, Firebase Authentication/Firestore, dan backend AI Cloudflare Workers. AI guest tidak memerlukan login atau API key dari pengguna; jawaban dibatasi, tetapi tarif/kuota pada key provider yang dikelola aplikasi tetap dapat berlaku. Akun dapat menggunakan email/password, nomor telepon, Google, atau GitHub. Akses AI terkelola tetap dibatasi oleh daftar email yang diizinkan admin.

## Aplikasi Android dan iOS

MyAI dapat dibungkus sebagai aplikasi native Android dan iOS menggunakan Capacitor. ID aplikasi `com.myai.assistant` masih sementara dan harus dipastikan unik sebelum rilis store. Akun Google Play Console dan Apple Developer belum tersedia, jadi aplikasi belum dapat ditandatangani atau diterbitkan.

### Persiapan lokal

- Pasang Node.js 20+ dan npm.
- Untuk Android, pasang Android Studio, Android SDK, dan JDK yang didukung Android Studio.
- Untuk iOS, gunakan Mac dengan Xcode 26+; pembuatan dan penandatanganan aplikasi iOS tidak dapat dilakukan dari Windows.
- Aktifkan Email/Password, Phone, Google, dan GitHub di Firebase Authentication. Konfigurasikan domain resmi, OAuth GitHub callback Firebase, dan reCAPTCHA/kuota SMS untuk Phone. Tambahkan aplikasi Android/iOS ke proyek Firebase dan letakkan `google-services.json` di `android/app/` serta `GoogleService-Info.plist` di `ios/App/App/`. File tersebut adalah konfigurasi klien Firebase, bukan API key provider AI.
- Tambahkan fingerprint SHA-1/SHA-256 Android dan konfigurasi OAuth iOS di Firebase/Google Cloud sesuai aplikasi native.
- Siapkan kebijakan privasi publik, URL dukungan, aset ikon store, informasi rating konten, serta akun developer untuk pengajuan store.

### Perintah build

```sh
npm install
npm run cap:add:android
# Jalankan pada Mac untuk membuat target iOS:
npm run cap:add:ios
npm run cap:sync
npm run cap:open:android
npm run cap:open:ios
```

`cap:sync` membangun web app ke `www/`, menyalin aset ke platform Capacitor, dan menambahkan deklarasi izin kamera/mikrofon untuk live chat. Login Google, GitHub, dan Phone pada aplikasi native menggunakan plugin Firebase Authentication dan tetap menyinkronkan sesi dengan Firebase JavaScript SDK. Login email/password menggunakan Firebase Web SDK. Worker AI hanya menerima akun Google, GitHub, atau email/password yang alamat emailnya terverifikasi dan tercantum di `AUTHORIZED_EMAILS`; akun Phone tanpa email tertaut tidak memenuhi kebijakan tersebut. Worker mengizinkan origin Capacitor lokal untuk permintaan dari aplikasi terpasang. Uji login, izin perangkat, upload file, dan live video di perangkat asli sebelum rilis. Build dan uji native belum dijalankan di workspace ini karena Node.js/npm serta toolchain Android/Xcode tidak tersedia.

Model yang didukung:

| Sumber | Model | Biaya |
|---|---|---|
| **Google Gemini** | Model dari katalog Worker | Kuota dan biaya mengikuti akun/provider |
| **NVIDIA NIM** | Model dari katalog Worker | Kuota dan biaya mengikuti akun/provider |
| **Groq** | Model dari katalog Worker | Kuota dan biaya mengikuti akun/provider |
| **OpenRouter** | Model dari katalog Worker | Model gratis dan berbayar mengikuti konfigurasi Worker |
| **Monid** | Pencarian dan eksekusi data, bukan model chat | Dapat memakai saldo Monid |
| **Explorium** | Pencarian preview data perusahaan, bukan model chat | Dapat memakai kredit Explorium |

Tidak ada bobot model AI yang diunduh ke browser. Chat teks dan gambar berjalan melalui Cloudflare Worker; setiap jawaban tetap memerlukan internet dan mengikuti kuota/biaya provider.

Katalog model dimuat dari Worker setelah autentikasi. Browser hanya mengirim pesan, ID model, dan opsi request; secret provider tetap di Worker.

## Pengembangan lokal dengan Cloudflare Worker

Frontend lokal memakai origin tetap `http://127.0.0.1:4173`; Vite meneruskan `/api` ke Worker lokal pada `http://127.0.0.1:8787`. Jalankan keduanya di terminal terpisah:

```sh
npm run worker:dev
npm run dev
```

Untuk AI chat lokal, simpan secret provider di `worker/.dev.vars` (file ini diabaikan Git), misalnya `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, atau `NVIDIA_API_KEY`. Isi nilai secret secara lokal; jangan pernah memasukkan API key ke browser atau meng-commit file tersebut. Jika Worker tidak berjalan, UI akan menandai provider tidak dapat dijangkau. Untuk deploy, daftarkan secret dengan `npm run worker:secret -- GROQ_API_KEY` atau `npx wrangler secret put GROQ_API_KEY --config worker/wrangler.toml`.

Browser tidak dapat membaca LocalStorage dari port atau origin lain. Karena itu dev dan preview dikunci ke port 4173 agar riwayat chat, Tree Concept, dan telemetri tetap berada pada origin yang sama.

## Pembaruan keamanan dan stabilitas di v3.6

- Website dan jalur `/api` tersedia di Cloudflare Pages; gateway Pages meneruskan permintaan ke Worker tanpa mengekspos key provider.
- Katalog OpenRouter Worker memuat model teks gratis terkini dan backend menolak chat yang tidak sesuai allowlist.
- Key yang tidak didukung tidak dipakai; nama provider tersebut ditampilkan sebagai peringatan, sementara provider yang didukung tetap bisa digunakan.
- Mode Umum, Coding, Flash, Pro, dan Max memilih model rekomendasi berbeda jika katalog menyediakan pilihan yang sesuai. Pilihan manual disimpan per mode; model aktif juga disimpan berdasarkan ID model agar pilihan tetap terikat saat katalog dimuat ulang.
- Semua chat model dan katalog server dipanggil melalui Cloudflare Worker; browser tidak mengunduh bobot model atau mengirim request chat langsung ke provider.
- Localhost memakai proxy Vite menuju Worker lokal; produksi memakai route same-origin `/api` di Cloudflare Pages.
- Login dengan email terverifikasi yang tercantum di `AUTHORIZED_EMAILS` diperlukan untuk provider Worker.
- AI guest tersedia tanpa login jika secret provider dan binding rate limit sudah disiapkan di Worker.
- Login otomatis beralih ke redirect jika browser memblokir popup Google.
- Pemuatan katalog Worker memiliki batas waktu dan menjelaskan gangguan koneksi/DNS tanpa membuat tombol model terus menunggu.
- Backend memverifikasi token Firebase, provider masuk yang didukung, email terverifikasi, dan allowlist sebelum menerima permintaan.
- Model Worker mengikuti allowlist dan batas provider. Model berbayar/tarif tak diketahui dapat langsung digunakan tanpa konfirmasi biaya dan dapat menimbulkan tagihan provider.
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
- Admin tetap harus mengatur secret provider AI di Cloudflare Worker dan binding rate limit guest di `worker/wrangler.toml`. Tanpa konfigurasi server tersebut, frontend tidak dapat menjalankan model secara mandiri.
- Jika katalog model gagal dimuat, MyAI tetap memilih model guest server sehingga pengguna dapat mencoba fitur gratis dan melihat error yang dikembalikan Worker bila konfigurasi server belum siap.
- Admin harus menyiapkan secret Gemini atau Groq dan deploy `worker/wrangler.toml` terbaru, termasuk rate limit guest 5 request per 60 detik.
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
- Tombol ✨ mengirim draft langsung ke route Cloudflare Worker `/api/enhance-prompt`, memakai Groq `openai/gpt-oss-20b` dan tidak mengubah model chat pilihan. Route memerlukan sesi akun, memakai rate limit, serta memiliki batas upstream 4,5 detik dan frontend 4,8 detik. Bahasa hasil mengikuti draft, bukan bahasa UI; hasil terlalu panjang/berulang, membocorkan konteks internal, berbeda bahasa, atau gagal akan memakai template lokal yang mempertahankan draft.
- Tombol **Saran** meminta tiga alternatif prompt. Respons JSON yang disertai teks penjelas tetap diparse; hasil yang tidak valid, berulang, atau membocorkan konteks internal diganti dengan alternatif lokal. Pilih satu untuk mengganti draft, lalu sunting manual bila perlu.
- **Saran** memakai model chat cepat yang tersedia (atau template lokal); key provider tetap berada di secret Worker, tidak di browser.
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
- API key provider bukan bagian dari frontend: source code hanya memuat Firebase Web config publik. Key Gemini, Groq, dan OpenRouter disimpan sebagai secret Cloudflare Worker (`AI_PROVIDER_KEYS` atau secret provider individual). **Status AI Worker** hanya menampilkan provider yang aktif.
- Jika tidak ada model, buka **＋ → Status provider AI** dan periksa pesan status; untuk model server, pastikan Worker dapat dijangkau serta admin sudah memasang secret provider dan mengizinkan akun melalui `AUTHORIZED_EMAILS` atau `AUTHORIZED_PHONE_NUMBERS`.
- Avatar adalah ilustrasi antarmuka animasi, bukan manusia/video yang dibuat AI. Untuk percakapan video/audio real-time dua arah dibutuhkan API/provider yang menyediakan sesi real-time dan konfigurasi backend tambahan.

## Logo orbital, intro login, dan perbaikan dialog di v5.13

- Logo orbital My AI dari aset branding digunakan pada halaman awal, dialog login, ikon menu, chat kosong, favicon, dan metadata berbagi.
- Setelah Firebase mengonfirmasi login akun Google, layar intro logo tampil penuh dengan animasi lembut lalu memudar untuk memperlihatkan aplikasi. Untuk pengguna yang sudah login, intro juga tampil saat sesi dipulihkan setelah membuka ulang aplikasi.
- Intro dibuat dari aset gambar dan animasi CSS; tidak memerlukan file video tambahan.
- Dialog terpusat dan dibatasi tinggi viewport agar tetap dapat digunakan pada layar pendek/kecil. Untuk pengujian lokal, gunakan `http://localhost`, bukan `http://127.0.0.1`; hostname domain produksi tetap harus diizinkan pada Authorized domains Firebase.
- Pada versi sebelum v5.23, voice chat memakai pengenalan dan sintesis suara browser per giliran; sejak v5.23, tombol percakapan suara memulai sesi audio realtime Gemini Live.
- Tombol salin mencoba Clipboard API lalu fallback browser; tombol salin dan pratinjau kode ditempatkan sesudah blok kode. File Office dibuat lokal di browser dan PPTX dapat diimpor manual ke Canva; belum ada integrasi API Canva karena API resmi serta akses/otorisasi akun tidak disediakan proyek ini.

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

- Sebelum login, pengguna mendapat **maksimal dua jawaban AI** per alamat IP. Penghitung persisten memakai Durable Object; tidak ada reset otomatis. Jika seluruh provider gagal sebelum memberikan respons, Worker mengembalikan jatah. Masuk Google untuk melanjutkan. Deploy Worker terbaru beserta binding/migrasi `GUEST_TRIAL_COUNTER` sebelum mengaktifkan perubahan ini.
- Daftar guest memilih model chat tier dasar dari katalog aktual Gemini/Groq dan sebagian model OpenRouter yang katalog harganya menyatakan gratis. Model Gemini/Groq memakai key aplikasi sehingga tarif/kuota provider tetap dapat berlaku; hanya model OpenRouter dengan harga prompt/completion/request nol yang ditandai gratis terverifikasi.
- Kategori **Free / Basic / Pro / Max** mengelompokkan model berdasarkan harga/kinerja dan **bukan paket langganan atau hak akses berbayar MyAI**. Harga model di luar Free tetap mengikuti provider.
- Mode AI offline WebGPU telah dihapus. Tidak ada tombol atau alur chat yang mengunduh bobot model ke browser.
- DOCX, XLSX, dan PPTX menerima format tabel serta tipografi/warna dasar yang lebih teratur. PPTX disiapkan untuk diimpor ke Canva; integrasi Canva langsung belum tersedia.
- Pages menambahkan `nosniff`, kebijakan referrer, dan pembatasan izin browser yang tetap mengizinkan mikrofon satu-origin. CSP sengaja tidak ditambahkan karena aplikasi memuat Firebase dan pustaka ekspor dari CDN.
- Pada localhost, API diarahkan langsung ke Worker supaya tidak melewati preflight Pages gateway yang saat ini bermasalah; produksi tetap memakai route same-origin `/api`.

## Personalisasi dan bahasa di v5.4

- Menu **Personalisasi** di sidebar menyimpan informasi tentang pengguna dan gaya jawaban AI yang disukai, tanpa panel pengaturan lanjutan. Fitur pengelolaan data chat tetap tersedia dalam bagian lipat di dialog tersebut.
- Bahasa jawaban otomatis memakai bahasa utama perangkat/browser. Pengguna tetap bisa meminta bahasa lain langsung di chat; kemampuan tiap bahasa bergantung pada model yang dipilih. Teks bawaan lama diperbarui tanpa mengganti gaya khusus yang pernah ditulis sendiri.
- Mode **Ngobrol** memberi instruksi pada model untuk merespons dengan hangat dan santai, menjaga konteks percakapan yang tersedia, dan bertanya lanjut bila memang membantu. Mode ini tetap memakai model/provider yang dipilih; tidak ada model atau biaya terpisah.

## Multi-model AI Gateway

- Worker terautentikasi menyediakan satu endpoint `POST /gateway` untuk Gemini, Groq, NVIDIA NIM, dan OpenRouter. Masing-masing adapter memakai format request/auth provider yang sesuai; katalog model diambil dari endpoint provider dan di-cache singkat di Worker.
- Secret yang didukung adalah `GEMINI_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY` (alias `NVIDIA_NIM_API_KEY`), dan `OPENROUTER_API_KEY`, atau key provider yang sama di JSON secret `AI_PROVIDER_KEYS`. Wrangler meminta nilai secret secara interaktif; jangan menaruh key di source, `.env`, frontend, atau chat.
- Panel **Status AI Worker** membedakan secret terpasang dari koneksi yang sudah diuji. **Tes koneksi** dan **Tes semua provider** mengirim prompt chat singkat, menguji Monid lewat `discover`, serta meminta satu gambar kecil dari Pollinations dan Gemini Image. Hasil menampilkan status, latensi, model, dan token yang benar-benar dilaporkan; uji gambar dapat memakai kuota dan tidak menyimpan gambarnya. Pollinations tidak melaporkan token, dan Monid bukan provider chat.
- Saat model gagal, Worker membatasi retry ke HTTP 429 dan 5xx. Aplikasi tidak mengganti provider secara diam-diam: pengguna diminta mengonfirmasi provider alternatif sebelum konteks chat dikirim ke provider tersebut.
- NVIDIA NIM memakai `https://integrate.api.nvidia.com/v1` dengan Bearer token serta `/models` dan `/chat/completions`, sesuai [referensi resmi NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/meta-muse-glimmer-30b-infer). Adapter lainnya mengikuti dokumentasi resmi [Gemini](https://ai.google.dev/api/generate-content), [Groq](https://console.groq.com/docs/api-reference#chat-create), [OpenRouter](https://openrouter.ai/docs/api_reference/overview), dan [Monid](https://docs.monid.ai/). Model Claude, bila tersedia, dipanggil melalui OpenRouter menggunakan `OPENROUTER_API_KEY`; aplikasi tidak lagi memakai Anthropic API key secara langsung. Dokumentasi Pollinations tidak berhasil diverifikasi; tesnya memakai endpoint gambar yang sudah ada di aplikasi dan tetap **BUTUH VERIFIKASI resmi**.
- Endpoint terautentikasi `POST /health` menerima `{ "providers": ["groq"] }` atau tanpa daftar untuk menguji seluruh layanan di panel. Chat memakai model yang dipilih dari katalog provider dan batas 8 token; Monid hanya melakukan discover, sedangkan tes engine gambar membuat satu gambar kecil. Respons hanya berisi status, latensi, model, dan usage yang dilaporkan. Tidak ada key atau respons upstream mentah yang dikirim ke browser.
- Semua panggilan gateway memerlukan sesi Firebase yang diizinkan melalui `AUTHORIZED_EMAILS` atau `AUTHORIZED_PHONE_NUMBERS` dan dibatasi rate limit per UID akun. Biaya serta kuota tetap mengikuti model/provider; OpenRouter free ditandai berdasarkan data harga katalog. Model berbayar tidak lagi meminta konfirmasi sebelum digunakan.
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
- **PowerPoint / Word / Excel / PDF**: model teks aktif diberi instruksi format khusus, lalu file `.pptx`, `.docx`, `.xlsx`, atau `.pdf` dibuat dan diunduh otomatis. Kartu **Unduh** tetap ada di bawah jawaban dan di riwayat chat. PowerPoint membagi teks panjang agar tetap terbaca tanpa membuang slide berlebih; Word menjaga hierarki heading, daftar, tabel, dan metadata; Excel memisahkan tiap tabel ke lembar sendiri, mengubah angka (termasuk format `1.000.000` / `Rp`) menjadi angka asli, dan memasang filter kolom. Jika pustaka ekspor dari CDN gagal dimuat, notifikasi kini menyertakan penyebab teknis agar kegagalan mudah didiagnosis.
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

- Setelah AI menjawab, tekan **Ekspor** di bawah balasan untuk mengunduh Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`), atau PDF.
- Untuk PowerPoint yang rapi, minta AI membuat judul dan isi per slide. Untuk Excel, minta tabel dengan nama kolom dan nilai yang jelas. Ekspor menyertakan judul, daftar, tabel, dan sumber yang tersedia.
- File dibuat di browser. Koneksi internet diperlukan saat format pertama kali dipakai untuk memuat pustaka ekspor dari CDN.
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

## Penjelasan singkat (tanpa background AI)

- **Transformer** adalah arsitektur di balik semua AI modern (GPT, Claude, Gemini, Qwen, DeepSeek). Intinya: model membaca teks, menghitung "perhatian" (*attention*) antar kata, lalu menebak kata berikutnya, berulang-ulang.
- **Melatih model sendiri dari nol** butuh ribuan GPU dan biaya miliaran rupiah. Karena itu kita memakai **model hasil riset yang sudah ada** (Qwen dari Alibaba, DeepSeek, Llama dari Meta, Gemma/Gemini dari Google). Semua "pengetahuan" dan data riset sudah tertanam di dalam model-model itu.
- Aplikasi mengirim permintaan provider melalui Cloudflare Worker setelah memverifikasi login Google. Model dan kuota gratis bergantung pada provider serta akun yang memiliki key.
- Model tidak dijalankan secara lokal; aplikasi tidak mengunduh bobot model.

---

## Menggunakan AI

1. Masuk menggunakan Google.
2. Untuk API gratis yang dikelola Worker, akun harus terdaftar dalam secret `AUTHORIZED_EMAILS`.
3. Model yang tersedia muncul dari katalog Worker setelah login.
4. Semua jawaban memerlukan internet. Kuota/biaya provider mengikuti jenis key dan model yang dipilih.

Model pada grup **Gratis** tetap menggunakan kuota provider yang disediakan server; ketersediaannya bergantung pada konfigurasi admin. Grup **Premium / cek tarif** perlu dipilih dengan sengaja dan akan meminta konfirmasi sebelum permintaan dikirim.

### API key provider server

1. Simpan key sebagai Cloudflare Worker secret: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, dan `NVIDIA_API_KEY` (atau `NVIDIA_NIM_API_KEY`). Gunakan `MONID_API_KEY` secara terpisah untuk fitur data Monid. Alternatifnya, gunakan JSON secret `AI_PROVIDER_KEYS`.
2. Tambahkan email terverifikasi ke `AUTHORIZED_EMAILS`, lalu deploy Worker.
3. Browser tidak menerima nilai key; **Status AI Worker** hanya menampilkan provider yang aktif. Setelah mengganti secret dan men-deploy Worker, buka dialog tersebut lalu pilih **Muat ulang status provider** untuk mengambil katalog dan status key terbaru.

Kuota dan biaya model mengikuti provider. Jangan menaruh key provider di frontend, repository, atau chat.

### Pengiriman email

Pengiriman email memakai akun Resend yang dikonfigurasi admin. Verifikasi domain pengirim di Resend, lalu pasang `RESEND_API_KEY` dan `RESEND_FROM_EMAIL` pada Cloudflare Worker. Pengguna harus login ke akun yang diizinkan, meninjau email, dan menyetujui dialog konfirmasi sebelum email dikirim. Endpoint membatasi laju pengiriman per akun; isi email dikirim sebagai teks biasa.

### Pengingat perangkat

Pengingat terjadwal memakai notifikasi lokal Capacitor di aplikasi Android/iOS; notifikasi dapat tetap terjadwal saat aplikasi ditutup setelah izin perangkat diberikan. Browser web tidak menjanjikan alarm ketika tab atau aplikasi ditutup. Buat platform native (`npm run cap:add:android`, atau `npm run cap:add:ios` pada macOS dengan Xcode), lalu jalankan `npm run cap:sync`. Android meminta izin notifikasi dan izin alarm tepat waktu; iOS meminta izin notifikasi saat pengingat pertama dibuat. Platform native belum dibuat otomatis oleh build web.

## Setup Cloudflare Worker dan Pages gratis

Firebase Authentication dan Firestore tetap digunakan. Worker menyimpan secret provider; Pages menyajikan website serta gateway `/api` pada hostname `pages.dev`. Gateway ini diperlukan karena sebagian jaringan tidak dapat menjangkau hostname `workers.dev` secara langsung. Paket, batas, dan kuota provider dapat berubah; periksa [harga dan batas Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/) serta kuota provider sebelum deploy.

### Menjalankan dan deploy Worker

Konfigurasi Worker berada di `worker/wrangler.toml` dan memakai `worker/src/index.js` sebagai entrypoint. Nama `myai-v3-free-api` harus tetap sama karena Pages proxy pada `pages/_worker.js` meneruskan request ke hostname Worker tersebut.

```powershell
npm install
npx wrangler login
npm run worker:dev
npm run worker:deploy
```

Skrip `worker:dev` menjalankan Wrangler secara lokal; `worker:deploy` memperbarui Worker produksi. Setiap deploy Worker langsung memengaruhi backend yang dipakai Pages. Deploy Pages tetap merupakan langkah terpisah sesuai petunjuk di bawah.

Pasang key produksi secara interaktif dari root proyek; Wrangler meminta nilainya tanpa menuliskannya ke source code:

```powershell
npm run worker:secret -- GROQ_API_KEY
npm run worker:secret -- OPENROUTER_API_KEY
npm run worker:secret -- GEMINI_API_KEY
npm run worker:secret -- NVIDIA_API_KEY
npm run worker:secret -- MONID_API_KEY
npm run worker:secret -- EXPLORIUM_API_KEY
npm run worker:secret -- AUTHORIZED_EMAILS
```

Hanya pasang key provider yang memang tersedia/akan dipakai. Alias yang juga diterima Worker: `NVIDIA_NIM_API_KEY`. `RESEND_API_KEY` opsional untuk fitur email. Jangan memasukkan key ke `wrangler.toml`, frontend, atau Git. Untuk pengujian lokal, buat `worker/.dev.vars` (file ini diabaikan Git) dengan satu pasangan `NAMA_SECRET="nilai"` per baris; gunakan key uji dan jangan unggah file tersebut. `FIREBASE_PROJECT_ID` sudah menjadi variable non-rahasia pada konfigurasi Worker.

Secara default Worker membatasi Origin ke domain Pages, `localhost`, dan `127.0.0.1`; `APP_ORIGINS` di `worker/wrangler.toml` dapat diisi daftar domain tambahan yang dipisahkan koma sebelum deploy. Respons preflight menyediakan `GET, POST, OPTIONS`, header `Content-Type` dan `Authorization`, serta CORS wildcard tanpa kredensial cookie. Worker tetap memeriksa Origin yang diizinkan sebelum memproses route.

Verifikasi setelah deploy: buka `https://myai-v3-free-api.firmansyahazharikuy6.workers.dev/api/models` atau `/models` untuk memastikan Worker menjawab (endpoint model terproteksi dapat membalas 401 tanpa sesi, yang menunjukkan Worker tercapai); jalankan chat dari website Pages setelah login; lalu periksa Cloudflare Workers → Logs untuk error. Keberhasilan `wrangler deploy` saja tidak membuktikan key provider, allowlist Firebase, kuota, atau integrasi UI produksi berfungsi. Jangan mengirim API key melalui chat.

1. Pastikan Firebase Google Sign-In aktif. Setelah Pages dideploy, tambahkan hostname `myai-v3-firmansyah.pages.dev` ke **Firebase Console → Authentication → Settings → Authorized domains**. Untuk tes lokal gunakan `localhost`, bukan `127.0.0.1`. Firebase project saat ini `my-ai-69027`.
2. Secret `AI_PROVIDER_KEYS` dan `AUTHORIZED_EMAILS` tetap berada di Worker lama. Nilai secret tidak bisa dibaca atau dipindahkan otomatis, tetapi gateway Pages tidak memerlukan salinan secret.
3. Untuk membangun dan mengunggah website ke Pages, dari folder proyek jalankan:

   Di macOS/Linux cukup jalankan `bash pages/build.sh`, lalu `cd pages` dan perintah `npx wrangler` yang sama.

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\pages\build.ps1
   cd .\pages
   npx wrangler@latest pages project create myai-v3-firmansyah --production-branch main
   npx wrangler@latest pages deploy .\dist --project-name myai-v3-firmansyah
   ```

   Perintah `pages project create` hanya diperlukan sekali. Jika Wrangler menyatakan project sudah ada, lanjutkan ke deploy.    `pages\_worker.js` meneruskan endpoint AI `/api/...` ke Worker yang sudah ada; file build tidak memuat folder `functions/` atau file `.env`.
4. Setelah deploy, gunakan URL `https://myai-v3-firmansyah.pages.dev`. Frontend sudah memakai URL API relatif `/api`. Situs GitHub Pages lama tidak berubah; gunakan URL Pages yang baru untuk login dan chat.
5. Jika menyiapkan Worker dari awal, tambahkan email Google yang boleh memakai API. Saat CLI meminta nilai secret, masukkan alamat email yang diizinkan; untuk beberapa alamat pisahkan dengan koma:

   ```powershell
   cd ..\worker
   npx wrangler@latest login
   npx wrangler@latest deploy
   npx wrangler@latest secret put AUTHORIZED_EMAILS
   ```

6. Simpan key provider yang punya paket gratis sebagai JSON secret Worker:

   ```powershell
   npx wrangler@latest secret put AI_PROVIDER_KEYS
   ```

   Contoh format: `{"openrouter":"KEY_OPENROUTER","gemini":"KEY_GEMINI","groq":"KEY_GROQ","nvidia":"KEY_NVIDIA"}`. Ganti nilai contoh dengan key milikmu. Nama provider JSON yang diterima adalah `openrouter`, `gemini`, `groq`, dan `nvidia`. Secret terpisah akan diprioritaskan untuk provider yang sama. Jangan kirim key melalui chat, jangan taruh di file frontend, dan jangan unggah file `.dev.vars`.

   Untuk menambah atau mengganti satu key tanpa menimpa JSON tersebut, simpan sebagai secret terpisah dari folder `worker`. Secret terpisah yang dikenali: `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY`/`NVIDIA_NIM_API_KEY`, `MONID_API_KEY`, dan `EXPLORIUM_API_KEY`. Provider harus mengaktifkan akses API untuk key tersebut; konfigurasi hanya dibaca Worker dan nilainya tidak dikirim ke browser.

   Katalog chat mencakup semua model teks yang dikembalikan katalog Gemini, Groq, OpenRouter, dan NVIDIA NIM; hasil OpenRouter tidak dipotong ke batas jumlah model. Integrasi langsung Kimi/Moonshot dan Anthropic telah dihapus; model Claude atau Kimi yang tersedia melalui OpenRouter tetap memakai key OpenRouter. Model khusus gambar, audio, transkripsi, serta tugas non-chat lain dikeluarkan dari daftar chat. Pages meneruskan `/api/models` dan `/api/chat` ke Worker; endpoint chat juga mempertahankan route `/gateway` lama. Katalog mengelompokkan model berdasarkan kemampuan: akses dasar/ringkas di **FREE**, model umum di **BASIC**, model besar atau reasoning di **PRO**, dan model flagship (mis. Gemini Pro, Claude Sonnet/Opus, serta model sangat besar) di **MAX**. Pemilihan tier mencakup seluruh tier yang lebih rendah. Tier aplikasi berbeda dari billing provider; biaya tetap mengikuti ketentuan provider. Pilihan paket disimpan di browser dan bukan sistem pembayaran atau otorisasi langganan server-side. Dialog paket menampilkan provider dan jumlah model yang benar-benar dimuat untuk setiap tier. Monid memakai `MONID_API_KEY` untuk menemukan dan mengeksekusi endpoint data **BASIC**, bukan sebagai model chat. Explorium memakai `EXPLORIUM_API_KEY` server-side untuk mencari maksimal satu hasil preview perusahaan; panggilan ini dapat memakai kredit provider. Hasil Explorium dapat digabungkan dengan hasil run Monid yang sudah dijalankan, lalu diekspor langsung di browser sebagai DOCX, PPTX, atau XLSX tanpa panggilan AI tambahan. Periksa harga dan saldo provider sebelum menjalankan pencarian atau endpoint. Mode **Cari di web** dan **Riset mendalam** memakai Google Search grounding melalui Gemini atau plugin web OpenRouter; jika model terpilih tidak mendukung pencarian, UI berpindah ke model Gemini/OpenRouter yang tersedia pada tier aktif atau menampilkan alasan. Sumber yang dikembalikan provider ditampilkan dan ikut ekspor dokumen. Biaya provider/model dapat berlaku. Ini bukan koneksi ke setiap situs internet atau Bing, dan cakupan hasil mengikuti provider. Jika katalog gagal dimuat, dropdown menyediakan katalog model lokal cadangan yang ditandai belum diverifikasi; ID model cadangan dapat berubah atau tidak tersedia di provider. Tombol **Rapikan** dan **Saran** memakai template lokal saat AI tidak tersedia. Saat koneksi tersedia, **Rapikan** memprioritaskan Groq, lalu Gemini, kemudian model cepat cadangan yang diizinkan tier aktif. Fallback gateway tidak berpindah provider secara diam-diam; alternatif lain hanya dipakai setelah persetujuan pengguna.

   Endpoint pembuatan gambar memakai `GEMINI_API_KEY` sebagai secret server-side. Pasang atau perbarui key dari folder `worker` dengan `npx wrangler@latest secret put GEMINI_API_KEY`, lalu deploy ulang Worker dan Pages agar keduanya memakai route terbaru. Route `/images/generate` hanya menerima akun terverifikasi yang ada di `AUTHORIZED_EMAILS`, membatasi prompt dan rasio gambar, serta memakai rate limit Worker yang sudah dikonfigurasi. Pemakaian Gemini dapat mengonsumsi kuota atau biaya provider; periksa paket dan batas billing Gemini sebelum mengaktifkan endpoint.

Jika memakai sinkronisasi chat, aktifkan **Firestore Database** dan publikasikan aturan dari `firestore.rules`. Firebase Functions tidak diperlukan untuk API AI; `firebase.json` hanya menargetkan aturan Firestore agar Functions lama tidak ikut ter-deploy.

Menu **Status provider AI** menampilkan provider yang tersedia setelah login. Untuk mengganti satu key, jalankan `npx wrangler@latest secret put OPENROUTER_API_KEY` (atau nama secret provider lain di atas) dari folder `worker`. Untuk memperbarui semua key sekaligus, jalankan `npx wrangler@latest secret put AI_PROVIDER_KEYS`. Wrangler menerbitkan versi Worker yang memakai secret baru.

### Pemecahan masalah login dan model

- Jika login menunjukkan `unauthorized-domain`, tambahkan hostname yang sedang digunakan, misalnya `myai-v3-firmansyah.pages.dev`, di **Firebase Console → Authentication → Settings → Authorized domains**. Untuk lokal, gunakan `localhost` (bukan `127.0.0.1`). Pastikan provider Google aktif.
- Jika katalog menunjukkan timeout dari website Pages, periksa status gateway Pages dan Worker yang menjadi tujuan; mengganti API key tidak memperbaiki gangguan koneksi.
- OpenRouter hanya mengizinkan chat untuk model yang pada katalog terbarunya memiliki ID `:free`, input/output teks, dan semua harga nol. Model di luar syarat ini akan ditolak meskipun masih tampak di daftar awal saat katalog sedang tidak dapat diakses.

> `firebaseConfig` di frontend berisi konfigurasi publik Firebase; ia bukan tempat menyimpan provider API key. Jangan pernah menaruh provider key di `js/config.js`, file HTML/JS, atau variabel yang ikut dikirim ke browser. Paket gratis provider tidak menjamin akun tetap gratis jika billing diaktifkan atau kebijakan provider berubah.

---

## Struktur file

```
index.html        Tampilan utama
assets/myai-orbital-logo.png  Logo My AI untuk halaman pembuka, login, menu, favicon, dan intro
assets/logo.svg       Ikon SVG lama
css/style.css     Desain (tema gelap)
js/config.js      Nama app, versi, URL Worker + konfigurasi Firebase
js/app.js         Logika UI chat & pemilih model
js/models.js      Logo model, nama rapi, filter "hanya versi terbaru"
js/providers.js   Katalog model dan koneksi ke Cloudflare Worker/provider
js/db.js          Firebase Authentication dan riwayat chat (Firebase / localStorage)
pages/            Gateway API same-origin dan build statis Cloudflare Pages
firestore.rules   Aturan keamanan database Firestore
worker/           Backend AI gratis (Cloudflare Worker + Wrangler)
firebase.json     Konfigurasi aturan Firestore; tidak men-deploy Functions
.firebaserc       Alias proyek Firebase untuk CLI
```

## Tips

- **Ganti nama AI-mu**: ubah `APP_NAME` di `js/config.js`; ganti logo di `assets/myai-orbital-logo.png`.
- Mode **Coding** memfilter model coding jika tersedia. Generasi gambar dan pencarian web dinonaktifkan pada konfigurasi gratis ini.
- Menu **+** menyediakan tambah banyak file sekaligus atau seluruh folder. Klik chip file sebelum/ sesudah dikirim untuk melihat pratinjau selama tab masih terbuka.
- Lampiran teks/kode, PDF, DOCX, XLSX, PPTX, ZIP, serta gambar umum dapat dibaca; file gambar dikirim sebagai input visual ke model vision yang mendukungnya.
- Respons JSON bertipe `text`, `image_generation`, `image_compress`, `file_converter`, `vision_analysis`, `ppt`, `doc`, `excel`, dan `tool_call` divalidasi di `js/response-handler.js`. Percakapan biasa memakai jawaban natural dan tidak dipaksa ke format JSON; format terstruktur hanya diminta untuk permintaan gambar/file/tindakan yang membutuhkannya. Kompresi gambar memakai Canvas API di browser melalui `js/image-compression.js`; pengguna dapat mengaksesnya dari menu lampiran atau respons AI. File tidak diunggah ke server, format keluaran dibatasi ke JPEG/PNG/WebP, ukuran input dibatasi 50 MB, dan preview memakai object URL yang dilepas saat chat dirender ulang. Engine file di `js/file-tools-engine.js` memuat `pdf-lib`, `pdfjs-dist`, `jspdf`, `jspdf-autotable`, `mammoth`, `xlsx`, `docx`, dan `jszip` dari CDN hanya saat operasi dipilih; semua proses file berjalan di browser. Konversi PDF ke Word mengekstrak teks (tidak mempertahankan tata letak/OCR), Word ke PDF merender teks dasar, PDF ke gambar dan pemisahan beberapa rentang menghasilkan ZIP, dan optimasi PDF menulis ulang struktur tetapi tidak mengompres gambar tertanam. File dibatasi 100 MB per berkas, 200 MB total, dan maksimum 30 berkas per operasi. Gambar hasil analisis menampilkan temuan/OCR dan saran tindak lanjut pilihan pengguna; rasio gambar, tema slide, catatan pembicara, serta tabel dan formula spreadsheet yang dibatasi ikut diproses saat ekspor. `assigned_model` adalah label tujuan tugas, bukan izin untuk mengganti model pilihan pengguna atau memakai model berbayar. `tool_call` tidak dijalankan otomatis; pengiriman email membutuhkan persetujuan klik dan backend same-origin `POST /api/send-email` yang dikonfigurasi terpisah serta hanya dianggap berhasil jika backend mengembalikan `{ "ok": true }` atau `{ "success": true }`. Jangan menyimpan kredensial email di frontend.
- **Keamanan**: secret provider berada di Cloudflare Worker dan tidak pernah dimuat ke browser. Jaga sesi akun karena sesi tersebut memberi akses ke kuota Worker.
- Model/provider yang menyediakan kuota gratis dapat mengubah model, kuota, harga, dan kebijakannya kapan saja.

## Rotasi API key

Jika API key provider terekspos, cabut key lama di dashboard provider, lalu simpan key pengganti sebagai secret individual (misalnya `npx wrangler@latest secret put OPENROUTER_API_KEY`) dari folder `worker`. Jangan pernah mengirim key ke chat atau menyimpannya di frontend.
