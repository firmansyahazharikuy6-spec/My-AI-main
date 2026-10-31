import assert from "node:assert/strict";
import test from "node:test";
import { createApiProxy, DEFAULT_PAGES_API_ORIGIN } from "../vite.config.js";

test("local Vite API proxy uses the deployed Pages API without stripping its route", () => {
  const proxy = createApiProxy();
  assert.equal(proxy.target, DEFAULT_PAGES_API_ORIGIN);
  assert.equal(proxy.rewrite("/api/models"), "/api/models");
  assert.equal(proxy.rewrite("/api/health"), "/api/health");
});

test("local Vite API proxy preserves the explicit local Worker route", () => {
  const proxy = createApiProxy({ workerUrl: "http://127.0.0.1:8787" });
  assert.equal(proxy.target, "http://127.0.0.1:8787");
  assert.equal(proxy.rewrite("/api/models"), "/models");
  assert.equal(proxy.rewrite("/api/guest/models"), "/guest/models");
});
