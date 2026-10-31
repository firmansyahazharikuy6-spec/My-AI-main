---
name: claude-design-skill
description: "Use when designing or refining MyAI interfaces, app layouts, visual systems, responsive behavior, glassmorphism, motion, or UI reviews. Apply the design workflow while preserving production security and existing app behavior."
---

# MyAI Design Workflow

This workspace adaptation is based on the user-provided `claude-design-skill` archive. It focuses on production UI work in MyAI; Claude Code-, Figma MCP-, and Codex-specific procedures and executable archive scripts are intentionally excluded.

## Workflow

1. Read the relevant HTML, CSS, JavaScript, and tests before changing the interface. Preserve established behavior, element IDs, localization hooks, and accessibility semantics.
2. Derive one visual direction from the request and existing product. Define a small set of colors, type, spacing, surface, and motion rules; avoid mixing unrelated styles or adding decorative effects without a purpose.
3. Design the complete interaction: default, hover, focus, active, disabled, loading, error, and empty states. Keep controls keyboard-operable and provide visible focus.
4. Make layouts responsive to narrow phones, tablets, and desktop. Prevent clipped menus, horizontal overflow, unreadable truncation, and unsafe-area overlap. Respect `prefers-reduced-motion`.
5. Keep changes production-ready: do not expose provider secrets in browser code or local storage, do not add arbitrary third-party scripts, and sanitize untrusted markup/assets. Reuse the existing Worker/provider adapters rather than introducing a second API path.
6. For provider changes, use the existing shared adapter and capability metadata. Route only supported modalities to a provider; do not make unsupported models appear capable, and keep fallback attempts finite and explicit.
7. Verify the affected tests and production build. Exercise the relevant UI at representative viewport sizes when browser validation is available; report any validation that could not be performed.

## MyAI design application

- Preserve the existing light and dark theme controls.
- Prefer a restrained liquid-glass treatment for dark surfaces: translucent neutral layers, blur used only where it improves hierarchy, a subtle specular edge, and readable contrast.
- Keep the prompt composer compact. On wide screens, align attachment and prompt helpers on the left and mode/model/send controls on the right; allow a deliberate compact layout on smaller screens.
- Keep the model selector driven by the server catalog and current access tier. Provider-specific capabilities and health must remain visible and truthful.

## Source and safety

The original archive targets Claude Code and assumes tools that are not available in this workspace. Its automation scripts are not required for this workflow and must not be executed as part of skill installation. See the accompanying `NOTICE` and `LICENSE` for source attribution and license terms.
