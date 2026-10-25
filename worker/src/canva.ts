export const CANVA_SCOPES = [
  "brandtemplate:content:read",
  "design:content:read",
  "design:content:write",
] as const;

const CANVA_API = "https://api.canva.com/rest/v1";
const CANVA_TOKEN_URL = `${CANVA_API}/oauth/token`;
const TOKEN_KEY_PREFIX = "canva:tokens:";
const STATE_KEY_PREFIX = "canva:oauth:state:";
const OAUTH_STATE_TTL_SECONDS = 600;
const DEFAULT_JOB_TIMEOUT_MS = 45_000;

export interface CanvaKV {
  get<T = string>(key: string, type?: "text" | "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CanvaEnv {
  CANVA_CLIENT_ID?: string;
  CANVA_CLIENT_SECRET?: string;
  CANVA_REDIRECT_URI?: string;
  CANVA_BRAND_TEMPLATE_ID?: string;
  CANVA_TOKEN_STORE?: CanvaKV;
}

export interface PresentationSlide {
  title: string;
  content: string[];
  notes?: string;
}

export interface PresentationOutline {
  title: string;
  slides: PresentationSlide[];
}

export interface CanvaPresentation {
  designId: string;
  editUrl: string;
  viewUrl: string;
  downloadUrl?: string;
  templateUsed: boolean;
  warning?: string;
  outline: PresentationOutline;
}

interface CanvaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface OAuthState {
  userId: string;
  codeVerifier: string;
  returnOrigin: string;
}

export class CanvaError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CanvaError";
    this.status = status;
    this.code = code;
  }
}

function requireClientCredentials(env: CanvaEnv): { clientId: string; clientSecret: string } {
  const clientId = env.CANVA_CLIENT_ID?.trim();
  const clientSecret = env.CANVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new CanvaError(503, "CANVA_NOT_CONFIGURED", "Canva OAuth belum dikonfigurasi pada Cloudflare Worker.");
  }
  return { clientId, clientSecret };
}

function requireStore(env: CanvaEnv): CanvaKV {
  if (!env.CANVA_TOKEN_STORE) {
    throw new CanvaError(503, "CANVA_STORAGE_UNAVAILABLE", "Penyimpanan OAuth Canva belum dikonfigurasi pada Worker.");
  }
  return env.CANVA_TOKEN_STORE;
}

function randomBase64Url(byteLength = 48): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function redirectUri(request: Request, env: CanvaEnv): string {
  return env.CANVA_REDIRECT_URI?.trim()
    || `${new URL(request.url).origin}/canva/oauth/callback`;
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function tokenKey(userId: string): string {
  return `${TOKEN_KEY_PREFIX}${userId}`;
}

async function readTokens(env: CanvaEnv, userId: string): Promise<CanvaTokens | null> {
  return requireStore(env).get<CanvaTokens>(tokenKey(userId), "json");
}

async function saveTokens(env: CanvaEnv, userId: string, data: Record<string, unknown>, previous?: CanvaTokens | null): Promise<CanvaTokens> {
  if (typeof data.access_token !== "string" || !data.access_token
    || (typeof data.refresh_token !== "string" && !previous?.refresh_token)) {
    throw new CanvaError(502, "CANVA_INVALID_TOKEN_RESPONSE", "Canva tidak mengembalikan access token dan refresh token yang valid.");
  }
  const expiresIn = Number(data.expires_in);
  const tokens: CanvaTokens = {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : previous!.refresh_token,
    expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 14_400) * 1000,
  };
  await requireStore(env).put(tokenKey(userId), JSON.stringify(tokens));
  return tokens;
}

async function tokenRequest(env: CanvaEnv, body: URLSearchParams): Promise<Record<string, unknown>> {
  const { clientId, clientSecret } = requireClientCredentials(env);
  let response: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(CANVA_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuthorization(clientId, clientSecret),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CanvaError(502, "CANVA_UNREACHABLE", "Tidak dapat menghubungi layanan autentikasi Canva.");
    }
    if (response.status !== 429 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  if (!response) throw new CanvaError(502, "CANVA_UNREACHABLE", "Canva tidak memberikan respons autentikasi.");
  if (!response.ok) {
    if (response.status === 401 || response.status === 400) {
      throw new CanvaError(401, "CANVA_REAUTH_REQUIRED", "Canva menolak sesi OAuth. Hubungkan kembali akun Canva.");
    }
    if (response.status === 403) {
      throw new CanvaError(403, "CANVA_PERMISSION_DENIED", "Canva menolak otorisasi aplikasi. Periksa client dan scope OAuth.");
    }
    if (response.status === 429) throw new CanvaError(429, "CANVA_RATE_LIMITED", "Batas autentikasi Canva tercapai. Coba lagi sebentar.");
    if (response.status >= 500) throw new CanvaError(502, "CANVA_TOKEN_UPSTREAM_ERROR", "Canva sedang mengalami gangguan autentikasi.");
    throw new CanvaError(502, "CANVA_TOKEN_FAILED", "Canva gagal menerbitkan token OAuth.");
  }
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new CanvaError(502, "CANVA_INVALID_TOKEN_RESPONSE", "Respons token Canva tidak valid.");
  }
  return result as Record<string, unknown>;
}

