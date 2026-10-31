import assert from "node:assert/strict";
import test from "node:test";

test("web app uses the same-origin API path so local Vite can proxy the Worker", async () => {
  const config = await import(`./config.js?local-proxy=${Date.now()}`);
  assert.equal(config.AI_API_URL, "/api");
});

test("Capacitor app uses the production Pages API instead of its local WebView origin", async () => {
  const previousBridge = globalThis.androidBridge;
  globalThis.androidBridge = {};
  try {
    const config = await import(`./config.js?native-api=${Date.now()}`);
    assert.equal(config.AI_API_URL, "https://myai-v3-firmansyah.pages.dev/api");
  } finally {
    if (previousBridge === undefined) delete globalThis.androidBridge;
    else globalThis.androidBridge = previousBridge;
  }
});
