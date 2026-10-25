import { createPresentation, finishOAuth, startOAuth } from "../canva.ts";

export function validatePresentationBody(body, HttpError) {
  if (Object.keys(body).some((field) => !["title", "slides", "exportFormat"].includes(field))) {
    throw new HttpError(400, "Permintaan presentasi berisi field yang tidak dikenal.");
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) {
    throw new HttpError(400, "Judul presentasi wajib diisi (maksimal 200 karakter).");
  }
  if (!Array.isArray(body.slides) || !body.slides.length || body.slides.length > 50) {
    throw new HttpError(400, "Outline presentasi harus berisi 1–50 slide.");
  }
  const slides = body.slides.map((slide, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)
      || Object.keys(slide).some((field) => !["title", "content", "notes"].includes(field))) {
      throw new HttpError(400, `Data slide ${index + 1} tidak valid.`);
    }
    const slideTitle = typeof slide.title === "string" ? slide.title.trim() : "";
    if (!slideTitle || slideTitle.length > 300 || !Array.isArray(slide.content)
      || slide.content.length > 30
      || !slide.content.every((line) => typeof line === "string" && line.trim() && line.length <= 2000)
      || (slide.notes !== undefined && (typeof slide.notes !== "string" || slide.notes.length > 4000))) {
      throw new HttpError(400, `Konten slide ${index + 1} tidak valid.`);
    }
    return {
      title: slideTitle,
      content: slide.content.map((line) => line.trim()),
      ...(typeof slide.notes === "string" && slide.notes.trim() ? { notes: slide.notes.trim() } : {}),
    };
  });
  const exportFormat = body.exportFormat === undefined ? "pptx" : body.exportFormat;
  if (exportFormat !== "pptx" && exportFormat !== "pdf") {
    throw new HttpError(400, "Format ekspor presentasi harus PPTX atau PDF.");
  }
  return { title, slides, exportFormat };
}

export async function handleCanvaCallback(request, env, HttpError) {
  const pathSegments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (pathSegments.slice(-3).join("/") !== "canva/oauth/callback") return null;
  if (request.method !== "GET") throw new HttpError(405, "Gunakan GET untuk callback OAuth Canva.");
  return finishOAuth(request, env);
}

export async function handleCanvaRoute(request, env, user, dependencies) {
  const pathSegments = new URL(request.url).pathname.split("/").filter(Boolean);
  const route = pathSegments.slice(-3).join("/");
  if (route === "canva/oauth/start") {
    if (request.method !== "GET") throw new dependencies.HttpError(405, "Gunakan GET untuk memulai koneksi Canva.");
    await dependencies.enforceAIRateLimit(user, env, "canva-oauth");
    return dependencies.jsonResponse({
      authorizationUrl: await startOAuth(request, env, user.sub),
    }, 200, request);
  }
  if (pathSegments.at(-1) === "presentation") {
    if (request.method !== "POST") throw new dependencies.HttpError(405, "Gunakan POST untuk membuat presentasi Canva.");
    await dependencies.enforceAIRateLimit(user, env, "canva-presentation");
    const body = validatePresentationBody(await dependencies.readJsonBody(request), dependencies.HttpError);
    return dependencies.jsonResponse(await createPresentation(env, user.sub, {
      title: body.title,
      slides: body.slides,
    }, body.exportFormat), 200, request);
  }
  return null;
}
