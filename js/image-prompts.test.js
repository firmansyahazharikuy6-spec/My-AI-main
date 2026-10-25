import assert from "node:assert/strict";
import test from "node:test";
import {
  boostImagePromptQuality,
  buildFallbackImagePromptPlan,
  cleanImageGenerationPrompt,
  validateImagePromptPlan,
} from "./image-prompts.js";
import { streamChat } from "./providers.js";

test("image prompt cleanup removes Indonesian and English generation commands", () => {
  assert.equal(cleanImageGenerationPrompt("Buatkan gambar sampel: pegunungan saat matahari terbit."), "pegunungan saat matahari terbit");
  assert.equal(cleanImageGenerationPrompt("Generate image: a quiet lake at dawn"), "a quiet lake at dawn");
  assert.equal(cleanImageGenerationPrompt("kota yang indah dengan tema masa depan"), "kota yang indah dengan tema masa depan");
});

test("image prompt quality boost is added once", () => {
  assert.equal(
    boostImagePromptQuality("a quiet lake at dawn"),
    "a quiet lake at dawn, highly detailed, clear visual composition, professional lighting",
  );
  assert.equal(
    boostImagePromptQuality("a quiet lake, 8k resolution"),
    "a quiet lake, 8k resolution, highly detailed, clear visual composition, professional lighting",
  );
  assert.equal(
    boostImagePromptQuality("a quiet lake, 8k resolution, highly detailed, photorealistic, cinematic lighting, masterpiece, sharp focus, octane render"),
    "a quiet lake, 8k resolution, highly detailed, photorealistic, cinematic lighting, masterpiece, sharp focus, octane render, clear visual composition, professional lighting",
  );
});

test("Pollinations image stream cleans the request and builds an HD URL without fetching image bytes", async () => {
  const chunks = [];
  for await (const chunk of streamChat("pollinations", "flux", [
    { role: "user", content: "Buatkan gambar sampel: pegunungan saat matahari terbit." },
  ], { imageGeneration: true }, new AbortController().signal)) {
    chunks.push(chunk);
  }
  const imageUrl = chunks.find((chunk) => typeof chunk.image === "string")?.image;
  assert.ok(imageUrl);
  const url = new URL(imageUrl);
  assert.equal(url.hostname, "image.pollinations.ai");
  assert.equal(url.searchParams.get("width"), "1280");
  assert.equal(url.searchParams.get("height"), "720");
  assert.equal(url.searchParams.get("nologo"), "true");
  assert.equal(url.searchParams.get("enhance"), "false");
  assert.match(url.searchParams.get("seed"), /^\d+$/);
  assert.match(decodeURIComponent(url.pathname), /^\/prompt\/A quiet mountain landscape at sunrise/);
  const metadata = chunks.find((chunk) => chunk.imageMetadata)?.imageMetadata;
  assert.equal(metadata.provider, "pollinations");
  assert.equal(metadata.modelLabel, "Flux (Pollinations)");
  assert.match(metadata.prompt, /mountain landscape/i);
});

test("image prompt fallback preserves concrete intent across ten Indonesian request shapes (MOCK)", async () => {
  const cases = [
    ["tolong buatka aku sebuah gambar tentang kemerdekaan indonesia", ["indonesian independence", "red-and-white"]],
    ["gambar kucing oren lagi tidur di jendela hujan", ["orange tabby cat", "rain"]],
    ["poster 17 agustus gaya retro", ["poster", "red-and-white"]],
    ["pemandangan sawah pagi hari", ["rice paddy", "morning"]],
    ["logo kopi minimalis", ["coffee", "logo"]],
    ["kebebasan", ["coherent illustration centered on", "kebebasan"]],
    ["Please create an image of a city skyline at dawn with warm windows", ["city skyline", "dawn"]],
    ["kucing", ["cat", "coherent everyday scene"]],
    [`tolong buatkan gambar tentang festival desa dengan lampion warna-warni dan musik tradisional ${"suasana ramai dan hangat ".repeat(50)}`, ["festival desa", "lampion"]],
    ["tolong gambarkn matahari terbit di balik gunung dengan danau tenang", ["sunrise", "mountain"]],
  ];
  for (const [rawPrompt, anchors] of cases) {
    const cleaned = cleanImageGenerationPrompt(rawPrompt);
    const plan = buildFallbackImagePromptPlan(cleaned);
    assert.ok(cleaned, `prompt cleanup returned empty for: ${rawPrompt}`);
    assert.ok(plan.prompt.length > 80, `fallback is not concrete for: ${rawPrompt}`);
    assert.doesNotMatch(plan.prompt, /\b(?:tolong|buatkan|buatka)\b/i, `command phrase leaked for: ${rawPrompt}`);
    for (const anchor of anchors) {
      assert.ok(plan.prompt.toLowerCase().includes(anchor.toLowerCase()), `missing "${anchor}" for: ${rawPrompt}`);
    }
    assert.deepEqual(validateImagePromptPlan(plan, cleaned), plan);
    assert.ok(plan.prompt.length <= 2400, `fallback exceeded output limit for: ${rawPrompt}`);
    const chunks = [];
    for await (const chunk of streamChat("pollinations", "flux", [{ role: "user", content: rawPrompt }], {
      imageGeneration: true,
      imagePromptPlan: plan,
    }, new AbortController().signal)) chunks.push(chunk);
    const image = chunks.find((chunk) => chunk.image);
    assert.ok(image, `no generated image URL for: ${rawPrompt}`);
    assert.equal(image.imageMetadata.provider, "pollinations");
    assert.equal(image.imageMetadata.model, "flux");
    assert.equal(image.imageMetadata.modelLabel, "Flux (Pollinations)");
  }
});

