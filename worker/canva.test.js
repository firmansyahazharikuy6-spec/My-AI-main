import assert from "node:assert/strict";
import test from "node:test";
import { setFetch } from "../test/set-fetch.js";
import {
  CANVA_SCOPES,
  CanvaError,
  createPresentation,
  finishOAuth,
  getAccessToken,
  startOAuth,
} from "./src/canva.ts";

class MemoryKV {
  values = new Map();

  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

function createEnv(store = new MemoryKV()) {
  return {
    CANVA_CLIENT_ID: "test-client-id",
    CANVA_CLIENT_SECRET: "test-client-secret",
    CANVA_REDIRECT_URI: "https://worker.test/canva/oauth/callback",
    CANVA_BRAND_TEMPLATE_ID: "brand-template",
    CANVA_TOKEN_STORE: store,
  };
}

test("OAuth uses PKCE, required scopes, one-time state, and persists per-user tokens", async (context) => {
  const store = new MemoryKV();
  const env = createEnv(store);
  const authorizationUrl = new URL(await startOAuth(new Request("https://worker.test/canva/oauth/start", {
    headers: { Origin: "https://myai-v3-firmansyah.pages.dev" },
  }), env, "firebase-uid"));
  const state = authorizationUrl.searchParams.get("state");
  const stateRecord = await store.get(`canva:oauth:state:${state}`, "json");
  assert.equal(authorizationUrl.origin, "https://www.canva.com");
  assert.equal(authorizationUrl.pathname, "/api/oauth/authorize");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.deepEqual(authorizationUrl.searchParams.get("scope").split(" "), [...CANVA_SCOPES]);
  assert.equal(stateRecord.userId, "firebase-uid");
  assert.equal(stateRecord.returnOrigin, "https://myai-v3-firmansyah.pages.dev");

  setFetch(context, async (url, options) => {
    assert.equal(String(url), "https://api.canva.com/rest/v1/oauth/token");
    assert.match(options.headers.Authorization, /^Basic /);
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "auth-code");
    assert.equal(form.get("code_verifier"), stateRecord.codeVerifier);
    return Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 14_400,
    });
  });
  const callback = await finishOAuth(new Request(
    `https://worker.test/canva/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
  ), env);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("Location"), "https://myai-v3-firmansyah.pages.dev/?canva_connected=1");
  assert.equal(await store.get(`canva:oauth:state:${state}`, "json"), null);
  assert.equal(await getAccessToken(env, "firebase-uid"), "access-token");
});

test("expired access tokens refresh and rotate refresh credentials", async (context) => {
  const store = new MemoryKV();
  const env = createEnv(store);
  await store.put("canva:tokens:uid", JSON.stringify({
    access_token: "expired-access",
    refresh_token: "old-refresh",
    expires_at: Date.now() - 1000,
  }));
  setFetch(context, async (_url, options) => {
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "old-refresh");
    return Response.json({
      access_token: "new-access",
      refresh_token: "rotated-refresh",
      expires_in: 14_400,
    });
  });
  assert.equal(await getAccessToken(env, "uid"), "new-access");
  assert.equal((await store.get("canva:tokens:uid", "json")).refresh_token, "rotated-refresh");
});

test("presentation autofills the configured template and exports through Canva", async (context) => {
  const store = new MemoryKV();
  const env = createEnv(store);
  await store.put("canva:tokens:uid", JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: Date.now() + 60_000_000,
  }));
  const calls = [];
  let datasetAttempts = 0;
  setFetch(context, async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push(`${options.method || "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/brand-templates/brand-template/dataset")) {
      datasetAttempts += 1;
      if (datasetAttempts === 1) return new Response(null, { status: 429 });
      return Response.json({ dataset: {
        presentation_title: { type: "text" },
        slide_1_title: { type: "text" },
        slide_1_content: { type: "text" },
      } });
    }
    if (url.pathname === "/rest/v1/autofills" && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.type, "create_from_brand_template");
      assert.equal(body.data.presentation_title.text, "Quarterly Plan");
      assert.equal(body.data.slide_1_content.text, "Goals\nGrow retention\nImprove onboarding");
      return Response.json({ job: { id: "autofill-job" } });
    }
    if (url.pathname.endsWith("/autofills/autofill-job")) {
      return Response.json({ job: {
        status: "success",
        result: { design: { id: "design-id", urls: {
          edit_url: "https://www.canva.com/design/design-id/edit",
          view_url: "https://www.canva.com/design/design-id/view",
        } } },
      } });
    }
    if (url.pathname === "/rest/v1/exports" && options.method === "POST") {
      assert.equal(JSON.parse(options.body).format.type, "pptx");
      return Response.json({ job: { id: "export-job" } });
    }
    if (url.pathname.endsWith("/exports/export-job")) {
      return Response.json({ job: {
        status: "success",
        result: { urls: ["https://export-download.canva.com/presentation.pptx"] },
      } });
    }
    throw new Error(`Unexpected Canva test request: ${options.method || "GET"} ${url.pathname}`);
  });

  const result = await createPresentation(env, "uid", {
    title: "Quarterly Plan",
    slides: [{ title: "Goals", content: ["Grow retention", "Improve onboarding"] }],
  });
  assert.equal(result.designId, "design-id");
  assert.equal(result.templateUsed, true);
  assert.match(result.editUrl, /^https:\/\/www\.canva\.com\//);
  assert.match(result.downloadUrl, /^https:\/\/export-download\.canva\.com\//);
  assert.deepEqual(calls, [
    "GET /rest/v1/brand-templates/brand-template/dataset",
    "GET /rest/v1/brand-templates/brand-template/dataset",
    "POST /rest/v1/autofills",
    "GET /rest/v1/autofills/autofill-job",
    "POST /rest/v1/exports",
    "GET /rest/v1/exports/export-job",
  ]);
});

