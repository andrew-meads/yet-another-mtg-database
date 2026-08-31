import { describe, it, expect, beforeEach } from "vitest";
import { POST as archiveDeck } from "@/app/api/decks/[id]/archive/route";
import { POST as fillDeck } from "@/app/api/decks/[id]/fill/route";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
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

let owner: string;
let cardId: string;
let collectionId: string;

beforeEach(async () => {
  owner = await seedUser();
  setTestUser(owner);
  cardId = (await seedCard()).id;
  collectionId = await seedCollection(owner);
});

/** Push physical-card ids into the deck's first column, in order. */
async function arrange(deck: Awaited<ReturnType<typeof seedDeck>>, ...pcIds: string[]) {
  deck.sections[0].columns[0].cards.push(...(pcIds as never[]));
  deck.markModified("sections");
  await deck.save();
}

function firstColumnIds(deckDoc: { sections: { columns: { cards: unknown[] }[] }[] }) {
  return deckDoc.sections[0].columns[0].cards.map(String);
}

describe("POST /api/decks/[id]/archive", () => {
  it("returns real cards to their collections and swaps in ephemeral placeholders in place", async () => {
    const otherCard = await seedCard({ name: "Other Card" });
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const realA = await seedPhysicalCard(owner, cardId, collectionId, { deckId });
    const realB = await seedPhysicalCard(owner, otherCard.id, collectionId, { deckId });
    const ephemeral = await seedEphemeralCard(owner, cardId, deckId);
    await arrange(deck, realA, ephemeral, realB);

    const res = await archiveDeck(
      jsonRequest(`/api/decks/${deckId}/archive`, "POST"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: 2 });

    // Real cards are back in their collection, no longer in the deck.
    for (const realId of [realA, realB]) {
      const pc = await PhysicalCardModel.findById(realId).lean();
      expect(pc!.deckId).toBeNull();
      expect(String(pc!.collectionId)).toBe(collectionId);
    }

    // Each real card's slot now holds a new ephemeral of the same printing;
    // the pre-existing ephemeral kept its exact slot.
    const fresh = await DeckModel.findById(deckId).lean();
    const ids = firstColumnIds(fresh!);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ephemeral);
    expect(ids).not.toContain(realA);
    expect(ids).not.toContain(realB);
    const placeholderA = await PhysicalCardModel.findById(ids[0]).lean();
    const placeholderB = await PhysicalCardModel.findById(ids[2]).lean();
    expect(placeholderA!.cardId).toBe(cardId);
    expect(placeholderB!.cardId).toBe(otherCard.id);
    for (const placeholder of [placeholderA, placeholderB]) {
      expect(placeholder!.collectionId).toBeNull();
      expect(String(placeholder!.deckId)).toBe(deckId);
    }
  });

  it("does not copy notes/tags onto the placeholders", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const realId = await seedPhysicalCard(owner, cardId, collectionId, {
      deckId,
      notes: "foil",
      tags: ["trade"]
    });
    await arrange(deck, realId);

    const res = await archiveDeck(
      jsonRequest(`/api/decks/${deckId}/archive`, "POST"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);

    const fresh = await DeckModel.findById(deckId).lean();
    const placeholder = await PhysicalCardModel.findById(firstColumnIds(fresh!)[0]).lean();
    expect(placeholder!.notes).toBeUndefined();
    expect(placeholder!.tags ?? []).toHaveLength(0);
    // The real card keeps its metadata.
    const real = await PhysicalCardModel.findById(realId).lean();
    expect(real!.notes).toBe("foil");
    expect(real!.tags).toEqual(["trade"]);
  });

  it("is a no-op for an empty deck", async () => {
    const deck = await seedDeck(owner);
    const res = await archiveDeck(
      jsonRequest(`/api/decks/${deck._id}/archive`, "POST"),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: 0 });
  });

  it("is a no-op for an all-ephemeral deck (no new cards created)", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const ephemeral = await seedEphemeralCard(owner, cardId, deckId);
    await arrange(deck, ephemeral);
    const before = await PhysicalCardModel.countDocuments();

    const res = await archiveDeck(
      jsonRequest(`/api/decks/${deckId}/archive`, "POST"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: 0 });
    expect(await PhysicalCardModel.countDocuments()).toBe(before);
    const fresh = await DeckModel.findById(deckId).lean();
    expect(firstColumnIds(fresh!)).toEqual([ephemeral]);
  });

  it("404s for an unknown deck", async () => {
    const res = await archiveDeck(
      jsonRequest(`/api/decks/000000000000000000000000/archive`, "POST"),
      ctx({ id: "000000000000000000000000" })
    );
    expect(res.status).toBe(404);
  });

  it("404s for a deck the user does not own, leaving its cards unchanged", async () => {
    const other = await seedUser("other@example.com");
    const otherCollection = await seedCollection(other);
    const deck = await seedDeck(other);
    const deckId = deck._id.toString();
    const realId = await seedPhysicalCard(other, cardId, otherCollection, { deckId });
    await arrange(deck, realId);

    const res = await archiveDeck(
      jsonRequest(`/api/decks/${deckId}/archive`, "POST"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(404);
    const pc = await PhysicalCardModel.findById(realId).lean();
    expect(String(pc!.deckId)).toBe(deckId);
  });
});

