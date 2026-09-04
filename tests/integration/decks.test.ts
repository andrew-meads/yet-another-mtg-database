import { describe, it, expect, beforeEach } from "vitest";
import { GET as getDeck, DELETE as deleteDeck } from "@/app/api/decks/[id]/route";
import { GET as listDecks } from "@/app/api/decks/route";
import { POST as deckCardsOp } from "@/app/api/decks/[id]/cards/route";
import { PATCH as setDeckActive } from "@/app/api/decks/[id]/isActive/route";
import { CollectionModel, DeckModel, PhysicalCardModel } from "@/db/schema";
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
    const { deck: detailed, cardData } = await res.json();
    const allCardIds = detailed.sections.flatMap((s: any) =>
      s.columns.flatMap((c: any) => c.cards.map((card: any) => card._id))
    );
    expect(allCardIds).toContain(pcId);
    // Card data ships once in the top-level map, keyed by Scryfall id.
    expect(cardData[cardId]).toBeDefined();

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

  it("404s for a malformed id instead of surfacing a cast error", async () => {
    for (const details of ["?details=true", ""]) {
      const res = await getDeck(
        jsonRequest(`/api/decks/doesnt-exist${details}`, "GET"),
        ctx({ id: "doesnt-exist" })
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Deck not found" });
    }
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

  it("remove deletes an ephemeral card entirely (no collection to fall back to)", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const pcId = await seedEphemeralCard(owner, cardId, deckId);
    deck.sections[0].columns[0].cards.push(pcId as never);
    deck.markModified("sections");
    await deck.save();

    const res = await deckCardsOp(
      jsonRequest(`/api/decks/${deckId}/cards`, "POST", { op: "remove", physicalCardId: pcId }),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);

    expect(await PhysicalCardModel.findById(pcId)).toBeNull();
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

describe("GET /api/decks/[id]?details=true (ephemeral cards)", () => {
  it("returns ephemeral cards flagged isEphemeral with no collection name", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const pcId = await seedEphemeralCard(owner, cardId, deckId);

    const res = await getDeck(
      jsonRequest(`/api/decks/${deckId}?details=true`, "GET"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(200);
    const { deck: detailed } = await res.json();
    const card = detailed.sections
      .flatMap((s: any) => s.columns.flatMap((c: any) => c.cards))
      .find((c: any) => c._id === pcId);
    expect(card).toBeDefined();
    expect(card.isEphemeral).toBe(true);
    expect(card.collectionId).toBeNull();
    expect(card.collectionName).toBeUndefined();
  });
});

describe("DELETE /api/decks/[id]", () => {
  it("deletes the deck and clears deckId on its cards (cards survive)", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const pcId = await seedPhysicalCard(owner, cardId, collectionId, { deckId });

    const res = await deleteDeck(
      jsonRequest(`/api/decks/${deckId}`, "DELETE"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(204);
    expect(await DeckModel.findById(deckId)).toBeNull();
    const pc = await PhysicalCardModel.findById(pcId).lean();
    expect(pc).not.toBeNull();
    expect(pc!.deckId).toBeNull();
  });

  it("deletes ephemeral cards along with the deck, but keeps collection-backed ones", async () => {
    const deck = await seedDeck(owner);
    const deckId = deck._id.toString();
    const keepId = await seedPhysicalCard(owner, cardId, collectionId, { deckId });
    const ephemeralId = await seedEphemeralCard(owner, cardId, deckId);

    const res = await deleteDeck(
      jsonRequest(`/api/decks/${deckId}`, "DELETE"),
      ctx({ id: deckId })
    );
    expect(res.status).toBe(204);
    expect(await PhysicalCardModel.findById(ephemeralId)).toBeNull();
    const kept = await PhysicalCardModel.findById(keepId).lean();
    expect(kept).not.toBeNull();
    expect(kept!.deckId).toBeNull();
  });
});

describe("PATCH /api/decks/[id]/isActive (single active invariant)", () => {
  it("activating one deck deactivates all the user's others", async () => {
    const a = await seedDeck(owner, "Deck A", { isActive: true });
    const b = await seedDeck(owner, "Deck B");

    const res = await setDeckActive(
      jsonRequest(`/api/decks/${b._id}/isActive`, "PATCH", { isActive: true }),
      ctx({ id: b._id.toString() })
    );
    expect(res.status).toBe(200);

    expect((await DeckModel.findById(a._id).lean())!.isActive).toBe(false);
    expect((await DeckModel.findById(b._id).lean())!.isActive).toBe(true);
  });

  it("leaves the active collection untouched (a collection and a deck can both be active)", async () => {
    const activeCollectionId = await seedCollection(owner, { name: "Active", isActive: true });
    const deck = await seedDeck(owner);

    const res = await setDeckActive(
      jsonRequest(`/api/decks/${deck._id}/isActive`, "PATCH", { isActive: true }),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(200);

    expect((await DeckModel.findById(deck._id).lean())!.isActive).toBe(true);
    expect((await CollectionModel.findById(activeCollectionId).lean())!.isActive).toBe(true);
  });

  it("deactivates a deck without activating another", async () => {
    const deck = await seedDeck(owner, "Deck A", { isActive: true });

    const res = await setDeckActive(
      jsonRequest(`/api/decks/${deck._id}/isActive`, "PATCH", { isActive: false }),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(200);
    expect((await DeckModel.findById(deck._id).lean())!.isActive).toBe(false);
  });

  it("400s when isActive is not a boolean", async () => {
    const deck = await seedDeck(owner);
    const res = await setDeckActive(
      jsonRequest(`/api/decks/${deck._id}/isActive`, "PATCH", { isActive: "yes" }),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(400);
  });

  it("404s for a deck the user does not own, leaving it unchanged", async () => {
    const other = await seedUser("other@example.com");
    const deck = await seedDeck(other);

    const res = await setDeckActive(
      jsonRequest(`/api/decks/${deck._id}/isActive`, "PATCH", { isActive: true }),
      ctx({ id: deck._id.toString() })
    );
    expect(res.status).toBe(404);
    expect((await DeckModel.findById(deck._id).lean())!.isActive).toBeUndefined();
  });
});

describe("GET /api/decks", () => {
  it("includes isActive in the deck summaries", async () => {
    await seedDeck(owner, "Inactive Deck");
    await seedDeck(owner, "Active Deck", { isActive: true });

    const res = await listDecks(jsonRequest("/api/decks", "GET"));
    expect(res.status).toBe(200);
    const { decks } = await res.json();

    const active = decks.find((d: any) => d.name === "Active Deck");
    const inactive = decks.find((d: any) => d.name === "Inactive Deck");
    expect(active.isActive).toBe(true);
    expect(inactive.isActive).toBeUndefined();
    expect(active.kind).toBe("deck");
  });

  it("includes the description and a card count from the deckId back-refs", async () => {
    const deck = await seedDeck(owner, "Counted Deck", { description: "Aggro brew" });
    await seedDeck(owner, "Empty Deck");
    const deckId = deck._id.toString();

    // Two collection-backed copies + one ephemeral in the deck, one loose copy outside it.
    await seedPhysicalCard(owner, cardId, collectionId, { deckId });
    await seedPhysicalCard(owner, cardId, collectionId, { deckId });
    await seedEphemeralCard(owner, cardId, deckId);
    await seedPhysicalCard(owner, cardId, collectionId);

    const res = await listDecks(jsonRequest("/api/decks", "GET"));
    expect(res.status).toBe(200);
    const { decks } = await res.json();

    const counted = decks.find((d: any) => d.name === "Counted Deck");
    const emptyDeck = decks.find((d: any) => d.name === "Empty Deck");
    expect(counted.description).toBe("Aggro brew");
    expect(counted.cardCount).toBe(3);
    expect(emptyDeck.description).toBe("");
    expect(emptyDeck.cardCount).toBe(0);
  });
});
