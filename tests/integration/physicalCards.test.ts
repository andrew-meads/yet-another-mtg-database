import { describe, it, expect, beforeEach } from "vitest";
import { POST as createPhysicalCards } from "@/app/api/physical-cards/route";
import { PATCH as patchPhysicalCard, DELETE as deletePhysicalCard } from "@/app/api/physical-cards/[id]/route";
import { POST as removeGroup } from "@/app/api/physical-cards/remove-group/route";
import { PhysicalCardModel, DeckModel, TagModel } from "@/db/schema";
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

describe("POST /api/physical-cards", () => {
  it("rejects when cardId or collectionId is missing", async () => {
    const res = await createPhysicalCards(jsonRequest("/api/physical-cards", "POST", { cardId }));
    expect(res.status).toBe(400);
  });

  it("404s when the collection is not owned by the user", async () => {
    const other = await seedUser("other@example.com");
    const otherColl = await seedCollection(other);
    const res = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", { cardId, collectionId: otherColl })
    );
    expect(res.status).toBe(404);
  });

  it("creates N copies and upserts tags", async () => {
    const res = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", {
        cardId,
        collectionId,
        quantity: 3,
        tags: ["staple", "foil"]
      })
    );
    expect(res.status).toBe(201);
    const { physicalCardIds } = await res.json();
    expect(physicalCardIds).toHaveLength(3);
    expect(await PhysicalCardModel.countDocuments({ collectionId })).toBe(3);
    expect(await TagModel.countDocuments()).toBe(2);
  });

  it("places created copies into a deck column and sets the back-ref", async () => {
    const deck = await seedDeck(owner);
    const sectionId = deck.sections[0]._id!.toString();
    const columnId = deck.sections[0].columns[0]._id!.toString();

    const res = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", {
        cardId,
        collectionId,
        deckId: deck._id.toString(),
        sectionId,
        columnId,
        quantity: 2
      })
    );
    expect(res.status).toBe(201);

    const fresh = await DeckModel.findById(deck._id).lean();
    expect(fresh!.sections[0].columns[0].cards).toHaveLength(2);
    expect(await PhysicalCardModel.countDocuments({ deckId: deck._id })).toBe(2);
  });
});

describe("PATCH /api/physical-cards/[id]", () => {
  it("updates notes and tags", async () => {
    const id = await seedPhysicalCard(owner, cardId, collectionId);
    const res = await patchPhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "PATCH", { notes: "mint", tags: ["edh"] }),
      ctx({ id })
    );
    expect(res.status).toBe(200);
    const pc = await PhysicalCardModel.findById(id).lean();
    expect(pc!.notes).toBe("mint");
    expect(pc!.tags).toEqual(["edh"]);
    expect(await TagModel.countDocuments({ label: "edh" })).toBe(1);
  });

  it("moves to another collection while keeping the deck assignment", async () => {
    const deck = await seedDeck(owner);
    const id = await seedPhysicalCard(owner, cardId, collectionId, { deckId: deck._id.toString() });
    const dest = await seedCollection(owner, { name: "Binder" });

    const res = await patchPhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "PATCH", { collectionId: dest }),
      ctx({ id })
    );
    expect(res.status).toBe(200);
    const pc = await PhysicalCardModel.findById(id).lean();
    expect(String(pc!.collectionId)).toBe(dest);
    expect(String(pc!.deckId)).toBe(deck._id.toString());
  });

  it("400s when the target collection is not owned", async () => {
    const id = await seedPhysicalCard(owner, cardId, collectionId);
    const other = await seedUser("other@example.com");
    const otherColl = await seedCollection(other);
    const res = await patchPhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "PATCH", { collectionId: otherColl }),
      ctx({ id })
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/physical-cards/[id]", () => {
  it("deletes the card and pulls it from its deck", async () => {
    const deck = await seedDeck(owner);
    const id = await seedPhysicalCard(owner, cardId, collectionId, { deckId: deck._id.toString() });
    deck.sections[0].columns[0].cards.push(id as never);
    deck.markModified("sections");
    await deck.save();

    const res = await deletePhysicalCard(jsonRequest(`/api/physical-cards/${id}`, "DELETE"), ctx({ id }));
    expect(res.status).toBe(204);
    expect(await PhysicalCardModel.findById(id)).toBeNull();
    const fresh = await DeckModel.findById(deck._id).lean();
    expect(fresh!.sections[0].columns[0].cards).toHaveLength(0);
  });

  it("returns 204 even when the card does not exist", async () => {
    const res = await deletePhysicalCard(
      jsonRequest(`/api/physical-cards/000000000000000000000000`, "DELETE"),
      ctx({ id: "000000000000000000000000" })
    );
    expect(res.status).toBe(204);
  });
});

describe("POST /api/physical-cards/remove-group", () => {
  it("deletes only the requested quantity from an exactly-matching group", async () => {
    // 3 loose copies with tag "a", plus 1 with different tags (must be untouched)
    for (let i = 0; i < 3; i++) await seedPhysicalCard(owner, cardId, collectionId, { tags: ["a"] });
    await seedPhysicalCard(owner, cardId, collectionId, { tags: ["b"] });

    const res = await removeGroup(
      jsonRequest("/api/physical-cards/remove-group", "POST", {
        collectionId,
        cardId,
        tags: ["a"],
        deckId: null,
        quantity: 2
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(await PhysicalCardModel.countDocuments({ collectionId, tags: ["a"] })).toBe(1);
    expect(await PhysicalCardModel.countDocuments({ collectionId, tags: ["b"] })).toBe(1);
  });

  it("validates the body", async () => {
    const res = await removeGroup(
      jsonRequest("/api/physical-cards/remove-group", "POST", { collectionId, cardId, quantity: 0 })
    );
    expect(res.status).toBe(400);
  });
});
