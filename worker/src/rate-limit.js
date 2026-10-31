export const GUEST_TRIAL_LIMIT = 2;
export const EMAIL_DAILY_LIMIT = 20;
export const EMAIL_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
export const CLOUD_CHAT_DAILY_LIMIT = 3;
export const LOCAL_AI_DAILY_LIMIT = 5;
export const LOCAL_RESERVE_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
export const CLOUD_RESERVE_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
export const MAX_ACCOUNT_DEVICES = 5;
export const IP_CLOUD_CHAT_DAILY_SIGNAL = 200;
export const DEVICE_IDLE_PRUNE_MS = 90 * 24 * 60 * 60 * 1000;

export const AI_ROUTE_LIMITS = Object.freeze({
  "image-chat": Object.freeze({ perMinute: 5, perDay: 10, label: "pembuatan gambar melalui chat" }),
  "image-generate": Object.freeze({ perMinute: 5, perDay: 10, label: "pembuatan gambar" }),
  transcribe: Object.freeze({ perMinute: 5, perDay: 30, label: "transkripsi audio" }),
  "monid-discover": Object.freeze({ perMinute: 5, perDay: 20, label: "pencarian endpoint Monid" }),
  "monid-inspect": Object.freeze({ perMinute: 5, perDay: 30, label: "pemeriksaan endpoint Monid" }),
  "monid-run": Object.freeze({ perMinute: 5, perDay: 10, label: "run endpoint Monid" }),
  "monid-get": Object.freeze({ perMinute: 5, perDay: 120, label: "pemeriksaan status run Monid" }),
  "live-token": Object.freeze({ perMinute: 5, perDay: 10, label: "token Live AI" }),
  "enhance-prompt": Object.freeze({ perMinute: 5, perDay: 60, label: "optimasi prompt" }),
  "canva-oauth": Object.freeze({ perMinute: 5, perDay: 10, label: "koneksi Canva" }),
  "canva-presentation": Object.freeze({ perMinute: 5, perDay: 10, label: "pembuatan presentasi" }),
  explorium: Object.freeze({ perMinute: 5, perDay: 10, label: "pencarian Explorium" }),
  "provider-health": Object.freeze({ perMinute: 5, perDay: 30, label: "tes kesehatan provider" }),
  "provider-test": Object.freeze({ perMinute: 5, perDay: 30, label: "tes koneksi provider" }),
  "email-preview": Object.freeze({ perMinute: 5, perDay: 20, label: "pratinjau email" }),
  email: Object.freeze({ perMinute: 5, perDay: 20, label: "pengiriman email" }),
});

export function isMaintenanceAdmin(user, env) {
  if (user?.email_verified !== true || typeof user.email !== "string") return false;
  const email = user.email.trim().toLowerCase();
  if (!email) return false;
  return String(env?.AI_ADMIN_EMAILS || "")
    .split(",")
    .some((allowed) => allowed.trim().toLowerCase() === email);
}

