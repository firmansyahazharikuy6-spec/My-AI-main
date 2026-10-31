# MyAI Android and PWA release guide

## Architecture and choice

- Keep the existing Vite web app and Cloudflare Pages/Worker API; Capacitor packages the built `www/` app into Android.
- Provider API keys stay exclusively in Cloudflare Worker secrets. The APK contains no provider keys.
- A service worker caches the same-origin app shell and static assets only; `/api` traffic is never cached.
- Capacitor is used instead of Trusted Web Activity (TWA): MyAI needs native auth integration, microphone permissions, Android file saving, Share Sheet, system bars, keyboard resizing, and layered Back handling.
- A TWA/Bubblewrap package is smaller and closer to Chrome, but is a weaker fit for these native flows and relies on browser capabilities for file and voice behavior.
- App ID: `com.firmansyahazharikuy6.myai`; production domain: `https://myai-v3-firmansyah.pages.dev`.

## Implemented integration

- PWA manifest includes app identity, standalone display, scope/start URL, theme colors, 192/512 icons, and a maskable icon. Icons are generated from `assets/myai-orbital-logo.png`.
- The service worker caches the shell and static resources and uses a clear offline page; it excludes API paths, non-GET requests, and cross-origin requests.
- Android uses min SDK 24 and compile/target SDK 36. The Google Play target API policy requires API 36 for new apps and updates submitted from August 31, 2026.
- Google and GitHub sign-in use the existing Capacitor Firebase Authentication plugin, not an OAuth popup inside the app WebView. The native plugin returns provider credentials with `skipNativeAuth: true`, then the Firebase JavaScript SDK creates the app session; this keeps Android and web session handling consistent. The app also declares `myai://auth/callback` and an HTTPS `/auth/return` App Link.
- Android initializes the Firebase default app from the same public Firebase client configuration used by `js/config.js`, so the native plugin can load even before `google-services.json` is added. This does not configure OAuth: native Google/GitHub sign-in still requires the Firebase Android app registration, matching `google-services.json`, enabled providers, and certificate fingerprints below.
- The packaged Capacitor app sends every AI/API request to `https://myai-v3-firmansyah.pages.dev/api`; the web app continues to use its same-origin `/api` path. Chat, model catalog, prompt enhancement, image, voice, and other Worker-backed features therefore share the production gateway, while provider API keys remain in Cloudflare Worker secrets and are never bundled into Android.
- `https://localhost` is explicitly allowed by both the Pages gateway and Worker CORS checks for Capacitor's HTTPS app origin.
- Android requests `RECORD_AUDIO` for voice and `POST_NOTIFICATIONS` only when saving a file; the download permission prompt is contextual. The app does not request camera access and hides video-mode controls on Android.
- Android file inputs remain available for images/files. Folder selection is hidden on Android because the directory picker is not consistently supported.
- Generated files are written to Android `Downloads/MyAI` on Android 10+ with a save notification. Older Android versions use the system document picker, where the user chooses a destination.
- Chat sharing and AI-content reports use the native Share Sheet. External web links open in Custom Tabs. Back closes dialogs/menus/panels before navigating or exiting.
- Status/navigation bars follow the selected theme; the existing viewport safe-area handling plus Capacitor keyboard resize keeps the composer above the keyboard.
- `public/privacy.html` and `public/terms.html` are clearly marked drafts. They are not publish-ready legal documents.

## Install, build, and sync

Requirements:

- Node.js 22+ and npm.
- Android Studio with Android SDK Platform 36 and Android Build Tools 36.0.0.
- JDK 17 for the checked-in Gradle 8.11.1 / Android Gradle Plugin 8.9.1 toolchain. Use a JDK supported by the selected Gradle version; the bundled JDK 25 in some Android Studio installations is not compatible with this Gradle wrapper.

From PowerShell at the repository root:

```powershell
npm ci
npm run icons:generate
```

The Android platform is already included in this repository. Only if `android/` is absent in a fresh platform setup, run this once:

