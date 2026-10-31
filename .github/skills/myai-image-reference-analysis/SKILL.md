---
name: myai-image-reference-analysis
description: "Use when analyzing an uploaded visual reference to describe its composition or produce a prompt that can guide a new MyAI image."
---

# MyAI image reference analysis

First determine whether the user wants a description, text extraction, editing instructions, or a generation prompt. These are different tasks and should not be conflated.

## Analysis steps

1. Identify the main subjects, actions, spatial relationships, framing, perspective, lighting, palette, materials, and visible text that matter to the requested outcome.
2. Separate direct observations from uncertain interpretation. Do not invent hidden context, identity, location, camera metadata, or intent.
3. For a generation prompt, describe the visual structure in concrete terms and preserve the source's medium and aspect ratio only when the user requests them.
4. For OCR, quote only text that is legible; mark uncertain characters rather than filling them in.
5. If the user asks for an edit, state what must remain unchanged and isolate the requested modifications.
6. Return only the requested output shape. Do not produce a long visual report when the user asked for a short prompt.

## MyAI integration

Use the existing attachment handling, image-capability checks, and prompt validation in the application. Do not send images to a provider/model that has not declared image input support, and do not claim that a reference was analyzed if it was not actually available to the model.
