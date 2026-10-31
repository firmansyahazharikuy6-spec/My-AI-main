---
name: myai-image-generation
description: "Use when improving MyAI image generation, image editing, prompt enhancement, aspect-ratio handling, or visual-result validation."
---

# MyAI image generation

Use the existing image prompt and provider pipeline rather than adding a second direct API client. Relevant implementation lives in `js/image-prompts.js`, `js/providers.js`, the image task routing, and the Worker image routes.

## Workflow

1. Classify the request as a new image, an edit of an attached image, or a request to analyze a visual reference. Do not convert an edit into a new image.
2. Preserve the user's named subjects, relationships, requested text, style, and composition. Ask only when a missing detail blocks a useful result.
3. Clean up command phrasing without deleting meaningful scene details. Keep optional negative prompts and assumptions separate from the positive prompt.
4. Validate generated prompt plans and fall back to the local plan when the model output is malformed or loses required subject anchors.
5. Route only through an image-capable model and the existing server-side provider configuration. Never add a direct browser API key or an unapproved provider.
6. Verify with focused image prompt tests, including Indonesian and English prompts, reference edits, invalid model output, and provider capability checks.

## Constraints

- Do not invent text or branding that the user did not request.
- Preserve identity and other explicit invariants when editing supplied images.
- Keep image-generation and chat endpoints distinct; do not silently substitute text chat for image output.
- Report provider limitations honestly and keep the local prompt fallback usable when a network call is unavailable.
