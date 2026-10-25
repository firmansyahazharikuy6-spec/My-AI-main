# MyAI

MyAI is a web AI workspace that routes chat and related tools through a Cloudflare Pages gateway and a Cloudflare Worker. It supports Google/GitHub sign-in, chat history synchronization with Firebase, multiple AI providers, file-assisted prompts, and optional voice, image, and document workflows. Provider usage may incur charges or consume quotas.

## Run locally

Requirements: Node.js 22 and npm.

```sh
npm ci
npm run worker:dev
```

In a second PowerShell terminal, point Vite at the local Worker and start the UI:

```powershell
$env:MYAI_WORKER_URL = "http://127.0.0.1:8787"
npm run dev
```

Open `http://localhost:4173`. Configure local Worker values in `worker/.dev.vars`; do not put provider keys in frontend files or commit local secrets. Firebase must also authorize `localhost`. Run the automated suite with `npm test`.

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

   The Pages gateway is configured to proxy API requests to the Worker named in `pages/_worker.js`. Update that configuration if you deploy the Worker under a different name or hostname.

## Worker configuration and secrets

At least one supported chat provider key is needed for AI chat. Add secrets from the repository root with `npm run worker:secret -- SECRET_NAME`; Wrangler prompts for the value.

| Purpose | Secret names |
|---|---|
| Chat providers (configure only those you use) | `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` (or `NVIDIA_NIM_API_KEY`) |
| Optional data tools | `MONID_API_KEY`, `EXPLORIUM_API_KEY` |
| Guest access | `TURNSTILE_SECRET_KEY`; also configure the non-secret `TURNSTILE_SITE_KEY` Worker variable |
| Optional email | `RESEND_API_KEY`; configure `RESEND_FROM_EMAIL` and `EMAIL_RECIPIENT_ALLOWED_DOMAINS` as Worker variables |
| Optional Canva export | `CANVA_CLIENT_SECRET` (secret) and `CANVA_CLIENT_ID` (OAuth client ID) |

The provider keys can alternatively be supplied in the `AI_PROVIDER_KEYS` JSON Worker secret. `FIREBASE_PROJECT_ID` is a Worker variable, not a provider secret. See [Firebase setup](./docs/SETUP-FIREBASE.md) and [architecture](./docs/ARCHITECTURE.md) for the authentication and request flow. The [privacy notice](./docs/privacy.md) and [terms](./docs/terms.md) are review drafts, not finalized legal documents. Historical release notes are in [CHANGELOG.md](./CHANGELOG.md); they are not the source of current configuration guidance.
