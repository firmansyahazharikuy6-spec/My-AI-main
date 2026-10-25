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
    ["kebebasan", ["freedom", "horizon"]],
    ["Please create an image of a city skyline at dawn with warm windows", ["city skyline", "dawn"]],
    ["kucing", ["cat", "coherent everyday scene"]],
    ["Buatkan ilustrasi hutan tropis luas setelah hujan, sungai jernih di antara pohon, kabut pagi, cahaya matahari menembus kanopi, tanpa manusia atau tulisan.", ["tropical rainforest", "clear river", "morning mist"]],
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
