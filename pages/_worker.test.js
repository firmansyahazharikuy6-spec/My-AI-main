import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pagesWorker from "./_worker.js";

test("Pages CSP permits Ollama on loopback and Hugging Face model downloads", () => {
  const headers = readFileSync(new URL("./_headers", import.meta.url), "utf8");
  const policy = headers.match(/Content-Security-Policy:\s*([^\r\n]+)/)?.[1] || "";
  const connectSources = policy.match(/connect-src\s+([^;]+)/)?.[1] || "";

  assert.match(connectSources, /http:\/\/localhost:\*/);
  assert.match(connectSources, /http:\/\/127\.0\.0\.1:\*/);
  assert.match(connectSources, /https:\/\/huggingface\.co/);
  assert.match(connectSources, /https:\/\/\*\.huggingface\.co/);
  assert.match(connectSources, /https:\/\/\*\.hf\.co/);
  assert.doesNotMatch(connectSources, /\[::1\]/);
  assert.doesNotMatch(connectSources, /http:\/\/\*/);
  assert.doesNotMatch(connectSources, /https:\/\/\*(?:\s|;|$)/);
});

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

test("Pages proxy allows Capacitor's secure localhost origin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), {
    headers: { "Content-Type": "application/json" },
  });

  try {
    const response = await pagesWorker.fetch(new Request(
      "https://myai-v3-firmansyah.pages.dev/api/models",
      { headers: { Origin: "https://localhost" } },
    ), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://localhost");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("Pages forwards email preview requests to the Worker", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (request) => {
    upstreamUrl = request.url;
    return Response.json({ confirmationToken: "test-confirmation" });
  };

  try {
    const response = await pagesWorker.fetch(new Request(
      "https://myai-v3-firmansyah.pages.dev/api/send-email/preview",
      { method: "POST", body: JSON.stringify({ to: "user@example.test" }) },
    ), {});

    assert.equal(upstreamUrl, "https://myai-v3-free-api.firmansyahazharikuy6.workers.dev/send-email/preview");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { confirmationToken: "test-confirmation" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages preflight allows Turnstile headers for guest model requests", async () => {
  const response = await pagesWorker.fetch(new Request(
    "https://myai-v3-firmansyah.pages.dev/api/guest/models",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://myai-v3-firmansyah.pages.dev",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-turnstile-token,x-guest-device-id",
      },
    },
  ), {});

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://myai-v3-firmansyah.pages.dev");
  const allowedHeaders = response.headers.get("Access-Control-Allow-Headers").toLowerCase();
  assert.match(allowedHeaders, /x-turnstile-token/);
  assert.match(allowedHeaders, /x-guest-device-id/);
});
