function cleanAnswer(content) {
  const text = String(content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trim() : text;
}

function plainText(value) {
  const html = globalThis.marked?.parse ? globalThis.marked.parse(value || "") : String(value || "");
  const safeHtml = globalThis.DOMPurify ? globalThis.DOMPurify.sanitize(html) : html;
  if (!globalThis.document?.createElement) {
    return safeHtml.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
  }
  const container = document.createElement("div");
  container.innerHTML = safeHtml;
  return (container.textContent || "").trim();
}

function blocksFromMarkdown(markdown) {
  const tokens = globalThis.marked?.lexer ? globalThis.marked.lexer(markdown) : [{ type: "paragraph", text: markdown }];
  const blocks = [];
  for (const token of tokens) {
    if (token.type === "heading") {
      blocks.push({ type: "heading", level: token.depth, text: plainText(token.text) });
    } else if (token.type === "paragraph" || token.type === "blockquote") {
      const text = plainText(token.text);
      if (text) blocks.push({ type: token.type, text });
    } else if (token.type === "list") {
      token.items.forEach((item, index) => {
        const text = plainText(item.text);
        if (text) blocks.push({ type: "list", text, ordered: Boolean(token.ordered), index: index + 1 });
      });
    } else if (token.type === "code") {
      if (token.text) blocks.push({ type: "code", text: token.text.trim() });
    } else if (token.type === "table") {
      const headers = token.header.map((cell) => plainText(cell.text));
      const rows = token.rows.map((row) => row.map((cell) => plainText(cell.text)));
      blocks.push({ type: "table", headers, rows });
    }
  }
  return blocks;
}

function safeFilename(title, extension) {
  const base = String(title || "dokumen-myai")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "dokumen-myai";
  return `${base}.${extension}`;
}

function answerTitle(title, blocks) {
  const heading = blocks.find((block) => block.type === "heading");
  return heading?.text || (title && title !== "Chat baru" ? title : "Dokumen MyAI");
}

function withSources(blocks, citations = []) {
  const valid = citations.filter((item) => /^https?:\/\//i.test(item.url));
  if (!valid.length) return blocks;
  return [...blocks, { type: "heading", level: 2, text: "Sumber" }, ...valid.map((item) => ({
    type: "paragraph",
    text: `${item.title || item.url} - ${item.url}`,
  }))];
}

async function exportWord(title, blocks, options = {}) {
  const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } =
    await (options.libraryLoader
      ? options.libraryLoader("docx", "https://cdn.jsdelivr.net/npm/docx@9.5.1/+esm")
      : import("https://cdn.jsdelivr.net/npm/docx@9.5.1/+esm"));
  const children = [new Paragraph({
    children: [new TextRun({ text: title, bold: true, font: "Aptos Display", size: 46, color: "173B36" })],
    spacing: { after: 320 },
    border: { bottom: { color: "4D6BFE", space: 8, size: 16, style: "single" } },
  })];
  const titleHeading = blocks.findIndex((block) => block.type === "heading" && block.text === title);
  for (const [index, block] of blocks.entries()) {
    if (index === titleHeading) continue;
    if (block.type === "heading") {
      const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({
        text: block.text,
        heading,
        keepNext: true,
        spacing: { before: block.level === 1 ? 300 : 200, after: 100 },
        border: block.level === 1
          ? { bottom: { color: "DCE8E3", space: 4, size: 5, style: "single" } }
          : undefined,
      }));
    } else if (block.type === "list") {
      const text = block.ordered ? `${block.index}. ${block.text}` : block.text;
      children.push(new Paragraph({ text, bullet: block.ordered ? undefined : { level: 0 }, spacing: { after: 90 } }));
    } else if (block.type === "table") {
      const columnCount = Math.max(block.headers.length, ...block.rows.map((row) => row.length));
      if (!columnCount) continue;
      const normalizedRows = [block.headers, ...block.rows].map((row) =>
        Array.from({ length: columnCount }, (_, column) => String(row[column] ?? "")));
      const rows = normalizedRows.map((row, rowIndex) => new TableRow({
        tableHeader: rowIndex === 0,
        children: row.map((text) => new TableCell({
          shading: rowIndex === 0 ? { fill: "E7F0EC" } : undefined,
          margins: { top: 90, bottom: 90, start: 120, end: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text, bold: rowIndex === 0, color: rowIndex === 0 ? "173B36" : "26332F" })],
          })],
        })),
      }));
      children.push(new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: Array.from({ length: columnCount }, () => Math.floor(9360 / Math.max(columnCount, 1))),
      }));
    } else if (block.text) {
      const code = block.type === "code";
      children.push(new Paragraph({
        children: [new TextRun({
          text: block.text,
          font: code ? "Cascadia Code" : "Aptos",
          color: block.type === "blockquote" ? "52665F" : "26332F",
        })],
        alignment: AlignmentType.LEFT,
        indent: block.type === "blockquote" ? { left: 360 } : undefined,
        spacing: { after: 160, line: 276 },
      }));
    }
  }
  const blob = await Packer.toBlob(new Document({
    creator: "MyAI",
    title,
    subject: "Dokumen dibuat dari jawaban MyAI",
    styles: { default: { document: { run: { font: "Aptos", size: 22, color: "26332F" } } } },
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children,
    }],
  }));
  const filename = safeFilename(title, "docx");
  if (options.download !== false) saveBlob(blob, filename);
  return { blob, filename };
}

