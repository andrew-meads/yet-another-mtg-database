import { describe, it, expect } from "vitest";
import {
  buildDeckExportModel,
  cardImageUrl,
  DEFAULT_DECK_EXPORT_OPTIONS,
  deckExportFileName,
  deckExportSearchParams,
  DeckExportOptions,
  formatExportTimestamp,
  formatOwnership,
  formatRowLine,
  parseDeckExportOptions,
  deckExportColumns,
  renderDeckCsv,
  renderDeckTxt
} from "@/lib/deckExport";
import type { DeckWithCards } from "@/types/Deck";
import type { DetailedPhysicalCard } from "@/types/PhysicalCard";
import type { SlimMtgCard } from "@/types/MtgCard";

function card(overrides: Partial<SlimMtgCard> & { id: string; name: string }): SlimMtgCard {
  return {
    layout: "normal",
    cmc: 1,
    type_line: "Artifact",
    set: "c21",
    set_name: "Commander 2021",
    collector_number: "263",
    rarity: "uncommon",
    image_uris: { normal: `https://cards.example/${overrides.id}.jpg` },
    ...overrides
  };
}

const solRing = card({ id: "sol-c21", name: "Sol Ring" });
const solRingLea = card({
  id: "sol-lea",
  name: "Sol Ring",
  set: "lea",
  set_name: "Limited Edition Alpha",
  collector_number: "270"
});
const shrine = card({
  id: "shrine-rna",
  name: "Godless Shrine",
  set: "rna",
  set_name: "Ravnica Allegiance",
  collector_number: "248"
});
const dfc = card({
  id: "dfc-1",
  name: "Delver of Secrets // Insectile Aberration",
  image_uris: undefined,
  card_faces: [
    { name: "Delver of Secrets", image_uris: { normal: "https://cards.example/delver-front.jpg" } },
    { name: "Insectile Aberration" }
  ]
});

let seq = 0;
function copy(c: SlimMtgCard, ephemeral = false): DetailedPhysicalCard {
  return {
    _id: `pc-${++seq}`,
    card: c,
    collectionId: ephemeral ? null : "coll-1",
    isEphemeral: ephemeral
  };
}

function deck(sections: { name: string; columns: DetailedPhysicalCard[][] }[]): DeckWithCards {
  return {
    _id: "deck-1",
    name: "My Deck",
    kind: "deck",
    owner: "user-1",
    description: "A test deck",
    sections: sections.map((s, i) => ({
      _id: `sec-${i}`,
      name: s.name,
      columns: s.columns.map((cards, j) => ({ _id: `sec-${i}-col-${j}`, cards }))
    }))
  };
}

const opts = (patch: Partial<DeckExportOptions> = {}): DeckExportOptions => ({
  ...DEFAULT_DECK_EXPORT_OPTIONS,
  ...patch
});

describe("buildDeckExportModel", () => {
  it("aggregates copies by name per section, in column-then-section order", () => {
    const d = deck([
      {
        name: "Main",
        columns: [
          [copy(shrine), copy(solRing), copy(shrine)],
          [copy(solRingLea), copy(shrine)]
        ]
      },
      { name: "Sideboard", columns: [[copy(solRing)]] }
    ]);
    const model = buildDeckExportModel(d, opts());

    expect(model.name).toBe("My Deck");
    expect(model.description).toBe("A test deck");
    expect(model.totalCards).toBe(6);
    expect(model.sections.map((s) => [s.name, s.count])).toEqual([
      ["Main", 5],
      ["Sideboard", 1]
    ]);
    // First-seen order; Sol Ring copies of different printings fold together by name.
    expect(model.sections[0].rows.map((r) => `${r.count}x ${r.name}`)).toEqual([
      "3x Godless Shrine",
      "2x Sol Ring"
    ]);
    // The row keeps the printing of its first occurrence.
    expect(model.sections[0].rows[1].cardId).toBe("sol-c21");
    expect(model.sections[1].rows.map((r) => `${r.count}x ${r.name}`)).toEqual(["1x Sol Ring"]);
  });

  it("separates rows by printing when asked", () => {
    const d = deck([{ name: "Main", columns: [[copy(solRing), copy(solRingLea), copy(solRing)]] }]);
    const model = buildDeckExportModel(d, opts({ separateByPrinting: true }));
    expect(
      model.sections[0].rows.map((r) => [r.count, r.cardId, r.set, r.collectorNumber])
    ).toEqual([
      [2, "sol-c21", "c21", "263"],
      [1, "sol-lea", "lea", "270"]
    ]);
  });

  it("counts owned versus placeholder copies per row", () => {
    const d = deck([
      { name: "Main", columns: [[copy(shrine), copy(shrine, true), copy(solRing, true)]] }
    ]);
    const model = buildDeckExportModel(d, opts());
    const [shrineRow, solRow] = model.sections[0].rows;
    expect(shrineRow).toMatchObject({ count: 2, owned: 1, placeholder: 1 });
    expect(solRow).toMatchObject({ count: 1, owned: 0, placeholder: 1 });
  });

  it("keeps empty sections and columns", () => {
    const d = deck([{ name: "Empty", columns: [[], []] }]);
    const model = buildDeckExportModel(d, opts());
    expect(model.totalCards).toBe(0);
    expect(model.sections).toEqual([{ name: "Empty", count: 0, rows: [] }]);
  });

  it("uses the front face image for cards without a top-level image", () => {
    expect(cardImageUrl(dfc)).toBe("https://cards.example/delver-front.jpg");
    expect(cardImageUrl(solRing)).toBe("https://cards.example/sol-c21.jpg");
    expect(cardImageUrl(card({ id: "x", name: "x", image_uris: undefined }))).toBeUndefined();
    const model = buildDeckExportModel(deck([{ name: "Main", columns: [[copy(dfc)]] }]), opts());
    expect(model.sections[0].rows[0].imageUrl).toBe("https://cards.example/delver-front.jpg");
  });
});

