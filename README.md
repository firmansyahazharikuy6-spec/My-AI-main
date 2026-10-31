# MyAI

MyAI is a web AI workspace that routes chat and related tools through a Cloudflare Pages gateway and a Cloudflare Worker. It supports Google/GitHub sign-in, chat history synchronization with Firebase, multiple AI providers, file-assisted prompts, and optional voice, image, and document workflows. Authenticated text chat has no MyAI per-account request quota; provider usage may incur charges or consume provider quotas, and each model's own context/output limits still apply.

## Run locally

Requirements: Node.js 22 and npm.

```sh
npm ci
npm run dev
```

Open `http://localhost:4173`. By default, Vite proxies `/api/*` to the deployed Pages API. To test against a local Worker with Cloudflare's public Turnstile test keys, run it in one terminal:

```sh
npm run worker:dev:test
```

In a second PowerShell terminal, point Vite at the local Worker and start the UI:

```powershell
$env:MYAI_WORKER_URL = "http://127.0.0.1:8787"
npm run dev
```

`worker:dev:test` uses Cloudflare's public Turnstile test keys for local development only; never deploy these keys. Configure local Worker provider keys in `worker/.dev.vars` if you want to test actual AI model requests; do not put provider keys in frontend files or commit local secrets. To use a Worker on another local port or a remote development endpoint, set `MYAI_WORKER_URL` before starting Vite. If the Worker cannot be reached, Vite logs the proxy target and the frontend shows a connection hint; retrying a request does not replay it automatically, avoiding duplicate provider charges.

Firebase must authorize `localhost`. Run the automated suite with `npm test`.

## Local AI

The model picker includes free local models for both guest and signed-in chats. Choose **AI Lokal · WebGPU** to run Llama 3.2 in a compatible browser; the first use downloads model files to the device and requires a WebGPU-capable browser and enough GPU memory. The prompt is processed in the browser.

To use Ollama instead, install and start Ollama, then run `ollama pull llama3.2`. In the model picker, set the Ollama endpoint to `http://127.0.0.1:11434` and select **Hubungkan**. MyAI's Content Security Policy permits requests only to loopback addresses for this local connection. Ollama must also allow the page's origin: for the production website use `https://myai-v3-firmansyah.pages.dev`; for local development use `http://localhost:4173` and `http://127.0.0.1:4173`. On Windows, add the origins to your user environment, then fully quit and restart the Ollama desktop app:

```powershell
setx OLLAMA_ORIGINS "https://myai-v3-firmansyah.pages.dev,http://localhost:4173,http://127.0.0.1:4173"
```

Or, if you run Ollama from PowerShell, close the Ollama desktop app first and start the server in that same terminal:

```powershell
$env:OLLAMA_ORIGINS = "https://myai-v3-firmansyah.pages.dev,http://localhost:4173,http://127.0.0.1:4173"
ollama serve
```

The model picker lists installed Ollama models after you connect from **Personalization → AI lokal · Ollama**. Connection settings stay out of the model menu. A local model failure does not send the prompt to a cloud provider automatically; use the explicit **Coba Cloud AI** action if you want to retry there. Image attachments and web search are not available in local chats.

## Deploy

1. Configure the Worker and its secrets (see below), then deploy it:

   ```sh
   npm run worker:deploy
   ```
2. Build Pages with `powershell -ExecutionPolicy Bypass -File .\pages\build.ps1` on Windows, or `bash pages/build.sh` on macOS/Linux.
3. Deploy the built `pages/dist` directory to the Cloudflare Pages project:

   ```sh
   cd pages
   npx wrangler pages deploy .\dist --project-name myai-v3-firmansyah
   ```

   From the repository root, the equivalent build-and-deploy command is `npm run pages:deploy`.
   To deploy both the Worker backend and Pages frontend, run `npm run deploy:all` from the repository root.

   The Pages gateway is configured to proxy API requests to the Worker named in `pages/_worker.js`. Update that configuration if you deploy the Worker under a different name or hostname.

## Worker configuration and secrets

At least one supported chat provider key is needed for AI chat. Add secrets from the repository root with `npm run worker:secret -- SECRET_NAME`; Wrangler prompts for the value.

| Purpose | Secret names |
|---|---|
| Chat providers (configure only those you use) | `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`), `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `KIMI_API_KEY` (or `MOONSHOT_API_KEY`), `NVIDIA_API_KEY` (or `NVIDIA_NIM_API_KEY`) |
| Optional realtime voice/video | `GEMINI_LIVE_API_KEY` (used only by Gemini Live) |
| Optional data tools | `MONID_API_KEY`, `EXPLORIUM_API_KEY` |
| Guest access | `TURNSTILE_SECRET_KEY`; also configure the non-secret `TURNSTILE_SITE_KEY` Worker variable |

| Optional email | `RESEND_API_KEY`; configure `RESEND_FROM_EMAIL`, `EMAIL_RECIPIENT_ALLOWED_DOMAINS`, and (for edit-quota alerts) `IMAGE_EDIT_ADMIN_EMAIL` as Worker variables |
| Optional Canva export | `CANVA_CLIENT_SECRET` (secret) and `CANVA_CLIENT_ID` (OAuth client ID) |

Chat provider keys can alternatively be supplied in the `AI_PROVIDER_KEYS` JSON Worker secret. `GEMINI_LIVE_API_KEY` must be configured separately and is intentionally not accepted in that JSON secret or by any chat provider route. `FIREBASE_PROJECT_ID` is a Worker variable, not a provider secret. See [Firebase setup](./docs/SETUP-FIREBASE.md) and [architecture](./docs/ARCHITECTURE.md) for the authentication and request flow. The [privacy notice](./docs/privacy.md) and [terms](./docs/terms.md) are review drafts, not finalized legal documents. Historical release notes are in [CHANGELOG.md](./CHANGELOG.md); they are not the source of current configuration guidance.

Direct Gemini chat and Gemini model discovery are removed. Gemini Live voice/video uses only the separate `GEMINI_LIVE_API_KEY` Worker secret. Remove the old `GEMINI_API_KEY` secret and install `GEMINI_LIVE_API_KEY` before deploying if you want Live sessions to continue. Gemini-branded models and Gemini Image accessed through OpenRouter remain OpenRouter integrations.

Hugging Face Inference Providers are not used for server-side chat, model discovery, health checks, or prompt enhancement. Locally run WebGPU models may still download their public model files from Hugging Face; this is separate from the removed Hugging Face API integration.

Photo editing uses the `IMAGE_EDIT_QUEUE` Durable Object and the minute cron configured in `worker/wrangler.toml`; deploy the Worker after adding the binding/migration. The default limits are five edit requests per account and four successful edits shared across all accounts per UTC day. Only Gemini Image and GPT Image models that accept a reference image are configured, both through the same OpenRouter account; account-wide credit/quota errors never trigger model fallback. Per-model daily limits may use the configured image-edit fallback, and queued requests expire after 24 hours. Admin email alerts require the explicit `IMAGE_EDIT_ADMIN_EMAIL` and `RESEND_FROM_EMAIL` Worker variables plus the `RESEND_API_KEY` secret; without all three, the threshold event is written to Worker logs only.

## Android and PWA

The Capacitor Android wrapper, PWA offline shell, Google Play setup, release signing, device test plan, and Data Safety draft are documented in [Android release guide](./docs/android-release.md). Provider API keys remain on the Cloudflare Worker and must never be added to Android assets or app configuration.