test("abstract fallback is generic rather than a fixed freedom scene", () => {
  const freedom = buildFallbackImagePromptPlan("kebebasan");
  const hope = buildFallbackImagePromptPlan("harapan");
  assert.match(freedom.prompt, /coherent illustration centered on/i);
  assert.match(hope.prompt, /coherent illustration centered on/i);
  assert.match(freedom.prompt, /kebebasan/i);
  assert.match(hope.prompt, /harapan/i);
  assert.doesNotMatch(freedom.prompt, /mountain ridge|horizon|lone person/i);
  assert.doesNotMatch(hope.prompt, /mountain ridge|horizon|lone person/i);
});

test("generic fallback preserves concrete subjects instead of abstracting the entire request", () => {
  const plan = buildFallbackImagePromptPlan("Please create an image of a city skyline at dawn with warm windows");
  assert.match(plan.prompt, /city skyline at dawn with warm windows/i);
  assert.doesNotMatch(plan.prompt, /woman|mountain ridge/i);
});

test("invalid image prompt plans fall back locally without losing known subject anchors", () => {
  const prompt = "tolong buatkan gambar tentang kemerdekaan indonesia";
  const plan = validateImagePromptPlan({
    prompt: "A woman wearing elaborate feathers in a studio portrait.",
    negative: "",
    aspect: "1:1",
    style: "portrait",
    assumptions: "",
  }, prompt);
  assert.match(plan.prompt, /Indonesian Independence Day/i);
  assert.match(plan.prompt, /red-and-white/i);
});

test("image result label metadata reflects the selected Pollinations model (MOCK; no provider request)", async () => {
  const chunks = [];
  const plan = buildFallbackImagePromptPlan("tolong buatka aku gambar tentang kemerdekaan indonesia");
  for await (const chunk of streamChat("pollinations", "flux", [
    { role: "user", content: "tolong buatka aku gambar tentang kemerdekaan indonesia" },
  ], { imageGeneration: true, imagePromptPlan: plan, imageFallbackReason: "Gemini Image tidak tersedia (HTTP 429)." }, new AbortController().signal)) {
    chunks.push(chunk);
  }
  const imageChunk = chunks.find((chunk) => chunk.image);
  assert.ok(imageChunk);
  const url = new URL(imageChunk.image);
  assert.equal(url.searchParams.get("model"), "flux");
  assert.equal(imageChunk.imageMetadata.provider, "pollinations");
  assert.equal(imageChunk.imageMetadata.modelLabel, "Flux (Pollinations)");
  assert.match(imageChunk.imageMetadata.fallbackReason, /429/);
  assert.match(decodeURIComponent(url.pathname), /Indonesian Independence Day/);
});

test("image fallback resolution pins Pollinations to 768 square (MOCK)", async () => {
  const chunks = [];
  for await (const chunk of streamChat("pollinations", "flux", [
    { role: "user", content: "Create a quiet forest scene." },
  ], {
    imageGeneration: true,
    imageFallbackReason: "Gemini returned HTTP 500.",
    imageFallbackResolution: "768x768",
  }, new AbortController().signal)) chunks.push(chunk);
  const url = new URL(chunks.find((chunk) => chunk.image).image);
  assert.equal(url.searchParams.get("width"), "768");
  assert.equal(url.searchParams.get("height"), "768");
});

test("Pollinations URL preserves reserved prompt characters without changing query parameters (MOCK)", async () => {
  const rawPrompt = "draw a robot & a cat? beside a 100% moon";
  const plan = buildFallbackImagePromptPlan(rawPrompt);
  let imageChunk;
  for await (const chunk of streamChat("pollinations", "flux", [{ role: "user", content: rawPrompt }], {
    imageGeneration: true,
    imagePromptPlan: plan,
  }, new AbortController().signal)) {
    if (chunk.image) imageChunk = chunk;
  }
  const url = new URL(imageChunk.image);
  assert.equal(decodeURIComponent(url.pathname.slice("/prompt/".length)), imageChunk.imageMetadata.prompt);
  assert.equal(url.searchParams.get("width"), "1024");
  assert.equal(url.searchParams.get("height"), "1024");
  assert.equal(url.searchParams.get("fake"), null);
  assert.match(url.pathname, /%26/);
  assert.match(url.pathname, /%3F/);
});

test("image fallback uses the requested 768 by 768 Pollinations resolution (MOCK)", async () => {
  let imageChunk;
  for await (const chunk of streamChat("pollinations", "flux", [
    { role: "user", content: "gambar ilustrasi sederhana" },
  ], {
    imageGeneration: true,
    imageFallbackResolution: "768x768",
    imagePromptPlan: buildFallbackImagePromptPlan("gambar ilustrasi sederhana"),
  }, new AbortController().signal)) {
    if (chunk.image) imageChunk = chunk;
  }
  const url = new URL(imageChunk.image);
  assert.equal(url.searchParams.get("width"), "768");
  assert.equal(url.searchParams.get("height"), "768");
});
