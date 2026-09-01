import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { Types } from "mongoose";
import { buildAiTools, buildAiToolSubset } from "@/lib/ai/tools";
import { CardRulingModel, RulesCacheModel } from "@/db/schema";
import {
  seedUser,
  seedCard,
  seedCollection,
  seedDeck,
  seedPhysicalCard,
  seedCardPrice
} from "./helpers";
import "./setup";

beforeAll(() => {
  process.env.SCRYFALL_API_BASE_URL = "https://api.scryfall.test";
  process.env.ACADEMY_RUINS_API_BASE_URL = "https://rules.test";
});

let fetchMock: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => {
  fetchMock?.mockRestore();
  fetchMock = undefined;
});

/** Call a tool's execute the way the SDK would. */
async function run(tool: any, input: any): Promise<any> {
  return tool.execute(input, { toolCallId: "call-1", messages: [] });
}

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  userId = await seedUser("owner@example.com");
  otherUserId = await seedUser("other@example.com");
});

/** Place physical cards into a deck doc's first section/column. */
async function arrangeInDeck(deck: any, physicalIds: string[]) {
  deck.sections[0].columns[0].cards.push(...physicalIds.map((id) => new Types.ObjectId(id)));
  deck.markModified("sections");
  await deck.save();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("readDeck tool", () => {
  it("serializes the deck by section with copy counts", async () => {
    const collectionId = await seedCollection(userId);
    const deck = await seedDeck(userId, "Gruul Aggro");
    const forest = await seedCard({ id: "forest-1", name: "Forest", set: "neo" });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await seedPhysicalCard(userId, forest.id, collectionId, { deckId: String(deck._id) })
      );
    }
    await arrangeInDeck(deck, ids);

    const tools = buildAiTools({ userId });
    const result = await run(tools.readDeck, { deckId: String(deck._id) });

    expect(result.name).toBe("Gruul Aggro");
    expect(result.totalCards).toBe(3);
    expect(result.decklist).toContain("## Main (3 cards)");
    expect(result.decklist).toContain("3x Forest [neo]");
  });

  it("lists back-ref copies missing from the arrangement as unsorted", async () => {
    const collectionId = await seedCollection(userId);
    const deck = await seedDeck(userId);
    const card = await seedCard({ id: "stray-1", name: "Stray Card" });
    await seedPhysicalCard(userId, card.id, collectionId, { deckId: String(deck._id) });

    const tools = buildAiTools({ userId });
    const result = await run(tools.readDeck, { deckId: String(deck._id) });
    expect(result.decklist).toContain("## (unsorted) (1 cards)");
    expect(result.decklist).toContain("1x Stray Card");
  });

  it("cannot read another user's deck and rejects malformed ids", async () => {
    const deck = await seedDeck(otherUserId);
    const tools = buildAiTools({ userId });
    expect(await run(tools.readDeck, { deckId: String(deck._id) })).toEqual({
      error: "Deck not found"
    });
    expect(await run(tools.readDeck, { deckId: "not-an-id" })).toEqual({
      error: "Invalid deck id"
    });
  });
});

describe("readCollection tool", () => {
  it("returns counts and a q-scoped slice", async () => {
    const collectionId = await seedCollection(userId, { name: "Main" });
    const goblin = await seedCard({ id: "gob-1", name: "Goblin Guide", type_line: "Creature — Goblin" });
    const forest = await seedCard({ id: "for-1", name: "Forest", type_line: "Basic Land — Forest" });
    await seedPhysicalCard(userId, goblin.id, collectionId);
    await seedPhysicalCard(userId, goblin.id, collectionId);
    await seedPhysicalCard(userId, forest.id, collectionId);

    const tools = buildAiTools({ userId });
    const all = await run(tools.readCollection, { collectionId });
    expect(all.totalCopies).toBe(3);
    expect(all.distinctCards).toBe(2);

    const filtered = await run(tools.readCollection, { collectionId, q: "t:goblin" });
    expect(filtered.matchedCopies).toBe(2);
    expect(filtered.cards).toContain("2x Goblin Guide");
    expect(filtered.cards).not.toContain("Forest");
  });

  it("cannot read another user's collection", async () => {
    const collectionId = await seedCollection(otherUserId);
    const tools = buildAiTools({ userId });
    expect(await run(tools.readCollection, { collectionId })).toEqual({
      error: "Collection not found"
    });
  });
});

