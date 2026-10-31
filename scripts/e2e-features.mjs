import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { exportAssistantDocument } from "../js/documents.js";
import { compressImageFile } from "../js/image-compression.js";
import { MyAIFileToolsEngine } from "../js/file-tools-engine.js";
import { parseStructuredResponse } from "../js/response-handler.js";
import { resetProviderCircuits, runProviderFallbacks } from "../js/task-routing.js";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const XLSX = require("xlsx-js-style");
const { PNG } = require("pngjs");
const { PDFDocument } = require("pdf-lib");
const mammothModule = await import("mammoth");
const mammoth = mammothModule.default || mammothModule;
const mammothBrowserAdapter = {
  ...mammoth,
  extractRawText: ({ arrayBuffer }) => mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }),
  convertToHtml: ({ arrayBuffer }) => mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) }),
};
const modules = new Map([
  ["docx", import("docx")],
  ["xlsx-js-style", import("xlsx-js-style")],
  ["pdf-lib", import("pdf-lib")],
  ["jszip", import("jszip")],
  ["pptxgenjs", import("pptxgenjs")],
  ["mammoth", Promise.resolve({ default: mammothBrowserAdapter })],
  ["jspdf", import("jspdf")],
  ["jspdf-autotable", import("jspdf-autotable")],
  ["xlsx", import("xlsx-js-style")],
]);
const libraryLoader = (name) => modules.get(name) || Promise.reject(new Error(`Harness library not registered: ${name}`));
const engine = new MyAIFileToolsEngine({ libraryLoader });
const results = [];

async function feature(id, label, run) {
  try {
    await run();
    results.push({ id, label, status: "LULUS" });
    console.log(`PASS ${id} ${label}`);
  } catch (error) {
    results.push({ id, label, status: "GAGAL" });
    console.error(`FAIL ${id} ${label}: ${error.stack || error.message}`);
  }
}

function fixturePNG(width = 256, height = 256) {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (width * y + x) << 2;
      image.data[offset] = (x * 13 + y * 3) % 256;
      image.data[offset + 1] = (x * 5 + y * 17) % 256;
      image.data[offset + 2] = (x * 7 + y * 11) % 256;
      image.data[offset + 3] = x < 32 ? 0 : 255;
    }
  }
  return image;
}

async function readZip(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

const generatedDocx = await exportAssistantDocument({
  title: "Rencana Uji MyAI",
  content: "# Rencana Uji MyAI\n\nDokumen ini memuat tujuan dan hasil.\n\n## Tujuan\n\nValidasi ekspor DOCX.",
}, "docx", { download: false, libraryLoader });

await feature("F1", "DOCX nyata dapat dibuka dan berisi judul serta isi", async () => {
  const zip = await readZip(generatedDocx.blob);
  const xml = await zip.file("word/document.xml")?.async("string");
  assert.ok(xml?.includes("Rencana Uji MyAI"));
  assert.ok(xml.includes("Validasi ekspor DOCX."));
  assert.equal(Object.keys(zip.files).some((name) => /vbaProject|\.bin$/i.test(name)), false);
});

await feature("F2", "XLSX nyata dapat dibuka dan berisi tabel sesuai skema", async () => {
  const generated = await exportAssistantDocument({
    title: "Anggaran",
    content: "# Anggaran",
    sheetName: "Anggaran",
    structuredTable: { headers: ["Item", "Jumlah"], rows: [["Lisensi", 3], ["Total", { formula: "SUM(B2:B2)" }]] },
  }, "xlsx", { download: false, libraryLoader });
  const workbook = XLSX.read(await generated.blob.arrayBuffer(), { type: "array" });
  assert.deepEqual(workbook.SheetNames, ["Anggaran"]);
  assert.equal(workbook.Sheets.Anggaran.A2.v, "Lisensi");
  assert.equal(workbook.Sheets.Anggaran.B2.v, 3);
  assert.equal(workbook.Sheets.Anggaran.B3.f, "SUM(B2:B2)");
});

await feature("F3", "PPTX modern-gold dua slide valid untuk impor manual ke Canva", async () => {
  const generated = await exportAssistantDocument({
    title: "Strategi Produk",
    content: "# Strategi Produk\n\nRencana validasi dan pertumbuhan produk.",
    structuredSlides: [
      { slide_number: 1, title: "Konteks", content: ["Pasar berkembang", "Peluang terukur"], notes: "Catatan pembicara" },
      { slide_number: 2, title: "Kesimpulan", content: ["Mulai dari uji coba"], notes: "" },
    ],
    requestedSlideCount: 2,
    theme: "modern-gold",
  }, "pptx", { download: false, libraryLoader });
  const zip = await readZip(generated.blob);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideFiles.length, 2);
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("ppt/presentation.xml"));
  const slideContents = await Promise.all(slideFiles.map((name) => zip.file(name).async("string")));
  assert.ok(slideContents.some((xml) => xml.includes("Konteks")));
  assert.ok(slideContents.some((xml) => xml.includes("Kesimpulan")));
  assert.ok(slideContents.some((xml) => /C28A32/i.test(xml)));
  const singleSlide = await exportAssistantDocument({
    title: "Rencana Singkat",
    content: "# Rencana Singkat\n\nRangkuman tujuan.",
    structuredSlides: [{ slide_number: 1, title: "Tujuan", content: ["Menguji gagasan"], notes: "" }],
    requestedSlideCount: 2,
    theme: "modern-gold",
  }, "pptx", { download: false, libraryLoader });
  const singleSlideZip = await readZip(singleSlide.blob);
  assert.equal(Object.keys(singleSlideZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
});

await feature("F4", "gambar valid dari fixture lokal (MOCK; tanpa panggilan provider)", async () => {
  const png = fixturePNG(16, 16);
  const bytes = PNG.sync.write(png);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const decoded = PNG.sync.read(bytes);
  assert.ok(decoded.width > 0 && decoded.height > 0);
  console.log("INFO F4 provider live tidak dipanggil; pengujian fixture berlabel MOCK.");
});

await feature("F5", "PNG diperkecil, dapat didekode, dan mempertahankan alpha", async () => {
  const sourceBytes = PNG.sync.write(fixturePNG(), { deflateLevel: 0 });
  const source = new File([sourceBytes], "fixture.png", { type: "image/png" });
  const codec = {
    decode: async (file) => PNG.sync.read(Buffer.from(await file.arrayBuffer())),
    encode: async (image) => new Blob([PNG.sync.write(image, { deflateLevel: 9 })], { type: "image/png" }),
  };
  const result = await compressImageFile(source, {
    maxWidthOrHeight: 256,
    outputType: "image/png",
    codec,
  });
  const decoded = PNG.sync.read(Buffer.from(await result.file.arrayBuffer()));
  assert.ok(result.compressedSize < result.originalSize);
  assert.equal(decoded.width, 256);
  assert.equal(decoded.height, 256);
  assert.equal(decoded.data[3], 0);
  assert.equal(decoded.data[(40 * 256 + 40) * 4 + 3], 255);
  console.log(`INFO F5 ${result.originalSize} B -> ${result.compressedSize} B (PNGJS codec adapter).`);
});

await feature("F6", "PDF diperkecil dan tetap valid setelah dibuka ulang", async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 200]);
  const pdfBytes = await document.save();
  const padded = Buffer.concat([Buffer.from(pdfBytes), Buffer.from(`\n% ${"padding ".repeat(800)}\n`)]);
  const source = new File([padded], "source.pdf", { type: "application/pdf" });
  const result = await engine.execute("compress_pdf", [source]);
  assert.ok(result.outputSize < result.sourceSize);
  const reopened = await PDFDocument.load(await result.file.arrayBuffer());
  assert.equal(reopened.getPageCount(), 1);
  console.log(`INFO F6 ${result.sourceSize} B -> ${result.outputSize} B.`);
});

