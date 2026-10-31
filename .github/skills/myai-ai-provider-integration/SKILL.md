---
name: myai-ai-provider-integration
description: "Use when changing MyAI cloud model catalogs, provider routing, model selection, tier visibility, health checks, or failover across NVIDIA NIM, Gemini, OpenRouter, and Groq."
---

# MyAI provider integration

Keep the browser catalog and Worker routing in sync. The supported cloud model menu is defined in `shared/model-catalog.js`; do not add a provider to only one side.

## Workflow

1. Trace the catalog from the Worker `/models` handler through `gatewayModelGroups` into `js/app.js` model selection.
2. Keep provider credentials in Worker environment secrets. Never move them into browser code, local storage, URLs, or logs.
3. Use current provider model catalogs when available. The shared static catalog is only a transient 5xx/network fallback; do not use it to bypass 401, 402, 403, 404, or 429 responses.
4. Preserve model access tiers, input modality metadata, provider health, and explicit error reporting when filtering or falling back.
5. Keep guest model IDs mapped to their actual backend provider, and keep tier filtering separate from provider allowlisting.
6. Add focused tests for successful discovery, each failure class, selection visibility, and fallback routing. Run `npm test` and `npm run build` after cross-layer changes.

## Safety and verification

- Never claim that a key, model, or live provider works unless a real request verified it.
- Never silently replace a user's selected provider or send credentials to a different provider.
- Do not retry billing, permission, invalid-model, or rate-limit errors against the same provider.
- Keep server-side validation authoritative; UI filtering is not an authorization boundary.
- Treat provider model names and upstream error bodies as untrusted data.
