# Audit & Persiapan Rilis My AI V5 (31 Oktober 2026)

Dokumen ini mencatat hasil audit produksi SaaS My AI V5, perbaikan yang diterapkan, dan hasil pengujian per fase. Target: versi final yang stabil, aman, dan berfungsi — bukan sekadar tampak lengkap.

## Fase 1 — Audit SaaS & keamanan

**Metode:** review kode penuh `worker/src/rate-limit.js`, route kuota di `worker/src/index.js`, proxy `pages/_worker.js`, frontend kuota/mesin adaptif (`js/app.js`, `js/engine-router.js`), plus full test suite.

**Hasil: 307 tes, 301 pass, 0 fail (awal audit).**

### Temuan

| # | Severitas | Lokasi | Temuan |
|---|-----------|--------|--------|
| A | Sedang | `js/app.js` (blok mesin adaptif di `respond()`) | `routeAdaptiveModel` menerima `[...models.values()]` tanpa filter tier/provider — bisa merutekan akun FREE ke model cloud (melanggar aturan "FREE lokal saja") atau memilih model di atas tier akun. Blok fallback vision tepat di atasnya sudah memfilter dengan benar. |
| B | Ringan | `worker/src/rate-limit.js` (`/quota/status`) | `deviceCount` menghitung semua device termasuk yang idle (> 90 hari) — laporan bisa berlebihan sampai register berikutnya memangkas. |
| C | Ringan | `worker/src/rate-limit.js` (`enforceCloudChatQuota`) | Urutan cek: device → reservasi cloud → sinyal IP. Jika sinyal IP memblokir (IP dipakai banyak akun), reservasi kuota cloud sudah terbakar sia-sia. |

### Area yang dinyatakan aman

- `GET /api/quota` berada di belakang `requireAuthorizedUser` → guest mendapat 401 `{"error":{"message":"Masuk terlebih dahulu."}}` (terverifikasi via curl).
- Error handler utama mengembalikan JSON bersih dan mempertahankan `code` (`CLOUD_QUOTA_EXCEEDED`, `DEVICE_LIMIT_EXCEEDED`, `IP_ABUSE_SIGNAL`).
- Validasi input Durable Object solid: `body.limit` harus safe integer ≥ 1, `deviceHash` harus hex 64 karakter, `maxDevices` 1–20, JSON tidak valid → 400.
- Kuota cloud ditegakkan di semua jalur chat (rute `chat` cabang gateway & langsung, rute `gateway`), sebelum request ke provider.
- CORS & header `X-Device-Id` lengkap di Worker dan proxy Pages; format guest device ID (UUID v4, 36 karakter) lolos pola `[A-Za-z0-9-]{8,64}`.
- Identitas tidak bergantung pada IP: akun Firebase + hash device + IP hanya sinyal tambahan (ambang 200/hari/jaringan).

## Fase 2 — Perbaikan bug hasil audit

1. **Fix A** — blok mesin adaptif kini memfilter model dengan `isTierAvailable(modelTierCategory(model), activeTier)` dan `isProviderAllowedForTier(model.provider, activeTier)` (pola sama dengan fallback vision).
2. **Fix B** — `/quota/status` menghitung hanya device aktif (`now - lastSeen < idlePruneMs`, default 90 hari; dapat di-override via `body.idlePruneMs` untuk pengujian).
3. **Fix C** — `enforceCloudChatQuota` memeriksa sinyal IP **sebelum** reservasi kuota cloud; device heartbeat tetap dicatat lebih dulu.

**Test regresi baru di `worker/quota.test.js` (2 tes):**

- "quota status counts only devices seen within the idle prune window" — device aktif terhitung, `idlePruneMs: 0` → 0.
- "IP abuse block fires before the cloud chat reservation burns quota" — IP sinyal habis → `IP_ABUSE_SIGNAL` 429 dan `chatUsed` tetap 0 (sebelum perbaikan: reservasi terbakar). Memakai binding DO palsu dengan storage memori yang meniru `stub.fetch(url, init)`.

**Hasil: 309 tes, 303 pass, 0 fail.**

