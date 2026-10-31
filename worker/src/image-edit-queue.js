const CHUNK_SIZE = 200_000;
const MAX_JOBS_PER_RUN = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function queueIndexKey(job) {
  const dueAt = job.state === "queued"
    ? job.nextAttemptAt
    : job.state === "processing"
    ? (job.processingAt || job.createdAt) + 5 * 60 * 1000
    : Number.MAX_SAFE_INTEGER;
  return `queue:${String(dueAt).padStart(16, "0")}:${job.id}`;
}

function nextUtcDay(timestamp) {
  const date = new Date(timestamp);
  date.setUTCHours(24, 0, 0, 0);
  return date.getTime();
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function splitPayload(value) {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks;
}

export class ImageEditQueue {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async writePayload(prefix, value) {
    const chunks = splitPayload(value);
    for (let index = 0; index < chunks.length; index += 1) {
      await this.ctx.storage.put(`${prefix}:${index}`, chunks[index]);
    }
    return chunks.length;
  }

  async readPayload(prefix, count) {
    const chunks = [];
    for (let index = 0; index < count; index += 1) {
      const chunk = await this.ctx.storage.get(`${prefix}:${index}`);
      if (typeof chunk !== "string") throw new Error("Data antrean gambar tidak lengkap.");
      chunks.push(chunk);
    }
    return chunks.join("");
  }

  async removePayload(prefix, count) {
    for (let index = 0; index < count; index += 1) {
      await this.ctx.storage.delete(`${prefix}:${index}`);
    }
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
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    if (action === "reserve") return this.reserve(body);
    if (action === "complete") return this.complete(body);
    if (action === "defer") return this.defer(body);
    if (action === "fail") return this.fail(body);
    if (action === "status") return this.status(body);
    if (action === "quota") return this.quota(body);
    if (action === "cancel") return this.cancel(body);
    if (action === "claim-due") return this.claimDue(body);
    if (action === "claim-shared") return this.claimShared(body);
    if (action === "cleanup") return this.cleanup();
    return new Response("Not found", { status: 404 });
  }

  async reserve(body) {
    const { userHash, requestHash, sourceImage, prompt, userLimit, sharedLimit, options = {} } = body;
    if (!validHash(userHash) || !validHash(requestHash)
      || typeof sourceImage !== "string" || sourceImage.length < 1 || sourceImage.length > 1_500_000
      || typeof prompt !== "string" || !prompt.trim() || prompt.length > 6000
      || !Number.isInteger(userLimit) || userLimit < 1 || userLimit > 20
      || !Number.isInteger(sharedLimit) || sharedLimit < 1 || sharedLimit > 10_000
      || !options || typeof options !== "object" || Array.isArray(options)) {
      return Response.json({ error: "Invalid image edit reservation" }, { status: 400 });
    }

    const now = Date.now();
    const day = utcDay(now);
    const cacheKey = `cache:${userHash}:${requestHash}`;
    const cached = await this.ctx.storage.get(cacheKey);
    if (cached?.expiresAt > now) {
      try {
        return Response.json({
          cached: true,
          result: { ...cached.result, image: await this.readPayload(cacheKey, cached.chunks) },
          quota: await this.quotaValues(userHash, day, userLimit, sharedLimit),
        });
      } catch (error) {
        console.warn("Image edit cache entry was incomplete; regenerating.", error?.name || "Error");
        await this.removePayload(cacheKey, cached.chunks || 0);
        await this.ctx.storage.delete(cacheKey);
      }
    } else if (cached) {
      await this.removePayload(cacheKey, cached.chunks || 0);
      await this.ctx.storage.delete(cacheKey);
    }

    const requestKey = `request:${userHash}:${requestHash}`;
    const existingId = await this.ctx.storage.get(requestKey);
    if (existingId) {
      const existing = await this.ctx.storage.get(`job:${existingId}`);
      if (existing && existing.expiresAt > now
        && ["processing", "queued", "completed"].includes(existing.state)) {
        if (existing.state === "completed" && existing.cacheKey) {
          const cachedResult = await this.ctx.storage.get(existing.cacheKey);
          if (cachedResult?.expiresAt > now) {
            return Response.json({
              cached: true,
              result: { ...cachedResult.result, image: await this.readPayload(existing.cacheKey, cachedResult.chunks) },
              quota: await this.quotaValues(userHash, day, userLimit, sharedLimit),
            });
          }
        }
        return Response.json({
          cached: existing.state === "completed",
          job: existing,
          isNew: false,
          quota: await this.quotaValues(userHash, day, userLimit, sharedLimit),
        });
      }
      await this.ctx.storage.delete(requestKey);
    }

    const reservation = await this.ctx.storage.transaction(async (txn) => {
      const userKey = `usage:user:${userHash}:${day}`;
      const sharedKey = `usage:shared:${day}`;
      const userUsed = await txn.get(userKey) || 0;
      if (userUsed >= userLimit) return { limited: true, remaining: 0 };
      const shared = await txn.get(sharedKey) || { used: 0, reserved: 0 };
      const canRunNow = shared.used + shared.reserved < sharedLimit;
      await txn.put(userKey, userUsed + 1);
      if (canRunNow) {
        shared.reserved += 1;
        await txn.put(sharedKey, shared);
      }
      return {
        canRunNow,
        userRemaining: userLimit - userUsed - 1,
        sharedRemaining: Math.max(0, sharedLimit - shared.used - shared.reserved),
      };
    });
    if (reservation.limited) {
      return Response.json({
        limited: true,
        remaining: 0,
        resetAt: nextUtcDay(now),
      }, { status: 429 });
    }

    const jobId = crypto.randomUUID();
    const payloadKey = `job-data:${jobId}`;
    const rollbackReservation = async () => {
      await this.ctx.storage.transaction(async (txn) => {
        const userKey = `usage:user:${userHash}:${day}`;
        const userUsed = await txn.get(userKey) || 0;
        await txn.put(userKey, Math.max(0, userUsed - 1));
        if (reservation.canRunNow) {
          const sharedKey = `usage:shared:${day}`;
          const shared = await txn.get(sharedKey) || { used: 0, reserved: 0 };
          shared.reserved = Math.max(0, shared.reserved - 1);
          await txn.put(sharedKey, shared);
        }
      });
    };
    let chunks;
    try {
      chunks = await this.writePayload(payloadKey, sourceImage);
    } catch (error) {
      await this.removePayload(payloadKey, Math.ceil(sourceImage.length / CHUNK_SIZE));
      await rollbackReservation();
      throw error;
    }
    const job = {
      id: jobId,
      owner: userHash,
      requestHash,
      payloadKey,
      chunks,
      prompt: prompt.trim(),
      options,
      state: reservation.canRunNow ? "processing" : "queued",
      createdAt: now,
      processingAt: reservation.canRunNow ? now : null,
      expiresAt: now + CACHE_TTL_MS,
      nextAttemptAt: reservation.canRunNow ? now : nextUtcDay(now),
      sharedReserved: reservation.canRunNow,
      sharedReservationDay: reservation.canRunNow ? day : null,
    };
    try {
      await this.ctx.storage.put(`job:${jobId}`, job);
      await this.ctx.storage.put(requestKey, jobId);
      await this.ctx.storage.put(queueIndexKey(job), jobId);
    } catch (error) {
      await this.ctx.storage.delete(`job:${jobId}`);
      await this.ctx.storage.delete(requestKey);
      await this.ctx.storage.delete(queueIndexKey(job));
      await this.removePayload(payloadKey, chunks);
      await rollbackReservation();
      throw error;
    }
    return Response.json({
      cached: false,
      job,
      isNew: true,
      quota: {
        userRemaining: reservation.userRemaining,
        sharedRemaining: reservation.sharedRemaining,
      },
    });
  }

  async quotaValues(userHash, day, userLimit, sharedLimit) {
    const [userUsed, shared] = await Promise.all([
      this.ctx.storage.get(`usage:user:${userHash}:${day}`),
      this.ctx.storage.get(`usage:shared:${day}`),
    ]);
    return {
      userLimit,
      userUsed: userUsed || 0,
      userRemaining: Math.max(0, userLimit - (userUsed || 0)),
      sharedLimit,
      sharedUsed: shared?.used || 0,
      sharedRemaining: Math.max(0, sharedLimit - (shared?.used || 0) - (shared?.reserved || 0)),
      resetAt: nextUtcDay(Date.now()),
    };
  }

  async quota(body) {
    if (!validHash(body.userHash)
      || !Number.isInteger(body.userLimit) || body.userLimit < 1
      || !Number.isInteger(body.sharedLimit) || body.sharedLimit < 1) {
      return Response.json({ error: "Invalid quota request" }, { status: 400 });
    }
    return Response.json(await this.quotaValues(
      body.userHash, utcDay(Date.now()), body.userLimit, body.sharedLimit,
    ));
  }

  async getOwnedJob(jobId, userHash) {
    if (typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId) || !validHash(userHash)) return null;
    const job = await this.ctx.storage.get(`job:${jobId}`);
    return job?.owner === userHash ? job : null;
  }

  async complete(body) {
    const job = await this.getOwnedJob(body.jobId, body.userHash);
    if (!job || !job.sharedReserved || job.state !== "processing"
      || !body.result || typeof body.result.image !== "string"
      || body.result.image.length > 12_000_000
      || !Number.isInteger(body.sharedLimit) || body.sharedLimit < 1) {
      return Response.json({ error: "Invalid job completion" }, { status: 400 });
    }
    const cacheKey = `cache:${job.owner}:${job.requestHash}`;
    let chunks;
    try {
      chunks = await this.writePayload(cacheKey, body.result.image);
    } catch (error) {
      await this.removePayload(cacheKey, Math.ceil(body.result.image.length / CHUNK_SIZE));
      throw error;
    }
    const { image: _image, ...result } = body.result;
    const now = Date.now();
    const expiresAt = now + CACHE_TTL_MS;
    const day = utcDay(now);
    const sharedKey = `usage:shared:${day}`;
    let usage;
    try {
      usage = await this.ctx.storage.transaction(async (txn) => {
        const reservationKey = `usage:shared:${job.sharedReservationDay || day}`;
        const reservedUsage = await txn.get(reservationKey) || { used: 0, reserved: 0 };
        reservedUsage.reserved = Math.max(0, reservedUsage.reserved - 1);
        await txn.put(reservationKey, reservedUsage);
        const usageDay = reservationKey === sharedKey ? reservedUsage : await txn.get(sharedKey) || { used: 0, reserved: 0 };
        usageDay.used += 1;
        await txn.put(sharedKey, usageDay);
        const alertKey = `alert:shared:${day}`;
        const threshold = Math.ceil(Number(body.sharedLimit) * 0.8);
        const sent = await txn.get(alertKey);
        const alert = !sent && threshold > 0 && usageDay.used >= threshold;
        if (alert) await txn.put(alertKey, true);
        await txn.put(cacheKey, { result, chunks, expiresAt });
        await txn.put(`job:${job.id}`, {
          ...job,
          state: "completed",
          processingAt: null,
          sharedReserved: false,
          sharedReservationDay: null,
          completedAt: now,
          expiresAt,
          cacheKey,
        });
        await txn.put(`request:${job.owner}:${job.requestHash}`, job.id);
        return { alert, used: usageDay.used, limit: body.sharedLimit };
      });
    } catch (error) {
      await this.removePayload(cacheKey, chunks);
      throw error;
    }
    await this.ctx.storage.delete(queueIndexKey(job));
    await this.removePayload(job.payloadKey, job.chunks);
    return Response.json({ ok: true, ...usage });
  }

  async defer(body) {
    const job = await this.getOwnedJob(body.jobId, body.userHash);
    if (!job || job.state !== "processing") return Response.json({ error: "Job not found" }, { status: 404 });
    const now = Date.now();
    const retryAt = Number.isFinite(body.retryAt) ? Math.max(now + 1000, body.retryAt) : nextUtcDay(now);
    if (retryAt >= job.expiresAt) {
      return this.fail({ jobId: job.id, userHash: job.owner, message: "Permintaan kedaluwarsa setelah 24 jam menunggu." });
    }
    if (job.state === "failed" || job.state === "cancelled") return Response.json({ ok: true });
    if (job.sharedReserved) {
      const sharedKey = `usage:shared:${job.sharedReservationDay || utcDay(now)}`;
      await this.ctx.storage.transaction(async (txn) => {
        const shared = await txn.get(sharedKey) || { used: 0, reserved: 0 };
        shared.reserved = Math.max(0, shared.reserved - 1);
        await txn.put(sharedKey, shared);
      });
    }
    await this.ctx.storage.delete(queueIndexKey(job));
    await this.ctx.storage.put(`job:${job.id}`, {
      ...job,
      state: "queued",
      processingAt: null,
      sharedReserved: false,
      sharedReservationDay: null,
      nextAttemptAt: retryAt,
      lastNotice: String(body.message || "").slice(0, 300),
    });
    return Response.json({ ok: true, retryAt });
  }

  async fail(body) {
    const job = await this.getOwnedJob(body.jobId, body.userHash);
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    if (["completed", "failed", "cancelled"].includes(job.state)) return Response.json({ ok: true, alreadyTerminal: true });
    if (job.sharedReserved) {
      const day = job.sharedReservationDay || utcDay(Date.now());
      await this.ctx.storage.transaction(async (txn) => {
        const shared = await txn.get(`usage:shared:${day}`) || { used: 0, reserved: 0 };
        shared.reserved = Math.max(0, shared.reserved - 1);
        await txn.put(`usage:shared:${day}`, shared);
      });
    }
    await this.ctx.storage.delete(queueIndexKey(job));
    const userKey = `usage:user:${job.owner}:${utcDay(job.createdAt)}`;
    const userUsed = await this.ctx.storage.get(userKey) || 0;
    await this.ctx.storage.put(userKey, Math.max(0, userUsed - 1));
    await this.removePayload(job.payloadKey, job.chunks);
    await this.ctx.storage.put(`job:${job.id}`, {
      ...job,
      state: "failed",
      processingAt: null,
      sharedReserved: false,
      sharedReservationDay: null,
      error: String(body.message || "Edit foto gagal diproses.").slice(0, 300),
      completedAt: Date.now(),
    });
    await this.ctx.storage.delete(`request:${job.owner}:${job.requestHash}`);
    return Response.json({ ok: true });
  }

  async status(body) {
    const job = await this.getOwnedJob(body.jobId, body.userHash);
    if (!job) return Response.json({ error: "Job tidak ditemukan." }, { status: 404 });
    if (job.expiresAt <= Date.now() && job.state !== "completed" && job.state !== "failed") {
      await this.fail({ jobId: job.id, userHash: job.owner, message: "Permintaan kedaluwarsa setelah 24 jam menunggu." });
      return Response.json({ state: "failed", error: "Permintaan kedaluwarsa setelah 24 jam menunggu." });
    }
    if (job.state === "completed" && job.cacheKey) {
      const cached = await this.ctx.storage.get(job.cacheKey);
      if (!cached || cached.expiresAt <= Date.now()) {
        return Response.json({ state: "failed", error: "Hasil edit sudah kedaluwarsa." });
      }
      return Response.json({
        state: "completed",
        result: { ...cached.result, image: await this.readPayload(job.cacheKey, cached.chunks) },
      });
    }
    return Response.json({
      state: job.state,
      nextAttemptAt: job.nextAttemptAt,
      error: job.error || "",
      notice: job.lastNotice || "",
    });
  }

  async cancel(body) {
    const job = await this.getOwnedJob(body.jobId, body.userHash);
    if (!job) return Response.json({ error: "Job tidak ditemukan." }, { status: 404 });
    if (job.state === "completed" || job.state === "failed") return Response.json({ cancelled: false });
    if (job.state === "processing") return Response.json({ cancelled: false, reason: "processing" });
    await this.fail({ jobId: job.id, userHash: job.owner, message: "Permintaan dibatalkan." });
    await this.ctx.storage.put(`job:${job.id}`, { ...(await this.ctx.storage.get(`job:${job.id}`)), state: "cancelled" });
    return Response.json({ cancelled: true });
  }

  async claimShared(body) {
    const job = await this.getOwnedJob(body.jobId, body.userHash);
    if (!job || job.state !== "queued" || job.nextAttemptAt > Date.now()) {
      return Response.json({ claimed: false });
    }
    const now = Date.now();
    const day = utcDay(now);
    const sharedKey = `usage:shared:${day}`;
    const claimed = await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.get(`job:${job.id}`);
      if (!current || current.state !== "queued" || current.nextAttemptAt > now) return false;
      const shared = await txn.get(sharedKey) || { used: 0, reserved: 0 };
      if (shared.used + shared.reserved >= body.sharedLimit) return false;
      shared.reserved += 1;
      await txn.put(sharedKey, shared);
      await txn.delete(queueIndexKey(current));
      const next = {
        ...current,
        state: "processing",
        sharedReserved: true,
        sharedReservationDay: day,
        processingAt: now,
      };
      await txn.put(`job:${job.id}`, next);
      await txn.put(queueIndexKey(next), next.id);
      return true;
    });
    return Response.json({ claimed });
  }

  async claimDue(body) {
    const now = Date.now();
    const dueEnd = `queue:${String(now).padStart(16, "0")}:\uffff`;
    const entries = await this.ctx.storage.list({ prefix: "queue:", end: dueEnd, limit: 1000 });
    const due = [...entries.entries()].slice(0, MAX_JOBS_PER_RUN);
    const jobs = [];
    for (const [indexKey, candidateId] of due) {
      const claimed = await this.ctx.storage.transaction(async (txn) => {
        const job = await txn.get(`job:${candidateId}`);
        const reclaim = job?.state === "processing" && (job.processingAt || 0) <= now - 5 * 60 * 1000;
        if (!job || (!reclaim && (job.state !== "queued" || job.nextAttemptAt > now))) {
          await txn.delete(indexKey);
          return null;
        }
        await txn.delete(queueIndexKey(job));
        if (job.expiresAt <= now) {
          return { expired: job };
        }
        const sharedKey = `usage:shared:${utcDay(now)}`;
        if (!reclaim) {
          const shared = await txn.get(sharedKey) || { used: 0, reserved: 0 };
          const limit = Number(body.sharedLimit) || Number(job.options?.sharedLimit) || 0;
          if (limit < 1 || shared.used + shared.reserved >= limit) {
            const deferred = { ...job, nextAttemptAt: nextUtcDay(now) };
            await txn.put(`job:${job.id}`, deferred);
            await txn.put(queueIndexKey(deferred), deferred.id);
            return null;
          }
          shared.reserved += 1;
          await txn.put(sharedKey, shared);
        }
        const next = {
          ...job,
          state: "processing",
          sharedReserved: true,
          sharedReservationDay: reclaim ? job.sharedReservationDay : utcDay(now),
          processingAt: now,
        };
        await txn.put(`job:${job.id}`, next);
        await txn.put(queueIndexKey(next), next.id);
        return { job: next };
      });
      if (!claimed) continue;
      if (claimed.expired) {
        await this.fail({ jobId: claimed.expired.id, userHash: claimed.expired.owner, message: "Permintaan kedaluwarsa setelah 24 jam menunggu." });
        continue;
      }
      const job = claimed.job;
      jobs.push({ ...job, sourceImage: await this.readPayload(job.payloadKey, job.chunks) });
    }
    return Response.json({ jobs });
  }

  async cleanup() {
    const now = Date.now();
    const jobs = await this.ctx.storage.list({ prefix: "job:", limit: 1000 });
    for (const job of jobs.values()) {
      if (!job || job.expiresAt > now) continue;
      if (!["completed", "failed", "cancelled"].includes(job.state)) {
        await this.fail({ jobId: job.id, userHash: job.owner, message: "Permintaan kedaluwarsa setelah 24 jam menunggu." });
      }
      await this.removePayload(job.payloadKey, job.chunks || 0);
      await this.ctx.storage.delete(`job:${job.id}`);
      await this.ctx.storage.delete(`request:${job.owner}:${job.requestHash}`);
      await this.ctx.storage.delete(queueIndexKey(job));
    }

    const caches = await this.ctx.storage.list({ prefix: "cache:", limit: 1000 });
    for (const [key, entry] of caches) {
      if (entry?.expiresAt > now) continue;
      await this.removePayload(key, entry?.chunks || 0);
      await this.ctx.storage.delete(key);
    }

    const retentionCutoff = utcDay(now - 2 * CACHE_TTL_MS);
    const usage = await this.ctx.storage.list({ prefix: "usage:", limit: 1000 });
    for (const key of usage.keys()) {
      const day = key.slice(key.lastIndexOf(":") + 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < retentionCutoff) await this.ctx.storage.delete(key);
    }
    const alerts = await this.ctx.storage.list({ prefix: "alert:", limit: 1000 });
    for (const key of alerts.keys()) {
      const day = key.slice("alert:shared:".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < retentionCutoff) await this.ctx.storage.delete(key);
    }
    return Response.json({ ok: true });
  }
}