describe("searchCards / searchMyCards tools", () => {
  it("searchCards spans the whole database; searchMyCards is owner-scoped", async () => {
    const owned = await seedCard({ id: "own-1", name: "Owned Goblin", type_line: "Creature — Goblin" });
    await seedCard({ id: "unowned-1", name: "Unowned Goblin", type_line: "Creature — Goblin" });
    const collectionId = await seedCollection(userId);
    await seedPhysicalCard(userId, owned.id, collectionId);

    const tools = buildAiTools({ userId });
    const allResults = await run(tools.searchCards, { q: "t:goblin" });
    expect(allResults.total).toBe(2);
    // No images, no Mongo internals in the LLM payload.
    expect(allResults.cards[0]).not.toHaveProperty("image_uris");
    expect(allResults.cards[0]).not.toHaveProperty("_id");

    const mine = await run(tools.searchMyCards, { q: "t:goblin" });
    expect(mine.total).toBe(1);
    expect(mine.cards[0].name).toBe("Owned Goblin");

    const othersView = await run(buildAiTools({ userId: otherUserId }).searchMyCards, {
      q: "t:goblin"
    });
    expect(othersView.total).toBe(0);
  });

  it("passes a time cap to the query and surfaces a timeout as an in-band error", async () => {
    const { CardData } = await import("@/db/schema");
    const timeoutError = Object.assign(new Error("operation exceeded time limit"), {
      codeName: "MaxTimeMSExpired"
    });
    const aggSpy = vi.spyOn(CardData, "aggregate").mockRejectedValue(timeoutError as never);
    try {
      const result = await run(buildAiTools({ userId }).searchMyCards, { q: "t:creature" });
      expect(result.error).toMatch(/searchMyCards is unavailable: operation exceeded time limit/);
      // The tool requested a bounded query, not an open-ended one.
      expect((aggSpy.mock.calls[0] as unknown[])[1]).toMatchObject({ maxTimeMS: 15000 });
    } finally {
      aggSpy.mockRestore();
    }
  });
});

describe("getCardDetails tool", () => {
  it("returns oracle text plus cached prices and reports unknown names", async () => {
    const card = await seedCard({ id: "bolt-1", name: "Lightning Bolt", oracle_text: "Deal 3 damage." });
    await seedCardPrice(card.id, { usd: "2.50" }, new Date(Date.now() - HOUR));

    const tools = buildAiTools({ userId });
    const result = await run(tools.getCardDetails, { names: ["lightning bolt", "No Such Card"] });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].oracle_text).toBe("Deal 3 damage.");
    expect(result.cards[0].prices.usd).toBe("2.50");
    expect(result.notFound).toEqual(["No Such Card"]);
  });
});

describe("manaBaseStats tool", () => {
  it("computes exact stats for the whole deck", async () => {
    const collectionId = await seedCollection(userId);
    const deck = await seedDeck(userId, "Mono Green");
    const forest = await seedCard({
      id: "mb-forest",
      name: "Forest",
      type_line: "Basic Land — Forest",
      cmc: 0,
      produced_mana: ["G"],
      mana_cost: ""
    });
    const elf = await seedCard({
      id: "mb-elf",
      name: "Llanowar Elves",
      type_line: "Creature — Elf Druid",
      cmc: 1,
      mana_cost: "{G}",
      oracle_text: "{T}: Add {G}."
    });
    const ids = [
      await seedPhysicalCard(userId, forest.id, collectionId, { deckId: String(deck._id) }),
      await seedPhysicalCard(userId, forest.id, collectionId, { deckId: String(deck._id) }),
      await seedPhysicalCard(userId, elf.id, collectionId, { deckId: String(deck._id) })
    ];
    await arrangeInDeck(deck, ids);

    const tools = buildAiTools({ userId });
    const result = await run(tools.manaBaseStats, { deckId: String(deck._id) });
    expect(result.deckName).toBe("Mono Green");
    expect(result.stats.landCount).toBe(2);
    expect(result.stats.nonlandCount).toBe(1);
    expect(result.stats.sources.G).toBe(3);
    expect(result.stats.pips.G).toBe(1);
  });

  it("scopes to a named section and rejects unknown sections", async () => {
    const collectionId = await seedCollection(userId);
    const deck = await seedDeck(userId);
    const forest = await seedCard({ id: "sec-forest", name: "Forest", type_line: "Basic Land — Forest", cmc: 0 });
    const ids = [
      await seedPhysicalCard(userId, forest.id, collectionId, { deckId: String(deck._id) })
    ];
    await arrangeInDeck(deck, ids);

    const tools = buildAiTools({ userId });
    const scoped = await run(tools.manaBaseStats, { deckId: String(deck._id), sectionName: "main" });
    expect(scoped.scope).toBe("main");
    expect(scoped.stats.landCount).toBe(1);

    const unknown = await run(tools.manaBaseStats, {
      deckId: String(deck._id),
      sectionName: "Sideboard"
    });
    expect(unknown.error).toMatch(/No section named "Sideboard"/);
  });

  it("cannot analyze another user's deck", async () => {
    const deck = await seedDeck(otherUserId);
    const tools = buildAiTools({ userId });
    expect(await run(tools.manaBaseStats, { deckId: String(deck._id) })).toEqual({
      error: "Deck not found"
    });
  });
});

