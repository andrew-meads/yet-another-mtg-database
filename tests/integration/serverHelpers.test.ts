import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { detailPhysicalCards, upsertTags } from "@/lib/server/cardDetails";
import { findOrCreateColumn, pullCardFromAllDecks } from "@/lib/server/deckArrange";
import { DeckModel, TagModel } from "@/db/schema";
import { seedCard, seedCollection, seedDeck, seedPhysicalCard, seedUser } from "./helpers";

describe("detailPhysicalCards", () => {
  it("returns empty entries + cardData for empty input", async () => {
    expect(await detailPhysicalCards([])).toEqual({ entries: [], cardData: {} });
  });

  it("returns entries referencing a card-data map and resolves collection + deck names", async () => {
    const owner = await seedUser();
    const card = await seedCard({ name: "Goblin Guide" });
    const collectionId = await seedCollection(owner, { name: "Mainboard" });
    const deck = await seedDeck(owner, "Burn");
    const deckId = deck._id.toString();
    const pcId = await seedPhysicalCard(owner, card.id, collectionId, {
      deckId,
      notes: "foil",
      tags: ["staple"]
    });

    const { entries, cardData } = await detailPhysicalCards([
      {
        _id: pcId,
        cardId: card.id,
        collectionId,
        deckId,
        notes: "foil",
        tags: ["staple"]
      }
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      _id: pcId,
      cardId: card.id,
      collectionId,
      deckId,
      notes: "foil",
      tags: ["staple"],
      collectionName: "Mainboard",
      deckName: "Burn"
    });
    // The card data is NOT embedded per entry — it lives once in the map.
    expect(entries[0]).not.toHaveProperty("card");
    expect(cardData[card.id].name).toBe("Goblin Guide");
  });

  it("deduplicates card data across copies of the same card", async () => {
    const owner = await seedUser();
    const card = await seedCard({ name: "Shock" });
    const collectionId = await seedCollection(owner);
    const pcA = await seedPhysicalCard(owner, card.id, collectionId);
    const pcB = await seedPhysicalCard(owner, card.id, collectionId);

    const { entries, cardData } = await detailPhysicalCards([
      { _id: pcA, cardId: card.id, collectionId },
      { _id: pcB, cardId: card.id, collectionId }
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.cardId)).toEqual([card.id, card.id]);
    expect(Object.keys(cardData)).toEqual([card.id]);
  });

  it("serves slim card data (projected to the fields the client renders)", async () => {
    const owner = await seedUser();
    const card = await seedCard({ name: "Lightning Bolt" });
    const collectionId = await seedCollection(owner);
    const pcId = await seedPhysicalCard(owner, card.id, collectionId);

    const { cardData } = await detailPhysicalCards([
      { _id: pcId, cardId: card.id, collectionId }
    ]);

    const slim = cardData[card.id];
    expect(slim.name).toBe("Lightning Bolt");
    // Fields no client component reads are projected away.
    expect(slim).not.toHaveProperty("lang");
    expect(slim).not.toHaveProperty("border_color");
    expect(slim).not.toHaveProperty("image_status");
    expect(slim).not.toHaveProperty("_id");
  });

  it("drops physical cards whose Scryfall data is missing", async () => {
    const owner = await seedUser();
    const collectionId = await seedCollection(owner);
    const { entries, cardData } = await detailPhysicalCards([
      { _id: "x", cardId: "does-not-exist", collectionId }
    ]);
    expect(entries).toEqual([]);
    expect(cardData).toEqual({});
  });
});

describe("upsertTags", () => {
  it("no-ops on empty / undefined", async () => {
    await upsertTags(undefined);
    await upsertTags([]);
    expect(await TagModel.countDocuments()).toBe(0);
  });

  it("inserts only new tags and is idempotent", async () => {
    await upsertTags(["a", "b"]);
    await upsertTags(["b", "c"]); // "b" already exists — must not throw on the unique index
    const labels = (await TagModel.find({}, { label: 1, _id: 0 }).lean())
      .map((t) => t.label)
      .sort();
    expect(labels).toEqual(["a", "b", "c"]);
  });
});

describe("findOrCreateColumn", () => {
  it("returns the first column of the first section by default", async () => {
    const owner = await seedUser();
    const deck = await seedDeck(owner);
    const column = findOrCreateColumn(deck);
    expect(column).toBe(deck.sections[0].columns[0]);
  });

  it("creates a Main section + column when the deck has none", async () => {
    const owner = await seedUser();
    const deck = await DeckModel.create({
      name: "Empty",
      description: "",
      owner: new Types.ObjectId(owner),
      sections: []
    });
    const column = findOrCreateColumn(deck);
    expect(deck.sections).toHaveLength(1);
    expect(deck.sections[0].name).toBe("Main");
    expect(column.cards).toEqual([]);
  });

  it("resolves a specific section and column by id", async () => {
    const owner = await seedUser();
    const deck = await seedDeck(owner);
    const sectionId = deck.sections[0]._id!.toString();
    const columnId = deck.sections[0].columns[0]._id!.toString();
    const column = findOrCreateColumn(deck, sectionId, columnId);
    expect(column).toBe(deck.sections[0].columns[0]);
  });
});

describe("pullCardFromAllDecks", () => {
  it("removes the card id from every deck arrangement owned by the user", async () => {
    const owner = await seedUser();
    const pcId = new Types.ObjectId();
    const deck = await DeckModel.create({
      name: "D",
      description: "",
      owner: new Types.ObjectId(owner),
      sections: [{ name: "Main", columns: [{ cards: [pcId] }] }]
    });

    await pullCardFromAllDecks(owner, pcId.toString());

    const fresh = await DeckModel.findById(deck._id).lean();
    expect(fresh!.sections[0].columns[0].cards).toHaveLength(0);
  });
});
