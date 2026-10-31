import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRateLimitStore,
  CLOUD_CHAT_DAILY_LIMIT,
  DEVICE_IDLE_PRUNE_MS,
  IP_CLOUD_CHAT_DAILY_SIGNAL,
  LOCAL_AI_DAILY_LIMIT,
  MAX_ACCOUNT_DEVICES,
  enforceCloudChatPerMinute,
  enforceCloudChatQuota,
  releaseCloudChatReservation,
  reserveLocalChatQuota,
} from "./src/rate-limit.js";

function memoryStorage() {
  const values = new Map();
  let queue = Promise.resolve();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
    list: async ({ prefix = "" } = {}) => new Map(
      [...values].filter(([key]) => key.startsWith(prefix)),
    ),
    transaction: async (callback) => {
      const run = queue.then(() => callback(storage));
      queue = run.catch(() => {});
      return run;
    },
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

test("quota status counts only devices seen within the idle prune window", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  await store.fetch(storeRequest(store, "/device/register", {
    deviceHash: sha("active-device"),
    maxDevices: MAX_ACCOUNT_DEVICES,
    idlePruneMs: DEVICE_IDLE_PRUNE_MS,
  }));
  const fresh = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(fresh.deviceCount, 1);
  const expired = await (await store.fetch(storeRequest(store, "/quota/status", { idlePruneMs: 0 }))).json();
  assert.equal(expired.deviceCount, 0);
});

class TestHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fakeQuotaBinding() {
  const instances = new Map();
  const storeFor = (key) => {
    if (!instances.has(key)) {
      instances.set(key, new AIRateLimitStore({ storage: memoryStorage() }));
    }
    return instances.get(key);
  };
  return {
    idFromName: (name) => ({ name }),
    get: (id) => {
      const store = storeFor(String(id?.name ?? id));
      return { fetch: (url, init) => store.fetch(new Request(url, init)) };
    },
    instanceFor: async (name) => storeFor(await sha256Hex(name)),
  };
}

test("IP abuse block fires before the cloud chat reservation burns quota", async () => {
  const binding = fakeQuotaBinding();
  const user = { sub: "audit-user", email: "audit@example.com", email_verified: true };
  const ip = "203.0.113.9";
  const ipStore = await binding.instanceFor(`ip:${ip}`);
  for (let index = 0; index < IP_CLOUD_CHAT_DAILY_SIGNAL; index += 1) {
    const result = await (await ipStore.fetch(
      storeRequest(ipStore, "/ip-signal/reserve", { limit: IP_CLOUD_CHAT_DAILY_SIGNAL }),
    )).json();
    assert.equal(result.allowed, true);
  }
  const request = new Request("https://ai-daily-rate-limit.internal/chat", {
    method: "POST",
    headers: { "x-device-id": "audit-device-0001", "cf-connecting-ip": ip },
  });
  await assert.rejects(
    () => enforceCloudChatQuota(user, { AI_DAILY_RATE_LIMIT_STORE: binding }, request, TestHttpError),
    (error) => error.code === "IP_ABUSE_SIGNAL" && error.status === 429,
  );
  const accountStore = await binding.instanceFor("audit-user");
  const status = await (await accountStore.fetch(storeRequest(accountStore, "/quota/status", {}))).json();
  assert.equal(status.chatUsed, 0, "IP-blocked request must not consume cloud chat quota");
  assert.equal(status.deviceCount, 1, "device heartbeat still registers before the IP check");
});

test("local AI quota allows 5 reserves per day then blocks without touching cloud chat", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = () => storeRequest(store, "/local-chat/reserve", { limit: LOCAL_AI_DAILY_LIMIT });
  for (let index = 0; index < LOCAL_AI_DAILY_LIMIT; index += 1) {
    const result = await (await store.fetch(reserve())).json();
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, LOCAL_AI_DAILY_LIMIT - index - 1);
  }
  const exhausted = await (await store.fetch(reserve())).json();
  assert.deepEqual(exhausted, { allowed: false, remaining: 0 });

  const cloud = await (await store.fetch(
    storeRequest(store, "/cloud-chat/reserve", { limit: CLOUD_CHAT_DAILY_LIMIT }),
  )).json();
  assert.equal(cloud.allowed, true, "local usage must not consume cloud chat quota");
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.localUsed, LOCAL_AI_DAILY_LIMIT);
  assert.equal(status.localRemaining, 0);
  assert.equal(status.chatUsed, 1);

  const invalid = await store.fetch(storeRequest(store, "/local-chat/reserve", { limit: 0 }));
  assert.equal(invalid.status, 400, "invalid local limits must be rejected");
});

