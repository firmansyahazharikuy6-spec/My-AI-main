# Baseline Report — My AI V5 (Phase Zero)

**Tanggal:** 31 Oktober 2026
**Commit baseline:** `e3d6fdd` — *Production readiness audit fixes, account dashboard, and admin emails*
**Branch:** `fix/image-gen-hardening`
**Kondisi working tree saat audit:** bersih (clean), tidak ada perubahan belum di-commit.

Dokumen ini adalah hasil Phase Zero (discovery & baseline) dari MASTER ENGINEERING PROMPT — MY AI V5.
Belum ada file yang dimodifikasi saat laporan ini ditulis; semua "Required Action" dieksekusi pada fase berikutnya.

---

## 1. Pengukuran Baseline

| Pengukuran | Hasil | Bukti |
|---|---|---|
| Test suite (`node --test js/*.test.js worker/*.test.js pages/*.test.js`) | **309 tes, 303 lulus, 0 gagal, 6 skipped** | Output runner Node test |
| Production build (`vite build`) | **Sukses**; hanya warning ukuran chunk (vendor besar), bukan error | Output Vite |
| Git status | Bersih, HEAD = `e3d6fdd`, ter-push ke `fix/image-gen-hardening` | `git status` / `git log` |
| Deploy Pages + Worker | Terverifikasi deployable (alur lokal: build → salin ke `pages/dist` → wrangler deploy) | Riwayat deploy sesi sebelumnya (Worker `v32acf17a`) |
| Browser console (uji produksi) | Bersih tanpa error pada alur tamu: chat WebGPU, katalog 150 kemampuan, Download Center, pemilih tier | Browser otomasi (browser-use, produksi) |

---

## 2. Tabel Baseline — Area | Current Status | Evidence | Required Action

