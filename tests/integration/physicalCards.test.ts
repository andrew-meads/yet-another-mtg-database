import { describe, it, expect, beforeEach } from "vitest";
import { POST as createPhysicalCards } from "@/app/api/physical-cards/route";
import {
  PATCH as patchPhysicalCard,
  DELETE as deletePhysicalCard
} from "@/app/api/physical-cards/[id]/route";
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

  it("stores finish and condition on every created copy", async () => {
    const res = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", {
        cardId,
        collectionId,
        quantity: 2,
        finish: "foil",
        condition: "LP"
      })
    );
    expect(res.status).toBe(201);
    const created = await PhysicalCardModel.find({ collectionId }).lean();
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.finish === "foil" && c.condition === "LP")).toBe(true);
  });

  it("leaves finish and condition absent when not given (default = non-foil / NM)", async () => {
    const res = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", { cardId, collectionId })
    );
    expect(res.status).toBe(201);
    const created = await PhysicalCardModel.findOne({ collectionId }).lean();
    expect(created).not.toHaveProperty("finish");
    expect(created).not.toHaveProperty("condition");
  });

  it("400s on an unknown finish or condition without creating anything", async () => {
    const bad = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", { cardId, collectionId, finish: "glossy" })
    );
    expect(bad.status).toBe(400);
    const badCond = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", { cardId, collectionId, condition: "nm" })
    );
    expect(badCond.status).toBe(400);
    expect(await PhysicalCardModel.countDocuments()).toBe(0);
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

  it("creates ephemeral (no-collection) cards and places them in a deck", async () => {
    const deck = await seedDeck(owner);
    const sectionId = deck.sections[0]._id!.toString();
    const columnId = deck.sections[0].columns[0]._id!.toString();

    const res = await createPhysicalCards(
      jsonRequest("/api/physical-cards", "POST", {
        cardId,
        deckId: deck._id.toString(),
        sectionId,
        columnId,
        quantity: 2
      })
    );
    expect(res.status).toBe(201);

    const created = await PhysicalCardModel.find({ deckId: deck._id }).lean();
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.collectionId == null)).toBe(true);
    const fresh = await DeckModel.findById(deck._id).lean();
    expect(fresh!.sections[0].columns[0].cards).toHaveLength(2);
  });

  it("400s when creating an ephemeral card without a deck", async () => {
    const res = await createPhysicalCards(jsonRequest("/api/physical-cards", "POST", { cardId }));
    expect(res.status).toBe(400);
    expect(await PhysicalCardModel.countDocuments()).toBe(0);
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

  it("updates finish and condition independently", async () => {
    const id = await seedPhysicalCard(owner, cardId, collectionId);
    let res = await patchPhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "PATCH", { finish: "etched" }),
      ctx({ id })
    );
    expect(res.status).toBe(200);
    let pc = await PhysicalCardModel.findById(id).lean();
    expect(pc!.finish).toBe("etched");
    expect(pc).not.toHaveProperty("condition");

    res = await patchPhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "PATCH", { condition: "DMG" }),
      ctx({ id })
    );
    expect(res.status).toBe(200);
    pc = await PhysicalCardModel.findById(id).lean();
    expect(pc!.finish).toBe("etched");
    expect(pc!.condition).toBe("DMG");
  });

  it("400s on an invalid finish or condition and changes nothing", async () => {
    const id = await seedPhysicalCard(owner, cardId, collectionId, { finish: "foil" });
    const res = await patchPhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "PATCH", { finish: "shiny", notes: "x" }),
      ctx({ id })
    );
    expect(res.status).toBe(400);
    const pc = await PhysicalCardModel.findById(id).lean();
    expect(pc!.finish).toBe("foil");
    expect(pc!.notes).toBeUndefined();
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

    const res = await deletePhysicalCard(
      jsonRequest(`/api/physical-cards/${id}`, "DELETE"),
      ctx({ id })
    );
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
    for (let i = 0; i < 3; i++)
      await seedPhysicalCard(owner, cardId, collectionId, { tags: ["a"] });
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

  it("matches finish/condition by effective value (unset equals non-foil / NM)", async () => {
    // Two plain copies: one with nothing stored, one with explicit defaults.
    await seedPhysicalCard(owner, cardId, collectionId);
    await seedPhysicalCard(owner, cardId, collectionId, { finish: "nonfoil", condition: "NM" });
    // A foil copy that must survive a "plain group" delete.
    const foilId = await seedPhysicalCard(owner, cardId, collectionId, { finish: "foil" });

    const res = await removeGroup(
      jsonRequest("/api/physical-cards/remove-group", "POST", {
        collectionId,
        cardId,
        deckId: null,
        quantity: 5
      })
    );
    expect(await res.json()).toEqual({ deleted: 2 });
    const remaining = await PhysicalCardModel.find({ collectionId }).lean();
    expect(remaining.map((c) => String(c._id))).toEqual([foilId]);

    // Targeting the foil group deletes only the foil copy.
    const res2 = await removeGroup(
      jsonRequest("/api/physical-cards/remove-group", "POST", {
        collectionId,
        cardId,
        finish: "foil",
        condition: "NM",
        deckId: null,
        quantity: 1
      })
    );
    expect(await res2.json()).toEqual({ deleted: 1 });
    expect(await PhysicalCardModel.countDocuments({ collectionId })).toBe(0);
  });

  it("validates the body", async () => {
    const res = await removeGroup(
      jsonRequest("/api/physical-cards/remove-group", "POST", { collectionId, cardId, quantity: 0 })
    );
    expect(res.status).toBe(400);
  });
});