function splitPresentationText(text) {
  const sentences = String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [String(text)];
  const points = [];
  let current = "";
  const append = (part) => {
    const words = part.trim().split(/\s+/);
    let chunk = "";
    for (const word of words) {
      if (chunk && `${chunk} ${word}`.length > 170) {
        points.push(chunk);
        chunk = word;
      } else {
        chunk = chunk ? `${chunk} ${word}` : word;
      }
    }
    if (chunk) points.push(chunk);
  };
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (current && `${current} ${part}`.length > 170) {
      append(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) append(current);
  return points;
}

export function limitPresentationSections(sections, requestedSlideCount, reserveCover = true) {
  if (!Number.isInteger(requestedSlideCount) || requestedSlideCount < 1 || requestedSlideCount > 50) return sections;
  const contentSlideLimit = requestedSlideCount - Number(reserveCover);
  if (contentSlideLimit === 0) return [];
  if (sections.length <= contentSlideLimit) return sections;

  let closingIndex = sections.length - 1;
  for (let index = sections.length - 1; index >= 0; index--) {
    if (/\b(?:kesimpulan|penutup|conclusion|closing|rekomendasi)\b/i.test(sections[index].title)) {
      closingIndex = index;
      break;
    }
  }
  const leadingSections = sections.slice(0, contentSlideLimit - 1);
  if (closingIndex >= leadingSections.length) return [...leadingSections, sections[closingIndex]];
  return sections.slice(0, contentSlideLimit);
}

function presentationSections(blocks, structuredSlides = null, requestedSlideCount = null) {
  if (Array.isArray(structuredSlides) && structuredSlides.length) {
    return limitPresentationSections(structuredSlides.flatMap((source) => {
      const points = source.content.length ? source.content : ["Tidak ada isi untuk slide ini."];
      const sections = [];
      for (let index = 0; index < points.length; index += 5) {
        sections.push({
          title: index ? `${source.title} (lanjutan)` : source.title,
          points: points.slice(index, index + 5),
          notes: index === 0 ? source.notes : "",
        });
      }
      return sections;
    }), requestedSlideCount, false);
  }
  const firstHeading = blocks.findIndex((block) => block.type === "heading");
  const sections = [];
  let current = { title: "Ringkasan", points: [] };
  blocks.forEach((block, index) => {
    if (block.type === "heading") {
      if (index === firstHeading) return;
      if (current.points.length) sections.push(current);
      current = { title: block.text, points: [] };
    } else if (block.type === "table") {
      current.points.push(...splitPresentationText(block.headers.join(" | ")));
      for (const row of block.rows) current.points.push(...splitPresentationText(row.join(" | ")));
    } else if (block.text) {
      current.points.push(...splitPresentationText(block.text));
    }
  });
  if (current.points.length) sections.push(current);
  if (!sections.length) sections.push({ title: "Ringkasan", points: ["Tidak ada isi jawaban untuk ditampilkan."] });
  return limitPresentationSections(sections.flatMap((section) => {
    const slides = [];
    for (let index = 0; index < section.points.length; index += 5) {
      slides.push({
        title: index ? `${section.title} (lanjutan)` : section.title,
        points: section.points.slice(index, index + 5),
      });
    }
    return slides;
  }), requestedSlideCount);
}

async function exportPowerPoint(title, blocks, structuredSlides = null, theme = "clean-light", requestedSlideCount = null, options = {}) {
  const imported = await (options.libraryLoader
    ? options.libraryLoader("pptxgenjs")
    : import("pptxgenjs"));
  const PptxGenJS = imported.default || imported;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "MyAI";
  pptx.subject = "Dokumen dibuat dari jawaban MyAI";
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "id-ID" };

  const colors = {
    cover: "173B36",
    background: "FFFFFF",
    ink: "173B36",
    body: "263630",
    muted: "74837D",
    accent: "4D6BFE",
    pale: "F3F7F5",
    line: "E2EAE6",
    white: "FFFFFF",
    card: ["EFF5F2", "F1F2FA", "FBF2E9", "EEF3F8", "F5F1F7"],
  };
  const themeColors = {
    "modern-dark": {
      cover: "0C1220", background: "101827", ink: "F4F6FB", body: "E0E6F0",
      muted: "AAB6C8", accent: "89A5FF", line: "35445D",
      card: ["1B2739", "20283D", "29263B", "1D2D35", "292735"],
    },
    "enterprise-gold": {
      cover: "332719", background: "FFFDFA", ink: "332719", body: "3E3426",
      muted: "82735D", accent: "C28A32", line: "E7DCC8",
      card: ["F7F0E4", "F8F3E9", "F5EBDD", "F1F3EE", "F8F0E7"],
    },
    "enterprise-dark": {
      cover: "0C1220", background: "101827", ink: "F4F6FB", body: "E0E6F0",
      muted: "AAB6C8", accent: "89A5FF", line: "35445D",
      card: ["1B2739", "20283D", "29263B", "1D2D35", "292735"],
    },
    "modern-gold": {
      cover: "332719", background: "FFFDFA", ink: "332719", body: "3E3426",
      muted: "82735D", accent: "C28A32", line: "E7DCC8",
      card: ["F7F0E4", "F8F3E9", "F5EBDD", "F1F3EE", "F8F0E7"],
    },
    "clean-light": { cover: "173B36", background: "FFFFFF", ink: "173B36", accent: "4D6BFE" },
  };
  Object.assign(colors, themeColors[theme] || themeColors["clean-light"]);
  let hasStructuredSlides = Array.isArray(structuredSlides) && structuredSlides.length > 0;
  const sections = presentationSections(blocks, structuredSlides, requestedSlideCount);
  if (requestedSlideCount === 2 && hasStructuredSlides && sections.length === 1) hasStructuredSlides = false;
  if (!hasStructuredSlides) {
    const cover = pptx.addSlide();
    cover.background = { color: colors.cover };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, line: { color: colors.cover, transparency: 100 }, fill: { color: colors.cover } });
  cover.addShape(pptx.ShapeType.ellipse, { x: 9.4, y: -1.5, w: 5.1, h: 5.1, line: { color: "597A72", transparency: 100 }, fill: { color: "597A72", transparency: 32 } });
  cover.addShape(pptx.ShapeType.ellipse, { x: 10.6, y: 3.7, w: 3.8, h: 3.8, line: { color: colors.accent, transparency: 100 }, fill: { color: colors.accent, transparency: 72 } });
  cover.addShape(pptx.ShapeType.rect, { x: 0.86, y: 1.2, w: 0.72, h: 0.08, line: { color: "7CCAB1", transparency: 100 }, fill: { color: "7CCAB1" } });
  cover.addText("MYAI  /  PRESENTASI", { x: 0.86, y: 1.48, w: 5.5, h: 0.32, fontFace: "Aptos", fontSize: 11, bold: true, charSpacing: 2.2, color: "B9D8CE", margin: 0 });
  cover.addText(title, { x: 0.82, y: 2.05, w: 10.8, h: 2.15, fontFace: "Aptos Display", fontSize: 36, bold: true, color: colors.white, breakLine: false, fit: "shrink", margin: 0.03, valign: "mid" });
  cover.addText("Disusun dengan MyAI", { x: 0.86, y: 4.48, w: 8.2, h: 0.42, fontFace: "Aptos", fontSize: 15, color: "D0DFDA", margin: 0 });
  cover.addText(new Date().toLocaleDateString("id-ID", { year: "numeric", month: "long" }), { x: 0.86, y: 6.55, w: 5, h: 0.28, fontFace: "Aptos", fontSize: 10, color: "A9C2B9", margin: 0 });
    cover.addText("MYAI", { x: 11.15, y: 6.48, w: 1.2, h: 0.35, fontFace: "Aptos Display", fontSize: 15, bold: true, color: colors.white, align: "right", margin: 0 });
  }

  const totalSlides = sections.length + Number(!hasStructuredSlides);
  sections.forEach((section, index) => {
    const slide = pptx.addSlide();
    if (section.notes) slide.addNotes(section.notes);
    slide.background = { color: colors.background };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.14, line: { color: colors.accent, transparency: 100 }, fill: { color: colors.accent } });
    slide.addText("MYAI  /  RINGKASAN", { x: 0.72, y: 0.34, w: 5, h: 0.25, fontFace: "Aptos", fontSize: 9, bold: true, charSpacing: 1.5, color: colors.muted, margin: 0 });
    slide.addText(section.title, { x: 0.7, y: 0.72, w: 11.9, h: 0.64, fontFace: "Aptos Display", fontSize: 24, bold: true, color: colors.ink, fit: "shrink", margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 0.72, y: 1.48, w: 11.9, h: 0, line: { color: colors.line, width: 1 } });
    const rows = Math.ceil(section.points.length / 2);
    const gapX = 0.2;
    const gapY = 0.16;
    const cardWidth = 5.85;
    const cardHeight = Math.min(2.05, (4.95 - gapY * Math.max(0, rows - 1)) / Math.max(1, rows));
    section.points.forEach((point, pointIndex) => {
      const column = pointIndex % 2;
      const row = Math.floor(pointIndex / 2);
      const x = 0.72 + column * (cardWidth + gapX);
      const y = 1.7 + row * (cardHeight + gapY);
      slide.addShape(pptx.ShapeType.roundRect, {
        x, y, w: cardWidth, h: cardHeight,
        rectRadius: 0.12,
        line: { color: colors.line, width: 0.8 },
        fill: { color: colors.card[pointIndex % colors.card.length] },
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: x + 0.24, y: y + 0.23, w: 0.38, h: 0.38,
        line: { color: colors.accent, transparency: 100 },
        fill: { color: colors.accent },
      });
      slide.addText(String(pointIndex + 1).padStart(2, "0"), {
        x: x + 0.24, y: y + 0.34, w: 0.38, h: 0.12,
        fontFace: "Aptos", fontSize: 8, bold: true, color: colors.white, align: "center", margin: 0,
      });
      slide.addText(point, {
        x: x + 0.76, y: y + 0.18, w: cardWidth - 1.02, h: cardHeight - 0.36,
        fontFace: "Aptos", fontSize: point.length > 150 ? 14 : 16, color: colors.body,
        breakLine: false, fit: "shrink", margin: 0.03, valign: "mid",
      });
    });
    slide.addShape(pptx.ShapeType.line, { x: 0.72, y: 6.96, w: 11.9, h: 0, line: { color: colors.line, width: 0.7 } });
    slide.addText("MYAI  ·  SIAP DIIMPOR KE CANVA", { x: 0.72, y: 7.08, w: 5.6, h: 0.18, fontFace: "Aptos", fontSize: 8, color: colors.muted, charSpacing: 0.6, margin: 0 });
    slide.addText(`${index + Number(hasStructuredSlides) + 1} / ${totalSlides}`, { x: 11.6, y: 7.06, w: 1, h: 0.2, fontFace: "Aptos", fontSize: 9, color: colors.muted, align: "right", margin: 0 });
  });
  const filename = safeFilename(title, "pptx");
  if (options.download !== false) {
    await pptx.writeFile({ fileName: filename });
    return { filename };
  }
  const output = await pptx.write({ outputType: "nodebuffer" });
  return { blob: new Blob([output], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), filename };
}

