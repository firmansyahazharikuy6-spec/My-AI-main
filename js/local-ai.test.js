import assert from "node:assert/strict";
import test from "node:test";
import { filterModelGroupsForMenu } from "../shared/model-catalog.js";

test("local AI providers stay in the menu while removed direct Gemini providers are excluded", () => {
  const groups = filterModelGroupsForMenu([
    { provider: "gemini", models: [{ id: "gemini-model" }] },
    { provider: "local-webgpu", models: [{ id: "local-webgpu-model" }] },
    { provider: "local-ollama", models: [{ id: "llama3.2:latest" }] },
  ]);
  assert.deepEqual(groups.map(({ provider }) => provider), ["local-webgpu", "local-ollama"]);
});