const refreshes = new Map<string, Promise<CanvaTokens>>();

async function refreshTokens(env: CanvaEnv, userId: string, previous: CanvaTokens): Promise<CanvaTokens> {
  const pending = refreshes.get(userId);
  if (pending) return pending;
  const refresh = (async () => {
    const result = await tokenRequest(env, new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: previous.refresh_token,
    }));
    return saveTokens(env, userId, result, previous);
  })();
  refreshes.set(userId, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshes.get(userId) === refresh) refreshes.delete(userId);
  }
}

export async function getAccessToken(env: CanvaEnv, userId: string): Promise<string> {
  if (!userId) throw new CanvaError(401, "CANVA_AUTH_REQUIRED", "Masuk dan hubungkan akun Canva terlebih dahulu.");
  const tokens = await readTokens(env, userId);
  if (!tokens?.access_token || !tokens.refresh_token) {
    throw new CanvaError(401, "CANVA_AUTH_REQUIRED", "Akun Canva belum terhubung. Hubungkan Canva lalu coba lagi.");
  }
  const valid = tokens.expires_at > Date.now() + 60_000;
  const latest = valid ? tokens : await refreshTokens(env, userId, tokens);
  return latest.access_token;
}

export async function startOAuth(request: Request, env: CanvaEnv, userId: string): Promise<string> {
  const { clientId } = requireClientCredentials(env);
  const store = requireStore(env);
  if (!userId) throw new CanvaError(401, "CANVA_AUTH_REQUIRED", "Masuk terlebih dahulu untuk menghubungkan Canva.");
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const requestOrigin = request.headers.get("Origin") || new URL(request.url).origin;
  const stateRecord: OAuthState = {
    userId,
    codeVerifier,
    returnOrigin: requestOrigin,
  };
  await store.put(`${STATE_KEY_PREFIX}${state}`, JSON.stringify(stateRecord), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  const authorize = new URL("https://www.canva.com/api/oauth/authorize");
  authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: await sha256Base64Url(codeVerifier),
    scope: CANVA_SCOPES.join(" "),
    state,
    redirect_uri: redirectUri(request, env),
  }).toString();
  return authorize.toString();
}

export async function finishOAuth(request: Request, env: CanvaEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const store = requireStore(env);
  if (!state) throw new CanvaError(400, "CANVA_INVALID_STATE", "Callback Canva tidak memiliki state OAuth.");
  const key = `${STATE_KEY_PREFIX}${state}`;
  const stateRecord = await store.get<OAuthState>(key, "json");
  if (!stateRecord?.userId || !stateRecord.codeVerifier) {
    throw new CanvaError(400, "CANVA_INVALID_STATE", "Sesi OAuth Canva kedaluwarsa atau tidak valid. Mulai ulang koneksi Canva.");
  }
  await store.delete(key);
  const returnUrl = new URL("/", stateRecord.returnOrigin);
  const authorizationError = url.searchParams.get("error");
  if (authorizationError) {
    returnUrl.searchParams.set("canva_error", "authorization_denied");
    return Response.redirect(returnUrl, 302);
  }
  const code = url.searchParams.get("code");
  if (!code) throw new CanvaError(400, "CANVA_MISSING_CODE", "Canva tidak mengembalikan kode otorisasi.");
  const result = await tokenRequest(env, new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: stateRecord.codeVerifier,
    redirect_uri: redirectUri(request, env),
  }));
  await saveTokens(env, stateRecord.userId, result);
  returnUrl.searchParams.set("canva_connected", "1");
  return Response.redirect(returnUrl, 302);
}

