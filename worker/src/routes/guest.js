export async function handleGuestRoute(request, env, dependencies) {
  const { HttpError, readProviderKeys, getGuestModels, guestChat, guestTranscribe, jsonResponse } = dependencies;
  const pathSegments = new URL(request.url).pathname.split("/").filter(Boolean);
  const route = pathSegments.at(-1) || "";
  const guestRoute = pathSegments.slice(-2).join("/");
  const guestImageRoute = pathSegments.slice(-3).join("/");
  const imageRoute = pathSegments.slice(-2).join("/");

  if (guestRoute === "guest/config") {
    if (request.method !== "GET") throw new HttpError(405, "Gunakan GET untuk memuat konfigurasi AI guest.");
    const siteKey = typeof env.TURNSTILE_SITE_KEY === "string" ? env.TURNSTILE_SITE_KEY.trim() : "";
    const secret = typeof env.TURNSTILE_SECRET_KEY === "string" ? env.TURNSTILE_SECRET_KEY.trim() : "";
    if (!siteKey || !secret) {
      throw new HttpError(503, "AI guest belum dikonfigurasi. Admin perlu mengatur TURNSTILE_SITE_KEY dan TURNSTILE_SECRET_KEY di Cloudflare Worker.");
    }
    return jsonResponse({ turnstileSiteKey: siteKey }, 200, request);
  }
  if (guestImageRoute === "guest/images/pollinations" || imageRoute === "images/pollinations") {
    throw new HttpError(410, "Pembuatan gambar Pollinations kini dimuat langsung oleh browser.");
  }
  if (!["guest/models", "guest/chat", "guest/transcribe"].includes(guestRoute)) return null;

  const { keys } = readProviderKeys(env.AI_PROVIDER_KEYS, env);
  if (guestRoute === "guest/models") return getGuestModels(request, env, keys);
  if (guestRoute === "guest/transcribe") return guestTranscribe(request, env, keys);
  return guestChat(request, env, keys);
}