function spreadsheetValue(text) {
  const raw = String(text ?? "").trim();
  const value = raw.replace(/^(?:rp\.?|\$|€|£)\s*/i, "").replace(/\s+/g, "");
  if (!value || /^0\d/.test(value)) return raw;
  let normalized = "";
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value)) normalized = value.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)) normalized = value.replace(/,/g, "");
  else if (/^-?\d+(?:[.,]\d+)?$/.test(value)) normalized = value.replace(",", ".");
  const number = normalized ? Number(normalized) : NaN;
  return Number.isFinite(number) ? number : raw;
}

function fitColumns(sheet, rows) {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  sheet["!cols"] = Array.from({ length: columnCount }, (_, column) => ({
    wch: Math.min(48, Math.max(12, ...rows.map((row) => String(row[column] ?? "").length + 2))),
  }));
}

async function exportSpreadsheet(title, blocks, requestedSheetName = "", structuredTable = null, options = {}) {
  const imported = await (options.libraryLoader
    ? options.libraryLoader("xlsx-js-style", "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/+esm")
    : import("https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/+esm"));
  const XLSX = imported.utils ? imported : imported.default;
  const workbook = XLSX.utils.book_new();
  const filename = safeFilename(title, "xlsx");
  const writeWorkbook = () => {
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (options.download !== false) saveBlob(blob, filename);
    return { blob, filename };
  };
  workbook.Props = { Title: title, Subject: "Spreadsheet dibuat dari jawaban MyAI", Author: "MyAI" };
  if (structuredTable) {
    const rows = [
      structuredTable.headers,
      ...structuredTable.rows.map((row) => row.map((cell) => (
        cell && typeof cell === "object" && typeof cell.formula === "string" ? "" : cell
      ))),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    structuredTable.rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      if (!cell || typeof cell !== "object" || typeof cell.formula !== "string") return;
      if (!/^(?:SUM|AVERAGE|MIN|MAX|COUNT)\([A-Z]{1,3}\d{1,7}:[A-Z]{1,3}\d{1,7}\)$/i.test(cell.formula)) {
        throw new Error("Formula Excel tidak didukung. Gunakan SUM, AVERAGE, MIN, MAX, atau COUNT dengan satu rentang sel sederhana.");
      }
      const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
      sheet[address] = { t: "n", v: 0, f: cell.formula };
    }));
    workbook.CalcPr = { fullCalcOnLoad: true, forceFullCalc: true };
    fitColumns(sheet, rows.map((row) => row.map((cell) => cell && typeof cell === "object" ? `=${cell.f}` : cell)));
    const columnCount = structuredTable.headers.length;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
        if (!cell) continue;
        cell.s = rowIndex === 0
          ? {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { patternType: "solid", fgColor: { rgb: "173B36" } },
            alignment: { vertical: "center", horizontal: "left", wrapText: true },
          }
          : { alignment: { vertical: "top", wrapText: true } };
        if (cell.t === "n") cell.s.numFmt = "#,##0.##";
      }
    }
    if (rows.length) sheet["!rows"] = [{ hpt: 30 }, ...rows.slice(1).map(() => ({ hpt: 21 }))];
    if (structuredTable.headers.length && structuredTable.rows.length) {
      sheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: structuredTable.rows.length, c: columnCount - 1 },
        }),
      };
    }
    const name = String(requestedSheetName || "Data").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Data";
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    return writeWorkbook();
  }
  const usedNames = new Set();
  const sheetName = (name, fallback) => {
    const base = String(name || fallback).replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || fallback;
    let candidate = base;
    for (let index = 2; usedNames.has(candidate.toLowerCase()); index++) candidate = `${base.slice(0, 25)} ${index}`;
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  const tables = [];
  const notes = [];
  const plainNotes = [];
  let lastHeading = "";
  for (const block of blocks) {
    if (block.type === "heading") lastHeading = block.text;
    if (block.type === "table" && (block.headers.length || block.rows.some((row) => row.length))) {
      tables.push({ name: lastHeading, block });
    }
    else if (block.text) {
      notes.push([block.text]);
      if (block.type !== "heading") plainNotes.push([block.text]);
    }
  }

  const styleSheet = (sheet, rows) => {
    const columnCount = Math.max(0, ...rows.map((row) => row.length));
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cell = sheet[address];
        if (!cell) continue;
        cell.s = rowIndex === 0
          ? {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { patternType: "solid", fgColor: { rgb: "173B36" } },
            alignment: { vertical: "center", horizontal: "left", wrapText: true },
          }
          : { alignment: { vertical: "top", wrapText: true } };
        if (cell.t === "n") cell.s.numFmt = "#,##0.##";
      }
    }
    if (rows.length) sheet["!rows"] = [{ hpt: 30 }, ...rows.slice(1).map(() => ({ hpt: 21 }))];
  };

  tables.forEach(({ name, block }, index) => {
    const columnCount = Math.max(block.headers.length, ...block.rows.map((row) => row.length));
    const rows = [block.headers, ...block.rows.map((row) => row.map(spreadsheetValue))]
      .map((row) => Array.from({ length: columnCount }, (_, column) => row[column] ?? ""));
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    fitColumns(sheet, rows);
    styleSheet(sheet, rows);
    if (block.headers.length && block.rows.length) {
      sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: block.rows.length, c: columnCount - 1 } }) };
    }
    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      sheetName(tables.length === 1 && name === title ? requestedSheetName || "Data" : name, `Tabel ${index + 1}`),
    );
  });

  const noteContent = tables.length ? plainNotes : notes;
  const noteRows = noteContent.length
    ? [[tables.length ? "Catatan" : "Jawaban MyAI"], ...noteContent]
    : [];
  if (!tables.length || noteRows.length) {
    const rows = noteRows.length ? noteRows : [["Jawaban MyAI"], ["Tidak ada isi jawaban."]];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    fitColumns(sheet, rows);
    styleSheet(sheet, rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName(tables.length ? "Catatan" : "Jawaban MyAI", "Catatan"));
  }
  return writeWorkbook();
}

