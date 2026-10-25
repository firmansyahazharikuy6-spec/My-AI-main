# MyAI v5.47 — Universal AI Gateway dengan Prioritas NVIDIA NIM

## Deskripsi proyek

MyAI adalah aplikasi AI full-stack untuk percakapan, pekerjaan, pembelajaran, dan pembuatan dokumen. Frontend web menyediakan pemilih model, ruang percakapan, panel status provider, dan alat produktivitas; backend Cloudflare Pages Functions meneruskan endpoint ke Cloudflare Worker. Worker mengelola katalog model, autentikasi, pemilihan rute, streaming jawaban, dan fallback provider tanpa mengekspos API key ke browser.

Integrasi NVIDIA NIM menjadi jalur inferensi utama untuk chat non-pencarian saat secret NVIDIA tersedia dan katalog menyediakan model yang kompatibel. Dukungan mencakup permintaan teks dan, jika tersedia model vision yang sesuai, input gambar. Model NVIDIA tetap dijalankan oleh layanan NVIDIA NIM; MyAI mengorkestrasi permintaan melalui Worker, bukan meng-host microservice inference NVIDIA sendiri.

## Masalah yang ditangani

Pengguna aplikasi AI yang bergantung pada satu provider dapat terdampak saat model tidak tersedia, kuota terlampaui, atau layanan mengalami gangguan. Pengguna UMKM juga membutuhkan alur kerja praktis yang menggabungkan bantuan AI dengan pembuatan dokumen, tanpa perlu mengelola API key di perangkat mereka.

MyAI menyatukan beberapa provider di belakang satu gateway, menampilkan provider/model aktual yang melayani jawaban, serta menyediakan mekanisme pemulihan ketika provider utama merespons status kuota tertentu. Sistem ini membantu menjaga kesinambungan alur kerja, tetapi tidak menjanjikan ketersediaan 100%: hasil tetap bergantung pada jaringan, kredensial, katalog, kuota, kebijakan, dan layanan upstream.

## Arsitektur teknis

```text
Browser / MyAI UI
  ├─ Pemilih model, percakapan, status provider dan metrik
  ├─ Parser SSE dengan pelepasan reader lock di blok finally
  └─ Alat produktivitas dan ekspor dokumen
          │ HTTPS + sesi Firebase
          ▼
Cloudflare Pages Functions
  └─ Proxy endpoint API menuju Worker
          │
          ▼
Cloudflare Worker — Universal Gateway
  ├─ Validasi sesi, rate limit, dan validasi payload
  ├─ Katalog model provider dengan cache edge
  ├─ Pemilihan rute utama dan adapter protokol upstream
  ├─ Streaming SSE: route, status provider, konten, usage, dan metrik
  └─ Fallback hingga lima kandidat pada kegagalan HTTP 402/429
          │
          ├─ NVIDIA NIM: default chat non-pencarian, helper, dan model vision kompatibel
          ├─ Groq: fallback prompt helper dan provider chat cadangan
          ├─ Gemini: provider chat dan jalur yang mendukung pencarian
          ├─ OpenRouter: katalog agregat dan dukungan pencarian yang tersedia
          ├─ Anthropic Claude
          └─ Moonshot Kimi
```

API key disimpan sebagai Cloudflare Worker secrets atau dalam konfigurasi secret server yang didukung. Browser tidak menerima nilai key. Pages meneruskan request API ke Worker dan mempertahankan streaming SSE untuk jawaban chat.

## Integrasi NVIDIA NIM

- Dropdown memilih model NVIDIA NIM sebagai default bila model tersedia pada tier aktif. Untuk chat non-pencarian, Worker memilih NVIDIA NIM apabila secret tersedia dan katalog menyajikan model yang cocok. Jika model vision yang kompatibel tersedia, input gambar dapat dirutekan ke model tersebut.
- Worker mengirimkan event rute SSE agar frontend dapat mencatat dan menampilkan provider/model yang benar-benar digunakan, termasuk saat rute berubah.
- Metrik jawaban mencakup durasi respons dan completion tokens per second, bila provider melaporkan usage dan durasi sekurang-kurangnya 100 ms. Badge latensi/throughput NVIDIA dan Groq disembunyikan untuk pengukuran di bawah 100 ms.
- Penggunaan NIM tunduk pada harga, kuota, dan kebijakan akun NVIDIA. Status “FREE” pada tier produk bukan jaminan bahwa penggunaan upstream tidak dikenakan biaya.
- Seluruh chat teks non-pencarian, termasuk helper prompt, diprioritaskan ke NIM. Pencarian web tetap memilih provider yang mendukung grounding; pembuatan gambar memakai engine gambar khusus karena jalur NIM ini untuk chat dan vision input, bukan image generation.