test("local reserve idempotency key prevents double counting on retries", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = (key) => storeRequest(store, "/local-chat/reserve", {
    limit: LOCAL_AI_DAILY_LIMIT,
    idempotencyKey: key,
  });
  const first = await (await store.fetch(reserve("retry-key-0001"))).json();
  assert.equal(first.allowed, true);
  const replay = await (await store.fetch(reserve("retry-key-0001"))).json();
  assert.deepEqual(replay, first, "replaying the same key must return the stored result");
  const fresh = await (await store.fetch(reserve("retry-key-0002"))).json();
  assert.equal(fresh.allowed, true);
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.localUsed, 2, "replayed reservations must not increment the counter");
});

test("reserveLocalChatQuota enforces the configured limit and bypasses for admin", async () => {
  const binding = fakeQuotaBinding();
  const user = { sub: "local-user", email: "local@example.com", email_verified: true };
  const env = { AI_DAILY_RATE_LIMIT_STORE: binding, LOCAL_AI_DAILY_LIMIT: "2" };
  const first = await reserveLocalChatQuota(user, env, TestHttpError, "gate-key-0001");
  assert.equal(first.admin, false);
  assert.equal(first.allowed, true);
  assert.equal(first.limit, 2, "configured LOCAL_AI_DAILY_LIMIT must override the default");
  assert.equal(first.remaining, 1);
  await reserveLocalChatQuota(user, env, TestHttpError, "gate-key-0002");
  await assert.rejects(
    () => reserveLocalChatQuota(user, env, TestHttpError, "gate-key-0003"),
    (error) => error.code === "LOCAL_QUOTA_EXCEEDED" && error.status === 429,
  );

  const admin = { sub: "admin-user", email: "muhammadfirmansyahashari@gmail.com", email_verified: true };
  const adminEnv = {
    AI_ADMIN_EMAILS: "muhammadfirmansyahashari@gmail.com",
    AI_DAILY_RATE_LIMIT_STORE: binding,
  };
  const adminReserve = await reserveLocalChatQuota(admin, adminEnv, TestHttpError, "gate-key-0004");
  assert.equal(adminReserve.admin, true);
  assert.equal(adminReserve.allowed, true);
  assert.equal(adminReserve.limit, null);
});

test("cloud reserve idempotency key prevents double counting on retries", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = (key) => storeRequest(store, "/cloud-chat/reserve", {
    limit: CLOUD_CHAT_DAILY_LIMIT,
    idempotencyKey: key,
  });
  const first = await (await store.fetch(reserve("cloud-key-0001"))).json();
  assert.equal(first.allowed, true);
  const replay = await (await store.fetch(reserve("cloud-key-0001"))).json();
  assert.deepEqual(replay, first, "replaying the same key must return the stored result");
  const fresh = await (await store.fetch(reserve("cloud-key-0002"))).json();
  assert.equal(fresh.allowed, true);
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.chatUsed, 2, "replayed reservations must not increment the cloud counter");
});

test("cloud release refunds the reservation and a later reserve succeeds", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = (key) => storeRequest(store, "/cloud-chat/reserve", {
    limit: CLOUD_CHAT_DAILY_LIMIT,
    idempotencyKey: key,
  });
  const first = await (await store.fetch(reserve("cloud-key-0001"))).json();
  assert.equal(first.allowed, true);
  const statusBefore = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(statusBefore.chatUsed, 1);

  const released = await (await store.fetch(
    storeRequest(store, "/cloud-chat/release", { idempotencyKey: "cloud-key-0001", limit: CLOUD_CHAT_DAILY_LIMIT }),
  )).json();
  assert.equal(released.released, true);
  assert.equal(released.remaining, CLOUD_CHAT_DAILY_LIMIT);
  const statusAfter = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(statusAfter.chatUsed, 0, "released reservation must restore the daily counter");

  const again = await (await store.fetch(reserve("cloud-key-0001"))).json();
  assert.equal(again.allowed, true, "the same key may reserve again after a release");
});

test("cloud release is a no-op without a matching reservation and cannot double-refund", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = (key) => storeRequest(store, "/cloud-chat/reserve", {
    limit: CLOUD_CHAT_DAILY_LIMIT,
    idempotencyKey: key,
  });
  const unknown = await (await store.fetch(
    storeRequest(store, "/cloud-chat/release", { idempotencyKey: "unknown-key-00" }),
  )).json();
  assert.equal(unknown.released, false);
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.chatUsed, 0, "release without a reservation must not change the counter");

  await store.fetch(reserve("cloud-key-0001"));
  await store.fetch(storeRequest(store, "/cloud-chat/release", { idempotencyKey: "cloud-key-0001" }));
  const replay = await (await store.fetch(reserve("cloud-key-0001"))).json();
  assert.equal(replay.allowed, true);
  await store.fetch(storeRequest(store, "/cloud-chat/release", { idempotencyKey: "cloud-key-0001" }));
  const secondRelease = await (await store.fetch(
    storeRequest(store, "/cloud-chat/release", { idempotencyKey: "cloud-key-0001" }),
  )).json();
  assert.equal(secondRelease.released, false, "a second release must not double-refund");
  const finalStatus = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(finalStatus.chatUsed, 0);
});

