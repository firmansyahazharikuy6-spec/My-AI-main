const SUPPORTED_INPUT_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const OUTPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 16_000_000;

function validateOptions(options = {}) {
  const quality = options.quality ?? 0.7;
  const maxWidthOrHeight = options.maxWidthOrHeight ?? 1920;
  const outputType = options.outputType ?? options.outputFormat ?? "image/webp";
  if (!Number.isFinite(quality) || quality < 0.1 || quality > 1) {
    throw new Error("Kualitas harus di antara 0,1 dan 1.");
  }
  if (!Number.isInteger(maxWidthOrHeight) || maxWidthOrHeight < 1 || maxWidthOrHeight > 8192) {
    throw new Error("Dimensi maksimum harus berupa bilangan bulat antara 1 dan 8192 piksel.");
  }
  if (!OUTPUT_TYPES.has(outputType)) {
    throw new Error("Format keluaran harus JPEG, PNG, atau WebP.");
  }
  return { quality, maxWidthOrHeight, outputType };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Browser gagal membuat gambar hasil kompresi."));
      else if (blob.type !== type) reject(new Error(`Browser tidak mendukung format ${type}.`));
      else resolve(blob);
    }, type, type === "image/png" ? undefined : quality);
  });
}

export async function compressImageFile(file, options = {}) {
  if (!(file instanceof Blob) || !SUPPORTED_INPUT_TYPES.has(file.type)) {
    throw new Error("Pilih gambar JPEG, PNG, WebP, GIF, BMP, atau AVIF yang didukung browser.");
  }
  if (!file.size || file.size > MAX_FILE_BYTES) {
    throw new Error("Ukuran gambar harus lebih dari 0 dan maksimal 50 MB.");
  }
  const { quality, maxWidthOrHeight, outputType } = validateOptions(options);
  let bitmap;
  let canvas;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) throw new Error("Dimensi gambar tidak valid.");
    const pixelScale = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / (bitmap.width * bitmap.height)));
    const dimensionScale = Math.min(1, maxWidthOrHeight / Math.max(bitmap.width, bitmap.height));
    const scale = Math.min(pixelScale, dimensionScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: outputType !== "image/jpeg" });
    if (!context) throw new Error("Canvas tidak tersedia di browser ini.");
    if (outputType === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasBlob(canvas, outputType, quality);
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    const originalName = file.name || "image";
    const outputName = `${originalName.replace(/\.[^.]*$/, "")}-compressed${extensions[outputType]}`;
    const compressedFile = new File([blob], outputName, { type: outputType, lastModified: Date.now() });
    const savedBytes = Math.max(0, file.size - compressedFile.size);
    return {
      file: compressedFile,
      originalSize: file.size,
      compressedSize: compressedFile.size,
      savedPercent: file.size ? Math.max(0, (savedBytes / file.size) * 100) : 0,
      width,
      height,
    };
  } catch (error) {
    if (error instanceof Error && /format|ukuran|dimensi|Canvas|browser|gambar/i.test(error.message)) throw error;
    throw new Error(`Gambar gagal diproses: ${error instanceof Error ? error.message : "format gambar tidak didukung."}`);
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