test("Canva API 401 refreshes once and retries with the rotated access token", async (context) => {
  const store = new MemoryKV();
  const env = createEnv(store);
  env.CANVA_BRAND_TEMPLATE_ID = "";
  await store.put("canva:tokens:uid", JSON.stringify({
    access_token: "expired-access",
    refresh_token: "refresh-token",
    expires_at: Date.now() + 60_000_000,
  }));
  const designTokens = [];
  let exportPolls = 0;
  setFetch(context, async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/token")) {
      assert.equal(new URLSearchParams(options.body).get("grant_type"), "refresh_token");
      return Response.json({
        access_token: "refreshed-access",
        refresh_token: "rotated-refresh",
        expires_in: 14_400,
      });
    }
    if (url.pathname === "/rest/v1/designs") {
      designTokens.push(options.headers.Authorization);
      if (designTokens.length === 1) return new Response(null, { status: 401 });
      return Response.json({ design: { id: "new-design", urls: {
        edit_url: "https://www.canva.com/design/new-design/edit",
        view_url: "https://www.canva.com/design/new-design/view",
      } } });
    }
    if (url.pathname === "/rest/v1/exports") return Response.json({ job: { id: "export-job" } });
    if (url.pathname.endsWith("/exports/export-job")) {
      exportPolls += 1;
      return Response.json({ job: { status: "success", result: { urls: ["https://download.canva.com/file.pptx"] } } });
    }
    throw new Error(`Unexpected Canva test request: ${url.pathname}`);
  });
  const result = await createPresentation(env, "uid", {
    title: "New design",
    slides: [{ title: "Opening", content: ["Point"] }],
  });
  assert.equal(result.designId, "new-design");
  assert.deepEqual(designTokens, ["Bearer expired-access", "Bearer refreshed-access"]);
  assert.equal(exportPolls, 1);
  assert.equal((await store.get("canva:tokens:uid", "json")).refresh_token, "rotated-refresh");
});

test("Canva 403 permissions are surfaced as typed errors without fallback", async (context) => {
  const store = new MemoryKV();
  const env = createEnv(store);
  env.CANVA_BRAND_TEMPLATE_ID = "";
  await store.put("canva:tokens:uid", JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: Date.now() + 60_000_000,
  }));
  setFetch(context, async () => new Response(null, { status: 403 }));
  await assert.rejects(createPresentation(env, "uid", {
    title: "Forbidden",
    slides: [{ title: "Opening", content: ["Point"] }],
  }), (error) => error instanceof CanvaError
    && error.status === 403
    && error.code === "CANVA_PERMISSION_DENIED");
});
