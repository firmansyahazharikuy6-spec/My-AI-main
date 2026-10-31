import assert from "node:assert/strict";
import test from "node:test";
import { brandOf, modelBrandName, modelPublisherName } from "./models.js";

test("model publishers are derived from namespaced model IDs for consistent catalog groups", () => {
  assert.equal(modelPublisherName({ id: "deepseek/deepseek-r1" }), "Deepseek");
  assert.equal(modelPublisherName({ id: "01-ai/yi-large" }), "01.AI");
  assert.equal(modelPublisherName({ id: "x-ai/grok-4" }), "xAI");
  assert.equal(modelPublisherName({ id: "unlisted-lab/model-v1" }), "Unlisted Lab");
  assert.equal(modelPublisherName({ id: "unqualified-model" }), "");
});

test("OpenRouter models without a known brand are grouped by publisher and receive its logo", () => {
  const publisher = modelBrandName({ id: "aion-labs/aion-3.5", name: "Aion 3.5" }, "gateway-openrouter");
  assert.equal(publisher, "Aion Labs");
  assert.match(brandOf(publisher).src, /aionlabs-color\.svg$/);
  assert.equal(modelBrandName({ id: "bytedance-seed/seed-2.0", name: "Seed 2.0" }, "openrouter"), "ByteDance");
  assert.equal(modelBrandName({ id: "openrouter/bodybuilder", name: "Body Builder" }, "gateway-openrouter"), "OpenRouter");
  assert.equal(modelBrandName({ id: "unlisted-lab/model" }, "openrouter"), "Unlisted Lab");
});
