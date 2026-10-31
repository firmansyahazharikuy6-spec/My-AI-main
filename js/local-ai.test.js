import assert from "node:assert/strict";
import test from "node:test";
import { filterModelGroupsForMenu } from "../shared/model-catalog.js";
import { estimateWebGpuCatalogSize, getWebGpuModelGroup, WEBGPU_GUEST_MODEL_ID } from "./local-ai.js";

test("local AI providers stay in the menu while removed direct Gemini providers are excluded", () => {
  const groups = filterModelGroupsForMenu([
    { provider: "gemini", models: [{ id: "gemini-model" }] },
    { provider: "local-webgpu", models: [{ id: "local-webgpu-model" }] },
    { provider: "local-ollama", models: [{ id: "llama3.2:latest" }] },
  ]);
  assert.deepEqual(groups.map(({ provider }) => provider), ["local-webgpu", "local-ollama"]);
});

test("trial guests only see Llama Lite while signed-in users see the full WebGPU catalog", () => {
  const guestGroup = getWebGpuModelGroup({ authenticated: false });
  assert.equal(guestGroup.provider, "local-webgpu");
  assert.equal(guestGroup.models.length, 1);
  assert.equal(guestGroup.models[0].id, WEBGPU_GUEST_MODEL_ID);
  assert.match(guestGroup.models[0].name, /Lite/);

  const fullGroup = getWebGpuModelGroup({ authenticated: true });
  assert.ok(fullGroup.models.length > 50, `expected a rich catalog, got ${fullGroup.models.length}`);
  const ids = fullGroup.models.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length, "model ids must be unique");
  assert.ok(ids.includes(WEBGPU_GUEST_MODEL_ID));
  assert.ok(ids.includes("Qwen3-8B-q4f16_1-MLC"));
  assert.ok(ids.includes("Hermes-3-Llama-3.2-3B-q4f16_1-MLC"));
});

test("WebGPU catalog defaults to the signed-in view and marks every model free", () => {
  const group = getWebGpuModelGroup();
  assert.equal(group.models.length, getWebGpuModelGroup({ authenticated: true }).models.length);
  for (const model of group.models) {
    assert.equal(model.accessTier, "free");
    assert.equal(model.priceTier, "free");
    assert.ok(Number(model.contextWindow) > 0);
  }
});

test("catalog size estimate parses memory labels into gigabytes", () => {
  const sizeGb = estimateWebGpuCatalogSize();
  assert.ok(sizeGb > 100 && sizeGb < 300, `expected a large catalog estimate, got ${sizeGb}`);
});
