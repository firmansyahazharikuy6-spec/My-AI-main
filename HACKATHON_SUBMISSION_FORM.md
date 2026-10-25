# NVIDIA & Nebius Hackathon — MyAI Submission Form

## Project

**Name:** MyAI v5.47 — All-in-One AI Workspace  
**Primary track:** **Best Apps and Agents Track**  
**Live demo:** [https://myai-v3-firmansyah.pages.dev](https://myai-v3-firmansyah.pages.dev)

## 1. Track selection and product positioning

> **Best Apps and Agents Track** is the best fit for MyAI. MyAI is an all-in-one AI workspace that combines conversational AI, prompt assistance, media and document workflows, and live artifact previews. Its gateway handles provider-aware model discovery, routing, streaming, and eligible fallback attempts behind a single user-facing product.

The product includes:

- **AI chat** with provider-catalog model selection and streamed responses.
- **Prompt assistance:** three auto-suggestions designed to contain five or six words each, plus an offline prompt-cleanup path that does not require an inference request.
- **Media and document workflows:** image-related workflows and browser-side document exports, including a two-slide Modern-Gold PPTX path tested for manual Canva import.
- **Live artifact previews:** sandboxed rendering for supported HTML, CSS, JavaScript, SVG, and Mermaid content.
- **AI orchestration:** provider adapters, capability- and tier-aware model selection, quota/rate-limit fallback attempts, and response metrics when supported by real provider data.

The user-facing AI workspace is the product; the gateway is the orchestration layer enabling these workflows. A small business such as Currypap Jumbo Jeng Nita is an illustrative potential use case, not a claimed client, endorsement, or measured case study.

## 2. Project description

### What did you build?

> We built MyAI, an all-in-one AI workspace backed by a server-side, multi-provider inference gateway. It combines chat, prompt tools, media and document generation workflows, and sandboxed live previews. The gateway discovers available provider models, applies routing and capability constraints, streams responses, and can attempt eligible alternatives when an upstream provider is rate-limited or out of quota.

### What problem does it solve?

> Hosted AI providers differ in API formats, model catalogs, availability, quotas, and failure behavior. MyAI consolidates those differences behind one workspace and gateway. This reduces application-level integration work and can keep eligible requests moving when a configured provider returns a quota or rate-limit error. The goal is more consistent AI access for developers and general users, with small businesses as a potential beneficiary.

### How does it work?

> A user prompt is sent from the web app through Cloudflare Pages Functions to a Cloudflare Worker. The Worker authenticates and validates the request, selects an available model based on provider catalog, capability, task, and active tier, and uses the corresponding provider adapter. It streams generated output back to the client. Provider API keys stay in Worker secrets and are not exposed to the browser.
>
> If a provider returns HTTP 402 or 429, the gateway can silently try other configured, eligible model candidates, subject to the request's capabilities and tier. The gateway supports up to five automatic fallback model candidates, but the number actually available depends on configured secrets and live catalogs; five usable models are not guaranteed. Stream readers release their locks in `finally` cleanup paths to prevent a consumed stream from leaving the reader locked.

## 3. AI model and infrastructure integration

### Active implementation

> MyAI integrates directly with NVIDIA NIM using NVIDIA's OpenAI-compatible API at `https://integrate.api.nvidia.com/v1`. NVIDIA is the gateway's preferred provider for supported chat and document workflows when an eligible NVIDIA model is available and permitted by capability and tier rules. The exact model is discovered from the provider catalog and depends on current account availability.
>
> The current Worker also has provider adapters for Google Gemini, Groq, OpenRouter, Anthropic Claude, and Moonshot Kimi. The application gateway runs on Cloudflare Workers, with Cloudflare Pages Functions forwarding application requests.

### Nebius Token Factory roadmap — planned, not currently live

> The current implementation does not configure a Nebius Token Factory endpoint or key and does not route inference through Nebius. The following is a proposed roadmap, not a claim of a deployed feature. Exact model IDs and availability must be confirmed in the Nebius account catalog before implementation.

| Workload | Proposed model class | Proposed provider route |
|---|---|---|
| High-reasoning tasks: complex questions, code analysis, synthesis | Nemotron 3 Ultra, only if listed and enabled for the account | Nebius Token Factory |
| Fast everyday chat and short calls | Nemotron Nano or Super, only if listed and benchmarked for the task | Nebius Token Factory |
| Auto-suggestion and online prompt improvement | A compact hosted model, if configured; local prompt templates remain the offline option | Nebius Token Factory for online inference |

> Nebius Serverless Endpoints are also a possible deployment option, but the current gateway is not deployed or verified there. It currently runs on Cloudflare Workers/Pages Functions. Nebius hosting would require a compatible endpoint adapter, secret configuration, streaming and authentication validation, and deployment-specific tests.

## 4. Performance and metrics disclosure

> MyAI only displays response latency and token-throughput metrics when the measured response duration is **at least 100 ms**. Throughput is calculated or displayed only when actual token-usage data is available. Responses faster than 100 ms omit these indicators, and the UI does not fabricate timing or throughput values. Metrics depend on provider telemetry and are not guaranteed for every model or request.

## 5. Reliability and current validation results

> The gateway detects quota/rate-limit responses including HTTP 402 and 429 and can continue through eligible configured fallbacks without exposing intermediate retry errors as the final user response when a fallback succeeds. If all eligible attempts fail, the request still reports a final failure. Reader locks are released in `finally` cleanup paths.

**Validation run on the current workspace:**

- **Regression tests:** 183 passed, 0 failed, 0 skipped.
- **Feature checks:** 8 passed, 0 failed.
- **Revision context:** run against the current workspace based on HEAD `9b56f9b`, including uncommitted working-tree changes. These results are not a claim that the current HEAD commit alone contains or passed those changes; rerun and record results on the final submission commit.
- **Feature-check scope:** includes document exports and a valid two-slide Modern-Gold PPTX intended for manual Canva import. Image generation in the feature suite uses a local mock fixture; it does not prove a live upstream image-provider response.

Commands used:

```powershell
$tests = @((Get-ChildItem -File js\*.test.js | ForEach-Object { $_.FullName }) + (Get-ChildItem -File worker\*.test.js | ForEach-Object { $_.FullName }) + (Get-ChildItem -File pages\_worker.test.js | ForEach-Object { $_.FullName }))
node --test $tests
node scripts/e2e-features.mjs
```

## 6. Working demo

**Live demo URL:** [https://myai-v3-firmansyah.pages.dev](https://myai-v3-firmansyah.pages.dev)

> The demo is hosted on Cloudflare Pages and uses the Cloudflare Worker gateway. Confirm login, provider availability, and a successful live inference immediately before submission; a reachable web page alone does not verify every upstream model or provider quota.

## 7. Three-minute YouTube demo outline

**Suggested title:** *MyAI v5.47 — NVIDIA NIM-Powered AI Workspace*

| Time | Demo script |
|---|---|
| **0:00–0:45 — Product and AI problem** | Introduce model fragmentation: different APIs, catalogs, and quotas interrupt AI workflows. Show MyAI's workspace and model selector briefly. Explain the request path: browser → Cloudflare Pages Functions → Worker gateway → provider. Emphasize that the demo focuses on AI workflows and model orchestration, not just visual design. |
| **0:45–1:45 — NVIDIA NIM inference** | Select an available NVIDIA NIM model, send a short prompt, and show the actual streamed answer and provider/model identity. Show latency and tokens-per-second only if the measured response is at least 100 ms and usage data is returned. Explain that NVIDIA NIM is directly integrated, while Nebius Token Factory routing remains planned unless implemented before recording. |
| **1:45–2:30 — AI tools and resilience** | Demonstrate three prompt suggestions, offline prompt cleanup, and a live artifact preview. In a controlled test environment, simulate HTTP 429 or 402 and show an eligible fallback attempt. Then show the validated two-slide Modern-Gold PPTX export. Do not exhaust production quotas or describe mock tests as live-provider tests. |
| **2:30–3:00 — Close and impact** | Summarize how one model-aware workspace can make AI workflows more consistent for developers and general users. Mention Currypap Jumbo Jeng Nita only as an illustrative potential small-business use case, not as a client or measured outcome. Close with the live demo URL and accurately state which integrations are live versus planned. |

## 8. Public repository and open-source license

> **Public repository and MIT license are not verified in the current workspace.** No Git remote is configured and no root-level `LICENSE` file is present. Consequently, there is no verified public GitHub URL to provide, and the project must not be represented as MIT-licensed until it is published and the license is confirmed. This information must be resolved before submitting a form that requires a public repository and open-source license.

The existing README documents local setup, Cloudflare Worker development/deployment, NVIDIA NIM configuration, provider routing, and server-side secret handling. Nebius Token Factory instructions are not current setup instructions because that integration has not yet been implemented.

## 9. Ready-to-copy form responses

### Track and short project description

> **Track: Best Apps and Agents Track.** MyAI v5.47 is an all-in-one AI workspace combining chat, prompt assistance, media and document workflows, and live artifact previews. Its server-side gateway discovers provider models, applies capability-aware routing, streams responses, and can attempt eligible fallback models after HTTP 402/429 quota or rate-limit responses. MyAI currently integrates directly with NVIDIA NIM and runs on Cloudflare Workers and Pages Functions. Nebius Token Factory and Nebius Serverless routing are planned integrations, not features currently verified as live.

### NVIDIA / Nebius integration

> MyAI directly integrates with NVIDIA NIM at `https://integrate.api.nvidia.com/v1`, prioritizing NVIDIA for supported requests when an eligible model is available. The gateway also supports Gemini, Groq, OpenRouter, Anthropic, and Moonshot. Nebius Token Factory routing for high-reasoning Nemotron and fast Nemotron Nano/Super workloads is a proposed roadmap item and is not currently deployed.

### Demo URL

> https://myai-v3-firmansyah.pages.dev

### Three-minute video description

> The video introduces the AI provider reliability problem and MyAI's gateway architecture (0:00–0:45), demonstrates a real NVIDIA NIM streamed response and eligible latency/throughput metrics (0:45–1:45), shows prompt assistance, live artifact previews, and controlled 402/429 fallback with a validated two-slide Modern-Gold PPTX export (1:45–2:30), then summarizes the product's potential value for developers and small businesses (2:30–3:00). Nebius routing is identified as planned unless implemented and verified before recording.

### Repository and license field

> A verified public GitHub repository URL and MIT license are not available in the current workspace: no Git remote or root-level `LICENSE` file is configured. Do not submit a fabricated URL or claim MIT licensing. Publish the repository and confirm/add the license before completing a form that requires these fields.

## Final pre-submission checklist

- [ ] Rerun regression and feature tests on the exact final submission commit and update the results above.
- [ ] Verify NVIDIA model availability and record a successful live response without exposing secrets.
- [ ] Implement and test Nebius routing before describing it as active; otherwise retain the planned-integration disclosure.
- [ ] Confirm the live demo and provider status shortly before submission.
- [ ] Publish a public repository and confirm its license before claiming a GitHub URL or MIT status.
- [ ] Record the demo video within three minutes and distinguish live inference from mock/test scenarios.