```powershell
npm run cap:add:android
```

Then build and sync the web app into Android:

```powershell
npm run cap:sync
```

Set the local JDK and Android SDK paths for the current PowerShell session. Replace the JDK directory with the JDK 17 installation path on your machine:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
```

Build and install a debug APK:

```powershell
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`. Install it by USB with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, or open it from Android Studio.

After changing web code, run `npm run cap:sync` before building or opening Android Studio. Do not edit the copied `android/app/src/main/assets/public` bundle directly.

## Firebase OAuth and app links

Before testing sign-in on a device:

1. In Firebase Console, register an Android app with package name `com.firmansyahazharikuy6.myai`.
2. Enable Google and GitHub under Firebase Authentication sign-in providers. For GitHub, configure the Firebase OAuth callback URL shown in Firebase Console in the GitHub OAuth application.
3. Add SHA-1 and SHA-256 fingerprints for the debug certificate and upload certificate in Firebase project settings. After enabling Play App Signing, also add the Play app-signing certificate fingerprints and download a refreshed `google-services.json`.
4. Download the Android `google-services.json` for this exact package and place it at `android/app/google-services.json`. It is intentionally ignored by Git. It contains Firebase client configuration, not provider AI API keys. This file supplies the `default_web_client_id` required by native Google sign-in; without it the plugin retains a placeholder value and Google login cannot complete.
5. Verify Google sign-in credentials are enabled in Firebase and GitHub's OAuth callback exactly matches Firebase's callback URL. Do not add credentials or provider API keys to `capacitor.config.ts`, assets, or frontend source.
6. The Android manifest includes a custom `myai://auth/callback` scheme and an HTTPS App Link for `/auth/return`. To verify the HTTPS App Link, deploy `/.well-known/assetlinks.json` on the Pages domain with the package ID and SHA-256 certificate fingerprint for the Play app-signing key. Obtain the fingerprint from Play Console after enrolling in Play App Signing. Without this association, Android may open the HTTPS link in the browser; the Firebase native OAuth plugin still owns its sign-in callback.

## Cloudflare guest AI configuration

- The guest trial depends on `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` Worker secrets. Without both, `/api/guest/config` intentionally returns HTTP 503 and guest AI cannot start; do not disable Turnstile as a workaround.
- `/api/models` requires a valid Firebase user token, so an HTTP 401 before signing in is expected. Finish native Firebase OAuth setup before testing the signed-in model catalog.

## Keystore and release AAB

