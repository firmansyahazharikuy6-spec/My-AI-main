# MyAI privacy notice (draft)

**Draft for product and legal review. Do not publish as a final privacy notice until the open questions below have been answered and a lawyer has reviewed the text.** This draft describes data flows visible in the repository; it does not claim to know the settings or retention practices of Firebase, Cloudflare, or AI providers.

## Data processed by the app

### Account and authentication

Users can sign in through Google or GitHub. Firebase Authentication processes the authentication credentials and account details needed for sign-in. The Worker receives a Firebase ID token and uses claims including the UID, sign-in provider, email, and email-verification state to authorize protected requests. The app does not need the user's Google/GitHub password.

### Conversations and settings

Chat records are kept in browser storage and, when signed in, are synchronized to Firestore under the user's own account. Records can contain user messages, AI responses, timestamps, model/provider metadata, and attachment metadata. Private user settings are also stored in Firestore. The application removes extracted file context (`modelContent`), uploaded image bytes, and generated image blobs from the durable chat copy; some content may remain in browser memory for follow-up prompts during the current tab session.

### Files and images

Files are selected and parsed in the browser. If the user submits a prompt that uses extracted file text or image content, that content can be sent to the MyAI Worker and forwarded to the selected AI provider. The original uploaded file bytes are not included in durable chat records by the current client persistence code, but attachment names/details may be retained as chat metadata. Image generation also sends its prompt and options to the Worker and relevant image provider.

### Audio and video

- For transcription, the selected audio file is sent through the Worker to Groq's transcription endpoint. The resulting text may be added to the conversation and saved with that chat.
- Gemini Live uses a short-lived token created through the Worker, followed by a browser-to-Google WebSocket connection. Microphone audio is streamed to Gemini Live; when video mode is enabled, camera frames are also sent during the session.
- The app does not put raw microphone/video stream bytes into durable chat records. This does **not** establish what Google or another provider may retain or process under its own terms.

### AI provider requests

When a user submits an AI request, the Worker may send the prompt, relevant conversation context, instructions, extracted file content, and images to the provider/model selected in the app. Supported direct chat providers visible in the code are Google Gemini, Groq, OpenRouter, and NVIDIA NIM. Provider fallback may occur under the conditions described in [architecture](./ARCHITECTURE.md); if it does, the actual provider/model is identified in the response. Provider terms and privacy policies govern the provider's handling of data after receipt.

Other optional integrations may process data when used: Turnstile/Cloudflare for guest verification and delivery; Monid or Explorium for data-tool requests; Canva for presentation export; Resend for email actions; and Pollinations for image generation. Whether a particular service is enabled depends on deployment configuration.

### Operational and anti-abuse data

Cloudflare handles requests to Pages and the Worker. Guest access uses Turnstile plus an IP address and a random browser device identifier for rate/trial counting. Authenticated AI routes use the account UID for rate limits. Cloudflare's exact request-log fields and retention are account settings and are not established by this repository.

## Storage and deletion

- Browser storage may contain local chat copies, drafts, preferences, model choices, language/theme settings, and the guest device identifier. Clearing browser/site data can remove local copies and settings.
- Signed-in chat and private settings are stored in the user's Firestore paths, subject to the Firebase project's configuration.
- The current repository does not establish an account-deletion workflow, backup schedule, retention period, or a complete cross-provider deletion mechanism.
- Raw uploaded file content and image bytes are omitted from durable chat records by the current app code, but they can be processed in memory and transmitted to a provider when needed to fulfill a request.

## User choices and safeguards

Users choose when to submit prompts, attach files, enable microphone/camera access, or use optional integrations. Browser permission prompts control camera and microphone access. Do not submit sensitive personal, financial, health, confidential business, or other restricted information unless you have assessed the relevant provider and applicable policies. Do not rely on an AI response as professional advice.

## Open questions requiring product/legal review

1. Who is the legal data controller/operator, where is it established, and what contact address should users use for privacy requests?
2. Which Firebase, Cloudflare, and AI-provider regions, subprocessors, retention periods, training/abuse-review practices, and deletion controls apply to the deployed accounts and selected models?
3. What request/diagnostic data is retained in Cloudflare, Firebase, provider, Resend, Canva, Monid, Explorium, and Pollinations logs, and for how long?
4. What is the process and timeline for deleting an account, its Firestore data, local data, and data already sent to third-party providers?
5. Which legal bases, consent requirements, international transfer disclosures, age limits, and jurisdiction-specific notices apply?
6. Are analytics, cookies, or other browser identifiers enabled in the deployed environment beyond the local storage items described above?
7. Is the guest device identifier resettable, and how should the privacy notice explain IP/device-based anti-abuse limits?
8. Should email, Canva, Monid, Explorium, or image-generation integrations be described as enabled features, optional features, or unavailable until verified in production?
