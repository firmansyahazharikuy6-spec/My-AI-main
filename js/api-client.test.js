import assert from "node:assert/strict";
import test from "node:test";
import { fetchAiApi, getAiApiUrl } from "./api-client.js";

test("API URL joins routes without changing configured base paths", () => {
  assert.equal(getAiApiUrl("/models", "https://api.example.test/api/"), "https://api.example.test/api/models");
  assert.equal(getAiApiUrl("chat", "/api"), "/api/chat");
});

test("API client preserves HTTP responses for endpoint-specific status handling", async () => {
  const response = Response.json({ error: "quota" }, { status: 429 });
  const actual = await fetchAiApi("gateway", {}, {
    baseUrl: "/api",
    fetchImpl: async (url) => {
      assert.equal(url, "/api/gateway");
      return response;
    },
  });
  assert.equal(actual.status, 429);
});

test("API client gives a local Worker start hint on network failure", async () => {
  await assert.rejects(fetchAiApi("models", {}, {
    baseUrl: "/api",
    location: { origin: "http://localhost:4173" },
    navigator: { onLine: true },
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
  }), (error) => error.code === "AI_API_UNREACHABLE" && /worker:dev/.test(error.message));
});

test("API client recognizes Vite's HTTP proxy error response as a local Worker outage", async () => {
  await assert.rejects(fetchAiApi("models", {}, {
    baseUrl: "/api",
    location: { origin: "http://127.0.0.1:4173" },
    navigator: { onLine: true },
    fetchImpl: async () => new Response("http proxy error", { status: 500 }),
  }), (error) => error.code === "AI_API_UNREACHABLE" && /worker:dev/.test(error.message));
});

test("API client propagates caller cancellation without relabeling it as a connection issue", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = Object.assign(new Error("cancelled"), { name: "AbortError" });
  await assert.rejects(fetchAiApi("chat", { signal: controller.signal }, {
    baseUrl: "/api",
    fetchImpl: async () => { throw aborted; },
  }), { name: "AbortError" });
});
