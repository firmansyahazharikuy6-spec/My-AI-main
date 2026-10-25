import assert from "node:assert/strict";
import test from "node:test";
import pagesWorker from "./_worker.js";

test("Pages static JavaScript responses preserve Content-Type and exact allowed origin", async () => {
  const response = await pagesWorker.fetch(new Request(
    "https://myai-v3-firmansyah.pages.dev/assets/app.js",
    { headers: { Origin: "https://myai-v3-firmansyah.pages.dev" } },
  ), {
    ASSETS: {
      fetch: async () => new Response("export const ready = true;", {
        headers: { "Content-Type": "application/javascript" },
      }),
    },
  });

  assert.equal(response.headers.get("Content-Type"), "application/javascript");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://myai-v3-firmansyah.pages.dev");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("Pages static responses do not grant CORS to unrelated origins", async () => {
  const response = await pagesWorker.fetch(new Request(
    "https://myai-v3-firmansyah.pages.dev/assets/app.js",
    { headers: { Origin: "https://another-project.pages.dev" } },
  ), {
    ASSETS: {
      fetch: async () => new Response("export const ready = true;", {
        headers: { "Content-Type": "application/javascript" },
      }),
    },
  });

  assert.equal(response.headers.get("Content-Type"), "application/javascript");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("Pages forwards guest configuration requests to the Worker", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (request) => {
    upstreamUrl = request.url;
    return new Response(JSON.stringify({ turnstileSiteKey: "test-site-key" }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await pagesWorker.fetch(new Request(
      "https://myai-v3-firmansyah.pages.dev/api/guest/config",
    ), { ASSETS: { fetch: () => new Response("unexpected static fallback", { status: 500 }) } });

    assert.equal(upstreamUrl, "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev/guest/config");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { turnstileSiteKey: "test-site-key" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