async function canvaRequest(
  env: CanvaEnv,
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let accessToken = await getAccessToken(env, userId);
  let refreshedAfterUnauthorized = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${CANVA_API}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: init.signal || AbortSignal.timeout(30_000),
      });
    } catch {
      throw new CanvaError(502, "CANVA_UNREACHABLE", "Tidak dapat menghubungi Canva Connect API.");
    }
    if (response.status === 401 && !refreshedAfterUnauthorized) {
      const stored = await readTokens(env, userId);
      if (!stored) throw new CanvaError(401, "CANVA_REAUTH_REQUIRED", "Sesi Canva tidak tersedia. Hubungkan ulang akun Canva.");
      accessToken = (await refreshTokens(env, userId, stored)).access_token;
      refreshedAfterUnauthorized = true;
      attempt -= 1;
      continue;
    }
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 4000)
        : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) {
      if (response.status === 401) throw new CanvaError(401, "CANVA_REAUTH_REQUIRED", "Sesi Canva kedaluwarsa. Hubungkan ulang akun Canva.");
      if (response.status === 403) throw new CanvaError(403, "CANVA_PERMISSION_DENIED", "Canva menolak izin. Periksa scope OAuth dan akses akun ke template.");
      if (response.status === 429) throw new CanvaError(429, "CANVA_RATE_LIMITED", "Batas permintaan Canva tercapai. Coba lagi sebentar.");
      if (response.status >= 500) throw new CanvaError(502, "CANVA_UPSTREAM_ERROR", "Canva sedang mengalami gangguan. Coba lagi nanti.");
      throw new CanvaError(response.status, "CANVA_REQUEST_FAILED", `Canva menolak permintaan (HTTP ${response.status}).`);
    }
    const result: unknown = await response.json().catch(() => null);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new CanvaError(502, "CANVA_INVALID_RESPONSE", "Canva mengembalikan respons JSON yang tidak valid.");
    }
    return result as Record<string, unknown>;
  }
  throw new CanvaError(429, "CANVA_RATE_LIMITED", "Batas permintaan Canva tercapai setelah beberapa percobaan.");
}

function cleanSlideText(slide: PresentationSlide): string {
  return [slide.title, ...slide.content].filter(Boolean).join("\n");
}

function mapTemplateDataset(dataset: Record<string, unknown>, outline: PresentationOutline): Record<string, unknown> {
  const entries = Object.entries(dataset).filter(([, field]) =>
    field && typeof field === "object" && (field as Record<string, unknown>).type === "text");
  if (!entries.length) {
    throw new CanvaError(422, "CANVA_TEMPLATE_NO_TEXT_FIELDS", "Template Canva tidak memiliki field teks yang dapat diisi otomatis.");
  }
  const values: Record<string, unknown> = {};
  const unused = new Set(entries.map(([name]) => name));
  const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const set = (name: string, text: string) => {
    if (!unused.has(name)) return;
    values[name] = { type: "text", text: text.slice(0, 4000) };
    unused.delete(name);
  };
  const titleField = entries.find(([name]) => /(^|_)(title|headline|heading|presentation_name)(_|$)/.test(normalized(name)));
  if (titleField) set(titleField[0], outline.title);
  for (const [name] of entries) {
    const fieldName = normalized(name);
    const slideMatch = fieldName.match(/(?:slide|page|s)_?(\d+)_?(title|heading|headline|content|body|text|points)?/);
    if (!slideMatch) continue;
    const slide = outline.slides[Number(slideMatch[1]) - 1];
    if (!slide) continue;
    const kind = slideMatch[2] || "content";
    set(name, /title|heading|headline/.test(kind) ? slide.title : cleanSlideText(slide));
  }
  const remaining = entries.filter(([name]) => unused.has(name));
  const bodyFields = remaining.filter(([name]) => !/(^|_)(title|headline|heading|presentation_name)(_|$)/.test(normalized(name)));
  const slideFields = bodyFields.length >= outline.slides.length ? bodyFields : remaining;
  for (const [index, [name]] of slideFields.entries()) {
    if (index >= outline.slides.length) break;
    set(name, cleanSlideText(outline.slides[index]));
  }
  if (!Object.keys(values).length) set(entries[0][0], `${outline.title}\n\n${outline.slides.map(cleanSlideText).join("\n\n")}`);
  return values;
}

