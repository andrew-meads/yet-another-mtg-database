import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import advancedFormat from "dayjs/plugin/advancedFormat";
import { DeckSectionKind, DeckWithCards } from "@/types/Deck";
import {
  effectiveSectionKind,
  formatCardCount,
  formatDeckCardCount,
  sortSectionsByKind
} from "@/lib/deckUtils";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { SlimMtgCard } from "@/types/MtgCard";

/**
 * Deck export: pure, client-safe model building + the TXT renderer.
 *
 * The XLSX and PDF renderers live server-side (src/lib/server/deckExport*.ts)
 * because they need node-only libraries and, for images, server-side Scryfall
 * fetches. Everything here is shared by the dialog, the route, and the tests.
 */

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

export const DECK_EXPORT_FORMATS = ["txt", "csv", "xlsx", "pdf"] as const;
export type DeckExportFormat = (typeof DECK_EXPORT_FORMATS)[number];

export interface DeckExportOptions {
  format: DeckExportFormat;
  /** Group rows by exact printing (Scryfall id) instead of by card name. */
  separateByPrinting: boolean;
  /** Append owned/placeholder counts to every row. */
  includeOwnership: boolean;
  /** PDF only: render a card image per row. Ignored for other formats. */
  includeImages: boolean;
  /**
   * IANA time zone the "exported at" timestamp is rendered in (the browser's,
   * so a server running in UTC still prints the user's local time). Falls back
   * to the server's zone when absent or unknown.
   */
  timeZone?: string;
}

export const DEFAULT_DECK_EXPORT_OPTIONS: DeckExportOptions = {
  format: "txt",
  separateByPrinting: false,
  includeOwnership: false,
  includeImages: false
};

/** One aggregated line of the decklist. */
export interface DeckExportRow {
  /** Total number of copies folded into this row. */
  count: number;
  name: string;
  /** Scryfall id of the printing this row represents (first seen when grouping by name). */
  cardId: string;
  set: string;
  setName: string;
  collectorNumber: string;
  /** Front-face "normal" image, when the card has one. */
  imageUrl?: string;
  /** Copies backed by a collection (cards the user actually owns). */
  owned: number;
  /** Ephemeral (deck-only placeholder) copies. */
  placeholder: number;
}

export interface DeckExportSection {
  name: string;
  /** Normal (main deck), sideboard, or scratch area (not part of the deck). */
  kind: DeckSectionKind;
  /** Total physical cards in the section (sum of row counts). */
  count: number;
  rows: DeckExportRow[];
}

export interface DeckExportModel {
  name: string;
  description: string;
  /** Cards in the main deck (normal sections only). */
  totalCards: number;
  /** Cards in sideboard sections. */
  sideboardCards: number;
  /** Cards in scratch areas (not part of the deck). */
  scratchCards: number;
  /** Normal sections first, then sideboard sections, then scratch areas. */
  sections: DeckExportSection[];
  options: DeckExportOptions;
  /** Human-readable export timestamp, e.g. "11:32 AM, September 4th, 2026". */
  exportedAt: string;
}

/** Format used for the "exported at" stamp: "11:32 AM, September 4th, 2026". */
export const EXPORT_TIMESTAMP_FORMAT = "h:mm A, MMMM Do, YYYY";

/**
 * Renders `date` in the given IANA time zone (or the runtime's local zone when
 * `timeZone` is absent or not a zone the runtime knows).
 */
export function formatExportTimestamp(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      return dayjs(date).tz(timeZone).format(EXPORT_TIMESTAMP_FORMAT);
    } catch {
      // Unknown zone: fall through to local time.
    }
  }
  return dayjs(date).format(EXPORT_TIMESTAMP_FORMAT);
}

