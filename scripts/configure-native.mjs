import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

async function addAndroidPermissions() {
  const path = "android/app/src/main/AndroidManifest.xml";
  if (!existsSync(path)) return false;

  let manifest = await readFile(path, "utf8");
  const permissions = [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.SCHEDULE_EXACT_ALARM",
  ];
  const missing = permissions.filter((permission) => !manifest.includes(`android:name="${permission}"`));
  if (!missing.length) return true;

  const declarations = missing
    .map((permission) => `    <uses-permission android:name="${permission}" />`)
    .join("\n");
  if (!/<application\b/.test(manifest)) {
    throw new Error(`${path}: tag <application> tidak ditemukan; izin aplikasi tidak dapat ditambahkan.`);
  }
  manifest = manifest.replace(/(\s*<application\b)/, `\n${declarations}$1`);
  await writeFile(path, manifest);
  return true;
}

async function addIosPermissionDescriptions() {
  const path = "ios/App/App/Info.plist";
  if (!existsSync(path)) return false;

  let plist = await readFile(path, "utf8");
  const descriptions = {
    NSCameraUsageDescription: "MyAI uses the camera for video live chat.",
    NSMicrophoneUsageDescription: "MyAI uses the microphone for voice and video live chat.",
  };
  const missing = Object.entries(descriptions).filter(([key]) => !plist.includes(`<key>${key}</key>`));
  if (!missing.length) return true;

  const entries = missing
    .map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`)
    .join("\n");
  if (!/<dict>/.test(plist)) {
    throw new Error(`${path}: tag <dict> tidak ditemukan; izin kamera/mikrofon tidak dapat ditambahkan.`);
  }
  plist = plist.replace("<dict>", `<dict>\n${entries}`);
  await writeFile(path, plist);
  return true;
}

const [androidConfigured, iosConfigured] = await Promise.all([
  addAndroidPermissions(),
  addIosPermissionDescriptions(),
]);

if (!androidConfigured && !iosConfigured) {
  throw new Error("Platform native belum dibuat. Jalankan cap add android/ios sebelum konfigurasi izin.");
}