## Failover kuota dan ketersediaan

Jika percobaan provider utama berakhir dengan HTTP 402 atau 429, Worker dapat membentuk pool dinamis dari maksimal lima kandidat model lain yang memenuhi kriteria akses FREE dan kebutuhan request. Katalog, secret aktif, dukungan gambar/pencarian, serta status ketersediaan menentukan kandidat yang benar-benar dapat dicoba. Saat salah satu kandidat berhasil, stream dilanjutkan dan UI menerima metadata provider/model aktual tanpa menghentikan percakapan dengan error merah.

“FREE” di sini merujuk pada kriteria akses/tier model aplikasi. OpenRouter dibatasi ke kandidat yang katalog harga mengidentifikasi sebagai gratis; provider lain memakai key akun yang dapat tetap memiliki kuota atau konsekuensi billing. Karena itu, fallback tidak menjamin lima kandidat selalu tersedia ataupun menjamin pemakaian tanpa biaya. Kegagalan selain kuota tidak otomatis dialihkan tanpa aturan/konfirmasi yang sesuai.

## Fitur produktivitas dan manfaat UMKM

MyAI menyediakan bantuan menulis prompt, saran prompt, pembuatan konten, serta alur ekspor dokumen dan presentasi. Generator presentasi dapat menghasilkan PPTX dua slide bertema modern-gold untuk proses impor manual ke Canva. Fitur dan hasil tetap perlu ditinjau oleh pengguna sebelum dipakai sebagai materi publik atau keputusan bisnis.

### Contoh skenario: Currypap Jumbo Jeng Nita

Sebagai ilustrasi penggunaan—bukan klaim kemitraan atau hasil bisnis terukur—pemilik usaha kuliner seperti Currypap Jumbo Jeng Nita dapat menggunakan MyAI untuk menyusun variasi deskripsi menu, draf caption promosi, daftar ide konten, atau outline presentasi produk. Pengguna dapat meminta AI menyesuaikan gaya bahasa dengan pelanggan yang dituju, lalu memeriksa fakta, harga, bahan, dan klaim promosi sebelum publikasi. Jika provider utama mengalami kuota, gateway dapat mencoba kandidat lain yang tersedia sehingga pekerjaan memiliki peluang berlanjut tanpa pengguna harus mengganti provider secara manual.

## Keamanan dan batasan

- API key provider hanya ditempatkan di konfigurasi rahasia server, tidak ditanam dalam frontend atau commit.
- Endpoint Worker memvalidasi sesi dan menerapkan rate limit sesuai konfigurasi aplikasi.
- SSE menyampaikan konten dan metadata yang diperlukan UI; parser frontend membatalkan reader yang belum selesai dan selalu melepaskan lock di `finally`.
- Fallback dibatasi pada status kuota yang ditentukan dan kandidat yang lolos filter katalog/kemampuan.
- Layanan upstream dapat mengalami gangguan, perubahan katalog, batas penggunaan, atau biaya. Pengguna/admin harus memeriksa ketentuan harga serta kuota setiap provider.
- MyAI mengorkestrasi akses ke NVIDIA NIM; ketersediaan GPU, performa, dan pemrosesan inference ditentukan oleh layanan NVIDIA dan model yang tersedia untuk akun.

## Validasi yang tercatat

Pada validasi lokal finalisasi ini:

- Regression suite: **179/179 lulus**
- Feature checks: **8/8 lulus**
- Production web build: **berhasil**
- `git diff --check`: **tanpa kesalahan whitespace**

Validasi tersebut adalah pengujian lokal dan fixture; bukan uji beban, bukan verifikasi dengan seluruh API key produksi, dan bukan bukti deployment atau SLA. Sebelum rilis, jalankan kembali pemeriksaan pada lingkungan Cloudflare yang dituju dan verifikasi secret serta kuota provider secara aman.
