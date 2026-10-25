import assert from "node:assert/strict";
import test from "node:test";
import { compressImageFile } from "./image-compression.js";

function pngBytes(size) {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return bytes;
}

function mockCanvasEnvironment({ width = 4000, height = 2000, outputSize = 1000 } = {}) {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFile = globalThis.File;
  let bitmapClosed = false;
  let canvas;
  let canvasOptions;
  globalThis.createImageBitmap = async () => ({
    width,
    height,
    close() { bitmapClosed = true; },
  });
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      canvas = {
        width: 0,
        height: 0,
        getContext(type, options) {
          assert.equal(type, "2d");
          canvasOptions = options;
          return {
            fillRect() {},
            drawImage(_bitmap, _x, _y, targetWidth, targetHeight) {
              canvas.drawnWidth = targetWidth;
              canvas.drawnHeight = targetHeight;
            },
          };
        },
        toBlob(callback, type, quality) {
          canvas.outputType = type;
          canvas.quality = quality;
          callback(new Blob([new Uint8Array(outputSize)], { type }));
        },
      };
      return canvas;
    },
  };
  return {
    get bitmapClosed() { return bitmapClosed; },
    get canvas() { return canvas; },
    get canvasOptions() { return canvasOptions; },
    restore() {
      globalThis.document = originalDocument;
      globalThis.createImageBitmap = originalCreateImageBitmap;
      globalThis.File = originalFile;
    },
  };
}

test("compresses and resizes in browser canvas, returns a File and accurate size statistics", async () => {
  const environment = mockCanvasEnvironment();
  try {
    const input = new File([pngBytes(5000)], "photo.png", { type: "image/png" });
    const result = await compressImageFile(input, {
      quality: 0.65,
      maxWidthOrHeight: 1000,
      outputType: "image/webp",
    });
    assert.ok(result.file instanceof File);
    assert.equal(result.file.name, "photo-compressed.webp");
    assert.equal(result.file.type, "image/webp");
    assert.equal(result.width, 1000);
    assert.equal(result.height, 500);
    assert.equal(result.originalSize, input.size);
    assert.equal(result.compressedSize, 1000);
    assert.equal(result.savedPercent, 80);
    assert.equal(environment.canvas.quality, 0.65);
    assert.equal(environment.canvas.width, 0);
    assert.equal(environment.canvas.height, 0);
    assert.equal(environment.bitmapClosed, true);
  } finally {
    environment.restore();
  }
});

test("uses a white background for JPEG output to preserve transparent-image appearance", async () => {
  const environment = mockCanvasEnvironment({ width: 20, height: 10 });
  try {
    const input = new File([pngBytes(8)], "transparent.png", { type: "image/png" });
    await compressImageFile(input, { outputType: "image/jpeg", quality: 0.8 });
    assert.deepEqual(environment.canvasOptions, { alpha: false });
    assert.equal(environment.canvas.outputType, "image/jpeg");
    assert.equal(environment.canvas.quality, 0.8);
  } finally {
    environment.restore();
  }
});

test("rejects unsupported files and invalid compression options", async () => {
  const textFile = new File(["not an image"], "note.txt", { type: "text/plain" });
  await assert.rejects(compressImageFile(textFile), /Pilih gambar/);
  const image = new File([pngBytes(8)], "image.png", { type: "image/png" });
  await assert.rejects(compressImageFile(image, { quality: 0.05 }), /Kualitas/);
  await assert.rejects(compressImageFile(image, { maxWidthOrHeight: 0 }), /Dimensi maksimum/);
  await assert.rejects(compressImageFile(image, { outputType: "image/gif" }), /Format keluaran/);
});