export async function pollJob(
  env: CanvaEnv,
  userId: string,
  kind: "autofills" | "exports",
  jobId: string,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let delay = 500;
  while (Date.now() < deadline) {
    const response = await canvaRequest(env, userId, `/${kind}/${encodeURIComponent(jobId)}`);
    const job = response.job as Record<string, unknown> | undefined;
    if (job?.status === "success") return job;
    if (job?.status === "failed") {
      throw new CanvaError(502, "CANVA_JOB_FAILED", `Canva gagal menyelesaikan pekerjaan ${kind === "exports" ? "ekspor" : "autofill"}.`);
    }
    if (job?.status !== "in_progress") {
      throw new CanvaError(502, "CANVA_INVALID_JOB_STATUS", "Canva mengembalikan status pekerjaan yang tidak dikenal.");
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 2500);
  }
  throw new CanvaError(504, "CANVA_JOB_TIMEOUT", "Pekerjaan Canva belum selesai dalam batas waktu. Coba lagi nanti.");
}

export async function autofillTemplate(
  env: CanvaEnv,
  userId: string,
  templateId: string,
  outline: PresentationOutline,
): Promise<Record<string, unknown>> {
  const datasetResponse = await canvaRequest(env, userId, `/brand-templates/${encodeURIComponent(templateId)}/dataset`);
  const dataset = datasetResponse.dataset;
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) {
    throw new CanvaError(422, "CANVA_TEMPLATE_DATASET_INVALID", "Canva tidak menemukan field autofill pada Brand Template ini.");
  }
  const data = mapTemplateDataset(dataset as Record<string, unknown>, outline);
  const created = await canvaRequest(env, userId, "/autofills", {
    method: "POST",
    body: JSON.stringify({ type: "create_from_brand_template", brand_template_id: templateId, data }),
  });
  const job = created.job as Record<string, unknown> | undefined;
  if (typeof job?.id !== "string") {
    throw new CanvaError(502, "CANVA_AUTOFILL_JOB_INVALID", "Canva tidak mengembalikan ID pekerjaan autofill.");
  }
  const completed = await pollJob(env, userId, "autofills", job.id);
  const design = (completed.result as Record<string, unknown> | undefined)?.design as Record<string, unknown> | undefined;
  if (typeof design?.id !== "string") {
    throw new CanvaError(502, "CANVA_AUTOFILL_RESULT_INVALID", "Autofill Canva selesai tanpa desain yang dapat dibuka.");
  }
  return design;
}

export async function exportDesign(
  env: CanvaEnv,
  userId: string,
  designId: string,
  format: "pptx" | "pdf" = "pptx",
): Promise<string> {
  const created = await canvaRequest(env, userId, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format: { type: format } }),
  });
  const job = created.job as Record<string, unknown> | undefined;
  if (typeof job?.id !== "string") throw new CanvaError(502, "CANVA_EXPORT_JOB_INVALID", "Canva tidak mengembalikan ID pekerjaan ekspor.");
  const completed = await pollJob(env, userId, "exports", job.id);
  const result = completed.result as Record<string, unknown> | undefined;
  const urls = Array.isArray(result?.urls) ? result.urls : [];
  const firstUrl = urls.find((item): item is string => typeof item === "string" && /^https:\/\//i.test(item));
  if (!firstUrl) throw new CanvaError(502, "CANVA_EXPORT_URL_MISSING", "Ekspor Canva selesai tanpa tautan unduhan.");
  return firstUrl;
}

export async function createPresentation(
  env: CanvaEnv,
  userId: string,
  outline: PresentationOutline,
  exportFormat: "pptx" | "pdf" = "pptx",
): Promise<CanvaPresentation> {
  const templateId = env.CANVA_BRAND_TEMPLATE_ID?.trim();
  let design: Record<string, unknown>;
  let warning: string | undefined;
  if (templateId) {
    design = await autofillTemplate(env, userId, templateId, outline);
  } else {
    const created = await canvaRequest(env, userId, "/designs", {
      method: "POST",
      body: JSON.stringify({
        type: "type_and_asset",
        design_type: { type: "preset", name: "presentation" },
        title: outline.title,
      }),
    });
    design = created.design as Record<string, unknown>;
    warning = "Desain Canva dibuat kosong karena Brand Template belum dikonfigurasi; outline tersedia pada respons.";
  }
  const urls = design.urls as Record<string, unknown> | undefined;
  if (typeof design.id !== "string" || typeof urls?.edit_url !== "string" || typeof urls.view_url !== "string") {
    throw new CanvaError(502, "CANVA_DESIGN_URLS_MISSING", "Canva membuat desain tanpa tautan edit/view yang valid.");
  }
  const downloadUrl = await exportDesign(env, userId, design.id, exportFormat);
  return {
    designId: design.id,
    editUrl: urls.edit_url,
    viewUrl: urls.view_url,
    downloadUrl,
    templateUsed: Boolean(templateId),
    ...(warning ? { warning } : {}),
    outline,
  };
}
