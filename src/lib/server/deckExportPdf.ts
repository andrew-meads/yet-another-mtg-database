import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { DeckExportModel, DeckExportRow, formatOwnership, formatRowLine } from "@/lib/deckExport";

/**
 * PDF decklist renderer (pdf-lib, A4 portrait).
 *
 * Without images: a title block then, per section, a header and one text line
 * per row. With images: per section, cards are laid out two per row, each as a
 * small card image with its written details beside it (count and name, then
 * printing and ownership when those options are on); cards whose image is
 * missing get a labelled placeholder box.
 * Layout is hand-rolled (pdf-lib has no text flow), so every piece of text goes
 * through `wrap` and every block checks `ensure` before drawing so pages break
 * cleanly.
 */

// A4 portrait, in PDF points.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const TITLE_SIZE = 18;
const BODY_SIZE = 10;
const SECTION_SIZE = 13;
const SMALL_SIZE = 8.5;
const LINE_GAP = 1.4;

// Image layout: two cards per row, each a small Scryfall "normal" (488x680)
// image with its text beside it.
const IMAGE_COLUMNS = 2;
const IMAGE_COLUMN_GAP = 16;
const IMAGE_CELL_WIDTH = (CONTENT_WIDTH - IMAGE_COLUMN_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS;
const IMAGE_WIDTH = 60;
const IMAGE_HEIGHT = (IMAGE_WIDTH * 680) / 488;
const IMAGE_TEXT_GAP = 10;
const ROW_GAP = 8;
const DETAIL_SIZE = 9;
const DETAIL_WIDTH = IMAGE_CELL_WIDTH - IMAGE_WIDTH - IMAGE_TEXT_GAP;

const GRAY = rgb(0.45, 0.45, 0.45);
const BLACK = rgb(0, 0, 0);
const PLACEHOLDER_FILL = rgb(0.93, 0.93, 0.93);
const PLACEHOLDER_STROKE = rgb(0.75, 0.75, 0.75);

/**
 * The standard fonts only cover WinAnsi; replace anything they can't encode
 * (rare in card names, but e.g. some Un-set glyphs) with "?" instead of throwing.
 */
function safeText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Greedy word wrap; over-long single words are split by character. */
function wrap(font: PDFFont, size: number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safeText(font, text).split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      // Word alone is too wide: split it.
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = "";
        }
        chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

class PdfWriter {
  page!: PDFPage;
  y = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Start a new page unless `height` more points fit on the current one. */
  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  /** Draw wrapped text at the left margin and advance the cursor. */
  paragraph(text: string, size: number, font = this.regular, color = BLACK, gapAfter = 0) {
    const lineHeight = size * LINE_GAP;
    for (const line of wrap(font, size, text, CONTENT_WIDTH)) {
      this.ensure(lineHeight);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
    this.y -= gapAfter;
  }

  space(points: number) {
    this.y -= points;
  }
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | undefined> {
  try {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (isPng) return await doc.embedPng(bytes);
    if (isJpg) return await doc.embedJpg(bytes);
    return undefined;
  } catch {
    return undefined;
  }
}

/** The written details shown beside a card image: [bold headline, ...detail lines]. */
function imageRowLines(row: DeckExportRow, model: DeckExportModel): string[] {
  const { options } = model;
  const lines = [`${row.count}x ${row.name}`];
  if (options.separateByPrinting) {
    lines.push(`${row.setName} (${row.set.toUpperCase()}) #${row.collectorNumber}`);
  }
  if (options.includeOwnership) lines.push(formatOwnership(row, true));
  return lines;
}

interface MeasuredImageCell {
  row: DeckExportRow;
  image: PDFImage | undefined;
  headlineLines: string[];
  detailLines: string[];
  height: number;
}

/** Wraps a card's text into the detail column and measures the cell's height. */
function measureImageCell(
  w: PdfWriter,
  row: DeckExportRow,
  image: PDFImage | undefined,
  model: DeckExportModel
): MeasuredImageCell {
  const [headline, ...details] = imageRowLines(row, model);
  const headlineLines = wrap(w.bold, BODY_SIZE, headline, DETAIL_WIDTH);
  const detailLines = details.flatMap((d) => wrap(w.regular, DETAIL_SIZE, d, DETAIL_WIDTH));
  const textHeight =
    headlineLines.length * BODY_SIZE * LINE_GAP + detailLines.length * DETAIL_SIZE * LINE_GAP;
  return { row, image, headlineLines, detailLines, height: Math.max(IMAGE_HEIGHT, textHeight) };
}

/**
 * Draws one measured cell with its top-left corner at (x, top): the image (or a
 * placeholder box) on the left and the headline plus detail lines beside it.
 */
function drawImageCell(w: PdfWriter, cell: MeasuredImageCell, x: number, top: number) {
  const imageY = top - IMAGE_HEIGHT;
  if (cell.image) {
    w.page.drawImage(cell.image, { x, y: imageY, width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  } else {
    w.page.drawRectangle({
      x,
      y: imageY,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      color: PLACEHOLDER_FILL,
      borderColor: PLACEHOLDER_STROKE,
      borderWidth: 1
    });
    const label = "no image";
    const width = w.regular.widthOfTextAtSize(label, SMALL_SIZE);
    w.page.drawText(label, {
      x: x + (IMAGE_WIDTH - width) / 2,
      y: imageY + IMAGE_HEIGHT / 2 - SMALL_SIZE / 2,
      size: SMALL_SIZE,
      font: w.regular,
      color: GRAY
    });
  }

  const textX = x + IMAGE_WIDTH + IMAGE_TEXT_GAP;
  let y = top;
  for (const line of cell.headlineLines) {
    w.page.drawText(line, {
      x: textX,
      y: y - BODY_SIZE,
      size: BODY_SIZE,
      font: w.bold,
      color: BLACK
    });
    y -= BODY_SIZE * LINE_GAP;
  }
  for (const line of cell.detailLines) {
    w.page.drawText(line, {
      x: textX,
      y: y - DETAIL_SIZE,
      size: DETAIL_SIZE,
      font: w.regular,
      color: GRAY
    });
    y -= DETAIL_SIZE * LINE_GAP;
  }
}

/**
 * Draws up to IMAGE_COLUMNS cells side by side at the writer's cursor (breaking
 * the page first if the tallest doesn't fit) and advances past the row.
 */
function drawImageRow(w: PdfWriter, cells: MeasuredImageCell[]) {
  const rowHeight = Math.max(...cells.map((c) => c.height));
  w.ensure(rowHeight + ROW_GAP);
  const top = w.y;
  cells.forEach((cell, i) =>
    drawImageCell(w, cell, MARGIN + i * (IMAGE_CELL_WIDTH + IMAGE_COLUMN_GAP), top)
  );
  w.y = top - rowHeight - ROW_GAP;
}

/**
 * Renders the decklist PDF. `images` maps a row's `imageUrl` to raw JPEG/PNG
 * bytes; it is only consulted when the model's `includeImages` option is set.
 */
export async function renderDeckPdf(
  model: DeckExportModel,
  images: Map<string, Uint8Array> = new Map()
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(model.name);
  doc.setProducer("yet-another-mtg-database");
  doc.setCreationDate(new Date());
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new PdfWriter(doc, regular, bold);
  const { options } = model;

  // Title block.
  w.paragraph(model.name, TITLE_SIZE, bold, BLACK, 2);
  if (model.description.trim()) w.paragraph(model.description.trim(), BODY_SIZE, regular, GRAY, 2);
  w.paragraph(
    `${model.totalCards} ${model.totalCards === 1 ? "card" : "cards"} · exported ${model.exportedAt}`,
    SMALL_SIZE,
    regular,
    GRAY,
    10
  );

  // Embed each distinct image once, up front.
  const embedded = new Map<string, PDFImage>();
  if (options.includeImages) {
    for (const [url, bytes] of images) {
      const img = await embedImage(doc, bytes);
      if (img) embedded.set(url, img);
    }
  }

  for (const section of model.sections) {
    const header = `${section.name} (${section.count})`;
    const headerHeight = SECTION_SIZE * LINE_GAP + 4;

    if (!options.includeImages) {
      // Keep the header with at least one row.
      w.ensure(headerHeight + BODY_SIZE * LINE_GAP);
      w.paragraph(header, SECTION_SIZE, bold, BLACK, 4);
      if (section.rows.length === 0) w.paragraph("(empty)", BODY_SIZE, regular, GRAY);
      for (const row of section.rows) w.paragraph(formatRowLine(row, options), BODY_SIZE);
      w.space(10);
      continue;
    }

    // Keep the header with the first image row.
    w.ensure(headerHeight + IMAGE_HEIGHT + ROW_GAP);
    w.paragraph(header, SECTION_SIZE, bold, BLACK, 6);
    if (section.rows.length === 0) w.paragraph("(empty)", BODY_SIZE, regular, GRAY);
    const cells = section.rows.map((row) =>
      measureImageCell(w, row, row.imageUrl ? embedded.get(row.imageUrl) : undefined, model)
    );
    for (let i = 0; i < cells.length; i += IMAGE_COLUMNS) {
      drawImageRow(w, cells.slice(i, i + IMAGE_COLUMNS));
    }
    w.space(6);
  }

  return doc.save();
}
