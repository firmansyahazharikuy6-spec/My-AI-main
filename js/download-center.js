// Download Center MyAI: tiga platform (Mobile, Desktop, Web App), rekomendasi
// otomatis sesuai perangkat, opsi unduh satuan, dan ZIP gabungan per platform.
// Installer Mobile & Desktop belum tersedia — placeholder "Segera hadir";
// Web App sudah aktif.

export const DOWNLOAD_PLATFORMS = Object.freeze([
  {
    id: "mobile",
    label: "Mobile",
    icon: "📱",
    description: "Android & iOS — MyAI dalam genggaman.",
    status: "soon",
    formats: Object.freeze([
      Object.freeze({ id: "android", label: "Android (APK)", size: "—", status: "soon" }),
      Object.freeze({ id: "ios", label: "iOS (App Store)", size: "—", status: "soon" }),
      Object.freeze({ id: "mobile-zip", label: "Semua file Mobile (ZIP)", size: "—", status: "soon" }),
    ]),
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: "🖥️",
    description: "Windows, macOS, dan Linux — performa penuh.",
    status: "soon",
    formats: Object.freeze([
      Object.freeze({ id: "windows", label: "Windows (Installer)", size: "—", status: "soon" }),
      Object.freeze({ id: "macos", label: "macOS (DMG)", size: "—", status: "soon" }),
      Object.freeze({ id: "linux", label: "Linux (AppImage)", size: "—", status: "soon" }),
      Object.freeze({ id: "desktop-zip", label: "Semua file Desktop (ZIP)", size: "—", status: "soon" }),
    ]),
  },
  {
    id: "web",
    label: "Web App",
    icon: "🌐",
    description: "Langsung di browser — tanpa instalasi, selalu terbaru.",
    status: "live",
    formats: Object.freeze([
      Object.freeze({ id: "web-live", label: "Buka Web App", status: "live" }),
      Object.freeze({ id: "web-pwa", label: "Install sebagai PWA", status: "live" }),
    ]),
  },
]);

export function detectRecommendedPlatform(userAgent = "") {
  const ua = String(userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "");
  if (/android|iphone|ipad|ipod|windows phone|mobile/i.test(ua)) return "mobile";
  if (/win|mac|linux|crOS/i.test(ua)) return "desktop";
  return "web";
}

export function listDownloadPlatforms() {
  return DOWNLOAD_PLATFORMS;
}
