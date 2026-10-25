export const MONID_API_BASE = "https://api.monid.ai/v1";

function requireMonidSecret(keys, HttpError) {
  const key = typeof keys.monid === "string" ? keys.monid.trim() : "";
  if (!key) throw new HttpError(503, "Monid belum dikonfigurasi. Admin perlu memasang secret MONID_API_KEY pada Cloudflare Worker.");
  return key;
}

async function monidRequest(request, keys, path, method, body, dependencies) {
  const key = requireMonidSecret(keys, dependencies.HttpError);
  let response;
  try {
    response = await fetch(`${MONID_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new dependencies.HttpError(504, "Permintaan Monid melewati batas waktu 60 detik.");
    }
    throw new dependencies.HttpError(502, "API Monid tidak dapat dijangkau dari Cloudflare Worker.");
  }
  const contentType = response.headers.get("Content-Type") || "";
  const rawBody = await response.text();
  let responseBody;
  if (contentType.includes("application/json")) {
    try {
      responseBody = JSON.parse(rawBody);
    } catch {
      responseBody = { message: "Respons Monid bukan JSON yang valid." };
    }
  } else {
    responseBody = { message: rawBody.slice(0, 2000) };
  }
  if (!response.ok) {
    const message = typeof responseBody.message === "string"
      ? responseBody.message
      : typeof responseBody.error === "string"
        ? responseBody.error
        : `Monid menolak permintaan (HTTP ${response.status}).`;
    throw new dependencies.HttpError(response.status, message);
  }
  return dependencies.jsonResponse(responseBody, response.status);
}

export async function handleMonidRoute(request, keys, action, env, dependencies) {
  const { HttpError, readJsonBody, jsonResponse } = dependencies;
  if (request.method !== "POST") throw new HttpError(405, "Gunakan POST untuk memakai Monid.");
  const body = await readJsonBody(request);
  if (action === "discover") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query || query.length > 1000) throw new HttpError(400, "Isi pencarian Monid 1–1000 karakter.");
    const limit = body.limit === undefined ? 5 : Number(body.limit);
    const minScore = body.minScore === undefined ? 0.2 : Number(body.minScore);
    if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new HttpError(400, "Batas hasil Monid harus 1–40.");
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) throw new HttpError(400, "minScore Monid harus 0–1.");
    const response = await monidRequest(request, keys, "/discover/endpoints", "POST", {
      q: query,
      limit,
      minScore,
      readonly: true,
    }, dependencies);
    const discovered = await response.json();
    return jsonResponse({
      ...discovered,
      results: Array.isArray(discovered.items) ? discovered.items : [],
    });
  }
  if (action === "inspect") {
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!/^[a-z0-9_-]{1,80}$/i.test(provider)) throw new HttpError(400, "Provider Monid tidak valid.");
    if (!endpoint.startsWith("/") || endpoint.length > 500 || /[\r\n]/.test(endpoint)) {
      throw new HttpError(400, "Endpoint Monid tidak valid.");
    }
    return monidRequest(request, keys, "/inspect", "POST", { provider, endpoint }, dependencies);
  }
  if (action === "run") {
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!/^[a-z0-9_-]{1,80}$/i.test(provider)) throw new HttpError(400, "Provider Monid tidak valid.");
    if (!endpoint.startsWith("/") || endpoint.length > 500 || /[\r\n]/.test(endpoint)) {
      throw new HttpError(400, "Endpoint Monid tidak valid.");
    }
    if (body.input !== undefined && (body.input === null || typeof body.input !== "object" || Array.isArray(body.input))) {
      throw new HttpError(400, "Input endpoint Monid harus berupa objek JSON.");
    }
    const rawMaximumCost = env.MONID_MAX_RUN_COST;
    const maximumCost = typeof rawMaximumCost === "number"
      || typeof rawMaximumCost === "string" && rawMaximumCost.trim()
      ? Number(rawMaximumCost)
      : NaN;
    if (!Number.isFinite(maximumCost) || maximumCost < 0) {
      throw new HttpError(503, "Batas biaya MONID_MAX_RUN_COST belum dikonfigurasi dengan benar.");
    }
    const inspectionResponse = await monidRequest(request, keys, "/inspect", "POST", { provider, endpoint }, dependencies);
    let inspection;
    try {
      inspection = await inspectionResponse.json();
    } catch {
      throw new HttpError(503, "Harga endpoint Monid tidak dapat dibaca. Run dibatalkan demi keamanan biaya.");
    }
    const rawPriceAmount = inspection?.price?.amount?.value;
    const priceAmount = typeof rawPriceAmount === "number"
      || typeof rawPriceAmount === "string" && rawPriceAmount.trim()
      ? Number(rawPriceAmount)
      : NaN;
    const priceCurrency = typeof inspection?.price?.amount?.currency === "string"
      ? inspection.price.amount.currency.trim()
      : "";
    if (!Number.isFinite(priceAmount) || priceAmount < 0 || !priceCurrency) {
      throw new HttpError(503, "Respons inspect Monid tidak memuat harga dan mata uang yang valid. Run dibatalkan demi keamanan biaya.");
    }
    if (priceAmount > maximumCost) {
      throw new HttpError(402, `Biaya endpoint Monid (${priceAmount} ${priceCurrency}) melebihi batas ${maximumCost} ${priceCurrency}. Run ditolak.`);
    }
    return monidRequest(request, keys, "/run", "POST", {
      provider,
      endpoint,
      ...(body.input ? { input: body.input } : {}),
    }, dependencies);
  }
  if (action === "get") {
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!/^[a-z0-9_-]{8,100}$/i.test(runId)) throw new HttpError(400, "ID run Monid tidak valid.");
    return monidRequest(request, keys, `/runs/${encodeURIComponent(runId)}`, "GET", undefined, dependencies);
  }
  throw new HttpError(404, "Aksi Monid tidak dikenal.");
}
