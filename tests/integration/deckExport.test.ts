import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import ExcelJS from "exceljs";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import { inflateSync } from "zlib";
import { Types } from "mongoose";
import { DeckModel } from "@/db/schema";
import { GET as exportDeck } from "@/app/api/decks/[id]/export/route";
import {
  ctx,
  jsonRequest,
  seedCard,
  seedCollection,
  seedDeck,
  seedEphemeralCard,
  seedPhysicalCard,
  seedUser,
  setTestUser
} from "./helpers";

// A 1x1 transparent PNG — what the "Scryfall" image CDN serves in these tests.
const PNG_1X1: ArrayBuffer = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  )
).buffer;
const IMAGE_HOST = "https://cards.scryfall.io";

const mswServer = setupServer();
beforeAll(() => mswServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

let userId: string;
let otherUserId: string;
let collectionId: string;
let deckId: string;

async function exportAs(query: string, id = deckId) {
  return exportDeck(jsonRequest(`/api/decks/${id}/export?${query}`, "GET"), ctx({ id }));
}

async function bodyBytes(res: Response) {
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * The text drawn in a pdf-lib PDF, one entry per `Tj` (pdf-lib writes each
 * line as a hex string into a Flate-compressed content stream), in drawing order.
 */
function pdfTextLines(pdf: PDFDocument): string[] {
  const lines: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let content = Buffer.from(obj.contents);
    try {
      content = inflateSync(content);
    } catch {
      // Not compressed.
    }
    for (const m of content.toString("latin1").matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      lines.push(Buffer.from(m[1], "hex").toString("latin1"));
    }
  }
  return lines;
}

beforeEach(async () => {
  userId = await seedUser();
  otherUserId = await seedUser("other@example.com");
  setTestUser(userId);
  collectionId = await seedCollection(userId, { name: "Main Collection" });

  const shrine = await seedCard({
    id: "shrine-rna",
    name: "Godless Shrine",
    set: "rna",
    set_name: "Ravnica Allegiance",
    collector_number: "248",
    image_uris: { normal: `${IMAGE_HOST}/normal/front/shrine.jpg` }
  } as any);
  const solRing = await seedCard({
    id: "sol-c21",
    name: "Sol Ring",
    set: "c21",
    set_name: "Commander 2021",
    collector_number: "263",
    image_uris: { normal: `${IMAGE_HOST}/normal/front/sol-c21.jpg` }
  } as any);
  const solRingLea = await seedCard({
    id: "sol-lea",
    name: "Sol Ring",
    set: "lea",
    set_name: "Limited Edition Alpha",
    collector_number: "270",
    image_uris: { normal: `${IMAGE_HOST}/normal/front/sol-lea.jpg` }
  } as any);

  const deck = await seedDeck(userId, "Orzhov Taxes", { description: "Lifegain and taxes" });
  deckId = deck._id.toString();

  // Main: column A = [Shrine, Sol Ring (c21), Shrine]; column B = [Sol Ring (lea, placeholder)]
  // Sideboard: one owned Shrine.
  const a1 = await seedPhysicalCard(userId, shrine.id, collectionId, { deckId });
  const a2 = await seedPhysicalCard(userId, solRing.id, collectionId, { deckId });
  const a3 = await seedPhysicalCard(userId, shrine.id, collectionId, { deckId });
  const b1 = await seedEphemeralCard(userId, solRingLea.id, deckId);
  const sb1 = await seedPhysicalCard(userId, shrine.id, collectionId, { deckId });

  await DeckModel.updateOne(
    { _id: deckId },
    {
      $set: {
        sections: [
          {
            name: "Main",
            columns: [
              { cards: [a1, a2, a3].map((id) => new Types.ObjectId(id)) },
              { cards: [new Types.ObjectId(b1)] }
            ]
          },
          { name: "Sideboard", columns: [{ cards: [new Types.ObjectId(sb1)] }] }
        ]
      }
    }
  );
});

describe("GET /api/decks/[id]/export", () => {
  it("renders the basic TXT decklist in column-then-section order", async () => {
    const res = await exportAs("format=txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain('filename="Orzhov Taxes.txt"');
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''Orzhov%20Taxes.txt");

    const text = await res.text();
    expect(text).toBe(
      [
        "Orzhov Taxes",
        "Lifegain and taxes",
        "5 cards",
        "",
        "// Main (4)",
        "2x Godless Shrine",
        "2x Sol Ring",
        "",
        "// Sideboard (1)",
        "1x Godless Shrine",
        ""
      ].join("\n")
    );
  });

  it("separates printings and annotates ownership when asked", async () => {
    const res = await exportAs("format=txt&byPrinting=true&ownership=true");
    const text = await res.text();
    expect(text).toContain("2x Godless Shrine (RNA) 248 [owned]");
    expect(text).toContain("1x Sol Ring (C21) 263 [owned]");
    expect(text).toContain("1x Sol Ring (LEA) 270 [placeholder]");
  });

  it("renders a CSV with the same columns as the XLSX export", async () => {
    const res = await exportAs("format=csv&byPrinting=true&ownership=true");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain('filename="Orzhov Taxes.csv"');
    expect(await res.text()).toBe(
      [
        "Section,Count,Name,Set,Set name,Collector #,Owned,Placeholder,Ownership",
        "Main,2,Godless Shrine,RNA,Ravnica Allegiance,248,2,0,Owned",
        "Main,1,Sol Ring,C21,Commander 2021,263,1,0,Owned",
        "Main,1,Sol Ring,LEA,Limited Edition Alpha,270,0,1,Placeholder",
        "Sideboard,1,Godless Shrine,RNA,Ravnica Allegiance,248,1,0,Owned",
        ""
      ].join("\r\n")
    );
  });

  it("renders an XLSX workbook with a Decklist sheet", async () => {
    const res = await exportAs("format=xlsx&byPrinting=true&ownership=true&tz=Pacific%2FAuckland");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(res.headers.get("content-disposition")).toContain('filename="Orzhov Taxes.xlsx"');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await bodyBytes(res)) as never);
    const sheet = workbook.getWorksheet("Decklist")!;
    const rows: unknown[][] = [];
    sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    expect(rows[0]).toEqual([
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
    expect(rows.slice(1)).toEqual([
      ["Main", 2, "Godless Shrine", "RNA", "Ravnica Allegiance", "248", 2, 0, "Owned"],
      ["Main", 1, "Sol Ring", "C21", "Commander 2021", "263", 1, 0, "Owned"],
      ["Main", 1, "Sol Ring", "LEA", "Limited Edition Alpha", "270", 0, 1, "Placeholder"],
      ["Sideboard", 1, "Godless Shrine", "RNA", "Ravnica Allegiance", "248", 1, 0, "Owned"]
    ]);
    const summary = workbook.getWorksheet("Summary")!;
    const exported = (summary.getRow(summary.rowCount).values as unknown[]).slice(1);
    expect(exported[0]).toBe("Exported");
    expect(exported[1]).toMatch(/^\d{1,2}:\d{2} [AP]M, [A-Z][a-z]+ \d{1,2}(st|nd|rd|th), \d{4}$/);
  });

  it("omits the printing and ownership XLSX columns by default", async () => {
    const res = await exportAs("format=xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await bodyBytes(res)) as never);
    const header = (workbook.getWorksheet("Decklist")!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(["Section", "Count", "Name"]);
  });

  it("renders a text-only PDF without touching Scryfall", async () => {
    const imageRequests = vi.fn();
    mswServer.use(
      http.get(`${IMAGE_HOST}/*`, () => {
        imageRequests();
        return HttpResponse.arrayBuffer(PNG_1X1, { headers: { "content-type": "image/png" } });
      })
    );

    const res = await exportAs("format=pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = await bodyBytes(res);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toBe("Orzhov Taxes");
    expect(imageRequests).not.toHaveBeenCalled();
  });

  it("fetches each distinct card image once and embeds them in the PDF", async () => {
    const requested: string[] = [];
    mswServer.use(
      http.get(`${IMAGE_HOST}/*`, ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.arrayBuffer(PNG_1X1, { headers: { "content-type": "image/png" } });
      })
    );

    const plain = await bodyBytes(await exportAs("format=pdf"));
    const res = await exportAs("format=pdf&images=true");
    expect(res.status).toBe(200);
    const bytes = await bodyBytes(res);

    // Grouped by name, so the two Sol Ring printings fold into one row → 2 images.
    expect(requested.sort()).toEqual(["/normal/front/shrine.jpg", "/normal/front/sol-c21.jpg"]);
    // pdf-lib embeds an alpha PNG as an image XObject plus a soft-mask image;
    // count only the primary images (the ones carrying the /SMask reference).
    const pdf = await PDFDocument.load(bytes);
    const imageObjects = pdf.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj.toString())
      .filter((s) => s.includes("/Subtype /Image") && s.includes("/SMask"));
    expect(imageObjects).toHaveLength(2);
    expect(bytes.byteLength).toBeGreaterThan(plain.byteLength);
  });

  it("still renders the PDF when an image fetch fails", async () => {
    mswServer.use(http.get(`${IMAGE_HOST}/*`, () => new HttpResponse(null, { status: 404 })));
    const res = await exportAs("format=pdf&images=true");
    expect(res.status).toBe(200);
    const pdf = await PDFDocument.load(await bodyBytes(res));
    expect(pdf.getPageCount()).toBe(1);
  });

  it("returns 400 for a missing or unknown format", async () => {
    expect((await exportAs("")).status).toBe(400);
    expect((await exportAs("format=docx")).status).toBe(400);
  });

  it("returns 404 for another user's deck", async () => {
    setTestUser(otherUserId);
    const res = await exportAs("format=txt");
    expect(res.status).toBe(404);
  });

  describe("with sideboard and scratch sections", () => {
    beforeEach(async () => {
      // Make the existing "Sideboard" a real sideboard and put a scratch area
      // FIRST in deck order — exports must still list it last.
      const maybe = await seedPhysicalCard(userId, "sol-c21", collectionId, { deckId });
      const deck = await DeckModel.findById(deckId);
      deck!.sections[1].kind = "sideboard";
      deck!.sections.unshift({
        name: "Maybe",
        kind: "scratch",
        columns: [{ cards: [new Types.ObjectId(maybe)] }]
      } as any);
      deck!.markModified("sections");
      await deck!.save();
    });

    it("lists the sideboard then the scratch area after the main deck in the TXT", async () => {
      expect(await (await exportAs("format=txt")).text()).toBe(
        [
          "Orzhov Taxes",
          "Lifegain and taxes",
          "4 cards + 1 sideboard (+1 in scratch area)",
          "",
          "// Main (4)",
          "2x Godless Shrine",
          "2x Sol Ring",
          "",
          "// ===== Sideboard: 1 card =====",
          "",
          "// Sideboard (1)",
          "1x Godless Shrine",
          "",
          "// ===== Scratch area (not part of the deck): 1 card =====",
          "",
          "// Maybe (1)",
          "1x Sol Ring",
          ""
        ].join("\n")
      );
    });

    it("adds a Board column to the CSV", async () => {
      expect(await (await exportAs("format=csv")).text()).toBe(
        [
          "Section,Board,Count,Name",
          "Main,Main,2,Godless Shrine",
          "Main,Main,2,Sol Ring",
          "Sideboard,Sideboard,1,Godless Shrine",
          "Maybe,Scratch,1,Sol Ring",
          ""
        ].join("\r\n")
      );
    });

    it("adds a Board column, greys scratch rows, and splits the XLSX summary", async () => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        Buffer.from(await bodyBytes(await exportAs("format=xlsx"))) as never
      );
      const sheet = workbook.getWorksheet("Decklist")!;
      const rows: unknown[][] = [];
      sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
      expect(rows).toEqual([
        ["Section", "Board", "Count", "Name"],
        ["Main", "Main", 2, "Godless Shrine"],
        ["Main", "Main", 2, "Sol Ring"],
        ["Sideboard", "Sideboard", 1, "Godless Shrine"],
        ["Maybe", "Scratch", 1, "Sol Ring"]
      ]);
      expect(sheet.getRow(5).font?.italic).toBe(true);
      expect(sheet.getRow(2).font?.italic).toBeFalsy();

      const summary = workbook.getWorksheet("Summary")!;
      const pairs: unknown[][] = [];
      summary.eachRow((row) => pairs.push((row.values as unknown[]).slice(1)));
      expect(pairs).toEqual(
        expect.arrayContaining([
          ["Main deck cards", 4],
          ["Sideboard cards", 1],
          ["Scratch area cards (not counted)", 1],
          ["Main", 4],
          ["Sideboard (Sideboard)", 1],
          ["Maybe (Scratch)", 1]
        ])
      );
    });

    for (const query of ["format=pdf", "format=pdf&images=true"]) {
      it(`draws sideboard and scratch headings after the main deck in the PDF (${query})`, async () => {
        mswServer.use(
          http.get(`${IMAGE_HOST}/*`, () =>
            HttpResponse.arrayBuffer(PNG_1X1, { headers: { "content-type": "image/png" } })
          )
        );
        const text = pdfTextLines(await PDFDocument.load(await bodyBytes(await exportAs(query))));
        const main = text.indexOf("Main (4)");
        const sideboard = text.indexOf("Sideboard: 1 card");
        const scratch = text.indexOf("Scratch area (not part of the deck): 1 card");
        const maybe = text.indexOf("Maybe (1)");
        expect(text[2]).toMatch(/^4 cards \+ 1 sideboard \(\+1 in scratch area\) · exported /);
        expect(main).toBeGreaterThan(-1);
        expect(sideboard).toBeGreaterThan(main);
        expect(scratch).toBeGreaterThan(sideboard);
        expect(maybe).toBeGreaterThan(scratch);
      });
    }
  });

  it("includes cards that point at the deck but are missing from its arrangement", async () => {
    const extra = await seedCard({ id: "extra-1", name: "Thalia, Guardian of Thraben" } as any);
    await seedPhysicalCard(userId, extra.id, collectionId, { deckId });
    const text = await (await exportAs("format=txt")).text();
    expect(text).toContain("1x Thalia, Guardian of Thraben");
    expect(text).toContain("6 cards");
  });
});