## Fase 3 — Stabilisasi integrasi Cloud & Local AI

Build Vite sukses → deploy Worker (`myai-v3-free-api`, versi 956f20b8) → deploy Pages (`myai-v3-firmansyah`). Verifikasi browser produksi (fresh cache-bust):

- **Guest chat → WebGPU berhasil:** pertanyaan "12×13" dijawab "156" oleh Llama 3.2 1B · Lite (jalur trial lokal tanpa Turnstile — sesuai desain: Turnstile hanya untuk guest cloud).
- **WebGPU aktif:** `navigator.gpu` tersedia; model dimuat dan inferensi berjalan di browser AMD.
- **Ollama lokal reachable:** `http://localhost:11434/api/tags` dari origin produksi → `llama3.2:latest` (CORS OK).
- **Katalog 150 kemampuan:** 150 kartu, 12 kategori + "Semua", pencarian "kode" → 6/150, badge mesin Cloud/WebGPU/Ollama per kemampuan.
- **Download Center:** 3 platform; Desktop direkomendasikan otomatis (perangkat ini Desktop), Mobile/Desktop "SEGERA HADIR", Web App "AKTIF".
- **Console bersih** — hanya warning Chromium `powerPreference` (bukan bug aplikasi).
- Chat cloud (OpenRouter/Groq/NVIDIA) memerlukan login OAuth → diverifikasi pengguna di browser asli; logika backend-nya tertutup oleh tes kuota + gateway.

## Fase 4 — Paket (tier Free/Basic/Pro/Max)

- Copy paket di `js/i18n.js` (EN + ID) dibuat jujur soal kuota: dialog tier dan fitur kartu FREE kini menyebut **"3 chat cloud/hari + AI lokal tanpa batas"**; dialog menjelaskan paket lebih tinggi membuka lebih banyak model cloud.
- Modal tier terverifikasi di browser: kartu FREE menampilkan fitur baru, pemilihan BASIC mengubah status "Selected" dan tombol konfirmasi "🚀 Activate engine BASIC" (pemilih tier murni pengatur visibilitas model; billing belum diaktifkan — tidak ada klaim pembayaran).

## Fase 5 — Dashboard pengguna

Dialog **Dashboard Akun** baru (index.html, `js/app.js`, `css/style.css`), terbuka dari baris "Dashboard Akun" di popover akun atau klik baris "Kuota Hari Ini":

- **Paket:** badge FREE (3 chat cloud/hari) atau ADMIN (tanpa batas) + penjelasan.
- **Pemakaian Chat Cloud Hari Ini:** angka `used dari limit` + progress bar.
- **Perangkat Terdaftar:** `count dari 5` + catatan prune 90 hari idle.
- **Email Admin MyAI:** daftar email admin (hanya tampil untuk admin).
- **Aksi cepat:** Paket Engine, 150 Kemampuan, Download Center.
- Data dari `GET /api/quota` (login wajib); tombol "Muat ulang kuota" bila gagal dimuat; guest diarahkan login.

## Fase 6 — Hasil akhir & catatan rilis

**Full suite final: 309 tes, 303 pass, 0 fail, 6 skipped.** Build Vite sukses, Worker + Pages live.

### Yang perlu diverifikasi pengguna di browser asli (tidak bisa diotomasi)

1. Login Google → popover akun → baris "Dashboard Akun" dan "Kuota Hari Ini" (klik membuka dashboard dengan angka nyata).
2. 3 chat cloud/hari → dialog kuota muncul → "Lanjut dengan AI Lokal" / "Lihat Paket Upgrade".
3. Mesin adaptif (toggle) memilih rute dan menampilkan label transparan.
4. Perangkat ke-6 diblokir dengan `DEVICE_LIMIT_EXCEEDED` (403).

### Tindak lanjut yang menunggu user

- Daftar email tim admin → isi `AI_ADMIN_EMAILS` di `worker/wrangler.toml`.
- Installer Mobile/Desktop asli untuk Download Center (saat ini placeholder jujur "Segera hadir").
- Billing/pembayaran paket berbayar (saat ini tier = visibilitas model; kuota FREE tetap ditegakkan backend).
