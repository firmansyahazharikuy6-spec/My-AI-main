---
name: myai-presentation-generation
description: "Use when creating or changing MyAI presentation, slide, or PPTX generation workflows and exports."
---

# MyAI presentation generation

Build on MyAI's existing document and presentation export paths instead of introducing a GPT-only command-line dependency. Check the current implementation and supported export libraries before changing behavior.

## Workflow

1. Convert the request into a slide outline with a clear audience, goal, narrative, and ending. Preserve supplied facts and label assumptions.
2. Use a consistent theme, hierarchy, and 16:9 layout unless the user specifies otherwise. Vary layouts to fit content rather than repeating one composition.
3. Keep each slide focused on one claim or idea. Prefer concise, readable text and meaningful visual guidance over dense paragraphs.
4. Preserve exact user-supplied names, numbers, and quotations. Never invent statistics, citations, or source material.
5. Generate through the existing MyAI presentation/document pipeline, then validate slide count, ordering, text overflow, and successful file export.
6. Add focused tests for outline limits, title/ending preservation, and export behavior when the workflow changes.

## Constraints

- Do not require OpenAI-specific credentials or bypass MyAI's configured provider routing.
- Do not run external install scripts or import large unreviewed template/style archives as part of a presentation request.
- Report unsupported edits or missing source content instead of presenting a partial export as complete.
