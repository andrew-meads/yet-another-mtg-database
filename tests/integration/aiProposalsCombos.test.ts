import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { Types } from "mongoose";
import { buildAiTools } from "@/lib/ai/tools";
import { PhysicalCardModel, DeckModel } from "@/db/schema";
import { seedUser, seedCard, seedCollection, seedDeck, seedPhysicalCard } from "./helpers";
import "./setup";

 

beforeAll(() => {
  process.env.COMMANDER_SPELLBOOK_API_BASE_URL = "https://spellbook.test";
});

let fetchMock: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => {
  fetchMock?.mockRestore();
  fetchMock = undefined;
});

async function run(tool: any, input: any): Promise<any> {
  return tool.execute(input, { toolCallId: "call-1", messages: [] });
}

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  userId = await seedUser("owner@example.com");
  otherUserId = await seedUser("other@example.com");
});

/** Seed a deck with a Main + Sideboard section holding 2x Bolt + 1x Forest in Main. */
async function seedProposalDeck() {
  const collectionId = await seedCollection(userId);
  const deck = await DeckModel.create({
    name: "Prop Deck",
    description: "",
    owner: new Types.ObjectId(userId),
    sections: [
      { name: "Main", columns: [{ cards: [] }] },
      { name: "Sideboard", columns: [{ cards: [] }] }
    ]
  });
  const bolt = await seedCard({ id: "prop-bolt", name: "Lightning Bolt" });
  const forest = await seedCard({ id: "prop-forest", name: "Forest", type_line: "Basic Land — Forest" });
  const ids = [
    await seedPhysicalCard(userId, bolt.id, collectionId, { deckId: String(deck._id) }),
    await seedPhysicalCard(userId, bolt.id, collectionId, { deckId: String(deck._id) }),
    await seedPhysicalCard(userId, forest.id, collectionId, { deckId: String(deck._id) })
  ];
  const d = await DeckModel.findById(deck._id);
  d!.sections[0].columns[0].cards.push(...ids.map((id) => new Types.ObjectId(id)));
  d!.markModified("sections");
  await d!.save();
  return { deck: d!, collectionId, bolt, forest };
}