describe("formatRowLine / formatOwnership", () => {
  const row = {
    count: 3,
    name: "Godless Shrine",
    cardId: "shrine-rna",
    set: "rna",
    setName: "Ravnica Allegiance",
    collectorNumber: "248",
    owned: 2,
    placeholder: 1
  };

  it("renders the basic form", () => {
    expect(formatRowLine(row, opts())).toBe("3x Godless Shrine");
  });

  it("appends the printing and ownership suffixes when enabled", () => {
    expect(formatRowLine(row, opts({ separateByPrinting: true }))).toBe(
      "3x Godless Shrine (RNA) 248"
    );
    expect(formatRowLine(row, opts({ includeOwnership: true }))).toBe(
      "3x Godless Shrine [2 owned, 1 placeholder]"
    );
    expect(formatRowLine(row, opts({ separateByPrinting: true, includeOwnership: true }))).toBe(
      "3x Godless Shrine (RNA) 248 [2 owned, 1 placeholder]"
    );
  });

  it("collapses ownership to a single word when all copies match", () => {
    expect(formatOwnership({ ...row, owned: 3, placeholder: 0 })).toBe("owned");
    expect(formatOwnership({ ...row, owned: 0, placeholder: 3 })).toBe("placeholder");
  });

  it("capitalizes the standalone ownership form", () => {
    expect(formatOwnership({ ...row, owned: 3, placeholder: 0 }, true)).toBe("Owned");
    expect(formatOwnership({ ...row, owned: 0, placeholder: 3 }, true)).toBe("Placeholder");
    expect(formatOwnership(row, true)).toBe("2 Owned, 1 Placeholder");
  });
});

describe("renderDeckTxt", () => {
  it("writes a header block then one block per section", () => {
    const d = deck([
      { name: "Main", columns: [[copy(shrine), copy(shrine), copy(solRing, true)]] },
      { name: "Sideboard", columns: [[]] }
    ]);
    const txt = renderDeckTxt(buildDeckExportModel(d, opts({ includeOwnership: true })));
    expect(txt).toBe(
      [
        "My Deck",
        "A test deck",
        "3 cards",
        "",
        "// Main (3)",
        "2x Godless Shrine [owned]",
        "1x Sol Ring [placeholder]",
        "",
        "// Sideboard (0)",
        ""
      ].join("\n")
    );
  });

  it("omits an empty description and singularizes one card", () => {
    const d = { ...deck([{ name: "Main", columns: [[copy(solRing)]] }]), description: "  " };
    expect(renderDeckTxt(buildDeckExportModel(d, opts()))).toBe(
      "My Deck\n1 card\n\n// Main (1)\n1x Sol Ring\n"
    );
  });
});

