const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedJwks = null;
let cachedJwksExpiry = 0;
let importedKeys = new Map();

function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function decodeJwtPart(value, HttpError) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
  } catch {
    throw new HttpError(401, "Sesi Firebase tidak valid. Keluar lalu masuk kembali.");
  }
}

export async function getFirebaseKey(kid, HttpError) {
  if (!cachedJwks || Date.now() >= cachedJwksExpiry) {
    let response;
    try {
      response = await fetch(FIREBASE_JWKS_URL, { signal: AbortSignal.timeout(8000) });
    } catch (error) {
      console.warn("Firebase public signing keys unavailable:", error?.name || "Error");
      throw new HttpError(503, "Kunci verifikasi Firebase tidak dapat dimuat. Coba lagi nanti.");
    }
    if (!response.ok) throw new HttpError(503, "Kunci verifikasi Firebase tidak dapat dimuat. Coba lagi nanti.");
    const maxAge = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1]) || 3600;
    cachedJwks = await response.json();
    cachedJwksExpiry = Date.now() + maxAge * 1000;
    importedKeys = new Map();
  }
  if (importedKeys.has(kid)) return importedKeys.get(kid);
  const jwk = cachedJwks.keys?.find((item) => item.kid === kid);
  if (!jwk) throw new HttpError(401, "Sesi Firebase kedaluwarsa. Keluar lalu masuk kembali.");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  importedKeys.set(kid, key);
  return key;
}

export async function requireAuthorizedUser(request, env, HttpError) {
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Masuk terlebih dahulu.");
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new HttpError(503, "FIREBASE_PROJECT_ID belum diatur pada Cloudflare Worker.");

  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Sesi Firebase tidak valid. Keluar lalu masuk kembali.");
  const jwtHeader = decodeJwtPart(parts[0], HttpError);
  const claims = decodeJwtPart(parts[1], HttpError);
  if (jwtHeader.alg !== "RS256" || typeof jwtHeader.kid !== "string") {
    throw new HttpError(401, "Sesi Firebase tidak valid. Keluar lalu masuk kembali.");
  }
  const key = await getFirebaseKey(jwtHeader.kid, HttpError);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  if (!valid
    || claims.aud !== projectId
    || claims.iss !== `https://securetoken.google.com/${projectId}`
    || typeof claims.sub !== "string" || !claims.sub
    || !(claims.exp > now)
    || !(claims.iat <= now + 300)) {
    throw new HttpError(401, "Sesi Firebase tidak valid atau kedaluwarsa. Keluar lalu masuk kembali.");
  }
  const provider = claims.firebase?.sign_in_provider;
  if (provider === "phone" || provider === "password") {
    throw new HttpError(403, "API AI server hanya menerima akun Google atau GitHub yang sudah login.");
  }
  if (!["google.com", "github.com"].includes(provider) || claims.email_verified !== true) {
    throw new HttpError(403, "API AI server hanya menerima akun Google atau GitHub yang sudah terverifikasi.");
  }
  return claims;
}
