import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRateLimitStore,
  CLOUD_CHAT_DAILY_LIMIT,
  DEVICE_IDLE_PRUNE_MS,
  IP_CLOUD_CHAT_DAILY_SIGNAL,
  MAX_ACCOUNT_DEVICES,
} from "./src/rate-limit.js";

function memoryStorage() {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
    list: async ({ prefix = "" } = {}) => new Map(
      [...values].filter(([key]) => key.startsWith(prefix)),
    ),
    transaction: async (callback) => callback(storage),
  };
  return storage;
}

function storeRequest(store, pathname, body) {
  return new Request(`https://ai-daily-rate-limit.internal${pathname}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function sha(value) {
  return Buffer.from(String(value)).toString("hex").padEnd(64, "0").slice(0, 64);
}

test("cloud chat quota allows 3 reserves per day then blocks until tomorrow", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = (limit = CLOUD_CHAT_DAILY_LIMIT) => storeRequest(store, "/cloud-chat/reserve", { limit });
  for (let index = 0; index < CLOUD_CHAT_DAILY_LIMIT; index += 1) {
    const result = await (await store.fetch(reserve())).json();
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, CLOUD_CHAT_DAILY_LIMIT - index - 1);
  }
  const exhausted = await (await store.fetch(reserve())).json();
  assert.deepEqual(exhausted, { allowed: false, remaining: 0 });
});

test("device registration caps an account at 5 devices and re-registration is idempotent", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const register = (deviceHash) => storeRequest(store, "/device/register", {
    deviceHash: sha(deviceHash),
    maxDevices: MAX_ACCOUNT_DEVICES,
    idlePruneMs: DEVICE_IDLE_PRUNE_MS,
  });
  for (let index = 0; index < MAX_ACCOUNT_DEVICES; index += 1) {
    const result = await (await store.fetch(register(`device-${index}`))).json();
    assert.equal(result.allowed, true, `device ${index} should register`);
    assert.equal(result.deviceCount, index + 1);
  }
  const blocked = await (await store.fetch(register("device-overflow"))).json();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.deviceCount, MAX_ACCOUNT_DEVICES);

  const repeat = await (await store.fetch(register("device-2"))).json();
  assert.equal(repeat.allowed, true);
  assert.equal(repeat.registered, false);
  assert.equal(repeat.deviceCount, MAX_ACCOUNT_DEVICES);
});

test("quota status reports used chat count and registered device count", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const status = (body = {}) => storeRequest(store, "/quota/status", body);
  const initial = await (await store.fetch(status())).json();
  assert.equal(initial.chatUsed, 0);
  assert.equal(initial.chatRemaining, CLOUD_CHAT_DAILY_LIMIT);
  assert.equal(initial.deviceCount, 0);

  await store.fetch(storeRequest(store, "/cloud-chat/reserve", { limit: CLOUD_CHAT_DAILY_LIMIT }));
  await store.fetch(storeRequest(store, "/device/register", {
    deviceHash: sha("one-device"),
    maxDevices: MAX_ACCOUNT_DEVICES,
    idlePruneMs: DEVICE_IDLE_PRUNE_MS,
  }));
  const after = await (await store.fetch(status())).json();
  assert.equal(after.chatUsed, 1);
  assert.equal(after.chatRemaining, CLOUD_CHAT_DAILY_LIMIT - 1);
  assert.equal(after.deviceCount, 1);
});

test("IP abuse signal blocks only after its generous daily threshold", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = () => storeRequest(store, "/ip-signal/reserve", { limit: IP_CLOUD_CHAT_DAILY_SIGNAL });
  const first = await (await store.fetch(reserve())).json();
  assert.equal(first.allowed, true);
  const second = await (await store.fetch(reserve())).json();
  assert.equal(second.allowed, true);
  const third = await (await store.fetch(storeRequest(store, "/ip-signal/reserve", { limit: 2 }))).json();
  assert.deepEqual(third, { allowed: false, remaining: 0 });
});
