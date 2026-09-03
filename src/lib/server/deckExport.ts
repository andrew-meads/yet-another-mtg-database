import ExcelJS from "exceljs";
import { scryfallFetch } from "@/lib/scryfall";
import {
  DECK_EXPORT_CONTENT_TYPES,
  DeckExportModel,
  deckExportColumns,
  deckExportFileName,
  renderDeckCsv,
  renderDeckTxt
} from "@/lib/deckExport";
import { renderDeckPdf } from "./deckExportPdf";

/**
 * Server-side deck export: the XLSX renderer, Scryfall image fetching for the
 * PDF, and the format dispatcher used by GET /api/decks/[id]/export.
 */

export interface RenderedDeckExport {
  body: Uint8Array;
  contentType: string;
  fileName: string;
}

/** Resolves an image URL to its bytes, or undefined when it can't be fetched. */
export type ImageFetcher = (url: string) => Promise<Uint8Array | undefined>;

const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const IMAGE_FETCH_CONCURRENCY = 4;

/**
 * Fetches one Scryfall-hosted card image. Goes through `scryfallFetch` so the
 * request carries the required User-Agent and respects the 10 req/s limit.
 * Never throws — a failed image just renders as a placeholder in the PDF.
 */
export const fetchScryfallImage: ImageFetcher = async (url) => {
  try {
    const res = await scryfallFetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
};

/**
 * Fetches the image for every row that has one (deduplicated by URL, a few in
 * flight at a time). Missing/failed images are simply absent from the map.
 */
export async function fetchDeckImages(
  model: DeckExportModel,
  fetchImage: ImageFetcher = fetchScryfallImage
): Promise<Map<string, Uint8Array>> {
  const urls = [
    ...new Set(
      model.sections.flatMap((s) => s.rows.map((r) => r.imageUrl)).filter((u): u is string => !!u)
    )
  ];
  const images = new Map<string, Uint8Array>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const bytes = await fetchImage(url);
      if (bytes) images.set(url, bytes);
    }
  };
  await Promise.all(Array.from({ length: IMAGE_FETCH_CONCURRENCY }, worker));
  return images;
}

/**
 * XLSX: one "Decklist" sheet (the same columns as the CSV export, via
 * deckExportColumns) with a frozen bold header, plus a "Summary" sheet.
 */
export async function renderDeckXlsx(model: DeckExportModel): Promise<Uint8Array> {
  const { options } = model;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "yet-another-mtg-database";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Decklist", { views: [{ state: "frozen", ySplit: 1 }] });
  const columns = deckExportColumns(options);
  const widths: Record<string, number> = {
    section: 20,
    count: 8,
    name: 36,
    set: 8,
    setName: 30,
    collectorNumber: 12,
    owned: 8,
    placeholder: 12,
    ownership: 24
  };
  sheet.columns = columns.map(
    (c): Partial<ExcelJS.Column> => ({ header: c.header, key: c.key, width: widths[c.key] ?? 16 })
  );
  sheet.getRow(1).font = { bold: true };

  for (const section of model.sections) {
    for (const row of section.rows) {
      sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, c.value(row, section)])));
    }
  }

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Deck", key: "k", width: 20 },
    { header: model.name, key: "v", width: 48 }
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRow({ k: "Description", v: model.description });
  summary.addRow({ k: "Total cards", v: model.totalCards });
  for (const section of model.sections) summary.addRow({ k: section.name, v: section.count });
  summary.addRow({ k: "Exported", v: model.exportedAt });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/** Renders the model in its chosen format. */
export async function renderDeckExport(
  model: DeckExportModel,
  fetchImage: ImageFetcher = fetchScryfallImage
): Promise<RenderedDeckExport> {
  const { format } = model.options;
  const fileName = deckExportFileName(model.name, format);
  const contentType = DECK_EXPORT_CONTENT_TYPES[format];

  switch (format) {
    case "txt":
      return { body: new TextEncoder().encode(renderDeckTxt(model)), contentType, fileName };
    case "csv":
      return { body: new TextEncoder().encode(renderDeckCsv(model)), contentType, fileName };
    case "xlsx":
      return { body: await renderDeckXlsx(model), contentType, fileName };
    case "pdf": {
      const images = model.options.includeImages
        ? await fetchDeckImages(model, fetchImage)
        : new Map<string, Uint8Array>();
      return { body: await renderDeckPdf(model, images), contentType, fileName };
    }
  }
}
