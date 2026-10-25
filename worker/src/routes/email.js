import { EMAIL_CONFIRMATION_TTL_MS } from "../rate-limit.js";

function isEmailAddress(value) {
  return typeof value === "string"
    && value.length <= 254
    && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function emailRecipientAllowedDomains(env) {
  return String(env.EMAIL_RECIPIENT_ALLOWED_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain));
}

function validateEmailRecipient(to, env, HttpError) {
  const allowedDomains = emailRecipientAllowedDomains(env);
  if (!allowedDomains.length) {
    throw new HttpError(503, "Allowlist penerima email belum dikonfigurasi pada Worker.");
  }
  const domain = to.slice(to.lastIndexOf("@") + 1).toLowerCase();
  if (!allowedDomains.includes(domain)) {
    throw new HttpError(403, "Domain penerima email tidak diizinkan.");
  }
}

function validateEmailDraft(body, HttpError) {
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body_markdown === "string" ? body.body_markdown.trim() : "";
  if (!isEmailAddress(to)) throw new HttpError(400, "Alamat penerima email tidak valid.");
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
    throw new HttpError(400, "Subjek email wajib diisi dan maksimal 200 karakter.");
  }
  if (!text || text.length > 30_000) {
    throw new HttpError(400, "Isi email wajib diisi dan maksimal 30.000 karakter.");
  }
  return { to, subject, text };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function emailActionStoreRequest(user, env, action, payload, HttpError) {
  if (typeof user?.sub !== "string" || !user.sub || !env.EMAIL_ACTION_STORE) {
    throw new HttpError(503, "Penyimpanan konfirmasi dan batas harian email belum dikonfigurasi pada Worker.");
  }
  const id = env.EMAIL_ACTION_STORE.idFromName(await sha256Hex(user.sub));
  const stub = env.EMAIL_ACTION_STORE.get(id);
  let response;
  try {
    response = await stub.fetch(`https://email-action.internal/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new HttpError(503, "Penyimpanan konfirmasi email tidak dapat dijangkau. Coba lagi nanti.");
  }
  if (!response.ok) throw new HttpError(503, "Penyimpanan konfirmasi email gagal memproses permintaan.");
  try {
    return await response.json();
  } catch {
    throw new HttpError(503, "Penyimpanan konfirmasi email mengembalikan respons tidak valid.");
  }
}

function createEmailConfirmationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sendEmailPreview(request, env, user, dependencies) {
  const { HttpError, readJsonBody, jsonResponse } = dependencies;
  if (request.method !== "POST") throw new HttpError(405, "Gunakan POST untuk meninjau email.");
  const draft = validateEmailDraft(await readJsonBody(request), HttpError);
  validateEmailRecipient(draft.to, env, HttpError);
  const confirmationToken = createEmailConfirmationToken();
  const payloadHash = await sha256Hex(JSON.stringify(draft));
  await emailActionStoreRequest(user, env, "preview", {
    tokenHash: await sha256Hex(confirmationToken),
    payloadHash,
  }, HttpError);
  return jsonResponse({
    ok: true,
    confirmationToken,
    expiresInSeconds: EMAIL_CONFIRMATION_TTL_MS / 1000,
    preview: { to: draft.to, subject: draft.subject, bodyPreview: draft.text.slice(0, 800) },
  }, 200, request);
}

export async function sendEmail(request, env, user, dependencies) {
  const { HttpError, readJsonBody, jsonResponse } = dependencies;
  if (request.method !== "POST") throw new HttpError(405, "Gunakan POST untuk mengirim email.");
  const apiKey = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  const from = typeof env.RESEND_FROM_EMAIL === "string" ? env.RESEND_FROM_EMAIL.trim() : "";
  const senderAddress = from.match(/<([^<>]+)>/)?.[1] || from;
  if (!apiKey || !isEmailAddress(senderAddress) || /[\r\n]/.test(from)) {
    throw new HttpError(503, "Email belum dikonfigurasi. Admin perlu memasang RESEND_API_KEY dan RESEND_FROM_EMAIL pada Cloudflare Worker.");
  }
  const draft = validateEmailDraft(await readJsonBody(request), HttpError);
  validateEmailRecipient(draft.to, env, HttpError);
  const confirmationToken = request.headers.get("X-Email-Confirmation") || "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(confirmationToken)) {
    throw new HttpError(403, "Konfirmasi email tidak valid atau kedaluwarsa. Tinjau ulang email sebelum mengirim.");
  }
  const reservation = await emailActionStoreRequest(user, env, "reserve-send", {
    tokenHash: await sha256Hex(confirmationToken),
    payloadHash: await sha256Hex(JSON.stringify(draft)),
  }, HttpError);
  if (!reservation.confirmed) {
    throw new HttpError(403, "Konfirmasi email tidak valid, sudah digunakan, atau kedaluwarsa. Tinjau ulang email sebelum mengirim.");
  }
  if (!reservation.reserved) {
    throw new HttpError(429, "Batas harian pengiriman email tercapai (20 email per hari). Coba lagi besok.");
  }
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [draft.to], subject: draft.subject, text: draft.text }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new HttpError(error?.name === "AbortError" || error?.name === "TimeoutError" ? 504 : 502,
      error?.name === "AbortError" || error?.name === "TimeoutError"
        ? "Pengiriman email melewati batas waktu 15 detik."
        : "Layanan email Resend tidak dapat dijangkau.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, "Resend menolak konfigurasi server. Periksa RESEND_API_KEY dan domain pengirim terverifikasi.");
    }
    if (response.status === 429) throw new HttpError(429, "Batas pengiriman Resend tercapai. Coba lagi nanti.");
    throw new HttpError(502, `Resend gagal mengirim email (HTTP ${response.status}).`);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new HttpError(502, "Resend mengembalikan respons yang tidak valid.");
  }
  if (typeof result.id !== "string" || !result.id) {
    throw new HttpError(502, "Resend tidak mengonfirmasi pengiriman email.");
  }
  return jsonResponse({ ok: true, id: result.id });
}