describe("POST /api/decks/[id]/fill", () => {
  it("replaces an ephemeral with a real card in its exact slot and deletes the ephemeral", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const before = await seedEphemeralCard(owner, cardId, deckId);
    const target = await seedEphemeralCard(owner, cardId, deckId);
    const after = await seedEphemeralCard(owner, cardId, deckId);
    await arrange(deck, before, target, after);
    const realId = await seedPhysicalCard(owner, cardId, collectionId);

    const res = await fillDeck(
      jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
        swaps: [{ ephemeralId: target, physicalCardId: realId }]
      }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, filled: 1 });

    expect(await PhysicalCardModel.findById(target)).toBeNull();
    const real = await PhysicalCardModel.findById(realId).lean();
    expect(String(real!.deckId)).toBe(deckId);
    expect(String(real!.collectionId)).toBe(collectionId);
    const fresh = await DeckModel.findById(deckId).lean();
    expect(firstColumnIds(fresh!)).toEqual([before, realId, after]);
  });

  it("pulls a real card out of its previous deck's arrangement", async () => {
    const deckA = await seedDeck(owner, "A");
    const deckB = await seedDeck(owner, "B");
    const deckAId = deckA._id.toString();
    const ephemeralId = await seedEphemeralCard(owner, cardId, deckAId);
    await arrange(deckA, ephemeralId);
    const realId = await seedPhysicalCard(owner, cardId, collectionId, {
      deckId: deckB._id.toString()
    });
    await arrange(deckB, realId);

    const res = await fillDeck(
      jsonRequest(`/api/decks/${deckAId}/fill`, "POST", {
        swaps: [{ ephemeralId, physicalCardId: realId }]
      }),
      ctx({ id: deckAId })
    );
    expect(res.status).toBe(200);

    const freshB = await DeckModel.findById(deckB._id).lean();
    expect(firstColumnIds(freshB!)).not.toContain(realId);
    const real = await PhysicalCardModel.findById(realId).lean();
    expect(String(real!.deckId)).toBe(deckAId);
    const freshA = await DeckModel.findById(deckAId).lean();
    expect(firstColumnIds(freshA!)).toEqual([realId]);
  });

  it("applies multiple swaps preserving every position", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const eph1 = await seedEphemeralCard(owner, cardId, deckId);
    const keep = await seedEphemeralCard(owner, cardId, deckId);
    const eph2 = await seedEphemeralCard(owner, cardId, deckId);
    await arrange(deck, eph1, keep, eph2);
    const real1 = await seedPhysicalCard(owner, cardId, collectionId);
    const real2 = await seedPhysicalCard(owner, cardId, collectionId);

    const res = await fillDeck(
      jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
        swaps: [
          { ephemeralId: eph1, physicalCardId: real1 },
          { ephemeralId: eph2, physicalCardId: real2 }
        ]
      }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, filled: 2 });

    const fresh = await DeckModel.findById(deckId).lean();
    expect(firstColumnIds(fresh!)).toEqual([real1, keep, real2]);
  });

  it("400s on a missing or empty swaps array", async () => {
    const deck = await seedDeck(owner);
    for (const body of [{}, { swaps: [] }, { swaps: "nope" }]) {
      const res = await fillDeck(
        jsonRequest(`/api/decks/${deck._id}/fill`, "POST", body),
        ctx({ id: deck._id.toString() })
      );
      expect(res.status).toBe(400);
    }
  });

  it("400s on malformed or duplicate ids", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const ephemeralId = await seedEphemeralCard(owner, cardId, deckId);
    const realId = await seedPhysicalCard(owner, cardId, collectionId);

    const malformed = await fillDeck(
      jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
        swaps: [{ ephemeralId: "not-an-id", physicalCardId: realId }]
      }),
      ctx({ id: deckId })
    );
    expect(malformed.status).toBe(400);

    const duplicated = await fillDeck(
      jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
        swaps: [
          { ephemeralId, physicalCardId: realId },
          { ephemeralId, physicalCardId: realId }
        ]
      }),
      ctx({ id: deckId })
    );
    expect(duplicated.status).toBe(400);
  });

  it("400s without partial writes when any swap is invalid", async () => {
    const deck = await seedDeck(owner);
    const otherDeck = await seedDeck(owner, "Other");
    const deckId = deck._id.toString();
    const validEphemeral = await seedEphemeralCard(owner, cardId, deckId);
    const foreignEphemeral = await seedEphemeralCard(owner, cardId, otherDeck._id.toString());
    await arrange(deck, validEphemeral);
    const validReal = await seedPhysicalCard(owner, cardId, collectionId);
    const otherReal = await seedPhysicalCard(owner, cardId, collectionId);

    const res = await fillDeck(
      jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
        swaps: [
          { ephemeralId: validEphemeral, physicalCardId: validReal },
          // Invalid: this ephemeral belongs to a different deck.
          { ephemeralId: foreignEphemeral, physicalCardId: otherReal }
        ]
      }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.invalid).toContain(foreignEphemeral);

    // Nothing was applied — the valid half of the request included.
    expect(await PhysicalCardModel.findById(validEphemeral)).not.toBeNull();
    const real = await PhysicalCardModel.findById(validReal).lean();
    expect(real!.deckId).toBeNull();
    const fresh = await DeckModel.findById(deckId).lean();
    expect(firstColumnIds(fresh!)).toEqual([validEphemeral]);
  });

  it("400s when the 'ephemeral' is actually a collection-backed card", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const notEphemeral = await seedPhysicalCard(owner, cardId, collectionId, { deckId });
    const realId = await seedPhysicalCard(owner, cardId, collectionId);

    const res = await fillDeck(
      jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
        swaps: [{ ephemeralId: notEphemeral, physicalCardId: realId }]
      }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).invalid).toContain(notEphemeral);
  });

  it("400s when the replacement card is itself ephemeral or unowned", async () => {
    const other = await seedUser("other@example.com");
    const otherCollection = await seedCollection(other);
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const ephemeralId = await seedEphemeralCard(owner, cardId, deckId);
    const ephemeralReplacement = await seedEphemeralCard(owner, cardId, deckId);
    const unownedReplacement = await seedPhysicalCard(other, cardId, otherCollection);

    for (const physicalCardId of [ephemeralReplacement, unownedReplacement]) {
      const res = await fillDeck(
        jsonRequest(`/api/decks/${deckId}/fill`, "POST", {
          swaps: [{ ephemeralId, physicalCardId }]
        }),
        ctx({ id: deckId })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).invalid).toContain(physicalCardId);
    }
  });

  it("404s for a deck the user does not own", async () => {
    const other = await seedUser("other@example.com");
    const deck = await seedDeck(other);
    const res = await fillDeck(
      jsonRequest(`/api/decks/${deck._id}/fill`, "POST", { swaps: [] }),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(404);
  });
});