/** Front-face "normal" image URL for a card, falling back to the first face's. */
export function cardImageUrl(card: SlimMtgCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

/**
 * Folds a deck into export sections. Cards are visited in **column-then-section
 * order** — every column of a section top to bottom, columns left to right,
 * sections in deck order — and aggregated per section by name (or by printing
 * when `separateByPrinting` is set). A row keeps the position of its first
 * occurrence, so the list reads in the same order as the deck view.
 *
 * Sections are then ordered by kind — normal sections, then sideboard
 * sections, then scratch areas (deck order within each) — and only normal
 * sections count toward `totalCards`.
 */
export function buildDeckExportModel(
  deck: DeckWithCards,
  options: DeckExportOptions,
  now: Date = new Date()
): DeckExportModel {
  const sections = deck.sections.map((section): DeckExportSection => {
    const rowsByKey = new Map<string, DeckExportRow>();
    let count = 0;
    for (const column of section.columns) {
      for (const copy of column.cards) {
        count++;
        const key = options.separateByPrinting ? copy.card.id : copy.card.name;
        let row = rowsByKey.get(key);
        if (!row) {
          row = rowFromCopy(copy);
          rowsByKey.set(key, row);
        }
        row.count++;
        if (copy.isEphemeral) row.placeholder++;
        else row.owned++;
      }
    }
    return {
      name: section.name,
      kind: effectiveSectionKind(section.kind),
      count,
      rows: [...rowsByKey.values()]
    };
  });
  const countOf = (kind: DeckSectionKind) =>
    sections.filter((s) => s.kind === kind).reduce((total, s) => total + s.count, 0);

  return {
    name: deck.name,
    description: deck.description ?? "",
    totalCards: countOf("normal"),
    sideboardCards: countOf("sideboard"),
    scratchCards: countOf("scratch"),
    sections: sortSectionsByKind(sections),
    options,
    exportedAt: formatExportTimestamp(now, options.timeZone)
  };
}

function rowFromCopy(copy: DetailedPhysicalCard): DeckExportRow {
  const { card } = copy;
  return {
    count: 0,
    name: card.name,
    cardId: card.id,
    set: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    imageUrl: cardImageUrl(card),
    owned: 0,
    placeholder: 0
  };
}

/** "(RNA) 248" — the printing suffix shown when grouping by printing. */
export function formatPrinting(row: DeckExportRow): string {
  return `(${row.set.toUpperCase()}) ${row.collectorNumber}`;
}

/**
 * "owned" / "placeholder" / "2 owned, 1 placeholder" — lowercase for inline
 * use (the `[owned]` suffix of a decklist line). Pass `standalone` for the
 * capitalized form ("Owned", "2 Owned, 1 Placeholder") used where the label
 * stands on its own: a CSV/XLSX cell or its own line in the PDF.
 */
export function formatOwnership(row: DeckExportRow, standalone = false): string {
  const owned = standalone ? "Owned" : "owned";
  const placeholder = standalone ? "Placeholder" : "placeholder";
  if (row.placeholder === 0) return owned;
  if (row.owned === 0) return placeholder;
  return `${row.owned} ${owned}, ${row.placeholder} ${placeholder}`;
}

/**
 * The canonical one-line rendering of a row, e.g.
 * `3x Godless Shrine (RNA) 248 [2 owned, 1 placeholder]`. Used verbatim by the
 * TXT export and the PDF captions.
 */
export function formatRowLine(row: DeckExportRow, options: DeckExportOptions): string {
  let line = `${row.count}x ${row.name}`;
  if (options.separateByPrinting) line += ` ${formatPrinting(row)}`;
  if (options.includeOwnership) line += ` [${formatOwnership(row)}]`;
  return line;
}

/** Heading of each section group in the exports ("Main deck" is never printed as a banner). */
export const SECTION_GROUP_TITLES: Record<DeckSectionKind, string> = {
  normal: "Main deck",
  sideboard: "Sideboard",
  scratch: "Scratch area (not part of the deck)"
};

/** Short per-row label for the tabular exports' "Board" column. */
export const SECTION_BOARD_LABELS: Record<DeckSectionKind, string> = {
  normal: "Main",
  sideboard: "Sideboard",
  scratch: "Scratch"
};

/** True when any section is a sideboard or scratch area. */
export function hasSpecialSections(model: DeckExportModel): boolean {
  return model.sections.some((s) => s.kind !== "normal");
}

/** A run of consecutive same-kind sections (the model keeps them grouped). */
export interface DeckExportSectionGroup {
  kind: DeckSectionKind;
  title: string;
  /** Total cards across the group's sections. */
  count: number;
  sections: DeckExportSection[];
}

/** The model's sections grouped by kind, in export order, omitting empty kinds. */
export function deckExportSectionGroups(model: DeckExportModel): DeckExportSectionGroup[] {
  const groups: DeckExportSectionGroup[] = [];
  for (const section of model.sections) {
    let group = groups[groups.length - 1];
    if (!group || group.kind !== section.kind) {
      group = {
        kind: section.kind,
        title: SECTION_GROUP_TITLES[section.kind],
        count: 0,
        sections: []
      };
      groups.push(group);
    }
    group.count += section.count;
    group.sections.push(section);
  }
  return groups;
}

/** "60 cards" / "60 cards + 15 sideboard", plus "(+3 in scratch area)" when any. */
export function formatModelCardCount(model: DeckExportModel): string {
  const base = formatDeckCardCount(model.totalCards, model.sideboardCards);
  return model.scratchCards > 0 ? `${base} (+${model.scratchCards} in scratch area)` : base;
}

/** One column of the tabular (CSV / XLSX) exports. */
export interface DeckExportColumn {
  key: string;
  header: string;
  value: (row: DeckExportRow, section: DeckExportSection) => string | number;
}

/**
 * Columns of the tabular exports: Section / Count / Name always, a Board
 * column (Main / Sideboard / Scratch) when `withBoard` (the deck has sideboard
 * or scratch sections), printing columns when grouping by printing, ownership
 * columns when requested. Shared by the CSV and XLSX renderers so the two
 * never drift.
 */
export function deckExportColumns(
  options: DeckExportOptions,
  withBoard = false
): DeckExportColumn[] {
  const columns: DeckExportColumn[] = [
    { key: "section", header: "Section", value: (_row, section) => section.name }
  ];
  if (withBoard) {
    columns.push({
      key: "board",
      header: "Board",
      value: (_row, section) => SECTION_BOARD_LABELS[section.kind]
    });
  }
  columns.push(
    { key: "count", header: "Count", value: (row) => row.count },
    { key: "name", header: "Name", value: (row) => row.name }
  );
  if (options.separateByPrinting) {
    columns.push(
      { key: "set", header: "Set", value: (row) => row.set.toUpperCase() },
      { key: "setName", header: "Set name", value: (row) => row.setName },
      { key: "collectorNumber", header: "Collector #", value: (row) => row.collectorNumber }
    );
  }
  if (options.includeOwnership) {
    columns.push(
      { key: "owned", header: "Owned", value: (row) => row.owned },
      { key: "placeholder", header: "Placeholder", value: (row) => row.placeholder },
      { key: "ownership", header: "Ownership", value: (row) => formatOwnership(row, true) }
    );
  }
  return columns;
}

/** RFC 4180 field quoting: wrap when the value holds a comma, quote, or newline. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV decklist: a header row then one row per aggregated card (CRLF line ends). */
export function renderDeckCsv(model: DeckExportModel): string {
  const columns = deckExportColumns(model.options, hasSpecialSections(model));
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const section of model.sections) {
    for (const row of section.rows) {
      lines.push(columns.map((c) => csvField(c.value(row, section))).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Plain-text decklist: a header block, then one block per section. Sideboard
 * sections and scratch areas follow the main deck, each group introduced by a
 * `// ===== Sideboard (15 cards) =====` banner.
 */
export function renderDeckTxt(model: DeckExportModel): string {
  const lines: string[] = [model.name];
  if (model.description.trim()) lines.push(model.description.trim());
  lines.push(formatModelCardCount(model));

  for (const group of deckExportSectionGroups(model)) {
    if (group.kind !== "normal") {
      lines.push("", `// ===== ${group.title}: ${formatCardCount(group.count)} =====`);
    }
    for (const section of group.sections) {
      lines.push("", `// ${section.name} (${section.count})`);
      for (const row of section.rows) lines.push(formatRowLine(row, model.options));
    }
  }
  return lines.join("\n") + "\n";
}

/** Download file name: the deck name stripped to safe characters plus the extension. */
export function deckExportFileName(deckName: string, format: DeckExportFormat): string {
  const base =
    deckName
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .replace(/\s+/g, " ")
      .trim() || "deck";
  return `${base}.${format}`;
}

/** MIME type served for each export format. */
export const DECK_EXPORT_CONTENT_TYPES: Record<DeckExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf"
};

/** Serialize options as the query string understood by GET /api/decks/[id]/export. */
export function deckExportSearchParams(options: DeckExportOptions): URLSearchParams {
  const params = new URLSearchParams({ format: options.format });
  if (options.separateByPrinting) params.set("byPrinting", "true");
  if (options.includeOwnership) params.set("ownership", "true");
  if (options.includeImages && options.format === "pdf") params.set("images", "true");
  if (options.timeZone) params.set("tz", options.timeZone);
  return params;
}

/**
 * Parse the export query string. Returns null when `format` is missing or not
 * one of the supported formats; `includeImages` is only honored for PDF.
 */
export function parseDeckExportOptions(params: URLSearchParams): DeckExportOptions | null {
  const format = params.get("format")?.toLowerCase();
  if (!format || !(DECK_EXPORT_FORMATS as readonly string[]).includes(format)) return null;
  const flag = (key: string) => params.get(key)?.toLowerCase() === "true";
  const timeZone = params.get("tz")?.trim();
  return {
    format: format as DeckExportFormat,
    separateByPrinting: flag("byPrinting"),
    includeOwnership: flag("ownership"),
    includeImages: format === "pdf" && flag("images"),
    ...(timeZone ? { timeZone } : {})
  };
}
