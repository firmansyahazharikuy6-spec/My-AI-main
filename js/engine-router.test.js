import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveRouteSummary,
  capabilityForSkill,
  classifyEngineProvider,
  compareModelPreference,
  engineRouteLabel,
  routeAdaptiveModel,
} from "./engine-router.js";

const cloudGroq = { provider: "gateway-groq", id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" };
const cloudNvidia = { provider: "gateway-nvidia", id: "nvidia/llama-3.1-nemotron-70b", name: "Nemotron 70B" };
const cloudCoder = { provider: "gateway-openrouter", id: "qwen/qwen-2.5-coder-32b", name: "Qwen 2.5 Coder" };
const webGpuCoder = { provider: "local-webgpu", id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 Coder 1.5B" };
const webGpuLite = { provider: "local-webgpu", id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 Lite" };
const ollamaModel = { provider: "local-ollama", id: "llama3.2:latest", name: "Llama 3.2 (Ollama)" };
const imageOnly = { provider: "openrouter", id: "google/gemini-2.5-flash-image", name: "Gemini Image", imageOnly: true };
const noChat = { provider: "gateway-groq", id: "whisper-large-v3", name: "Whisper", chatSupport: false };

test("classifies providers into cloud, webgpu, ollama, and guest engines", () => {
  assert.equal(classifyEngineProvider("gateway-groq"), "cloud");
  assert.equal(classifyEngineProvider("openrouter"), "cloud");
  assert.equal(classifyEngineProvider("local-webgpu"), "webgpu");
  assert.equal(classifyEngineProvider("local-ollama"), "ollama");
  assert.equal(classifyEngineProvider("guest"), "guest");
  assert.equal(classifyEngineProvider("lainnya"), "other");
});

test("maps skills to capabilities with a general fallback", () => {
  assert.equal(capabilityForSkill("kode"), "coding");
  assert.equal(capabilityForSkill("gambar"), "image");
  assert.equal(capabilityForSkill("umum"), "general");
  assert.equal(capabilityForSkill("tidak-ada"), "general");
  assert.equal(capabilityForSkill(undefined), "general");
});

test("adaptive route prefers cloud while quota remains, then WebGPU, then Ollama", () => {
  const models = [ollamaModel, webGpuLite, cloudGroq, cloudNvidia];
  const withQuota = routeAdaptiveModel({
    skillId: "umum",
    models,
    cloudRemaining: 2,
    webgpuSupported: true,
    ollamaAvailable: true,
    providerOrder: ["gateway-nvidia", "gateway-groq"],
  });
  assert.equal(withQuota[0].provider, "gateway-nvidia");
  assert.equal(withQuota[1].provider, "gateway-groq");
  assert.equal(withQuota[2].provider, "local-webgpu");
  assert.equal(withQuota[3].provider, "local-ollama");

  const noQuota = routeAdaptiveModel({
    skillId: "umum",
    models,
    cloudRemaining: 0,
    webgpuSupported: true,
    ollamaAvailable: true,
    providerOrder: ["gateway-nvidia", "gateway-groq"],
  });
  assert.equal(noQuota[0].provider, "local-webgpu");
  assert.equal(noQuota[1].provider, "local-ollama");
  assert.equal(noQuota.some((model) => model.provider === "gateway-nvidia"), false);

  const noLocal = routeAdaptiveModel({
    skillId: "umum",
    models,
    cloudRemaining: 3,
    webgpuSupported: false,
    ollamaAvailable: false,
    providerOrder: ["gateway-nvidia", "gateway-groq"],
  });
  assert.equal(noLocal.length, 2);
  assert.equal(noLocal[0].provider, "gateway-nvidia");
});

test("capability hints boost coding models on WebGPU and skip image-only or no-chat models", () => {
  const models = [webGpuLite, webGpuCoder, imageOnly, noChat];
  const route = routeAdaptiveModel({
    skillId: "kode",
    models,
    cloudRemaining: 0,
    webgpuSupported: true,
    ollamaAvailable: false,
  });
  assert.equal(route.length, 2);
  assert.equal(route[0].id, "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC");
  assert.equal(route[1].id, "Llama-3.2-1B-Instruct-q4f16_1-MLC");

  const coding = routeAdaptiveModel({
    skillId: "kode",
    models: [cloudGroq, cloudCoder, webGpuCoder],
    cloudRemaining: 2,
    webgpuSupported: true,
    ollamaAvailable: false,
    providerOrder: ["gateway-groq", "gateway-openrouter"],
  });
  assert.equal(coding[0].id, "qwen/qwen-2.5-coder-32b");
  assert.equal(coding[1].provider, "gateway-groq");
});

test("capability matching prefers hinted models regardless of provider order", () => {
  const order = ["gateway-groq", "gateway-openrouter"];
  assert.equal(compareModelPreference(cloudCoder, cloudGroq, "coding", order) < 0, true);
  assert.equal(compareModelPreference(cloudGroq, cloudGroq, "coding", order), 0);
});

test("route labels explain the chosen engine without confusing the user", () => {
  assert.match(engineRouteLabel(cloudGroq, { cloudRemaining: 2 }), /^Cloud · Llama 3\.1 8B Instant \(kuota tersisa 2\)$/);
  assert.match(engineRouteLabel(webGpuLite), /AI Lokal · WebGPU/);
  assert.match(engineRouteLabel(ollamaModel), /AI Lokal · Ollama/);
});

test("route summary lists available engines in preference order", () => {
  const models = [cloudGroq, webGpuLite, ollamaModel];
  assert.equal(adaptiveRouteSummary({ models, cloudRemaining: 1, webgpuSupported: true, ollamaAvailable: true }), "Cloud → WebGPU → Ollama");
  assert.equal(adaptiveRouteSummary({ models, cloudRemaining: 0, webgpuSupported: true, ollamaAvailable: true }), "WebGPU → Ollama");
  assert.equal(adaptiveRouteSummary({ models: [cloudGroq], cloudRemaining: 0, webgpuSupported: false, ollamaAvailable: false }), "");
});
