import assert from "node:assert/strict";
import test from "node:test";
import {
  boostImagePromptQuality,
  buildFallbackImagePromptPlan,
  buildImagePromptEnhanceSystemPrompt,
  cleanImageGenerationPrompt,
  isImageEditPrompt,
  validateImagePromptPlan,
} from "./image-prompts.js";
import { streamChat } from "./providers.js";

test("image prompt cleanup removes Indonesian and English generation commands", () => {
  assert.equal(cleanImageGenerationPrompt("Buatkan gambar sampel: pegunungan saat matahari terbit."), "pegunungan saat matahari terbit");
  assert.equal(cleanImageGenerationPrompt("Generate image: a quiet lake at dawn"), "a quiet lake at dawn");
  assert.equal(cleanImageGenerationPrompt("kota yang indah dengan tema masa depan"), "kota yang indah dengan tema masa depan");
});

test("photo-retouch requests with a supplied image are classified as edits, not new image prompts", () => {
  const prompt = `Edit foto ini, bukan buat gambar baru. Pertahankan wajah, identitas, pose,
proporsi tubuh, pakaian, dan latar belakang persis seperti aslinya.
Lakukan hanya penyempurnaan halus:
- haluskan kulit secara natural dengan tekstur pori tetap terlihat
- rapikan noda kecil dan bayangan di bawah mata secara ringan
- perbaiki pencahayaan dan koreksi warna agar lebih hangat dan cerah
- pertajam detail wajah dan rambut sedikit
Hasil harus terlihat seperti foto asli yang diambil dengan kamera bagus,
bukan hasil AI atau filter berlebihan. Jangan ubah bentuk wajah atau tubuh.`;
  assert.equal(isImageEditPrompt(prompt), true);
  assert.equal(isImageEditPrompt("Buat gambar baru seekor kucing di taman."), false);
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

test("image prompt fallback preserves concrete intent across ten Indonesian request shapes (MOCK)", () => {
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

test("image requests cannot use Pollinations or the chat-provider stream", async () => {
  for (const [provider, options] of [
    ["pollinations", {}],
    ["gemini", { imageGeneration: true }],
    ["groq", { generateImage: true }],
  ]) {
    await assert.rejects(async () => {
      for await (const _chunk of streamChat(provider, "test-model", [
        { role: "user", content: "Create a landscape." },
      ], options, new AbortController().signal)) {}
    }, /hanya tersedia melalui Gemini Image/i);
  }
});

test("image prompt enhancer system prompt demands maximum detail and full budget", () => {
  const system = buildImagePromptEnhanceSystemPrompt();
  assert.ok(system.length > 800);
  assert.ok(system.includes("2,400"));
  assert.ok(system.includes("1,000"));
  assert.match(system, /never shorten/i);
  assert.match(system, /requiredVisualAnchor/);
  assert.match(system, /assumptions/i);
  assert.match(system, /16:9/i);
  assert.match(system, /negative under 800/i);
  assert.match(system, /Do not ask questions/i);
});

test("validation rejects plans that drop a generic requested subject", () => {
  const plan = validateImagePromptPlan({
    prompt: "A colossal fire-breathing dragon soaring above a burning medieval castle, dark storm clouds gathering behind it, embers and ash swirling through the air, the castle towers silhouetted against the inferno, glowing orange light from the flames reflecting on the dragon's dark scales, terrified villagers fleeing along a stone bridge in the foreground, dramatic low-angle composition, volumetric smoke rolling across the courtyard, sparks rising into the night sky, deep shadows and high contrast, rich crimson and amber palette with deep black shadows, ultra-detailed individual scales and leathery wings, cinematic epic fantasy digital painting, sharp focus on the dragon's head, atmospheric haze, wisps of smoke curling around the battlements, molten embers trailing from the dragon's jaws, silhouettes of ravens scattering into the night, the fire glow painting the undersides of the clouds, distant mountain peaks barely visible beyond the castle walls, no text.",
    negative: "",
    aspect: "16:9",
    style: "Epic digital painting",
    assumptions: "Saya mengubah subjek menjadi naga.",
  }, "gambar robot raksasa di tengah kota");
  assert.match(plan.prompt, /robot/i);
  assert.doesNotMatch(plan.prompt, /dragon/i);
});

test("validation accepts a detailed plan that keeps the subject in another language", () => {
  const prompt = "A vast field of golden sunflowers stretching to the horizon under a clear blue summer sky, hundreds of large blooms with dark brown centers facing the sun, a gentle breeze bending the green stems and leaves, a rustic wooden fence and a small farmhouse visible in the distance, warm golden afternoon sunlight streaming from the upper left with soft long shadows across the field, bees hovering between the flower heads, fine dew drops on the petals, vibrant yellow and green palette with blue sky accents, wide landscape composition with a low horizon line, shallow depth of field keeping the foreground blooms razor sharp, photorealistic photography style with high dynamic range, rows of flowers receding into the distance, scattered white clouds drifting across the sky, butterflies resting on the tallest blooms, the warm glow of late afternoon on every petal, a dirt path winding between the rows, soft atmospheric haze near the horizon, no text.";
  const plan = validateImagePromptPlan({
    prompt,
    negative: "text, logos",
    aspect: "16:9",
    style: "Photorealistic",
    assumptions: "Saya menafsirkan ladang sebagai hamparan bunga matahari.",
  }, "gambar bunga matahari di ladang");
  assert.equal(plan.prompt, prompt);
  assert.match(plan.prompt, /sunflowers/i);
  assert.equal(plan.aspect, "16:9");
});

test("validation accepts a detailed plan for a known scene that keeps its anchors", () => {
  const prompt = "A fluffy orange tabby cat with bright green eyes sitting upright on a wooden windowsill, soft raindrops streaking down the window glass behind it, a cozy warm interior with a knitted blanket and a steaming cup visible in the foreground, cool blue rainy daylight filtering through the glass and contrasting with the warm amber indoor light, the cat's fur rendered strand by strand with detailed whiskers and a gently curled tail, intimate close composition with shallow depth of field, soft storybook illustration style with gentle shading, no text.";
  const plan = validateImagePromptPlan({
    prompt,
    negative: "",
    aspect: "1:1",
    style: "Storybook illustration",
    assumptions: "Saya mempertahankan kucing sebagai subjek utama.",
  }, "kucing");
  assert.equal(plan.prompt, prompt);
  assert.match(plan.prompt, /tabby cat/i);
});

test("validation rejects plans shorter than the deterministic fallback", () => {
  const plan = validateImagePromptPlan({
    prompt: "A cat.",
    negative: "",
    aspect: "1:1",
    style: "minimal",
    assumptions: "",
  }, "kucing");
  assert.match(plan.prompt, /clearly visible cat/i);
  assert.ok(plan.prompt.length > 150);
});