Create an upload key once. Keep the file outside the repository and store its passwords in a password manager:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.keys"
keytool -genkeypair -v `
  -keystore "$env:USERPROFILE\.keys\myai-upload.jks" `
  -alias myai-upload -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` prompts for the keystore and key passwords. Never put those values in source code, `package.json`, a checked-in `gradle.properties`, chat, or a commit. The root and Android ignore rules exclude `.jks` and `.keystore` files.

Create or edit the user-level Gradle properties file at `$env:USERPROFILE\.gradle\gradle.properties` (outside the repository), and provide these four properties:

```properties
MYAI_UPLOAD_STORE_FILE=C:/Users/<your-windows-user>/.keys/myai-upload.jks
MYAI_UPLOAD_STORE_PASSWORD=<keystore-password>
MYAI_UPLOAD_KEY_ALIAS=myai-upload
MYAI_UPLOAD_KEY_PASSWORD=<key-password>
```

Restrict access to this file and back it up securely. The Gradle release task intentionally stops with an error if any signing property is missing.

Build a signed Android App Bundle:

```powershell
npm run cap:sync
Push-Location android
.\gradlew.bat bundleRelease
Pop-Location
```

AAB output: `android/app/build/outputs/bundle/release/app-release.aab`. Upload the AAB to Play Console, enroll in Play App Signing, and retain the upload keystore and password backup. Play App Signing signs the distributed APKs with a separate app-signing key; keep both certificate fingerprints in Firebase. Increment `versionCode` in `android/app/build.gradle` for each Play update. Do not change the application ID after publishing.

## On-device manual tests

- **Install / launch:** clean install, adaptive icon, splash, dark and light status/navigation bars, rotation, phone and tablet layouts.
- **Google and GitHub login:** system/native OAuth opens, cancel and return work, Firebase session survives app restart; test both debug and Play-signed/internal-track builds.
- **Chat:** guest and signed-in behavior, model list, sending/streaming, error/offline message, history sync; confirm AI calls still reach the Cloudflare Worker.
- **Voice:** microphone rationale/system permission appears, deny and allow paths behave clearly, voice starts/stops, Android has no video/camera control.
- **Upload:** gallery image, camera/photo source offered by Android picker where available, documents and multiple files work; folder upload is absent on Android.
- **Download:** HTML, JSON, DOCX/PPTX/XLSX/PDF, and generated image appear under Downloads/MyAI on Android 10+; notification permission is requested only when saving. On older Android, verify the document picker destination.
- **Share/report:** chat Share opens Android Share Sheet; each assistant response has a report action that prepares a reason/model/response report.
- **Back:** close dialog, menu, attachment panel, sidebar, then navigate back, and only then exit.
- **Keyboard/safe areas:** focus chat input, type/send with keyboard open, rotate, and verify composer plus navigation gestures remain visible.
- **Offline:** disable network before launch and while using chat; verify offline banner/page is clear, app is not blank, and API requests are not served from cache.
- **External links:** citation and policy links open in the browser/Custom Tab, not in the app's chat WebView.

## Google Play Console checklist

Before release:

- **Application identity:** app name `MyAI`, package ID above, launcher/adaptive icon, feature graphic (1024×500), screenshots for phone and tablet, short/full descriptions, support contact, and an accurate release notes entry.
- **Privacy and terms:** replace the draft pages with final, legally reviewed documents and publish them at the in-app URLs (`/privacy.html`, `/terms.html`). Add the operator's legal identity and a working privacy/support contact.
- **Account deletion:** Google Play requires an in-app account deletion path and a web resource for account deletion when users can create accounts. This repository currently has no complete Firebase account/cloud-data deletion workflow; implement and verify it before production submission.
- **AI content reporting:** the in-app button prepares a report in the native Share Sheet, but does not submit it to MyAI automatically. Configure a real report recipient/service and update the UI to confirm delivery before representing this as a direct reporting channel to Play reviewers.
- **Data Safety:** declare account email/identifier; messages, files/images, and audio users submit; IP/device identifiers used for guest abuse prevention; purposes (app functionality and abuse prevention); and sharing with Firebase, Cloudflare, and selected AI/integration providers. Confirm retention, deletion, encryption, and provider practices against the live project before completing the form. Do not claim that account deletion or cross-provider deletion is available until implemented.
- **Content rating and target audience:** complete the questionnaire truthfully; describe that responses are generative AI and may be inaccurate. Set the audience/age targeting based on the actual product and legal review.
myai-v3-firmansyah.pages.dev- **Policy review:** verify Data Safety, privacy policy, account deletion, AI reporting, content rating, permissions, target API 36, app links, OAuth, and accessibility on real devices. Recheck Google's target API and testing requirements on submission day.

## Known release gates

- `public/privacy.html` and `public/terms.html` are drafts and require operator/legal completion before Play submission.
- No report destination or email has been supplied; the report flow shares a report to a destination selected by the user, rather than delivering it to MyAI.
- Account deletion is not implemented and is a Google Play production blocker for an app with account creation.
- OAuth still requires Firebase Android registration, SHA fingerprints, provider setup, and the ignored `google-services.json`.
- App Links require a real Play app-signing SHA-256 in the deployed `assetlinks.json`.
- Build and sync can be checked locally; OAuth, microphone, file chooser, Android download notification, and Back behavior must still be tested on actual devices.
