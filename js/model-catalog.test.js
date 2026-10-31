import assert from "node:assert/strict";
import test from "node:test";
import { filterModelGroupsForMenu, isOpenRouterProvider, MODEL_MENU_PROVIDERS } from "../shared/model-catalog.js";

test("the model menu excludes direct Gemini chat while preserving OpenRouter models", () => {
  const groups = filterModelGroupsForMenu([
    { provider: "gateway-nvidia", models: [{ id: "nvidia/model" }] },
    { provider: "gemini", models: [{ id: "gemini-model" }] },
    { provider: "gateway-gemini", models: [{ id: "gateway-gemini-model" }] },
    { provider: "openrouter-image", models: [{ id: "image-model" }] },
    { provider: "claude", models: [{ id: "claude-model" }] },
    { provider: "gateway-kimi", models: [{ id: "kimi-model" }] },
    { provider: "gateway-huggingface", models: [{ id: "hf-model" }] },
    { provider: "groq", models: [{ id: "groq-model" }] },
    { provider: "local-webgpu", models: [{ id: "local-model" }] },
    { provider: "empty", models: [] },
  ]);
  assert.deepEqual(MODEL_MENU_PROVIDERS, [
    "nvidia",
    "openrouter",
    "groq",
    "claude",
    "kimi",
    "local-webgpu",
    "local-ollama",
  ]);
  assert.deepEqual(groups.map(({ provider }) => provider), [
    "gateway-nvidia",
    "openrouter-image",
    "claude",
    "gateway-kimi",
    "groq",
    "local-webgpu",
  ]);
});

test("local AI providers stay in the menu while unsupported providers are filtered out", () => {
  assert.deepEqual(filterModelGroupsForMenu([
    { provider: "local-webgpu", models: [{ id: "local-webgpu-model" }] },
    { provider: "local-ollama", models: [{ id: "llama3.2:latest" }] },
    { provider: "gemini", models: [{ id: "gemini-model" }] },
  ]).map(({ provider }) => provider), ["local-webgpu", "local-ollama"]);
});

test("guest models stay restricted to the existing guest-enabled providers", () => {
  const [guest] = filterModelGroupsForMenu([{
    provider: "guest",
    models: [
      { id: "gemini::flash", backendProvider: "gemini" },
      { id: "groq::llama", backendProvider: "groq" },
      { id: "openrouter::google/gemma-free", backendProvider: "openrouter" },
      { id: "claude::haiku", backendProvider: "claude" },
      { id: "kimi::chat", backendProvider: "kimi" },
      { id: "provider-without-mapping" },
    ],
  }]);
  assert.deepEqual(guest.models.map(({ id }) => id), ["groq::llama", "openrouter::google/gemma-free"]);
  assert.deepEqual(filterModelGroupsForMenu([{ provider: "guest", models: [{ id: "unknown" }] }]), []);
});

test("Hugging Face inference is excluded from supported model menus", () => {
  assert.equal(MODEL_MENU_PROVIDERS.includes("huggingface"), false);
  assert.deepEqual(filterModelGroupsForMenu([
    { provider: "huggingface", models: [{ id: "hf-model" }] },
    { provider: "gateway-huggingface", models: [{ id: "hf-gateway-model" }] },
  ]), []);
});

test("Qwen remains in the active OpenRouter fallback catalog", () => {
  const qwenModels = [
    "google/gemma-4-26b-a4b-it:free",
    "qwen/qwen3-8b:free",
    "qwen/qwq-32b:free",
  ];
  assert.equal(qwenModels.some((id) => /qwen|qwq/i.test(id)), true);
  assert.equal(MODEL_MENU_PROVIDERS.includes("openrouter"), true);
});

test("OpenRouter catalog and image groups share the no-MyAI-tier-gate policy", () => {
  assert.equal(isOpenRouterProvider("openrouter"), true);
  assert.equal(isOpenRouterProvider("gateway-openrouter"), true);
  assert.equal(isOpenRouterProvider("openrouter-image"), true);
  assert.equal(isOpenRouterProvider("gateway-gemini"), false);
  assert.equal(isOpenRouterProvider("guest"), false);
});