export function localAiDailyLimit(user, env) {
  const configured = Number(env?.LOCAL_AI_DAILY_LIMIT);
  if (Number.isSafeInteger(configured) && configured >= 0) return configured;
  return LOCAL_AI_DAILY_LIMIT;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function accountQuotaStub(env, user) {
  const identity = typeof user?.sub === "string" ? user.sub : "";
  if (!identity) throw new Error("Akun tidak memiliki identitas pengguna.");
  return env.AI_DAILY_RATE_LIMIT_STORE.get(env.AI_DAILY_RATE_LIMIT_STORE.idFromName(await sha256Hex(identity)));
}

async function accountQuotaRequest(stub, action, body) {
  const response = await stub.fetch(`https://ai-daily-rate-limit.internal/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Kuota akun gagal diproses (${action}): HTTP ${response.status}`);
  return response.json();
}

export async function getAccountQuotaStatus(user, env) {
  const admin = isMaintenanceAdmin(user, env);
  if (admin) {
    return {
      admin: true,
      plan: "admin",
      chat: { used: 0, limit: null, remaining: null },
      local: { used: 0, limit: null, remaining: null },
      devices: { count: 1, limit: null },
      adminEmails: String(env?.AI_ADMIN_EMAILS || "").split(",").map((value) => value.trim()).filter(Boolean),
    };
  }
  if (!env.AI_DAILY_RATE_LIMIT_STORE) {
    throw new Error("Penyimpanan kuota belum dikonfigurasi di Cloudflare Worker.");
  }
  const stub = await accountQuotaStub(env, user);
  const status = await accountQuotaRequest(stub, "quota/status", {
    cloudLimit: CLOUD_CHAT_DAILY_LIMIT,
    localLimit: localAiDailyLimit(user, env),
  });
  return {
    admin: false,
    plan: "free",
    chat: { used: status.chatUsed, limit: CLOUD_CHAT_DAILY_LIMIT, remaining: status.chatRemaining },
    local: { used: status.localUsed, limit: localAiDailyLimit(user, env), remaining: status.localRemaining },
    devices: { count: status.deviceCount, limit: MAX_ACCOUNT_DEVICES },
  };
}

export async function enforceCloudChatPerMinute(user, env, HttpError) {
  if (isMaintenanceAdmin(user, env) || !env.AI_RATE_LIMITER) return;
  const identity = typeof user?.sub === "string" ? user.sub : "";
  if (!identity) return;
  const { success } = await env.AI_RATE_LIMITER.limit({ key: `chat:${identity}` });
  if (!success) {
    throw new HttpError(429, "Terlalu banyak permintaan chat. Tunggu sebentar lalu coba lagi.");
  }
}

export async function enforceCloudChatQuota(user, env, request, HttpError, idempotencyKey = "") {
  if (isMaintenanceAdmin(user, env)) {
    return { admin: true, remaining: null, limit: null, idempotencyKey: "" };
  }
  if (!env.AI_DAILY_RATE_LIMIT_STORE) {
    throw new HttpError(503, "Penyimpanan kuota chat cloud belum dikonfigurasi di Cloudflare Worker.");
  }
  const key = /^[A-Za-z0-9-]{8,64}$/.test(String(idempotencyKey || "")) ? idempotencyKey : "";
  const stub = await accountQuotaStub(env, user);
  const rawDeviceId = request.headers.get("x-device-id") || "";
  const deviceHash = await sha256Hex(/^[A-Za-z0-9-]{8,64}$/.test(rawDeviceId) ? rawDeviceId : `legacy:${user.sub}`);
  let deviceResult;
  try {
    deviceResult = await accountQuotaRequest(stub, "device/register", {
      deviceHash,
      maxDevices: MAX_ACCOUNT_DEVICES,
      idlePruneMs: DEVICE_IDLE_PRUNE_MS,
    });
  } catch {
    throw new HttpError(503, "Batas perangkat tidak dapat diperiksa. Coba lagi nanti.");
  }
  if (deviceResult.allowed !== true) {
    const error = new HttpError(403,
      `Batas perangkat akun tercapai (${MAX_ACCOUNT_DEVICES} perangkat). Gunakan perangkat yang sudah terdaftar atau hubungi admin MyAI.`);
    error.code = "DEVICE_LIMIT_EXCEEDED";
    throw error;
  }
  const ip = request.headers.get("cf-connecting-ip");
  if (ip && env.AI_DAILY_RATE_LIMIT_STORE) {
    const ipStub = env.AI_DAILY_RATE_LIMIT_STORE.get(
      env.AI_DAILY_RATE_LIMIT_STORE.idFromName(await sha256Hex(`ip:${ip}`)),
    );
    let ipResult;
    try {
      ipResult = await accountQuotaRequest(ipStub, "ip-signal/reserve", { limit: IP_CLOUD_CHAT_DAILY_SIGNAL });
    } catch {
      throw new HttpError(503, "Sinyal jaringan tidak dapat diperiksa. Coba lagi nanti.");
    }
    if (ipResult.allowed !== true) {
      const error = new HttpError(429,
        "Terlalu banyak aktivitas chat dari jaringan ini hari ini. Tunggu hingga besok atau gunakan AI lokal.");
      error.code = "IP_ABUSE_SIGNAL";
      throw error;
    }
  }
  let reserve;
  try {
    reserve = await accountQuotaRequest(stub, "cloud-chat/reserve", {
      limit: CLOUD_CHAT_DAILY_LIMIT,
      idempotencyKey: key,
    });
  } catch {
    throw new HttpError(503, "Kuota chat cloud tidak dapat diperiksa. Coba lagi nanti.");
  }
  if (reserve.allowed !== true) {
    const error = new HttpError(429,
      `Batas chat cloud harian tercapai (${CLOUD_CHAT_DAILY_LIMIT}/hari untuk paket Free). Upgrade paket atau lanjutkan dengan AI lokal (5/hari untuk paket Free).`);
    error.code = "CLOUD_QUOTA_EXCEEDED";
    throw error;
  }
  return { admin: false, remaining: reserve.remaining, limit: CLOUD_CHAT_DAILY_LIMIT, idempotencyKey: key };
}

export async function releaseCloudChatReservation(user, env, idempotencyKey = "") {
  const key = /^[A-Za-z0-9-]{8,64}$/.test(String(idempotencyKey || "")) ? idempotencyKey : "";
  if (!key || isMaintenanceAdmin(user, env) || !env.AI_DAILY_RATE_LIMIT_STORE) {
    return { released: false };
  }
  try {
    const stub = await accountQuotaStub(env, user);
    return await accountQuotaRequest(stub, "cloud-chat/release", { idempotencyKey: key });
  } catch {
    return { released: false };
  }
}

export async function reserveLocalChatQuota(user, env, HttpError, idempotencyKey = "") {
  if (isMaintenanceAdmin(user, env)) {
    return { admin: true, allowed: true, remaining: null, limit: null };
  }
  if (!env.AI_DAILY_RATE_LIMIT_STORE) {
    throw new HttpError(503, "Penyimpanan kuota AI lokal belum dikonfigurasi di Cloudflare Worker.");
  }
  const stub = await accountQuotaStub(env, user);
  const limit = localAiDailyLimit(user, env);
  let result;
  try {
    result = await accountQuotaRequest(stub, "local-chat/reserve", {
      limit,
      idempotencyKey: /^[A-Za-z0-9-]{8,64}$/.test(String(idempotencyKey || "")) ? idempotencyKey : "",
    });
  } catch {
    throw new HttpError(503, "Kuota AI lokal tidak dapat diperiksa. Coba lagi nanti.");
  }
  if (result.allowed !== true) {
    const error = new HttpError(429,
      `Batas AI lokal harian tercapai (${limit}/hari untuk paket Free). Upgrade paket atau coba lagi besok.`);
    error.code = "LOCAL_QUOTA_EXCEEDED";
    throw error;
  }
  return { admin: false, allowed: true, remaining: result.remaining, limit };
}

export function outputTokenLimitForUser() {
  return Number.MAX_SAFE_INTEGER;
}

export function dailyLimitForUser(user, env, route) {
  const limits = AI_ROUTE_LIMITS[route];
  if (!limits) return null;
  return limits.perDay;
}

export async function enforceGuestRateLimit(request, env, deviceId, HttpError) {
  if (!env.AI_RATE_LIMITER) {
    throw new HttpError(503, "AI guest belum diaktifkan. Admin perlu deploy binding rate limit Worker.");
  }
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) throw new HttpError(503, "AI guest tidak tersedia pada jaringan ini.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId));
  const deviceKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  for (const key of [`guest-ip:${ip}`, `guest-device:${deviceKey}`]) {
    const { success } = await env.AI_RATE_LIMITER.limit({ key });
    if (!success) throw new HttpError(429, "Batas AI guest tercapai. Coba lagi setelah satu menit.");
  }
}

export async function enforceAIRateLimit(user, env, route, HttpError) {
  const identity = typeof user?.sub === "string" ? user.sub : "";
  if (!identity) throw new HttpError(401, "Masuk dengan akun untuk menggunakan layanan AI.");
  if (route === "chat") return;
  const limits = AI_ROUTE_LIMITS[route];
  if (!limits) throw new HttpError(500, "Konfigurasi batas AI untuk route ini tidak tersedia.");
  const dailyLimit = dailyLimitForUser(user, env, route);
  if (!env.AI_RATE_LIMITER) {
    throw new HttpError(503, "Rate limit AI belum dikonfigurasi di Cloudflare Worker.");
  }
  const { success } = await env.AI_RATE_LIMITER.limit({ key: `${route}:${identity}` });
  if (!success) throw new HttpError(429, `Batas ${limits.label} per menit tercapai. Coba lagi setelah satu menit.`);
  if (!env.AI_DAILY_RATE_LIMIT_STORE) {
    throw new HttpError(503, "Penyimpanan batas harian AI belum dikonfigurasi di Cloudflare Worker.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const name = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = env.AI_DAILY_RATE_LIMIT_STORE.idFromName(name);
  const stub = env.AI_DAILY_RATE_LIMIT_STORE.get(id);
  let response;
  try {
    response = await stub.fetch("https://ai-daily-rate-limit.internal/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route, limit: dailyLimit }),
    });
  } catch {
    throw new HttpError(503, "Batas harian AI tidak dapat diperiksa. Coba lagi nanti.");
  }
  if (!response.ok) throw new HttpError(503, "Batas harian AI tidak dapat diperiksa. Coba lagi nanti.");
  let result;
  try {
    result = await response.json();
  } catch {
    throw new HttpError(503, "Respons batas harian AI tidak valid. Coba lagi nanti.");
  }
  if (result.allowed !== true) {
    throw new HttpError(429, `Batas harian ${limits.label} tercapai. Coba lagi besok.`);
  }
}

export async function guestTrialCounter(request, env, action, deviceId, HttpError) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !env.GUEST_TRIAL_COUNTER) {
    throw new HttpError(503, "Batas uji coba guest belum dikonfigurasi di Cloudflare Worker.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}:${deviceId}`));
  const name = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = env.GUEST_TRIAL_COUNTER.idFromName(name);
  const stub = env.GUEST_TRIAL_COUNTER.get(id);
  const response = await stub.fetch(`https://guest-trial.internal/${action}`, { method: "POST" });
  if (!response.ok) throw new HttpError(503, "Batas uji coba guest tidak dapat diperiksa. Coba lagi nanti.");
  return response.json();
}

export class GuestTrialCounter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    if (action === "status") {
      const used = (await this.ctx.storage.get("used")) || 0;
      return Response.json({ remaining: Math.max(0, GUEST_TRIAL_LIMIT - used) });
    }
    if (action === "reserve") {
      const result = await this.ctx.storage.transaction(async (txn) => {
        const used = await txn.get("used") || 0;
        if (used >= GUEST_TRIAL_LIMIT) return { reserved: false, remaining: 0 };
        const next = used + 1;
        await txn.put("used", next);
        return { reserved: true, remaining: GUEST_TRIAL_LIMIT - next };
      });
      return Response.json(result);
    }
    if (action === "refund") {
      const result = await this.ctx.storage.transaction(async (txn) => {
        const used = await txn.get("used") || 0;
        const next = Math.max(0, used - 1);
        await txn.put("used", next);
        return { remaining: GUEST_TRIAL_LIMIT - next };
      });
      return Response.json(result);
    }
    return new Response("Not found", { status: 404 });
  }
}