describe("proposeDeckChanges tool", () => {
  it("validates and echoes a normalized proposal without writing anything", async () => {
    const { deck } = await seedProposalDeck();
    await seedCard({ id: "prop-shock", name: "Shock" });
    const before = await PhysicalCardModel.countDocuments({});

    const tools = buildAiTools({ userId });
    const result = await run(tools.proposeDeckChanges, {
      deckId: String(deck._id),
      changes: [
        { action: "add", cardName: "shock", count: 2, sectionName: "main", ephemeral: true },
        { action: "remove", cardName: "lightning bolt" },
        { action: "move", cardName: "Forest", sectionName: "Sideboard" }
      ],
      rationale: "Tighten the burn plan."
    });

    expect(result.proposal).toMatchObject({
      deckId: String(deck._id),
      deckName: "Prop Deck",
      rationale: "Tighten the burn plan."
    });
    const [add, remove, move] = result.proposal.changes;
    // Names canonicalized, section names resolved to ids, printing resolved.
    expect(add).toMatchObject({
      action: "add",
      cardName: "Shock",
      cardId: "prop-shock",
      count: 2,
      sectionName: "Main",
      ephemeral: true
    });
    expect(add.sectionId).toBe(String((deck.sections as any)[0]._id));
    expect(remove).toMatchObject({ action: "remove", cardName: "Lightning Bolt", count: 1 });
    expect(move).toMatchObject({ action: "move", cardName: "Forest", sectionName: "Sideboard" });
    expect(move.sectionId).toBe(String((deck.sections as any)[1]._id));

    // The tool wrote NOTHING: no cards created, deck arrays untouched.
    expect(await PhysicalCardModel.countDocuments({})).toBe(before);
    const untouched = await DeckModel.findById(deck._id).lean();
    expect((untouched!.sections as any)[0].columns[0].cards).toHaveLength(3);
    expect((untouched!.sections as any)[1].columns[0].cards).toHaveLength(0);
  });

  it("rejects a foreign deck", async () => {
    const foreignDeck = await seedDeck(otherUserId);
    const tools = buildAiTools({ userId });
    const result = await run(tools.proposeDeckChanges, {
      deckId: String(foreignDeck._id),
      changes: [{ action: "add", cardName: "Shock" }],
      rationale: "nope"
    });
    expect(result).toEqual({ error: "Deck not found" });
  });

  it("rejects unknown cards, missing copies, bad sections, and move without a destination", async () => {
    const { deck } = await seedProposalDeck();
    const tools = buildAiTools({ userId });
    const result = await run(tools.proposeDeckChanges, {
      deckId: String(deck._id),
      changes: [
        { action: "add", cardName: "Definitely Not A Card" },
        { action: "remove", cardName: "Lightning Bolt", count: 3 },
        { action: "remove", cardName: "Shock" },
        { action: "add", cardName: "Forest", sectionName: "Maybeboard" },
        { action: "move", cardName: "Forest" }
      ],
      rationale: "all invalid"
    });

    expect(result.error).toMatch(/Proposal rejected/);
    expect(result.invalid).toHaveLength(5);
    expect(result.invalid[0].reason).toMatch(/Unknown card/);
    expect(result.invalid[1].reason).toMatch(/only 2 copies/);
    expect(result.invalid[2].reason).toMatch(/no copies/);
    expect(result.invalid[3].reason).toMatch(/No section named "Maybeboard"/);
    expect(result.invalid[4].reason).toMatch(/move requires a sectionName/);
  });
});

describe("findCombos tool", () => {
  it("posts the deck's card names and returns the slimmed combos", async () => {
    const { deck } = await seedProposalDeck();
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        results: {
          included: [
            {
              id: "1-2",
              uses: [{ card: { name: "Lightning Bolt" } }, { card: { name: "Forest" } }],
              produces: [{ feature: { name: "Infinite damage" } }],
              description: "Zap repeatedly."
            }
          ],
          almostIncluded: [
            {
              id: "3-4",
              uses: [{ card: { name: "Lightning Bolt" } }, { card: { name: "Storm-Kiln Artist" } }],
              produces: [{ feature: { name: "Infinite magecraft" } }]
            }
          ]
        }
      })
    ) as any;

    const tools = buildAiTools({ userId });
    const result = await run(tools.findCombos, { deckId: String(deck._id) });

    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(String(url)).toBe("https://spellbook.test/find-my-combos");
    const sent = JSON.parse(init.body);
    expect(sent.main).toEqual(
      expect.arrayContaining([
        { card: "Lightning Bolt", quantity: 1 },
        { card: "Forest", quantity: 1 }
      ])
    );
    expect(sent.main).toHaveLength(2); // deduplicated names

    expect(result.deckName).toBe("Prop Deck");
    expect(result.included[0]).toMatchObject({
      id: "1-2",
      produces: ["Infinite damage"],
      description: "Zap repeatedly."
    });
    expect(result.almostIncluded[0].missing).toEqual(["Storm-Kiln Artist"]);
  });

  it("cannot search a foreign deck and reports API failures in-band", async () => {
    const foreignDeck = await seedDeck(otherUserId);
    const tools = buildAiTools({ userId });
    expect(await run(tools.findCombos, { deckId: String(foreignDeck._id) })).toEqual({
      error: "Deck not found"
    });

    const { deck } = await seedProposalDeck();
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("busy", { status: 503 })) as any;
    const failure = await run(buildAiTools({ userId }).findCombos, { deckId: String(deck._id) });
    expect(failure.error).toMatch(/findCombos is unavailable: Commander Spellbook returned 503/);
  });
});