describe("getRulings tool", () => {
  it("serves a fresh cache without calling Scryfall", async () => {
    const card = await seedCard({ id: "rul-1", name: "Tricky Card" });
    await CardRulingModel.create({
      cardId: card.id,
      rulings: [{ source: "wotc", published_at: "2024-01-01", comment: "Cached ruling." }]
    });
    fetchMock = vi.spyOn(globalThis, "fetch") as any;

    const tools = buildAiTools({ userId });
    const result = await run(tools.getRulings, { cardName: "Tricky Card" });
    expect(result.rulings).toEqual([{ published_at: "2024-01-01", comment: "Cached ruling." }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a stale cache from Scryfall and upserts it", async () => {
    const card = await seedCard({ id: "rul-2", name: "Stale Card" });
    const doc = await CardRulingModel.create({
      cardId: card.id,
      rulings: [{ source: "wotc", published_at: "2020-01-01", comment: "Old ruling." }]
    });
    await CardRulingModel.updateOne(
      { _id: doc._id },
      { $set: { updatedAt: new Date(Date.now() - 8 * DAY) } },
      { timestamps: false }
    );

    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: [{ source: "wotc", published_at: "2025-06-01", comment: "New ruling." }]
      })
    ) as any;

    const tools = buildAiTools({ userId });
    const result = await run(tools.getRulings, { cardName: "Stale Card" });
    expect(result.rulings).toEqual([{ published_at: "2025-06-01", comment: "New ruling." }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String((fetchMock.mock.calls[0] as any)[0])).toBe(
      "https://api.scryfall.test/cards/rul-2/rulings"
    );

    const stored = await CardRulingModel.findOne({ cardId: card.id }).lean();
    expect(stored!.rulings[0].comment).toBe("New ruling.");
  });

  it("reports unknown card names in-band", async () => {
    const tools = buildAiTools({ userId });
    expect(await run(tools.getRulings, { cardName: "Nope" })).toEqual({
      error: 'Unknown card "Nope"'
    });
  });
});

describe("lookupRule tool", () => {
  it("fetches a rule with examples and caches it", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes("/cr/example/")) {
        return Response.json({ ruleNumber: "702.19b", examples: ["Example text."] });
      }
      return Response.json({ ruleNumber: "702.19b", ruleText: "Trample rules text." });
    }) as any;

    const tools = buildAiTools({ userId });
    const result = await run(tools.lookupRule, { kind: "rule", query: "702.19b" });
    expect(result).toEqual({
      title: "702.19b",
      text: "Trample rules text.",
      examples: ["Example text."]
    });

    // Second call is served from the cache — no further fetches.
    fetchMock.mockClear();
    const again = await run(tools.lookupRule, { kind: "rule", query: "702.19b" });
    expect(again.title).toBe("702.19b");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await RulesCacheModel.countDocuments({ key: "rule:702.19b" })).toBe(1);
  });

  it("resolves keywords through the keyword lists when the glossary 404s", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes("/cr/glossary/")) {
        return Response.json({ detail: "Entry not found." }, { status: 404 });
      }
      if (url.endsWith("/cr/keywords")) {
        return Response.json({ keywordAbilities: ["Deathtouch", "Trample"], keywordActions: [] });
      }
      if (url.includes("/cr/example/")) {
        return Response.json({ ruleNumber: "702.3", examples: null });
      }
      return Response.json({ ruleNumber: "702.3a", ruleText: "Trample text." });
    }) as any;

    const tools = buildAiTools({ userId });
    const result = await run(tools.lookupRule, { kind: "glossary", query: "Trample" });
    expect(result.title).toBe("trample (rule 702.3a)");
    expect(result.text).toBe("Trample text.");
  });

  it("returns not-found in-band", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.endsWith("/cr/keywords")) {
        return Response.json({ keywordAbilities: [], keywordActions: [] });
      }
      return Response.json({ detail: "Entry not found." }, { status: 404 });
    }) as any;

    const tools = buildAiTools({ userId });
    const result = await run(tools.lookupRule, { kind: "glossary", query: "flumph" });
    expect(result.error).toMatch(/No keyword or glossary entry found/);
  });
});

describe("tool debug logging", () => {
  it("logs one call line and one timing/result line per execution", async () => {
    const deck = await seedDeck(userId, "Logged Deck");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await run(buildAiTools({ userId }).readDeck, { deckId: String(deck._id) });
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.startsWith("[ai] tool readDeck called:"))).toBe(true);
      expect(lines.some((l) => /\[ai\] tool readDeck finished in \d+ms → ok/.test(l))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("buildAiToolSubset", () => {
  it("returns only the requested tools", () => {
    const subset = buildAiToolSubset({ userId }, ["readDeck", "lookupRule"]);
    expect(Object.keys(subset)).toEqual(["readDeck", "lookupRule"]);
  });
});