await feature("F7", "Word ke PDF dan Excel menghasilkan outline untuk Canva Connect", async () => {
  const word = await engine.execute("word_to_pdf", [new File([generatedDocx.blob], "source.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })]);
  const pdf = await PDFDocument.load(await word.file.arrayBuffer());
  assert.equal(pdf.getPageCount(), 1);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Produk", "Unit"], ["Kursi", "12"]]), "Ringkas");
  const xlsx = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const presentation = await engine.execute("excel_to_ppt", [new File([xlsx], "source.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })]);
  assert.equal(presentation.presentationOutline.title, "source");
  assert.equal(presentation.presentationOutline.slides.length, 1);
  assert.match(presentation.presentationOutline.slides[0].content.join("\n"), /Produk: Kursi/);
  await assert.rejects(engine.execute("pdf_to_odt", [new File(["x"], "unsupported.pdf", { type: "application/pdf" })]), /tidak didukung/);
});

await feature("F8", "fallback berpindah provider setelah skema gagal dan lolos validasi", async () => {
  resetProviderCircuits();
  const invalid = '{"type":"doc","assigned_model":"groq-fast","summary":"","data":{"title":"valid","content_markdown":"isi"}}';
  const validDoc = '{"type":"doc","assigned_model":"groq-fast","summary":"Dokumen siap","data":{"title":"Rencana","content_markdown":"Isi valid."}}';
  const validFallback = '{"type":"text","assigned_model":"groq-fast","summary":"Jawaban cadangan","data":{"reply_markdown":"fallback"}}';
  const runWithOneRepair = async (candidate, attempted, repairSucceeds) => {
    attempted.push(candidate.id);
    try {
      return parseStructuredResponse(invalid);
    } catch (error) {
      attempted.push(`${candidate.id}:repair`);
      const repaired = parseStructuredResponse(repairSucceeds ? validDoc : invalid);
      if (!repaired) throw new Error(`JSON tetap tidak valid setelah satu perbaikan: ${error.message}`);
      return repaired;
    }
  };

  const repairedAttempts = [];
  const repairedPrimary = await runProviderFallbacks([
    { provider: "groq", id: "groq-primary" },
    { provider: "nvidia", id: "nvidia-fallback" },
  ], async (candidate) => runWithOneRepair(candidate, repairedAttempts, true));
  assert.equal(repairedPrimary.provider, "groq");
  assert.deepEqual(repairedAttempts, ["groq-primary", "groq-primary:repair"]);

  resetProviderCircuits();
  const fallbackAttempts = [];
  const selectedFallback = await runProviderFallbacks([
    { provider: "groq", id: "groq-primary" },
    { provider: "nvidia", id: "nvidia-fallback" },
  ], async (candidate) => {
    if (candidate.provider === "groq") return runWithOneRepair(candidate, fallbackAttempts, false);
    fallbackAttempts.push(candidate.id);
    assert.ok(parseStructuredResponse(validFallback));
  });
  assert.equal(selectedFallback.provider, "nvidia");
  assert.deepEqual(fallbackAttempts, ["groq-primary", "groq-primary:repair", "nvidia-fallback"]);
});

const failures = results.filter((result) => result.status !== "LULUS");
console.log(`\nRingkasan: ${results.length - failures.length}/${results.length} fitur lulus; ${failures.length} gagal.`);
if (failures.length) process.exitCode = 1;