| Area | Current Status | Evidence | Required Action |
|---|---|---|---|---|
| **Frontend** | Berfungsi. Dashboard akun, pemilih tier, katalog 150 kemampuan, Download Center, PWA — semua termuat tanpa error console. Kelemahan: kartu kemampuan **tidak punya click handler** (murni informasional) padahal copy UI menjanjikan "MyAI yang memilihkan mesinnya"; stub mati `generateImageChat()` yang melempar 410; tidak ada penanganan `beforeinstallprompt`. | [js/app.js:6871-6889](file:///D:/My-AI-main/js/app.js#L6871) (kartu kemampuan tanpa handler), [index.html:320](file:///D:/My-AI-main/index.html#L320) (klaim copy), [js/index.js:813-815](file:///D:/My-AI-main/js/index.js#L813) (stub 410) | Fase 13: beri jalur eksekusi nyata pada kartu kemampuan **atau** perbaiki copy agar jujur; hapus stub mati; tambah prompt instal PWA. |
| **Backend** | Stabil. Pages `_worker.js` mem-proxy `/api/*` ke Worker dengan allowlist `API_ROUTES`; Worker menangani chat, kuota, DO, cron. Tidak ada route rusak yang ditemukan. | `pages/_worker.js`, `worker/src/` — proxy + route terverifikasi lewat deploy dan tes | Tidak ada perubahan besar. Pertahankan allowlist; audit lanjutan pada fase keamanan (lihat baris Security). |
| **Cloud AI** | Nyata & terintegrasi: Groq, NVIDIA, OpenRouter (termasuk Gemini Image via OpenRouter). Adapter per provider, streaming, akuntansi pemakaian, fallback transparan dengan label mesin pengganti. Model non-gratis dibatasi backend (`PREMIUM_ALLOWED_UIDS`). | Adapter di `worker/src/`, uji chat cloud di produksi (sesi sebelumnya) | Verifikasi secret provider masih valid di Cloudflare (tidak dapat diinspeksi dari kode — catatan jujur); tidak ada perubahan kode yang dibutuhkan saat ini. |
| **Local AI** | Nyata: WebGPU via web-llm 0.2.86 (62 model, q4f16_1), Ollama (`llama3.2`), trial tamu dibatasi Llama 3.2 1B Lite. Teruji end-to-end di browser (perkalian 12×13=156 via Llama Lite WebGPU; konektivitas Ollama OK). | Uji browser produksi; katalog di `js/`; CSP WebGPU di `pages/_headers` | **§6.2**: kebijakan "Local AI tanpa batas untuk Free" tidak boleh dipertahankan sebagai kebijakan final — batas harus dikonfigurasi (lihat §3 Keputusan Produk). Implementasi menunggu keputusan pemilik. |
| **Authentication** | Solid. Firebase JWT diverifikasi **di backend** (RS256, JWKS Google securetoken, `aud`/`iss`, `email_verified` wajib, provider dibatasi `google.com`/`github.com`). Worker menolak provider `password`/`phone`. | [worker/src/auth.js](file:///D:/My-AI-main/worker/src/auth.js) | Tidak ada tindakan wajib. Tinjau note asal `pages.dev` (baris Security) sebagai risiko rendah. |
| **Subscription** | Tier FREE/BASIC/PRO/MAX ada di UI; belum ada integrasi pembayaran (jujur, tidak ada transaksi palsu). Penegakan akses model backend via `PREMIUM_ALLOWED_UIDS` + matriks visibilitas tier di frontend. | `js/i18n.js` (kartu tier), `worker/src/` (allowlist premium) | **§6.5**: audit sentralisasi definisi entitlement agar tidak tersebar di banyak file frontend; siapkan konfigurasi terpusat tanpa membangun pembayaran palsu. |
| **Quota** | Tervalidasi backend penuh: chat cloud 3/hari non-admin (DO `AI_DAILY_RATE_LIMIT_STORE`), 5 perangkat terdaftar/akun (prune 90 hari), sinyal IP 200/hari sebagai sinyal tambahan, bypass admin server-side. Diperbaiki sesi ini: cek sinyal IP berjalan **sebelum** reservasi membakar kuota; status kuota menghitung perangkat aktif saja (dengan tes regresi). | [worker/src/rate-limit.js](file:///D:/My-AI-main/worker/src/rate-limit.js), `worker/quota.test.js` | **§6.4 (Prioritas Medium)**: belum ada idempotency key & refund untuk reservasi `cloud-chat` — kuota bisa hangus jika eksekusi gagal setelah reservasi, dan retry klien bisa memotong dua kali. Tambah reservasi atomik + idempotensi + kebijakan refund, lengkap dengan tes konkurensi. |
| **Creative Studio** | Modular: Image Engine dan Presentation Engine berdiri sendiri; kegagalan satu tidak menimpa lainnya. Video Engine tidak ada (jujur dilaporkan, bukan placeholder sukses). | `js/` + `worker/src/` per-engine | Pertahankan batas antar-engine saat menyelesaikan Image Engine (§10) dan Presentation (§11). |
| **Image Engine** | Nyata: OpenRouter Gemini Image (`/images/generate`), DO antrean edit dengan dedupe `requestHash`, 3 percobaan/edit. **Kelemahan utama:** tidak ada evaluasi output berbasis vision (`verifyMatch` selalu "unavailable") — akar masalah "gambar tidak mengikuti prompt"; stub `generateImageChat()` mati. | [worker/src/](file:///D:/My-AI-main/worker/src) (pipeline image + edit queue) | **§10**: klasifikasi task (t2i vs editing), analisis intent terstruktur, preservasi referensi (mask/lokalisasi bila provider mendukung), evaluasi vision dengan retry terbatas (default +2) dan kesadaran kuota/biaya. Hapus stub mati. |
| **PPT Engine** | Nyata: autofill template brand Canva + ekspor PPTX asli (`canva.ts`) + fallback lokal pptxgenjs 4.0.1. | `worker/src/` (canva/pptx), `js/` | **§11**: verifikasi kualitas desain hasil (bukan sekadar teks), lalu tingkatkan template bila kurang profesional. |
| **Video Engine** | **Tidak ada** — dan itu jujur: hanya penerbitan token Gemini Live untuk percakapan voice/video, bukan pembuatan video. Tidak ada klaim palsu di UI. | Grep `text-to-video|image-to-video|generateVideo` di `worker/src/` → 0 hasil | **§12**: pertahankan kejujuran; jangan bangun mesin video palsu. Cukup dokumentasikan ketersediaan. |
| **Security** | Kuat pada inti: auth server-side, sink XSS dilindungi DOMPurify, tidak ada secret di repo/log, admin tidak bisa diangkat dari frontend. Risiko Medium: tanpa idempotensi quota (lihat baris Quota). Risiko Low: origin wildcard subdomain `pages.dev`; route chat tanpa batas per-menit (hanya per-hari); fallback `documents.js` saat DOMPurify absen. | [worker/src/auth.js](file:///D:/My-AI-main/worker/src/auth.js), grep secret scan bersih | **Fase keamanan**: selesaikan idempotensi quota; tinjau tiga item Low satu per satu; tetap tanpa perubahan modul tak terkait. |
| **Performance** | Tidak ada masalah kinerja akut di produksi. Risiko staleness: service worker cache-first dengan `CACHE_NAME = "myai-shell-v1"` yang tidak pernah di-bump (aset bisa basi antar-rilis); `pages/_headers` tanpa aturan Cache-Control. | [www/service-worker.js:1](file:///D:/My-AI-main/www/service-worker.js#L1), `pages/_headers` | Fase performa: kebijakan cache eksplisit + bump versi cache SW tiap rilis + audit chunk build. |
| **Deployment** | Deployable penuh lewat alur lokal (Pages `myai-v3-firmansyah` + Worker `myai-v3-free-api`) dengan wrangler; tidak ada CI. Secret hidup di Cloudflare (bukan di repo). | Riwayat deploy terverifikasi; `wrangler.toml` tanpa `AI_PROVIDER_KEYS` | Pertahankan alur; jangan klaim sukses deploy tanpa konfirmasi platform; opsional: dokumentasikan alur deploy ulang di README. |

---

## 3. Keputusan Produk yang Wajib Dikonfirmasi Pemilik

Per §23 prompt (jangan mengarang kebijakan produk; tanya pemilik hanya untuk keputusan yang hilang):

1. **§6.2 — Batas Local AI untuk paket Free (SELESAI).** Keputusan pemilik (31 Oktober 2026): **"di luar admin hanya berlaku 5x/hari"**. Terimplementasi: counter harian AI Lokal = 5/hari untuk semua non-admin (belum ada pembayaran, jadi semua non-admin diperlakukan sama), admin tanpa batas. Counter terpisah penuh dari Cloud AI di DO yang sama, batas terkonfigurasi via `LOCAL_AI_DAILY_LIMIT` (wrangler.toml), reservasi idempoten (idempotency key TTL 1 jam), route `POST /api/local-quota/reserve` + `GET /api/quota` melaporkan `local.{used,limit,remaining}`. Frontend memesan kuota sebelum inferensi WebGPU/Ollama untuk pengguna login; tamu tetap memakai trial counter 2 jawaban. Kebijakan refund: AI Lokal berbiaya nol, reservasi dihitung saat mulai eksekusi dan tidak direfund — konsisten dan terdokumentasi.
2. Copy katalog kemampuan ([index.html:320](file:///D:/My-AI-main/index.html#L320)) — dua opsi: (a) kartu jadi fungsional (klik → mengisi prompt/engine sesuai §13), atau (b) copy diubah agar jujur ("katalog informasional"). Opsi (a) sejalan dengan §13; akan diusulkan di fase terkait.
3. Tingkat kedalaman desain PPT yang dianggap "profesional" (§11) — akan diusulkan berbasis inspeksi hasil ekspor, bukan ditanyakan sekarang.

---

## 4. Rencana Fase (urutan sesuai prompt)

1. ✅ Phase Zero — audit & baseline (dokumen ini).
2. Keamanan & anti-abuse: idempotensi/refund quota chat cloud (§6.4) + tinjau item Low.
3. ✅ Subscription & quota — **kuota AI Lokal Free 5/hari selesai** (counter independen + idempotensi + konfigurasi `LOCAL_AI_DAILY_LIMIT`). Sisa: sentralisasi penuh definisi entitlement (§6.5) saat integrasi pembayaran nyata.
4. Cloud AI: verifikasi/audit adaptor, tanpa perubahan yang tidak perlu.
5. Local AI & routing adaptif: audit rute + label transparan (label "tanpa batas" sudah dikoreksi).
6. Creative Studio: pembersihan stub, batas antar-engine.
7. Image Engine: §10 (intent, preservasi referensi, evaluasi vision + retry terbatas).
8. Presentation Engine: §11.
9. Video Engine: §12 (dokumentasi kejujuran).
10. Katalog kemampuan: §13 (jalur eksekusi nyata atau copy jujur).
11. Download Center: §14 (sudah jujur; verifikasi saja).
12. Dashboard & akun: verifikasi (sudah ada dari sesi sebelumnya).
13. Performa: cache policy + bump versi SW.
14. Regresi penuh + production readiness + laporan final (format A–K).

## 5. Hasil Fase Kuota AI Lokal (31 Oktober 2026)

**Implementasi:**
- `worker/src/rate-limit.js` — `LOCAL_AI_DAILY_LIMIT=5` (override env `LOCAL_AI_DAILY_LIMIT`), handler DO `/local-chat/reserve` atomik + idempotensi (TTL 1 jam, replay tidak menambah counter), `/quota/status` melaporkan `localUsed`/`localRemaining`, `reserveLocalChatQuota()` (bypass admin, error `LOCAL_QUOTA_EXCEEDED` 429).
- `worker/src/index.js` — route `POST /local-quota/reserve` (auth wajib, guest ditolak 401).
- `pages/_worker.js` — allowlist +`/api/local-quota/reserve`; `worker/wrangler.toml` — `LOCAL_AI_DAILY_LIMIT = "5"`.
- `js/app.js` — gate reservasi sebelum inferensi lokal (pengguna login; tamu tetap trial counter), dialog kuota varian lokal (tombol "Lanjut dengan AI Lokal" disembunyikan), indikator menu + dashboard menampilkan pemakaian AI Lokal, refresh kuota setelah chat lokal, copy "tanpa batas" dikoreksi di semua titik (dialog, dashboard, fallback, engine router, tier i18n EN+ID).
- Kebijakan refund: AI Lokal berbiaya nol → reservasi dihitung saat mulai eksekusi, tanpa refund; konsisten untuk semua kasus.

**Tes:** 3 tes baru di `worker/quota.test.js` (batas 5 + independensi cloud, idempotensi, bypass admin + limit terkonfigurasi). Suite penuh: **312 tes, 306 lulus, 0 gagal, 6 skipped** (baseline 309/303/0).

**Build & deploy:** Vite build sukses (warning ukuran chunk, sama dengan baseline). Deploy Worker `85709abc-7a29-4ef9-a05c-1175d99c5d08` + Pages `68092abe` sukses.

**Verifikasi browser produksi:**
- `GET /api/quota` tanpa login → 401 "Masuk terlebih dahulu" (auth tetap ditegakkan).
- `POST /api/local-quota/reserve` tanpa login → 401 (route + allowlist Pages terverifikasi live).
- Aplikasi termuat bersih tanpa error console baru.

**Masih butuh verifikasi manual pemilik (akun Google asli):**
1. Login Google (non-admin) → 5 chat WebGPU/Ollama sukses, chat ke-6 diblokir + dialog kuota lokal muncul, dashboard menampilkan pemakaian AI Lokal.
2. Login admin (email `AI_ADMIN_EMAILS`) → chat lokal tanpa batas, dashboard menampilkan badge ADMIN tanpa batas.
3. `GET /api/quota` saat login → memuat `local: {used, limit: 5, remaining}`.