async function exportPdf(title, blocks, options = {}) {
  const imported = await (options.libraryLoader
    ? options.libraryLoader("jspdf", "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm")
    : import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm"));
  const download = options.download !== false;
  const JsPDF = imported.jsPDF || imported.default?.jsPDF || imported.default;
  const pdf = new JsPDF({ unit: "mm", format: "a4" });
  const margin = 18;
  const maxWidth = 210 - margin * 2;
  let y = 24;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  const titleLines = pdf.splitTextToSize(title, maxWidth);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 8 + 8;

  for (const block of blocks) {
    const text = block.type === "table" ? [block.headers, ...block.rows].map((row) => row.join(" | ")).join("\n") : block.text;
    if (!text) continue;
    const heading = block.type === "heading";
    pdf.setFont("helvetica", heading ? "bold" : "normal");
    pdf.setFontSize(heading ? 13 : 10.5);
    const lines = pdf.splitTextToSize(text, maxWidth);
    const lineHeight = heading ? 6.5 : 5.2;
    if (y + lines.length * lineHeight > 278) {
      pdf.addPage();
      y = 20;
    }
    pdf.text(lines, margin, y);
    y += lines.length * lineHeight + (heading ? 3 : 2);
  }
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text(`MyAI  |  ${page} / ${pageCount}`, 210 - margin, 289, { align: "right" });
  }
  const filename = safeFilename(title, "pdf");
  const blob = pdf.output("blob");
  if (download) saveBlob(blob, filename);
  return { blob, filename };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportAssistantDocument(
  { content, title, citations = [], structuredSlides, theme, requestedSlideCount, sheetName, structuredTable },
  format,
  options = {},
) {
  const markdown = cleanAnswer(content);
  const blocks = withSources(blocksFromMarkdown(markdown), citations);
  const documentTitle = answerTitle(title, blocks);
  if (format === "docx") return exportWord(documentTitle, blocks, options);
  if (format === "pptx") return exportPowerPoint(documentTitle, blocks, structuredSlides, theme, requestedSlideCount, options);
  if (format === "xlsx") return exportSpreadsheet(documentTitle, blocks, sheetName, structuredTable, options);
  if (format === "pdf") return exportPdf(documentTitle, blocks, options);
  throw new Error("Format dokumen tidak didukung.");
}