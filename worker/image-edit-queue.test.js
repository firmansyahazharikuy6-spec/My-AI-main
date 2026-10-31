import assert from "node:assert/strict";
import test from "node:test";
import { setFetch } from "../test/set-fetch.js";
import { callImageEditProvider, ImageEditQueue } from "./src/index.js";

function createQueue() {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value)),
    delete: async (key) => values.delete(key),
    list: async ({ prefix = "", end, limit = 1000 } = {}) => new Map(
      [...values.entries()]
        .filter(([key]) => key.startsWith(prefix) && (!end || key <= end))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit),
    ),
    transaction: async (callback) => callback(storage),
  };
  const queue = new ImageEditQueue({ storage });
  queue.testValues = values;
  return queue;
}

async function queueRequest(queue, action, body) {
  const response = await queue.fetch(new Request(`https://queue.test/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}

function reservation(userHash, requestHash, sharedLimit = 4, userLimit = 5) {
  return {
    userHash,
    requestHash,
    sourceImage: `data:image/png;base64,${"a".repeat(1200)}`,
    prompt: "Edit the supplied source photo only.",
    sharedLimit,
    userLimit,
    options: { sharedLimit },
  };
}

function editJob() {
  return {
    sourceImage: `data:image/png;base64,${"a".repeat(1200)}`,
    prompt: "Edit this source photo only.",
  };
}

test("a short Retry-After limit is retried and the image edit succeeds", async (t) => {
  let calls = 0;
  setFetch(t, async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json({ error: { message: "rate limit per minute" } }, {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    }
    return Response.json({ data: [{ b64_json: "aGVsbG8=", media_type: "image/png" }] });
  });
  const result = await callImageEditProvider(editJob(), { OPENROUTER_API_KEY: "test-key" });
  assert.equal(calls, 2);
  assert.equal(result.model, "google/gemini-2.5-flash-image");
  assert.equal(result.image, "aGVsbG8=");
});

test("a model-specific daily limit uses the next reference-image model", async (t) => {
  const models = [];
  setFetch(t, async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    if (models.length === 1) {
      return Response.json({ error: { message: "upstream model daily quota exceeded" } }, { status: 429 });
    }
    return Response.json({ data: [{ b64_json: "aGVsbG8=", media_type: "image/png" }] });
  });
  const result = await callImageEditProvider(editJob(), { OPENROUTER_API_KEY: "test-key" });
  assert.deepEqual(models, ["google/gemini-2.5-flash-image", "openai/gpt-image-1"]);
  assert.equal(result.model, "openai/gpt-image-1");
});

test("daily limits on every configured edit model defer the job instead of switching to text-to-image", async (t) => {
  let calls = 0;
  setFetch(t, async () => {
    calls += 1;
    return Response.json({ error: { message: "upstream model daily quota exceeded" } }, { status: 429 });
  });
  const result = await callImageEditProvider(editJob(), { OPENROUTER_API_KEY: "test-key" });
  assert.equal(calls, 2);
  assert.equal(result.queued, true);
  assert.ok(result.retryAt > Date.now());
});

test("account-wide credit failures do not trigger model fallback", async (t) => {
  let calls = 0;
  setFetch(t, async () => {
    calls += 1;
    return Response.json({ error: { message: "insufficient account credits" } }, { status: 402 });
  });
  await assert.rejects(
    callImageEditProvider(editJob(), { OPENROUTER_API_KEY: "test-key" }),
    /Kredit atau kuota akun OpenRouter habis/,
  );
  assert.equal(calls, 1);
});

test("the queue enforces five edit reservations per account per UTC day", async () => {
  const queue = createQueue();
  const userHash = "a".repeat(64);
  for (let index = 0; index < 5; index += 1) {
    const result = await queueRequest(queue, "reserve", reservation(
      userHash, index.toString(16).padStart(64, "0"), 10, 5,
    ));
    assert.equal(result.response.status, 200);
    assert.equal(result.body.isNew, true);
  }
  const limited = await queueRequest(queue, "reserve", reservation(userHash, "f".repeat(64), 10, 5));
  assert.equal(limited.response.status, 429);
  assert.equal(limited.body.limited, true);
});

test("a cache hit returns the prior image without reserving quota again", async () => {
  const queue = createQueue();
  const request = reservation("b".repeat(64), "c".repeat(64));
  const created = await queueRequest(queue, "reserve", request);
  await queueRequest(queue, "complete", {
    jobId: created.body.job.id,
    userHash: request.userHash,
    sharedLimit: 4,
    result: { image: "a".repeat(1200), mimeType: "image/png", provider: "Gemini Image · OpenRouter" },
  });
  const cached = await queueRequest(queue, "reserve", request);
  assert.equal(cached.body.cached, true);
  assert.equal(cached.body.result.image, "a".repeat(1200));
  assert.equal(cached.body.quota.userUsed, 1);
});

test("all shared slots queue new work and the 80-percent alert fires once at its threshold", async () => {
  const queue = createQueue();
  for (let index = 1; index <= 4; index += 1) {
    const userHash = index.toString(16).padStart(64, "0");
    const request = reservation(userHash, (index + 10).toString(16).padStart(64, "0"), 4, 5);
    const created = await queueRequest(queue, "reserve", request);
    const complete = await queueRequest(queue, "complete", {
      jobId: created.body.job.id,
      userHash,
      sharedLimit: 4,
      result: { image: "a".repeat(1200), mimeType: "image/png" },
    });
    assert.equal(complete.body.alert, index === 4);
  }
  const queued = await queueRequest(queue, "reserve", reservation("e".repeat(64), "d".repeat(64), 4, 5));
  assert.equal(queued.body.job.state, "queued");
  assert.ok(queued.body.job.nextAttemptAt > Date.now());
});

test("the queue claims due jobs with the original reference image attached", async () => {
  const queue = createQueue();
  const first = reservation("1".repeat(64), "a".repeat(64), 1, 5);
  const started = await queueRequest(queue, "reserve", first);
  await queueRequest(queue, "complete", {
    jobId: started.body.job.id,
    userHash: first.userHash,
    sharedLimit: 1,
    result: { image: "a".repeat(1200), mimeType: "image/png" },
  });
  const pendingRequest = reservation("2".repeat(64), "b".repeat(64), 1, 5);
  const pending = await queueRequest(queue, "reserve", pendingRequest);
  assert.equal(pending.body.job.state, "queued");

  const queuedJob = pending.body.job;
  const day = new Date().toISOString().slice(0, 10);
  queue.testValues.set(`usage:shared:${day}`, { used: 0, reserved: 0 });
  for (const [key, value] of queue.testValues) {
    if (key.startsWith("queue:") && value === queuedJob.id) queue.testValues.delete(key);
  }
  const dueJob = { ...queuedJob, nextAttemptAt: Date.now() - 1 };
  queue.testValues.set(`job:${dueJob.id}`, dueJob);
  queue.testValues.set(`queue:${String(dueJob.nextAttemptAt).padStart(16, "0")}:${dueJob.id}`, dueJob.id);

  const claimed = await queueRequest(queue, "claim-due", {});
  assert.equal(claimed.body.jobs.length, 1);
  assert.equal(claimed.body.jobs[0].id, queuedJob.id);
  assert.equal(claimed.body.jobs[0].sourceImage, pendingRequest.sourceImage);
  assert.equal(claimed.body.jobs[0].state, "processing");
});

test("expired queued edits are failed and release their reserved account quota", async () => {
  const queue = createQueue();
  const request = reservation("3".repeat(64), "4".repeat(64));
  const created = await queueRequest(queue, "reserve", request);
  queue.testValues.set(`job:${created.body.job.id}`, {
    ...created.body.job,
    expiresAt: Date.now() - 1,
  });
  const status = await queueRequest(queue, "status", {
    jobId: created.body.job.id,
    userHash: request.userHash,
  });
  assert.equal(status.body.state, "failed");
  const quota = await queueRequest(queue, "quota", { userHash: request.userHash, userLimit: 5, sharedLimit: 4 });
  assert.equal(quota.body.userUsed, 0);
  assert.equal(quota.body.sharedRemaining, 4);
});