describe("renderDeckCsv", () => {
  const thalia = card({
    id: "thalia",
    name: 'Thalia, "Guardian" of Thraben',
    set: "dka",
    set_name: "Dark Ascension",
    collector_number: "24"
  });

  it("writes a header row and one CRLF row per card, quoting as needed", () => {
    const d = deck([
      { name: "Main, side", columns: [[copy(thalia), copy(shrine), copy(shrine, true)]] },
      { name: "Sideboard", columns: [[]] }
    ]);
    expect(renderDeckCsv(buildDeckExportModel(d, opts()))).toBe(
      [
        "Section,Count,Name",
        '"Main, side",1,"Thalia, ""Guardian"" of Thraben"',
        '"Main, side",2,Godless Shrine',
        ""
      ].join("\r\n")
    );
  });

  it("adds printing and ownership columns when enabled", () => {
    const d = deck([{ name: "Main", columns: [[copy(shrine), copy(shrine, true)]] }]);
    const all = opts({ separateByPrinting: true, includeOwnership: true });
    expect(deckExportColumns(all).map((c) => c.header)).toEqual([
      "Section",
      "Count",
      "Name",
      "Set",
      "Set name",
      "Collector #",
      "Owned",
      "Placeholder",
      "Ownership"
    ]);
    expect(renderDeckCsv(buildDeckExportModel(d, all))).toBe(
      [
        "Section,Count,Name,Set,Set name,Collector #,Owned,Placeholder,Ownership",
        'Main,2,Godless Shrine,RNA,Ravnica Allegiance,248,1,1,"1 Owned, 1 Placeholder"',
        ""
      ].join("\r\n")
    );
  });
});

describe("formatExportTimestamp", () => {
  const instant = new Date("2026-09-03T23:32:00Z");

  it("renders a 12-hour time and ordinal date in the given zone", () => {
    expect(formatExportTimestamp(instant, "Pacific/Auckland")).toBe(
      "11:32 AM, September 4th, 2026"
    );
    expect(formatExportTimestamp(instant, "America/New_York")).toBe("7:32 PM, September 3rd, 2026");
    expect(formatExportTimestamp(new Date("2026-01-01T00:05:00Z"), "UTC")).toBe(
      "12:05 AM, January 1st, 2026"
    );
  });

  it("falls back to local time for an unknown zone", () => {
    const local = formatExportTimestamp(instant);
    expect(local).toMatch(/^\d{1,2}:\d{2} [AP]M, [A-Z][a-z]+ \d{1,2}(st|nd|rd|th), \d{4}$/);
    expect(formatExportTimestamp(instant, "Not/AZone")).toBe(local);
  });

  it("stamps the model with the export time in the option's zone", () => {
    const d = deck([{ name: "Main", columns: [[copy(solRing)]] }]);
    const model = buildDeckExportModel(d, opts({ timeZone: "Pacific/Auckland" }), instant);
    expect(model.exportedAt).toBe("11:32 AM, September 4th, 2026");
  });
});

describe("deckExportFileName", () => {
  it("strips unsafe characters and keeps the extension", () => {
    expect(deckExportFileName("Mono-Red: Burn / v2!", "pdf")).toBe("Mono-Red Burn v2.pdf");
    expect(deckExportFileName("Jötun's Deck", "txt")).toBe("Jötuns Deck.txt");
    expect(deckExportFileName("   ", "xlsx")).toBe("deck.xlsx");
  });
});

describe("export option query serialization", () => {
  it("round-trips every option", () => {
    const options = opts({
      format: "pdf",
      separateByPrinting: true,
      includeOwnership: true,
      includeImages: true,
      timeZone: "Pacific/Auckland"
    });
    expect(parseDeckExportOptions(deckExportSearchParams(options))).toEqual(options);
    expect(parseDeckExportOptions(deckExportSearchParams(opts()))).toEqual(opts());
  });

  it("omits the time zone when absent or blank", () => {
    expect(deckExportSearchParams(opts()).has("tz")).toBe(false);
    expect(parseDeckExportOptions(new URLSearchParams("format=txt&tz=+"))).toEqual(opts());
  });

  it("accepts csv", () => {
    expect(parseDeckExportOptions(new URLSearchParams("format=csv"))?.format).toBe("csv");
  });

  it("only honors images for PDF", () => {
    expect(deckExportSearchParams(opts({ format: "txt", includeImages: true })).has("images")).toBe(
      false
    );
    expect(
      parseDeckExportOptions(new URLSearchParams("format=xlsx&images=true"))?.includeImages
    ).toBe(false);
    expect(
      parseDeckExportOptions(new URLSearchParams("format=PDF&images=TRUE"))?.includeImages
    ).toBe(true);
  });

  it("rejects a missing or unknown format", () => {
    expect(parseDeckExportOptions(new URLSearchParams(""))).toBeNull();
    expect(parseDeckExportOptions(new URLSearchParams("format=docx"))).toBeNull();
  });
});
