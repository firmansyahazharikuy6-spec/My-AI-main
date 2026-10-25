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
