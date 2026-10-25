const LIBRARIES = {
  pdfLib: "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm",
  pdfJs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs",
  pdfJsWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs",
  jsPdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm",
  jsPdfAutoTable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/+esm",
  mammoth: "https://esm.sh/mammoth@1.9.0",
  xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm",
  docx: "https://cdn.jsdelivr.net/npm/docx@9.5.1/+esm",
  jsZip: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm",
  pptxGen: "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/+esm",
};
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 30;
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;
const PDF_MIME = "application/pdf";

function extension(file) {
  return String(file.name || "").split(".").pop().toLowerCase();
}

async function validateFileSignature(file, kind) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (...signature) => signature.every((byte, index) => bytes[index] === byte);
  const ext = extension(file);
  const valid = kind === "pdf"
    ? ext === "pdf" && startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)
    : kind === "office"
      ? ["docx", "xlsx"].includes(ext) && startsWith(0x50, 0x4b, 0x03, 0x04)
      : kind === "excel"
        ? ext === "xlsx" ? startsWith(0x50, 0x4b, 0x03, 0x04)
          : ext === "xls" ? startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
            : ext === "csv" && !bytes.includes(0)
        : kind === "image"
          ? ext === "png" ? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
            : ["jpg", "jpeg"].includes(ext) ? startsWith(0xff, 0xd8, 0xff)
              : ext === "webp" ? startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
                : ext === "gif" ? ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))
                  : ext === "bmp" && startsWith(0x42, 0x4d)
          : false;
  if (!valid) throw new Error(`${file.name || "File"} tidak cocok dengan format yang didukung atau header file tidak valid.`);
}

async function validateOfficeArchive(file, libraryLoader) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minEocd; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50
      && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file.name} bukan arsip Office yang valid.`);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > 10_000 || centralOffset + centralSize > eocd || entryCount === 0xffff
    || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("Arsip Office terlalu besar atau memiliki struktur ZIP64 yang tidak didukung.");
  }
  let cursor = centralOffset;
  let expandedSize = 0;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > centralOffset + centralSize || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("Struktur arsip Office tidak valid.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (cursor + recordLength > centralOffset + centralSize || flags & 1
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("Arsip Office terenkripsi atau rusak dan tidak dapat diproses.");
    }
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (/(?:^|\/)vbaproject\.bin$/i.test(name) || /\.(?:docm|xlsm|pptm)$/i.test(name)) {
      throw new Error("Dokumen bermakro ditolak. Unggah format non-makro .docx atau .xlsx.");
    }
    expandedSize += uncompressedSize;
    if (expandedSize > 250 * 1024 * 1024
      || (uncompressedSize > 1024 * 1024 && (compressedSize === 0 || uncompressedSize / compressedSize > 250))) {
      throw new Error("Arsip Office melebihi batas ekspansi aman dan ditolak.");
    }
    cursor += recordLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error("Directory arsip Office tidak konsisten.");
  const JSZip = await loadZip(libraryLoader);
  await JSZip.loadAsync(bytes, { checkCRC32: false });
}

function validateFiles(files, { multiple = false, maxFiles = MAX_FILES, allowEmpty = false } = {}) {
  if (!Array.isArray(files) || !files.length || files.length > maxFiles) {
    throw new Error(`Pilih ${multiple ? `1–${maxFiles} file` : "satu file"} yang akan diproses.`);
  }
  if (!multiple && files.length !== 1) throw new Error("Operasi ini hanya menerima satu file.");
  for (const file of files) {
    if (!(file instanceof Blob) || (!allowEmpty && !file.size) || file.size > MAX_FILE_SIZE) {
      throw new Error(`${file?.name || "File"} kosong atau melebihi batas 100 MB.`);
    }
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) {
    throw new Error("Total ukuran file untuk satu operasi tidak boleh melebihi 200 MB.");
  }
}

function outputFile(blob, name, sourceSize) {
  return {
    file: new File([blob], name, { type: blob.type || "application/octet-stream", lastModified: Date.now() }),
    sourceSize,
    outputSize: blob.size,
  };
}

function safeBaseName(name) {
  return (name || "myai-file").replace(/\.[^.]*$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "myai-file";
}

function importedDefault(module) {
  return module.default || module;
}

async function loadPdfLib(libraryLoader) {
  return importedDefault(await (libraryLoader
    ? libraryLoader("pdf-lib", LIBRARIES.pdfLib)
    : import(LIBRARIES.pdfLib)));
}

async function loadJsPdf(libraryLoader) {
  const module = await (libraryLoader
    ? libraryLoader("jspdf", LIBRARIES.jsPdf)
    : import(LIBRARIES.jsPdf));
  return module.jsPDF || module.default?.jsPDF || module.default;
}

async function loadPdfJs(libraryLoader) {
  const pdfjs = await (libraryLoader
    ? libraryLoader("pdfjs-dist", LIBRARIES.pdfJs)
    : import(LIBRARIES.pdfJs));
  pdfjs.GlobalWorkerOptions.workerSrc = LIBRARIES.pdfJsWorker;
  return pdfjs;
}

async function loadZip(libraryLoader) {
  return importedDefault(await (libraryLoader
    ? libraryLoader("jszip", LIBRARIES.jsZip)
    : import(LIBRARIES.jsZip)));
}

function imageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name}: gagal membaca gambar.`));
    reader.readAsDataURL(file);
  });
}

function imageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (!width || !height || width * height > 32_000_000 || Math.max(width, height) > 12_000) {
        reject(new Error("Resolusi gambar terlalu besar untuk diproses dengan aman (maksimal 32 megapiksel)."));
        image.src = "";
        return;
      }
      resolve({ width, height });
      image.src = "";
    };
    image.onerror = () => reject(new Error("Gambar tidak valid atau tidak didukung."));
    image.src = dataUrl;
  });
}

function parsePageRanges(value, pageCount) {
  const ranges = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!ranges.length || ranges.length > 100) throw new Error("Masukkan rentang halaman, misalnya 1-3,5.");
  return ranges.map((range) => {
    const match = range.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Rentang halaman tidak valid: ${range}.`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > pageCount || end - start > 499) {
      throw new Error(`Rentang ${range} di luar jumlah halaman PDF (${pageCount}) atau terlalu besar.`);
    }
    return { start, end };
  });
}

export class MyAIFileToolsEngine {
  constructor({ libraryLoader } = {}) {
    this.libraryLoader = libraryLoader;
  }

  async loadLibrary(name, url) {
    return this.libraryLoader ? this.libraryLoader(name, url) : import(url);
  }

  async execute(operation, files, options = {}) {
    const multiple = ["merge_pdf", "image_to_pdf", "zip_files"].includes(operation);
    validateFiles(files, {
      multiple,
      maxFiles: operation === "zip_files" ? 500 : MAX_FILES,
      allowEmpty: operation === "zip_files",
    });
    const onProgress = options.onProgress;
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const startedAt = Date.now();
    const checkAbort = () => {
      if (options.signal?.aborted) throw new DOMException("Pemrosesan dibatalkan.", "AbortError");
    };
    const report = (value, label) => {
      checkAbort();
      const remainingSeconds = value > 0 && value < 100
        ? Math.max(0, Math.ceil(((Date.now() - startedAt) / value) * (100 - value) / 1000))
        : 0;
      onProgress?.({ value: Math.min(100, Math.max(0, Math.round(value))), label, remainingSeconds });
    };
    try {
      checkAbort();
      let result;
      switch (operation) {
        case "word_to_pdf": result = await this.convertWordToPdf(files[0], report); break;
        case "pdf_to_word": result = await this.convertPdfToWord(files[0], report); break;
        case "excel_to_pdf": result = await this.convertExcelToPdf(files[0], report); break;
        case "pdf_to_images": result = await this.convertPdfToImages(files[0], report, options.targetFormat); break;
        case "merge_pdf": result = await this.mergePdfFiles(files, report); break;
        case "split_pdf": result = await this.splitPdfFile(files[0], options.pageRanges, report); break;
        case "compress_pdf": result = await this.compressPdfFile(files[0], report); break;
        case "image_to_pdf": result = await this.convertImagesToPdf(files, report); break;
        case "zip_files": result = await this.zipFiles(files, report); break;
        case "word_to_excel": result = await this.convertWordToExcel(files[0], report); break;
        case "excel_to_ppt": result = await this.convertExcelToPowerPoint(files[0], report); break;
        default: throw new Error("Operasi file tidak didukung.");
      }
      checkAbort();
      report(100, "Selesai");
      return { ...result, sourceSize: result.sourceSize ?? totalSize };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan saat memproses file.";
      throw new Error(message);
    }
  }

  async convertWordToPdf(file, onProgress) {
    if (extension(file) !== "docx") throw new Error("Pilih dokumen Word .docx.");
    await validateFileSignature(file, "office");
    await validateOfficeArchive(file, this.libraryLoader);
    onProgress(8, "Membaca dokumen Word");
    const mammothModule = importedDefault(await this.loadLibrary("mammoth", LIBRARIES.mammoth));
    const mammoth = mammothModule.default || mammothModule;
    const converted = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (!converted.value.trim()) throw new Error("Dokumen Word tidak berisi teks yang dapat dikonversi.");
    onProgress(48, "Menyusun PDF");
    const JsPDF = await loadJsPdf(this.libraryLoader);
    const pdf = new JsPDF({ unit: "mm", format: "a4" });
    const margin = 18;
    const maxWidth = 210 - margin * 2;
    let y = 18;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    for (const paragraph of converted.value.split(/\n{1,}/).map((line) => line.trim()).filter(Boolean)) {
      const lines = pdf.splitTextToSize(paragraph, maxWidth);
      const blockHeight = lines.length * 5.2 + 3;
      if (y + blockHeight > 278) {
        pdf.addPage();
        y = 18;
      }
      pdf.text(lines, margin, y);
      y += blockHeight;
    }
    onProgress(90, "Membuat file PDF");
    return outputFile(pdf.output("blob"), `${safeBaseName(file.name)}.pdf`, file.size);
  }

  async convertPdfToWord(file, onProgress) {
    if (extension(file) !== "pdf" && file.type !== PDF_MIME) throw new Error("Pilih file PDF.");
    await validateFileSignature(file, "pdf");
    onProgress(5, "Membuka PDF");
    const pdfjs = await loadPdfJs(this.libraryLoader);
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 500) {
      await loadingTask.destroy();
      throw new Error("Ekspor PDF ke Word dibatasi hingga 500 halaman.");
    }
    const paragraphs = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        paragraphs.push(`Halaman ${pageNumber}`);
        const content = await page.getTextContent();
        paragraphs.push(...content.items.map((item) => item.str?.trim()).filter(Boolean));
        page.cleanup();
        onProgress(5 + (pageNumber / pdf.numPages) * 65, `Mengekstrak halaman ${pageNumber} dari ${pdf.numPages}`);
      }
    } finally {
      await loadingTask.destroy();
    }
    if (!paragraphs.some((text) => !/^Halaman \d+$/.test(text))) {
      throw new Error("Tidak ditemukan teks di PDF. PDF hasil scan memerlukan OCR dan tidak dapat dikonversi ke Word dengan modul ini.");
    }
    const docxModule = await this.loadLibrary("docx", LIBRARIES.docx);
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docxModule;
    const children = paragraphs.map((text) => /^Halaman \d+$/.test(text)
      ? new Paragraph({ text, heading: HeadingLevel.HEADING_2, pageBreakBefore: text !== "Halaman 1" })
      : new Paragraph({ children: [new TextRun(text)] }));
    const doc = new Document({ sections: [{ children }] });
    onProgress(85, "Menyusun dokumen Word");
    return outputFile(await Packer.toBlob(doc), `${safeBaseName(file.name)}.docx`, file.size);
  }

  async convertExcelToPdf(file, onProgress) {
    if (!["xlsx", "xls", "csv"].includes(extension(file))) throw new Error("Pilih file Excel .xlsx, .xls, atau .csv.");
    await validateFileSignature(file, "excel");
    if (extension(file) === "xlsx") await validateOfficeArchive(file, this.libraryLoader);
    onProgress(10, "Membaca lembar kerja");
    const module = await this.loadLibrary("xlsx", LIBRARIES.xlsx);
    const XLSX = module.read ? module : module.default;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const JsPDF = await loadJsPdf(this.libraryLoader);
    const tableModule = await this.loadLibrary("jspdf-autotable", LIBRARIES.jsPdfAutoTable);
    const applyPlugin = tableModule.applyPlugin || tableModule.default?.applyPlugin;
    if (typeof applyPlugin !== "function") throw new Error("Modul tabel PDF tidak tersedia.");
    applyPlugin(JsPDF);
    const pdf = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const sheetNames = workbook.SheetNames.slice(0, 30);
    for (let index = 0; index < sheetNames.length; index++) {
      const sheetName = sheetNames[index];
      const sheet = workbook.Sheets[sheetName];
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
      range.e.r = Math.min(range.e.r, range.s.r + 2000);
      range.e.c = Math.min(range.e.c, range.s.c + 49);
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false, range }).slice(0, 2001);
      if (!rows.length) continue;
      if (index > 0) pdf.addPage("a4", "landscape");
      pdf.setFontSize(14);
      pdf.text(String(sheetName).slice(0, 100), 14, 14);
      const head = [rows[0].map((cell) => String(cell ?? "").slice(0, 500))];
      const body = rows.slice(1).map((row) => row.map((cell) => String(cell ?? "").slice(0, 2000)));
      pdf.autoTable({ head, body, startY: 20, margin: 12, styles: { fontSize: 8, cellWidth: "wrap" } });
      onProgress(15 + ((index + 1) / sheetNames.length) * 75, `Menyusun lembar ${index + 1} dari ${sheetNames.length}`);
    }
    return outputFile(pdf.output("blob"), `${safeBaseName(file.name)}.pdf`, file.size);
  }

  async zipFiles(files, onProgress) {
    const JSZip = await loadZip(this.libraryLoader);
    const zip = new JSZip();
    const usedPaths = new Set();
    for (const [index, file] of files.entries()) {
      const path = String(file.webkitRelativePath || file.name || `file-${index + 1}`)
        .replace(/\\/g, "/")
        .split("/")
        .filter((part) => part && part !== "." && part !== "..")
        .map((part) => part.replace(/[\u0000-\u001f]/g, "_"))
        .join("/");
      if (!path) throw new Error(`Nama file ke-${index + 1} tidak valid untuk arsip ZIP.`);
      const lastSlash = path.lastIndexOf("/");
      const directory = lastSlash < 0 ? "" : path.slice(0, lastSlash + 1);
      const filename = lastSlash < 0 ? path : path.slice(lastSlash + 1);
      const extensionStart = filename.lastIndexOf(".");
      const stem = extensionStart > 0 ? filename.slice(0, extensionStart) : filename;
      const suffix = extensionStart > 0 ? filename.slice(extensionStart) : "";
      let uniquePath = path;
      for (let duplicate = 2; usedPaths.has(uniquePath.toLocaleLowerCase()); duplicate++) {
        uniquePath = `${directory}${stem} (${duplicate})${suffix}`;
      }
      usedPaths.add(uniquePath.toLocaleLowerCase());
      zip.file(uniquePath, file);
      onProgress(((index + 1) / files.length) * 75, `Menambahkan file ${index + 1} dari ${files.length}`);
    }
    const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      (metadata) => onProgress(75 + metadata.percent * 0.24, "Mengompres arsip ZIP"));
    return outputFile(archive, "myai-arsip.zip", files.reduce((sum, file) => sum + file.size, 0));
  }

  async convertWordToExcel(file, onProgress) {
    if (extension(file) !== "docx") throw new Error("Pilih dokumen Word .docx.");
    await validateFileSignature(file, "office");
    await validateOfficeArchive(file, this.libraryLoader);
    onProgress(8, "Membaca dokumen Word");
    const mammothModule = importedDefault(await this.loadLibrary("mammoth", LIBRARIES.mammoth));
    const mammoth = mammothModule.default || mammothModule;
    const converted = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const document = new DOMParser().parseFromString(converted.value, "text/html");
    const tables = [...document.querySelectorAll("table")];
    const module = await this.loadLibrary("xlsx", LIBRARIES.xlsx);
    const XLSX = module.read ? module : module.default;
    const workbook = XLSX.utils.book_new();
    if (tables.length) {
      tables.forEach((table, index) => {
        const rows = [...table.querySelectorAll("tr")]
          .map((row) => [...row.querySelectorAll("th,td")].map((cell) => cell.textContent.trim()));
        if (rows.some((row) => row.some(Boolean))) {
          const sheet = XLSX.utils.aoa_to_sheet(rows);
          XLSX.utils.book_append_sheet(workbook, sheet, `Tabel ${index + 1}`);
        }
        onProgress(20 + ((index + 1) / tables.length) * 55, `Membaca tabel ${index + 1} dari ${tables.length}`);
      });
    } else {
      const extracted = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const rows = extracted.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!rows.length) throw new Error("Dokumen Word tidak berisi teks atau tabel yang dapat dikonversi.");
      const sheet = XLSX.utils.aoa_to_sheet([["No.", "Konten"], ...rows.map((text, index) => [index + 1, text])]);
      XLSX.utils.book_append_sheet(workbook, sheet, "Konten");
    }
    if (!workbook.SheetNames.length) throw new Error("Tidak ditemukan tabel atau teks yang bisa dimasukkan ke Excel.");
    onProgress(85, "Menyusun file Excel");
    const result = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    return outputFile(new Blob([result], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${safeBaseName(file.name)}.xlsx`, file.size);
  }

  async convertExcelToPowerPoint(file, onProgress) {
    if (!["xlsx", "xls", "csv"].includes(extension(file))) throw new Error("Pilih file Excel .xlsx, .xls, atau .csv.");
    await validateFileSignature(file, "excel");
    if (extension(file) === "xlsx") await validateOfficeArchive(file, this.libraryLoader);
    onProgress(8, "Membaca lembar kerja");
    const xlsxModule = await this.loadLibrary("xlsx", LIBRARIES.xlsx);
    const XLSX = xlsxModule.read ? xlsxModule : xlsxModule.default;
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    if (workbook.SheetNames.length > 30) throw new Error("Konversi dibatasi hingga 30 lembar kerja per presentasi.");
    const sheets = workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, blankrows: false });
      if (rows.some((row) => row.length > 8)) throw new Error(`Lembar "${name}" memiliki lebih dari 8 kolom; rapikan kolom terlebih dahulu agar slide tetap terbaca.`);
      return { name, rows: rows.map((row) => row.map((cell) => String(cell ?? ""))).filter((row) => row.some(Boolean)) };
    }).filter((sheet) => sheet.rows.length);
    if (!sheets.length) throw new Error("Workbook tidak berisi data untuk dibuat menjadi presentasi.");
    const pageCount = sheets.reduce((sum, sheet) => sum + Math.max(1, Math.ceil(Math.max(0, sheet.rows.length - 1) / 10)), 0);
    if (pageCount > 50) throw new Error("Konversi dibatasi hingga 50 slide. Pilih lembar atau baris yang lebih sedikit.");
    const imported = await this.loadLibrary("pptxgenjs", LIBRARIES.pptxGen);
    const PptxGenJS = imported.default || imported;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "MyAI";
    pptx.subject = "Presentasi dibuat dari workbook Excel";
    pptx.title = safeBaseName(file.name);
    pptx.theme = {
      headFontFace: "Aptos Display",
      bodyFontFace: "Aptos",
      lang: "id-ID",
    };
    const colors = { background: "10151D", surface: "1B2532", accent: "62D7C8", text: "F3F6FA", muted: "A9B7C8" };
    let slideNumber = 0;
    for (const sheet of sheets) {
      const [header, ...data] = sheet.rows;
      const pages = Math.max(1, Math.ceil(data.length / 10));
      for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
        const slide = pptx.addSlide();
        slide.background = { color: colors.background };
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.16, h: 7.5, line: { color: colors.accent, transparency: 100 }, fill: { color: colors.accent } });
        slide.addText(sheet.name, { x: 0.62, y: 0.42, w: 10.8, h: 0.5, fontFace: "Aptos Display", fontSize: 27, bold: true, color: colors.text, margin: 0 });
        if (pages > 1) slide.addText(`Bagian ${pageIndex + 1} dari ${pages}`, { x: 10.7, y: 0.55, w: 1.9, h: 0.22, fontSize: 10, color: colors.muted, align: "right", margin: 0 });
        slide.addShape(pptx.ShapeType.line, { x: 0.62, y: 1.12, w: 12.05, h: 0, line: { color: colors.accent, transparency: 35, width: 1.2 } });
        const pageRows = data.slice(pageIndex * 10, (pageIndex + 1) * 10);
        const tableRows = [
          header.map((cell) => ({ text: cell, options: { bold: true, color: colors.background, fill: colors.accent, breakLine: false } })),
          ...pageRows.map((row, rowIndex) => Array.from({ length: header.length }, (_, column) => ({
            text: row[column] || "",
            options: { color: colors.text, fill: rowIndex % 2 ? colors.surface : "222F3D", breakLine: false },
          }))),
        ];
        slide.addTable(tableRows, {
          x: 0.62, y: 1.42, w: 12.05, h: 5.42,
          border: { type: "solid", color: "344456", pt: 0.6 },
          fontFace: "Aptos", fontSize: header.length > 5 ? 10 : 12,
          color: colors.text, margin: 0.08, rowH: 0.43,
          autoFit: false, valign: "mid",
          colW: Array.from({ length: header.length }, () => 12.05 / header.length),
        });
        slide.addText(`MYAI  ·  ${++slideNumber} / ${pageCount}`, { x: 10.7, y: 7.08, w: 1.9, h: 0.18, fontSize: 9, color: colors.muted, align: "right", margin: 0 });
        onProgress(20 + (slideNumber / pageCount) * 60, `Menyusun slide ${slideNumber} dari ${pageCount}`);
      }
    }
    onProgress(88, "Mengekspor presentasi PowerPoint");
    const blob = await pptx.write({ outputType: "blob" });
    return outputFile(blob, `${safeBaseName(file.name)}.pptx`, file.size);
  }

  async convertImagesToPdf(files, onProgress) {
    if (files.some((file) => !["png", "jpg", "jpeg"].includes(extension(file)))) {
      throw new Error("Images to PDF hanya menerima file JPG atau PNG.");
    }
    for (const file of files) await validateFileSignature(file, "image");
    const JsPDF = await loadJsPdf(this.libraryLoader);
    const pdf = new JsPDF({ unit: "pt", format: "a4" });
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const dataUrl = await imageDataUrl(file);
      const dimensions = await imageDimensions(dataUrl);
      if (index) pdf.addPage();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const scale = Math.min((pageWidth - 40) / dimensions.width, (pageHeight - 40) / dimensions.height);
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      pdf.addImage(dataUrl, extension(file) === "png" ? "PNG" : "JPEG", (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
      onProgress(((index + 1) / files.length) * 90, `Memasukkan gambar ${index + 1} dari ${files.length}`);
    }
    return outputFile(pdf.output("blob"), `${safeBaseName(files[0].name)}${files.length > 1 ? "-images" : ""}.pdf`, files.reduce((sum, file) => sum + file.size, 0));
  }

  async convertPdfToImages(file, onProgress, targetFormat = "png") {
    if (extension(file) !== "pdf" && file.type !== PDF_MIME) throw new Error("Pilih file PDF.");
    await validateFileSignature(file, "pdf");
    if (!["png", "jpg"].includes(targetFormat)) throw new Error("Format gambar PDF harus PNG atau JPG.");
    const pdfjs = await loadPdfJs(this.libraryLoader);
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > 100) {
      await loadingTask.destroy();
      throw new Error("Ekspor dibatasi hingga 100 halaman per PDF.");
    }
    const JSZip = await loadZip(this.libraryLoader);
    const zip = new JSZip();
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: Math.min(2, 4096 / Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1])) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("Canvas tidak tersedia untuk merender halaman PDF.");
          await page.render({ canvasContext: context, viewport }).promise;
          const mime = targetFormat === "jpg" ? "image/jpeg" : "image/png";
          const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Gagal membuat gambar halaman PDF.")), mime, targetFormat === "jpg" ? 0.92 : undefined));
          zip.file(`${safeBaseName(file.name)}-page-${String(pageNumber).padStart(3, "0")}.${targetFormat}`, blob);
        } finally {
          page.cleanup();
          canvas.width = 0;
          canvas.height = 0;
        }
        onProgress((pageNumber / pdf.numPages) * 85, `Merender halaman ${pageNumber} dari ${pdf.numPages}`);
      }
    } finally {
      await loadingTask.destroy();
    }
    const archive = await zip.generateAsync({ type: "blob" }, (metadata) => onProgress(85 + metadata.percent * 0.14, "Membuat arsip gambar"));
    return outputFile(archive, `${safeBaseName(file.name)}-images.zip`, file.size);
  }

  async mergePdfFiles(files, onProgress) {
    if (files.some((file) => extension(file) !== "pdf" && file.type !== PDF_MIME)) throw new Error("Pilih beberapa file PDF.");
    for (const file of files) await validateFileSignature(file, "pdf");
    const { PDFDocument } = await loadPdfLib(this.libraryLoader);
    const merged = await PDFDocument.create();
    for (let index = 0; index < files.length; index++) {
      const source = await PDFDocument.load(await files[index].arrayBuffer());
      if (merged.getPageCount() + source.getPageCount() > 5000) {
        throw new Error("PDF gabungan dibatasi hingga 5000 halaman.");
      }
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
      onProgress(((index + 1) / files.length) * 90, `Menggabungkan PDF ${index + 1} dari ${files.length}`);
    }
    return outputFile(new Blob([await merged.save({ useObjectStreams: true })], { type: PDF_MIME }), "myai-merged.pdf", files.reduce((sum, file) => sum + file.size, 0));
  }

  async splitPdfFile(file, pageRanges, onProgress) {
    if (extension(file) !== "pdf" && file.type !== PDF_MIME) throw new Error("Pilih file PDF.");
    await validateFileSignature(file, "pdf");
    const { PDFDocument } = await loadPdfLib(this.libraryLoader);
    const source = await PDFDocument.load(await file.arrayBuffer());
    const ranges = parsePageRanges(pageRanges, source.getPageCount());
    const selectedPageCount = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
    if (selectedPageCount > 5000) throw new Error("Pemisahan dibatasi hingga 5000 halaman keluaran.");
    const JSZip = await loadZip(this.libraryLoader);
    const zip = new JSZip();
    for (let index = 0; index < ranges.length; index++) {
      const { start, end } = ranges[index];
      const document = await PDFDocument.create();
      const pages = await document.copyPages(source, Array.from({ length: end - start + 1 }, (_, offset) => start + offset - 1));
      pages.forEach((page) => document.addPage(page));
      zip.file(`${safeBaseName(file.name)}-pages-${start}-${end}.pdf`, await document.save({ useObjectStreams: true }));
      onProgress(((index + 1) / ranges.length) * 80, `Memisahkan rentang ${index + 1} dari ${ranges.length}`);
    }
    const archive = await zip.generateAsync({ type: "blob" }, (metadata) => onProgress(80 + metadata.percent * 0.19, "Membuat arsip PDF"));
    return outputFile(archive, `${safeBaseName(file.name)}-split.zip`, file.size);
  }

  async compressPdfFile(file, onProgress) {
    if (extension(file) !== "pdf" && file.type !== PDF_MIME) throw new Error("Pilih file PDF.");
    await validateFileSignature(file, "pdf");
    onProgress(10, "Membaca PDF");
    const { PDFDocument } = await loadPdfLib(this.libraryLoader);
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    if (pdf.getPageCount() > 5000) throw new Error("Optimasi PDF dibatasi hingga 5000 halaman.");
    onProgress(70, "Mengoptimalkan struktur PDF");
    const blob = new Blob([await pdf.save({ useObjectStreams: true, objectsPerTick: 50 })], { type: PDF_MIME });
    if (blob.size >= file.size) {
      throw new Error("PDF sudah teroptimasi atau tidak dapat diperkecil tanpa layanan kompresi khusus; file asli tidak diubah.");
    }
    return outputFile(blob, `${safeBaseName(file.name)}-optimized.pdf`, file.size);
  }
}
