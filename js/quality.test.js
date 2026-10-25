import test from "node:test";
import assert from "node:assert/strict";
import { loadCustomInstructions, loadUserProfile, saveCustomInstructions, saveUserProfile } from "./quality.js";

function installStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  return values;
}

test("user profile persistence keeps legacy fields and stores profile info in the established key", () => {
  const values = installStorage();
  values.set("myai_user_profile", JSON.stringify({ name: "Ari", role: "Developer", tone: "Friendly" }));

  assert.deepEqual(loadUserProfile(), {
    name: "Ari",
    role: "Developer",
    tone: "Friendly",
    preferences: "",
    about: "",
  });
  const saved = saveUserProfile({ ...loadUserProfile(), about: "Saya membuat aplikasi web." });
  assert.equal(saved.about, "Saya membuat aplikasi web.");
  assert.equal(JSON.parse(values.get("myai_user_profile")).name, "Ari");
  assert.equal(loadUserProfile().about, "Saya membuat aplikasi web.");
});

test("custom response style persists separately and is length-bounded", () => {
  const values = installStorage();

  assert.equal(saveCustomInstructions("  Jawab ringkas dan profesional  "), "Jawab ringkas dan profesional");
  assert.equal(values.get("myai_custom_instructions"), "Jawab ringkas dan profesional");
  assert.equal(loadCustomInstructions(), "Jawab ringkas dan profesional");
  assert.equal(saveCustomInstructions("x".repeat(4100)).length, 4000);
});
