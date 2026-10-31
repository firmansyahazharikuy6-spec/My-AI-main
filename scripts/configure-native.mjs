import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

async function addAndroidPermissions() {
  const path = "android/app/src/main/AndroidManifest.xml";
  if (!existsSync(path)) return false;

  let manifest = await readFile(path, "utf8");
  manifest = manifest
    .replace(/^\s*<uses-permission android:name="android\.permission\.CAMERA"\s*\/>\s*\r?\n/gm, "")
    .replace(/^\s*<uses-permission android:name="android\.permission\.SCHEDULE_EXACT_ALARM"\s*\/>\s*\r?\n/gm, "");
  const permission = "android.permission.RECORD_AUDIO";
  for (const required of [permission, "android.permission.POST_NOTIFICATIONS"]) {
    if (manifest.includes(`android:name="${required}"`)) continue;
    if (!/<application\b/.test(manifest)) {
      throw new Error(`${path}: tag <application> tidak ditemukan; izin native tidak dapat ditambahkan.`);
    }
    manifest = manifest.replace(/(\s*<application\b)/, `\n    <uses-permission android:name="${required}" />$1`);
  }
  manifest = manifest.replace(/android:icon="[^"]+"/, 'android:icon="@mipmap/ic_launcher"');
  manifest = manifest.replace(/android:label="[^"]+"/, 'android:label="MyAI"');
  manifest = manifest.replace(/android:roundIcon="[^"]+"/, 'android:roundIcon="@mipmap/ic_launcher"');
  if (!manifest.includes('android:scheme="myai"')) {
    const links = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="myai" android:host="auth" android:path="/callback" />
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="myai-v3-firmansyah.pages.dev" android:pathPrefix="/auth/return" />
            </intent-filter>`;
    manifest = manifest.replace(/(\s*<\/activity>)/, `${links}$1`);
  }

  await writeFile(path, manifest);
  return true;
}

async function configureAndroidSdk() {
  const path = "android/variables.gradle";
  if (!existsSync(path)) return false;

  let variables = await readFile(path, "utf8");
  for (const [key, value] of [["minSdkVersion", "24"], ["compileSdkVersion", "36"], ["targetSdkVersion", "36"]]) {
    const expression = new RegExp(`(${key}\\s*=\\s*)\\d+`);
    if (!expression.test(variables)) throw new Error(`${path}: ${key} tidak ditemukan.`);
    variables = variables.replace(expression, `$1${value}`);
  }
  if (!variables.includes("rgcfaIncludeGoogle")) {
    variables = variables.replace(/ext\s*\{/, "ext {\n    rgcfaIncludeGoogle = true\n    androidxCredentialsVersion = '1.3.0'");
  }
  await writeFile(path, variables);
  return true;
}

async function configureFirebaseAndroid() {
  const path = "js/config.js";
  const androidValuesPath = "android/app/src/main/res/values/myai_firebase.xml";
  if (!existsSync("android/app/src/main/AndroidManifest.xml")) return false;

  const source = await readFile(path, "utf8");
  const fields = [
    ["apiKey", "firebase_api_key"],
    ["appId", "firebase_app_id"],
    ["projectId", "firebase_project_id"],
    ["storageBucket", "firebase_storage_bucket"],
    ["messagingSenderId", "firebase_messaging_sender_id"],
  ];
  const values = fields.map(([key, resource]) => {
    const match = source.match(new RegExp(`\\b${key}\\s*:\\s*["']([^"']+)["']`));
    if (!match) throw new Error(`${path}: konfigurasi Firebase ${key} tidak ditemukan.`);
    const value = match[1].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `    <string name="${resource}">${value}</string>`;
  });

  await writeFile(androidValuesPath, `<?xml version="1.0" encoding="utf-8"?>
<resources>
${values.join("\n")}
</resources>
`);
  return true;
}

async function addAndroidBranding() {
  const root = "android/app/src/main/res";
  const manifestPath = "android/app/src/main/AndroidManifest.xml";
  if (!existsSync(manifestPath)) return false;
  const { mkdir, copyFile, readdir } = await import("node:fs/promises");
  const foreground = `${root}/drawable-nodpi/myai_icon_foreground.png`;
  const splash = `${root}/drawable/splash.png`;
  await mkdir(`${root}/drawable-nodpi`, { recursive: true });
  await mkdir(`${root}/drawable`, { recursive: true });
  await mkdir(`${root}/mipmap-anydpi-v26`, { recursive: true });
  await mkdir(`${root}/values`, { recursive: true });
  await copyFile("public/icons/myai-512-maskable.png", foreground);
  await copyFile("assets/myai-orbital-logo.png", splash);
  const resourceFolders = await readdir(root, { withFileTypes: true });
  for (const folder of resourceFolders) {
    if (/^drawable-(?:land|port)-/.test(folder.name)) {
      await copyFile("assets/myai-orbital-logo.png", `${root}/${folder.name}/splash.png`);
    }
  }
  const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/myai_icon_foreground" />
</adaptive-icon>
`;
  await writeFile(`${root}/mipmap-anydpi-v26/ic_launcher.xml`, adaptiveIcon);
  await writeFile(`${root}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptiveIcon);
  const colorPath = `${root}/values/ic_launcher_background.xml`;
  await writeFile(colorPath, `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#11131B</color></resources>
`);
  return true;
}

const [androidConfigured, sdkConfigured, firebaseConfigured] = await Promise.all([
  addAndroidPermissions(),
  configureAndroidSdk(),
  configureFirebaseAndroid(),
]);
if (androidConfigured) await addAndroidBranding();

if (!androidConfigured || !sdkConfigured || !firebaseConfigured) {
  throw new Error("Platform Android belum dibuat. Jalankan npm run cap:add:android sebelum konfigurasi native.");
}