export class AIRateLimitStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const pathname = new URL(request.url).pathname;
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (pathname === "/reserve") {
      const limits = AI_ROUTE_LIMITS[body?.route];
      if (!limits || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > limits.perDay) {
        return Response.json({ error: "Invalid route or limit" }, { status: 400 });
      }
      const day = new Date().toISOString().slice(0, 10);
      const storageKey = `daily:${body.route}:${day}`;
      const result = await this.ctx.storage.transaction(async (txn) => {
        const used = await txn.get(storageKey) || 0;
        if (used >= body.limit) return { allowed: false, remaining: 0 };
        const next = used + 1;
        await txn.put(storageKey, next);
        return { allowed: true, remaining: body.limit - next };
      });
      return Response.json(result);
    }
    if (pathname === "/device/register") {
      if (!/^[a-f0-9]{64}$/.test(body?.deviceHash || "")
        || !Number.isSafeInteger(body.maxDevices) || body.maxDevices < 1 || body.maxDevices > 20) {
        return Response.json({ error: "Invalid device registration" }, { status: 400 });
      }
      const now = Date.now();
      const result = await this.ctx.storage.transaction(async (txn) => {
        const prefix = "device:";
        const devices = await txn.list({ prefix });
        const active = new Map();
        for (const [key, record] of devices) {
          if (record && typeof record.lastSeen === "number"
            && now - record.lastSeen < (body.idlePruneMs || DEVICE_IDLE_PRUNE_MS)) {
            active.set(key.slice(prefix.length), record);
          } else {
            await txn.delete(key);
          }
        }
        const existing = active.has(body.deviceHash);
        if (!existing && active.size >= body.maxDevices) {
          return { allowed: false, deviceCount: active.size, deviceLimit: body.maxDevices };
        }
        await txn.put(`${prefix}${body.deviceHash}`, { lastSeen: now });
        return {
          allowed: true,
          registered: !existing,
          deviceCount: active.size + (existing ? 0 : 1),
          deviceLimit: body.maxDevices,
        };
      });
      return Response.json(result);
    }
    if (pathname === "/cloud-chat/reserve") {
      if (!Number.isSafeInteger(body?.limit) || body.limit < 1) {
        return Response.json({ error: "Invalid chat limit" }, { status: 400 });
      }
      const idempotencyKey = /^[A-Za-z0-9-]{8,64}$/.test(body?.idempotencyKey || "") ? body.idempotencyKey : "";
      const day = new Date().toISOString().slice(0, 10);
      const storageKey = `daily:cloud-chat:${day}`;
      const now = Date.now();
      const result = await this.ctx.storage.transaction(async (txn) => {
        if (idempotencyKey) {
          const replay = await txn.get(`idempotency:cloud:${idempotencyKey}`);
          if (replay && typeof replay.expiresAt === "number" && replay.expiresAt > now && replay.result) {
            return replay.result;
          }
          const stale = await txn.list({ prefix: "idempotency:cloud:" });
          for (const [key, record] of stale) {
            if (record && typeof record.expiresAt === "number" && record.expiresAt <= now) await txn.delete(key);
          }
        }
        const used = await txn.get(storageKey) || 0;
        const outcome = used >= body.limit
          ? { allowed: false, remaining: 0 }
          : { allowed: true, remaining: body.limit - used - 1 };
        if (outcome.allowed) await txn.put(storageKey, used + 1);
        if (idempotencyKey) {
          await txn.put(`idempotency:cloud:${idempotencyKey}`, {
            expiresAt: now + CLOUD_RESERVE_IDEMPOTENCY_TTL_MS,
            result: outcome,
          });
        }
        return outcome;
      });
      return Response.json(result);
    }
    if (pathname === "/cloud-chat/release") {
      const idempotencyKey = /^[A-Za-z0-9-]{8,64}$/.test(body?.idempotencyKey || "") ? body.idempotencyKey : "";
      if (!idempotencyKey) {
        return Response.json({ error: "Invalid idempotency key" }, { status: 400 });
      }
      const day = new Date().toISOString().slice(0, 10);
      const storageKey = `daily:cloud-chat:${day}`;
      const recordKey = `idempotency:cloud:${idempotencyKey}`;
      const result = await this.ctx.storage.transaction(async (txn) => {
        const record = await txn.get(recordKey);
        if (!record || record.result?.allowed !== true) return { released: false };
        const used = await txn.get(storageKey) || 0;
        const next = Math.max(0, used - 1);
        if (next !== used) await txn.put(storageKey, next);
        await txn.delete(recordKey);
        const remaining = Number.isSafeInteger(body?.limit) && body.limit >= 1
          ? Math.max(0, body.limit - next)
          : undefined;
        return { released: true, ...(remaining !== undefined ? { remaining } : {}) };
      });
      return Response.json(result);
    }
    if (pathname === "/local-chat/reserve") {
      if (!Number.isSafeInteger(body?.limit) || body.limit < 1 || body.limit > 1000) {
        return Response.json({ error: "Invalid local chat limit" }, { status: 400 });
      }
      const idempotencyKey = /^[A-Za-z0-9-]{8,64}$/.test(body?.idempotencyKey || "") ? body.idempotencyKey : "";
      const day = new Date().toISOString().slice(0, 10);
      const storageKey = `daily:local-chat:${day}`;
      const now = Date.now();
      const result = await this.ctx.storage.transaction(async (txn) => {
        if (idempotencyKey) {
          const replay = await txn.get(`idempotency:local:${idempotencyKey}`);
          if (replay && typeof replay.expiresAt === "number" && replay.expiresAt > now && replay.result) {
            return replay.result;
          }
          const stale = await txn.list({ prefix: "idempotency:local:" });
          for (const [key, record] of stale) {
            if (record && typeof record.expiresAt === "number" && record.expiresAt <= now) await txn.delete(key);
          }
        }
        const used = await txn.get(storageKey) || 0;
        const outcome = used >= body.limit
          ? { allowed: false, remaining: 0 }
          : { allowed: true, remaining: body.limit - used - 1 };
        if (outcome.allowed) await txn.put(storageKey, used + 1);
        if (idempotencyKey) {
          await txn.put(`idempotency:local:${idempotencyKey}`, {
            expiresAt: now + LOCAL_RESERVE_IDEMPOTENCY_TTL_MS,
            result: outcome,
          });
        }
        return outcome;
      });
      return Response.json(result);
    }
    if (pathname === "/ip-signal/reserve") {
      if (!Number.isSafeInteger(body?.limit) || body.limit < 1) {
        return Response.json({ error: "Invalid ip signal limit" }, { status: 400 });
      }
      const day = new Date().toISOString().slice(0, 10);
      const storageKey = `daily:ip-cloud-chat:${day}`;
      const result = await this.ctx.storage.transaction(async (txn) => {
        const used = await txn.get(storageKey) || 0;
        if (used >= body.limit) return { allowed: false, remaining: 0 };
        const next = used + 1;
        await txn.put(storageKey, next);
        return { allowed: true, remaining: body.limit - next };
      });
      return Response.json(result);
    }
    if (pathname === "/quota/status") {
      const day = new Date().toISOString().slice(0, 10);
      const idlePruneMs = Number.isSafeInteger(body?.idlePruneMs) && body.idlePruneMs >= 0
        ? body.idlePruneMs
        : DEVICE_IDLE_PRUNE_MS;
      const cloudLimit = Number.isSafeInteger(body?.cloudLimit) && body.cloudLimit >= 1
        ? body.cloudLimit
        : CLOUD_CHAT_DAILY_LIMIT;
      const localLimit = Number.isSafeInteger(body?.localLimit) && body.localLimit >= 1
        ? body.localLimit
        : LOCAL_AI_DAILY_LIMIT;
      const now = Date.now();
      const [chatUsed, localUsed, devices] = await Promise.all([
        this.ctx.storage.get(`daily:cloud-chat:${day}`),
        this.ctx.storage.get(`daily:local-chat:${day}`),
        this.ctx.storage.list({ prefix: "device:" }),
      ]);
      const activeDevices = [...devices.values()].filter((record) => record
        && typeof record.lastSeen === "number"
        && now - record.lastSeen < idlePruneMs).length;
      return Response.json({
        chatUsed: chatUsed || 0,
        chatRemaining: Math.max(0, cloudLimit - (chatUsed || 0)),
        localUsed: localUsed || 0,
        localRemaining: Math.max(0, localLimit - (localUsed || 0)),
        deviceCount: activeDevices,
      });
    }
    return new Response("Not found", { status: 404 });
  }
}

