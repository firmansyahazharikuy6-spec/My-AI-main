import assert from "node:assert/strict";
import test from "node:test";
import { startGeminiLiveSession } from "./live-voice.js";

function installLiveBrowserMocks({ createMediaStreamSource = () => ({ connect() {}, disconnect() {} }), fetchImpl } = {}) {
  const originalDescriptors = new Map(
    ["window", "navigator", "WebSocket", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  class MockAudioContext {
    constructor() {
      this.sampleRate = 16000;
      this.state = "running";
      this.destination = {};
    }

    async resume() {}
    async close() { this.state = "closed"; }
    createMediaStreamSource(value) {
      assert.equal(value, stream);
      return createMediaStreamSource();
    }
    createScriptProcessor() {
      return { connect() {}, disconnect() {}, onaudioprocess: null };
    }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  }
  class MockWebSocket {
    static OPEN = 1;
    static CLOSING = 2;

    constructor() {
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }));
      });
    }

    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.({ reason: "" });
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      isSecureContext: true,
      WebSocket: MockWebSocket,
      AudioContext: MockAudioContext,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: MockWebSocket });
  if (fetchImpl) Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchImpl });
  else Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => Response.json({ token: "temporary-live-token" }),
  });

  return {
    tracks,
    restore() {
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("Gemini Live rejects setup errors and releases the microphone", async () => {
  const browser = installLiveBrowserMocks({
    createMediaStreamSource() {
      throw new Error("Audio graph setup failed.");
    },
  });
  try {
    await assert.rejects(startGeminiLiveSession({
      apiBase: "/api",
      authToken: "test-auth",
      systemInstruction: "Test",
    }), /Audio graph setup failed/);
    assert.equal(browser.tracks[0].stopped, true);
  } finally {
    browser.restore();
  }
});

test("Gemini Live cancellation while requesting a token releases the microphone", async () => {
  const browser = installLiveBrowserMocks({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  const controller = new AbortController();
  try {
    const startup = startGeminiLiveSession({
      apiBase: "/api",
      authToken: "test-auth",
      systemInstruction: "Test",
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(startup, { name: "AbortError" });
    assert.equal(browser.tracks[0].stopped, true);
  } finally {
    browser.restore();
  }
});
