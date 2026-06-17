import { describe, it, expect, beforeEach } from "vitest";
import { GET as getDeck, DELETE as deleteDeck } from "@/app/api/decks/[id]/route";
import { POST as deckCardsOp } from "@/app/api/decks/[id]/cards/route";
import { DeckModel, PhysicalCardModel } from "@/db/schema";
import {
  ctx,
  jsonRequest,
  seedCard,
  seedCollection,
  seedDeck,
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

describe("GET /api/decks/[id]?details=true (reconciliation)", () => {
  it("appends orphaned cards (deckId set, missing from arrays) to a default column", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    // Card claims membership via back-ref but is NOT in any column array.
    const pcId = await seedPhysicalCard(owner, cardId, collectionId, { deckId });

    const res = await getDeck(
      jsonRequest(`/api/decks/${deckId}?details=true`, "GET"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);
    const { deck: detailed } = await res.json();
    const allCardIds = detailed.sections.flatMap((s: any) =>
      s.columns.flatMap((c: any) => c.cards.map((card: any) => card._id))
    );
    expect(allCardIds).toContain(pcId);

    // Reconciliation is persisted.
    const fresh = await DeckModel.findById(deckId).lean();
    const persisted = fresh!.sections.flatMap((s) => s.columns.flatMap((c) => c.cards.map(String)));
    expect(persisted).toContain(pcId);
  });

  it("404s for a deck the user does not own", async () => {
    const other = await seedUser("other@example.com");
    const deck = await seedDeck(other);
    const res = await getDeck(
      jsonRequest(`/api/decks/${deck._id}?details=true`, "GET"),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/decks/[id]/cards", () => {
  it("places a card, setting the back-ref and splicing into the column", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const pcId = await seedPhysicalCard(owner, cardId, collectionId);

    const res = await deckCardsOp(
      jsonRequest(`/api/decks/${deckId}/cards`, "POST", { op: "place", physicalCardId: pcId }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);

    const pc = await PhysicalCardModel.findById(pcId).lean();
    expect(String(pc!.deckId)).toBe(deckId);
    const fresh = await DeckModel.findById(deckId).lean();
    expect(fresh!.sections[0].columns[0].cards.map(String)).toContain(pcId);
  });

  it("placing into a new deck clears the card from its previous deck (one-deck invariant)", async () => {
    const deckA = await seedDeck(owner, "A");
    const deckB = await seedDeck(owner, "B");
    const pcId = await seedPhysicalCard(owner, cardId, collectionId);

    await deckCardsOp(
      jsonRequest(`/api/decks/${deckA._id}/cards`, "POST", { op: "place", physicalCardId: pcId }),
      ctx({ id: deckA._id.toString() })
    );
    await deckCardsOp(
      jsonRequest(`/api/decks/${deckB._id}/cards`, "POST", { op: "place", physicalCardId: pcId }),
      ctx({ id: deckB._id.toString() })
    );

    const freshA = await DeckModel.findById(deckA._id).lean();
    const freshB = await DeckModel.findById(deckB._id).lean();
    expect(freshA!.sections[0].columns[0].cards.map(String)).not.toContain(pcId);
    expect(freshB!.sections[0].columns[0].cards.map(String)).toContain(pcId);
    const pc = await PhysicalCardModel.findById(pcId).lean();
    expect(String(pc!.deckId)).toBe(deckB._id.toString());
  });

  it("remove clears the deck assignment but keeps the card in its collection", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const pcId = await seedPhysicalCard(owner, cardId, collectionId, { deckId });
    deck.sections[0].columns[0].cards.push(pcId as never);
    deck.markModified("sections");
    await deck.save();

    const res = await deckCardsOp(
      jsonRequest(`/api/decks/${deckId}/cards`, "POST", { op: "remove", physicalCardId: pcId }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);

    const pc = await PhysicalCardModel.findById(pcId).lean();
    expect(pc!.deckId).toBeNull();
    expect(String(pc!.collectionId)).toBe(collectionId);
    const fresh = await DeckModel.findById(deckId).lean();
    expect(fresh!.sections[0].columns[0].cards).toHaveLength(0);
  });

  it("404s for a physical card the user does not own", async () => {
    const deck = await seedDeck(owner);
    const res = await deckCardsOp(
      jsonRequest(`/api/decks/${deck._id}/cards`, "POST", {
        op: "place",
        physicalCardId: "000000000000000000000000"
      }),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/decks/[id]", () => {
  it("deletes the deck and clears deckId on its cards (cards survive)", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const pcId = await seedPhysicalCard(owner, cardId, collectionId, { deckId });

    const res = await deleteDeck(jsonRequest(`/api/decks/${deckId}`, "DELETE"), ctx({ id: deckId }));
    expect(res.status).toBe(204);
    expect(await DeckModel.findById(deckId)).toBeNull();
    const pc = await PhysicalCardModel.findById(pcId).lean();
    expect(pc).not.toBeNull();
    expect(pc!.deckId).toBeNull();
  });
});