export class EmailActionStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const action = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (!/^[a-f0-9]{64}$/.test(body.tokenHash || "") || !/^[a-f0-9]{64}$/.test(body.payloadHash || "")) {
      return Response.json({ error: "Invalid email confirmation data" }, { status: 400 });
    }
    if (action === "preview") {
      await this.ctx.storage.transaction(async (txn) => {
        await txn.put("email-preview", {
          tokenHash: body.tokenHash,
          payloadHash: body.payloadHash,
          expiresAt: Date.now() + EMAIL_CONFIRMATION_TTL_MS,
        });
      });
      return Response.json({ created: true });
    }
    if (action === "reserve-send") {
      const result = await this.ctx.storage.transaction(async (txn) => {
        const preview = await txn.get("email-preview");
        if (!preview
          || preview.expiresAt <= Date.now()
          || preview.tokenHash !== body.tokenHash
          || preview.payloadHash !== body.payloadHash) {
          return { confirmed: false, reserved: false };
        }
        const today = new Date().toISOString().slice(0, 10);
        const daily = await txn.get("email-daily-count");
        const count = daily?.day === today ? daily.count : 0;
        if (count >= EMAIL_DAILY_LIMIT) return { confirmed: true, reserved: false };
        await txn.delete("email-preview");
        await txn.put("email-daily-count", { day: today, count: count + 1 });
        return { confirmed: true, reserved: true, remaining: EMAIL_DAILY_LIMIT - count - 1 };
      });
      return Response.json(result);
    }
    return new Response("Not found", { status: 404 });
  }
}
