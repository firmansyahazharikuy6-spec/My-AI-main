# NVIDIA & Nebius Hackathon — Track Selection

## Primary track

**Best Apps and Agents Track**

### Track-selection statement

> MyAI v5.47 is an AI-powered all-in-one workspace that brings model-powered chat, prompt assistance, media and document workflows, and live artifact previews into one application. It is designed to make AI tasks accessible through a single interface while a server-side gateway handles model discovery, provider-specific requests, streaming, and eligible fallback routing. This combination of useful end-user workflows and agent-ready AI orchestration makes **Best Apps and Agents** the strongest fit.

> MyAI is built for general users, developers, and small businesses. A family business such as Currypap Jumbo Jeng Nita is an illustrative potential user; this is not a claim of a customer relationship or measured business impact.

## Why this is the best fit

MyAI is more than a model API proxy: its primary product is an AI workspace in which users can apply models to everyday tasks. The application combines:

- **AI chat and model choice** across supported provider catalogs.
- **Prompt assistance**, with online provider-backed enhancement where configured and local prompt assistance when a provider is unavailable.
- **Document and presentation workflows**, including browser-side document export.
- **Live artifacts**, with sandboxed previews for supported HTML, CSS, JavaScript, SVG, and Mermaid content.
- **Provider-aware orchestration**, including server-side credential handling, streamed generation, capability-aware routing, and quota/rate-limit fallback attempts.

The user-facing application is the product; the gateway is the orchestration layer that makes these workflows work across model providers.

## AI routing and deployment architecture

### Current, verified implementation

The current MyAI code integrates directly with NVIDIA NIM at `https://integrate.api.nvidia.com/v1`. The gateway also has adapters for Gemini, Groq, OpenRouter, Anthropic, and Moonshot. NVIDIA models are prioritized in supported workflows when the model is available and allowed by the active tier and request capabilities. Model IDs and availability come from provider catalogs; a specific Nemotron release is not guaranteed to be present in every account or deployment.

The current code does **not** configure Nebius Token Factory, Nebius API credentials, or Nebius Serverless Endpoints. It therefore does not currently route any request through Nebius, including Nemotron-3 Ultra, Nemotron Nano, or Nemotron Super. The application runs its gateway on Cloudflare Workers, with Cloudflare Pages Functions forwarding application requests.

### Proposed NVIDIA / Nebius routing plan

The following routing matrix describes the target integration to implement and validate before presenting it as a live feature. Exact model identifiers must be confirmed against the current Nebius Token Factory catalog; model names and availability can change.

| Workload | Proposed model class | Proposed route | Routing behavior |
|---|---|---|---|
| Complex reasoning, code analysis, and multi-source synthesis | A high-reasoning Nemotron model, such as Nemotron 3 Ultra **only if the exact model is available in the account catalog** | Nebius Token Factory OpenAI-compatible API | Select for tasks classified as reasoning-intensive; stream the response and collect actual timing/usage data. |
| Everyday chat and short assistance | Nemotron Nano or Super **only if available and benchmarked for the task** | Nebius Token Factory OpenAI-compatible API | Prefer a lower-latency model for routine prompts and short completions; retain capability and availability checks. |
| Auto-suggestions and prompt enhancement | A compact hosted model when network inference is configured; local prompt templates remain an offline path | Nebius Token Factory for online inference, local code for offline assistance | Do not claim offline prompt assistance is Nemotron inference. Keep offline behavior available without a network call. |
| Provider quota or rate-limit failure | Other configured and eligible catalog models | Existing gateway fallback chain | Retry only candidates meeting the request's capability and access constraints. The number of usable candidates is not guaranteed. |

**Routing principle:** Workload-based selection should be based on explicit task signals and measured model capability/latency, not just a model's display name. A configured preferred provider must still fall back safely when its key, model, endpoint, quota, or required capability is unavailable.

### Serverless hosting position

The current gateway is implemented for Cloudflare Workers and the app uses Cloudflare Pages Functions as a forwarding layer. A Nebius Serverless Endpoints deployment would require a compatible service/adapter, secrets configuration, request/response streaming support, authentication and rate-limit controls, and deployment-specific tests. The existing `gateway.js` should **not** be described as already deployed or verified on Nebius Serverless Endpoints.

## Secondary track alignment

### Coding & Agentic Engineering

MyAI has relevant supporting capabilities: sandboxed live artifact previews for supported web content and Mermaid diagrams, model-aware task routing, and automated regression tests. These features demonstrate agent-assisted development workflows, but the central product proposition remains a multi-workflow AI application rather than a dedicated coding agent.

Historical project notes reported **183/183 regression tests** and **8/8 feature checks** at that time. Those numbers are historical, not validation of the final hackathon submission revision; rerun the suite and record the exact commit before citing current test results. Do not use the separate 177/177 figure unless that exact run can be verified.

### Personal AI

MyAI also aligns with Personal AI through its user workspace, saved preferences, and conversation-context handling. The application includes prompt/history sanitization intended to keep unrelated prior system/template content from contaminating a new response. Describe this as a design and implementation safeguard, not an absolute guarantee of no data exposure; retain server-side secret isolation and test privacy behavior on the submission build.

## Ready-to-copy form response

> **Selected track: Best Apps and Agents Track.** MyAI v5.47 is an all-in-one AI workspace combining chat, prompt assistance, media and document workflows, and live artifact previews. Its server-side gateway discovers models, applies provider- and capability-aware routing, streams responses, and can attempt eligible alternatives when a provider returns a quota or rate-limit error. The current release integrates NVIDIA NIM directly and prioritizes NVIDIA for supported workloads when an eligible model is available. The application currently runs on Cloudflare Pages and Workers. Nebius Token Factory routing and Nebius Serverless deployment are planned integrations, not features verified in the current release.

#332543     y
