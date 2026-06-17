import { describe, it, expect, beforeEach } from "vitest";
import { POST as createCollection } from "@/app/api/collections/route";
import { GET as listSummaries } from "@/app/api/collections/summaries/route";
import {
  GET as getCollection,
  PATCH as patchCollection,
  DELETE as deleteCollection
} from "@/app/api/collections/[id]/route";
import { PATCH as setActive } from "@/app/api/collections/[id]/isActive/route";
import { CollectionModel, PhysicalCardModel, DeckModel } from "@/db/schema";
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

beforeEach(async () => {
  owner = await seedUser();
  setTestUser(owner);
});

describe("POST /api/collections", () => {
  it("creates a collection and 400s without a name", async () => {
    const ok = await createCollection(
      jsonRequest("/api/collections", "POST", { name: "Binder" })
    );
    expect(ok.status).toBe(201);
    expect(ok.headers.get("Location")).toMatch(/^\/api\/collections\//);

    const bad = await createCollection(jsonRequest("/api/collections", "POST", {}));
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/collections/summaries", () => {
  it("returns only the user's collections, newest first", async () => {
    await seedCollection(owner, { name: "Old" });
    await seedCollection(owner, { name: "New" });
    const other = await seedUser("other@example.com");
    await seedCollection(other, { name: "Theirs" });

    const res = await listSummaries(jsonRequest("/api/collections/summaries", "GET"));
    const { collections } = await res.json();
    const names = collections.map((c: any) => c.name);
    expect(names).toContain("Old");
    expect(names).toContain("New");
    expect(names).not.toContain("Theirs");
  });
});

describe("GET /api/collections/[id]?details=true", () => {
  it("returns the collection with its joined cards", async () => {
    const card = await seedCard({ name: "Llanowar Elves" });
    const collectionId = await seedCollection(owner);
    await seedPhysicalCard(owner, card.id, collectionId);

    const res = await getCollection(
      jsonRequest(`/api/collections/${collectionId}?details=true`, "GET"),
      ctx({ id: collectionId })
    );
    expect(res.status).toBe(200);
    const { collection } = await res.json();
    expect(collection.cards).toHaveLength(1);
    expect(collection.cards[0].card.name).toBe("Llanowar Elves");
  });
});

describe("PATCH /api/collections/[id]", () => {
  it("updates name/description and 400s on an empty body", async () => {
    const collectionId = await seedCollection(owner);
    const ok = await patchCollection(
      jsonRequest(`/api/collections/${collectionId}`, "PATCH", { name: "Renamed" }),
      ctx({ id: collectionId })
    );
    expect(ok.status).toBe(200);
    expect((await CollectionModel.findById(collectionId).lean())!.name).toBe("Renamed");

    const bad = await patchCollection(
      jsonRequest(`/api/collections/${collectionId}`, "PATCH", {}),
      ctx({ id: collectionId })
    );
    expect(bad.status).toBe(400);
  });
});

describe("PATCH /api/collections/[id]/isActive (single active invariant)", () => {
  it("activating one collection deactivates all the user's others", async () => {
    const a = await seedCollection(owner, { name: "A", isActive: true });
    const b = await seedCollection(owner, { name: "B" });

    const res = await setActive(
      jsonRequest(`/api/collections/${b}/isActive`, "PATCH", { isActive: true }),
      ctx({ id: b })
    );
    expect(res.status).toBe(200);

    expect((await CollectionModel.findById(a).lean())!.isActive).toBe(false);
    expect((await CollectionModel.findById(b).lean())!.isActive).toBe(true);
  });

  it("400s when isActive is not a boolean", async () => {
    const a = await seedCollection(owner);
    const res = await setActive(
      jsonRequest(`/api/collections/${a}/isActive`, "PATCH", { isActive: "yes" }),
      ctx({ id: a })
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/collections/[id] (cascade)", () => {
  it("deletes the collection, its cards, and pulls those cards from decks", async () => {
    const card = await seedCard();
    const collectionId = await seedCollection(owner);
    const deck = await seedDeck(owner);
    const pcId = await seedPhysicalCard(owner, card.id, collectionId, {
      deckId: deck._id.toString()
    });
    deck.sections[0].columns[0].cards.push(pcId as never);
    deck.markModified("sections");
    await deck.save();

    const res = await deleteCollection(
      jsonRequest(`/api/collections/${collectionId}`, "DELETE"),
      ctx({ id: collectionId })
    );
    expect(res.status).toBe(204);

    expect(await CollectionModel.findById(collectionId)).toBeNull();
    expect(await PhysicalCardModel.countDocuments({ collectionId })).toBe(0);
    const fresh = await DeckModel.findById(deck._id).lean();
    expect(fresh!.sections[0].columns[0].cards).toHaveLength(0);
  });
});