test("simultaneous cloud reservations count exactly once per request under concurrency", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const reserve = (key) => store.fetch(storeRequest(store, "/cloud-chat/reserve", {
    limit: CLOUD_CHAT_DAILY_LIMIT,
    idempotencyKey: key,
  })).then((response) => response.json());
  const results = await Promise.all([
    reserve("parallel-key-01"),
    reserve("parallel-key-02"),
    reserve("parallel-key-03"),
    reserve("parallel-key-04"),
    reserve("parallel-key-05"),
  ]);
  assert.equal(results.filter((result) => result.allowed === true).length, CLOUD_CHAT_DAILY_LIMIT,
    "exactly the daily limit of parallel reservations may succeed");
  assert.equal(results.filter((result) => result.allowed === false).length, 2);
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.chatUsed, CLOUD_CHAT_DAILY_LIMIT,
    "the counter must reflect each successful reservation exactly once");
});

test("local and cloud idempotency namespaces never replay each other's results", async () => {
  const store = new AIRateLimitStore({ storage: memoryStorage() });
  const sharedKey = "shared-key-0001";
  const local = await (await store.fetch(storeRequest(store, "/local-chat/reserve", {
    limit: LOCAL_AI_DAILY_LIMIT,
    idempotencyKey: sharedKey,
  }))).json();
  assert.equal(local.allowed, true);
  const cloud = await (await store.fetch(storeRequest(store, "/cloud-chat/reserve", {
    limit: CLOUD_CHAT_DAILY_LIMIT,
    idempotencyKey: sharedKey,
  }))).json();
  assert.equal(cloud.allowed, true, "a key used for local quota must not replay a cloud reservation");
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.localUsed, 1);
  assert.equal(status.chatUsed, 1, "both counters must count the shared key independently");
});

test("releaseCloudChatReservation refunds through the binding and stays quiet on failures", async () => {
  const binding = fakeQuotaBinding();
  const user = { sub: "refund-user", email: "refund@example.com", email_verified: true };
  const env = { AI_DAILY_RATE_LIMIT_STORE: binding };
  const request = new Request("https://ai-daily-rate-limit.internal/chat", {
    method: "POST",
    headers: { "x-device-id": "refund-device-0001" },
  });
  const reservation = await enforceCloudChatQuota(user, env, request, TestHttpError, "refund-key-0001");
  assert.equal(reservation.admin, false);
  assert.equal(reservation.limit, CLOUD_CHAT_DAILY_LIMIT);
  assert.equal(reservation.remaining, CLOUD_CHAT_DAILY_LIMIT - 1);
  assert.equal(reservation.idempotencyKey, "refund-key-0001");
  const released = await releaseCloudChatReservation(user, env, "refund-key-0001");
  assert.equal(released.released, true);
  const store = await binding.instanceFor("refund-user");
  const status = await (await store.fetch(storeRequest(store, "/quota/status", {}))).json();
  assert.equal(status.chatUsed, 0, "refund through the worker binding must restore the counter");

  const quiet = await releaseCloudChatReservation(user, {}, "refund-key-0001");
  assert.equal(quiet.released, false, "missing binding must not throw during refund");
});

test("chat per-minute limiter blocks bursts but bypasses admins and missing bindings", async () => {
  let calls = 0;
  let lastKey = "";
  const limiter = { limit: async ({ key }) => { calls += 1; lastKey = key; return { success: calls <= 5 }; } };
  const user = { sub: "burst-user", email: "burst@example.com", email_verified: true };
  const env = { AI_RATE_LIMITER: limiter };
  for (let index = 0; index < 5; index += 1) {
    await enforceCloudChatPerMinute(user, env, TestHttpError);
  }
  assert.equal(lastKey, "chat:burst-user", "the limiter must key on the account identity");
  await assert.rejects(
    () => enforceCloudChatPerMinute(user, env, TestHttpError),
    (error) => error.status === 429,
  );

  const admin = { sub: "admin-user", email: "muhammadfirmansyahashari@gmail.com", email_verified: true };
  const adminEnv = {
    AI_ADMIN_EMAILS: "muhammadfirmansyahashari@gmail.com",
    AI_RATE_LIMITER: { limit: async () => ({ success: false }) },
  };
  await enforceCloudChatPerMinute(admin, adminEnv, TestHttpError);

  await enforceCloudChatPerMinute(user, {}, TestHttpError);
});
