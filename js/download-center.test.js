import assert from "node:assert/strict";
import test from "node:test";
import {
  detectRecommendedPlatform,
  DOWNLOAD_PLATFORMS,
  listDownloadPlatforms,
} from "./download-center.js";

test("download center lists exactly three platforms: Mobile, Desktop, Web App", () => {
  const platforms = listDownloadPlatforms();
  assert.equal(platforms.length, 3);
  assert.deepEqual(platforms.map((platform) => platform.id), ["mobile", "desktop", "web"]);
  assert.equal(platforms[0].label, "Mobile");
  assert.equal(platforms[1].label, "Desktop");
  assert.equal(platforms[2].label, "Web App");
});

test("each platform offers individual downloads and a per-platform ZIP bundle", () => {
  for (const platform of DOWNLOAD_PLATFORMS) {
    assert.ok(platform.formats.length >= 2);
    assert.ok(platform.formats.every((format) => typeof format.id === "string" && typeof format.label === "string"));
    if (platform.id !== "web") {
      assert.ok(platform.formats.some((format) => /zip/i.test(format.id)));
    }
  }
});

test("installers are placeholders while the Web App is live", () => {
  assert.equal(DOWNLOAD_PLATFORMS.find((platform) => platform.id === "mobile").status, "soon");
  assert.equal(DOWNLOAD_PLATFORMS.find((platform) => platform.id === "desktop").status, "soon");
  assert.equal(DOWNLOAD_PLATFORMS.find((platform) => platform.id === "web").status, "live");
});

test("device detection recommends Mobile for phones and Desktop for computers", () => {
  assert.equal(detectRecommendedPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"), "mobile");
  assert.equal(detectRecommendedPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"), "mobile");
  assert.equal(detectRecommendedPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"), "desktop");
  assert.equal(detectRecommendedPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"), "desktop");
  assert.equal(detectRecommendedPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"), "desktop");
  assert.equal(detectRecommendedPlatform(""), "web");
});
