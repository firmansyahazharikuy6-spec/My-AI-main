import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITIES,
  CAPABILITY_COUNT,
  capabilityCategories,
  listCapabilities,
  searchCapabilities,
} from "./capabilities.js";

test("catalog holds exactly 150 unique capabilities with valid engines", () => {
  assert.equal(CAPABILITY_COUNT, 150);
  assert.equal(listCapabilities().length, 150);
  const ids = new Set(CAPABILITIES.map((capability) => capability.id));
  assert.equal(ids.size, 150);
  for (const capability of CAPABILITIES) {
    assert.equal(typeof capability.category, "string");
    assert.ok(capability.category.length > 0);
    assert.equal(typeof capability.label, "string");
    assert.ok(capability.label.length > 0);
    assert.equal(typeof capability.hint, "string");
    assert.ok(capability.hint.length > 0);
    assert.ok(capability.engines.length >= 1 && capability.engines.length <= 3);
    for (const engine of capability.engines) {
      assert.ok(["cloud", "webgpu", "ollama"].includes(engine), `engine invalid: ${engine} pada ${capability.id}`);
    }
  }
});

test("capabilities spread across at least 10 categories", () => {
  const categories = capabilityCategories();
  assert.ok(categories.length >= 10);
  for (const category of categories) {
    const count = CAPABILITIES.filter((capability) => capability.category === category).length;
    assert.ok(count >= 5, `${category} terlalu sedikit: ${count}`);
  }
});

test("search filters by label, hint, id, and category", () => {
  const byLabel = searchCapabilities("kode");
  assert.ok(byLabel.length > 0);
  assert.ok(byLabel.every((capability) => (
    capability.label.toLowerCase().includes("kode")
    || capability.hint.toLowerCase().includes("kode")
    || capability.id.includes("kode")
  )));
  const byCategory = searchCapabilities("", "Koding & Teknologi");
  assert.ok(byCategory.length > 0);
  assert.ok(byCategory.every((capability) => capability.category === "Koding & Teknologi"));
  assert.equal(searchCapabilities("").length, 150);
  assert.equal(searchCapabilities("zzz-tidak-ada").length, 0);
});

test("local engines cover text-only capabilities; cloud covers vision, audio, and research", () => {
  const has = (id) => CAPABILITIES.find((capability) => capability.id === id);
  assert.ok(has("deskripsi-gambar").engines.includes("cloud"));
  assert.equal(has("deskripsi-gambar").engines.includes("webgpu"), false);
  assert.ok(has("transkripsi-audio").engines.includes("cloud"));
  assert.ok(has("riset-web").engines.includes("cloud"));
  assert.ok(has("tanya-jawab").engines.includes("webgpu"));
  assert.ok(has("tanya-jawab").engines.includes("ollama"));
});
