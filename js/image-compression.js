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

async function hasSupportedSignature(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (...signature) => signature.every((byte, index) => bytes[index] === byte);
  switch (file.type) {
    case "image/png": return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg": return startsWith(0xff, 0xd8, 0xff);
    case "image/webp": return startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    case "image/gif": return ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)));
    case "image/bmp": return startsWith(0x42, 0x4d);
    case "image/avif": return String.fromCharCode(...bytes.slice(4, 12)).includes("ftypavif");
    default: return false;
  }
}

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
  if (!await hasSupportedSignature(file)) throw new Error("Header gambar tidak valid atau tidak cocok dengan tipe file.");
  const { quality, maxWidthOrHeight, outputType } = validateOptions(options);
  let bitmap;
  let canvas;
  try {
    const codec = options.codec;
    bitmap = codec ? await codec.decode(file) : await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) throw new Error("Dimensi gambar tidak valid.");
    const pixelScale = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / (bitmap.width * bitmap.height)));
    const dimensionScale = Math.min(1, maxWidthOrHeight / Math.max(bitmap.width, bitmap.height));
    const scale = Math.min(pixelScale, dimensionScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let blob;
    if (codec) {
      if ((width !== bitmap.width || height !== bitmap.height) && !codec.resize) {
        throw new Error("Codec pengujian tidak mendukung perubahan dimensi.");
      }
      const pixels = width === bitmap.width && height === bitmap.height
        ? bitmap
        : await codec.resize(bitmap, width, height);
      blob = await codec.encode(pixels, { width, height, type: outputType, quality });
    } else {
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
      blob = await canvasBlob(canvas, outputType, quality);
    }
    if (!(blob instanceof Blob) || blob.type !== outputType) {
      throw new Error(`Browser gagal menghasilkan gambar ${outputType}.`);
    }
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
    if (typeof bitmap?.close === "function") bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
