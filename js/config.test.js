import assert from "node:assert/strict";
import test from "node:test";

test("frontend uses the same-origin API path so local Vite can proxy the Worker", async () => {
  const config = await import(`./config.js?local-proxy=${Date.now()}`);
  assert.equal(config.AI_API_URL, "/api");
});
