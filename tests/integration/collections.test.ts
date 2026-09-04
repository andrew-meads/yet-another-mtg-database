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
    const ok = await createCollection(jsonRequest("/api/collections", "POST", { name: "Binder" }));
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

  it("includes the description and a card count from the collectionId back-refs", async () => {
    const cardId = (await seedCard()).id;
    const countedId = await seedCollection(owner, {
      name: "Counted",
      description: "Binder of staples"
    });
    await seedCollection(owner, { name: "Empty" });

    // Two copies in the collection (one of them deck-assigned still counts).
    const deck = await seedDeck(owner);
    await seedPhysicalCard(owner, cardId, countedId);
    await seedPhysicalCard(owner, cardId, countedId, { deckId: deck._id.toString() });

    const res = await listSummaries(jsonRequest("/api/collections/summaries", "GET"));
    expect(res.status).toBe(200);
    const { collections } = await res.json();

    const counted = collections.find((c: any) => c.name === "Counted");
    const empty = collections.find((c: any) => c.name === "Empty");
    expect(counted.description).toBe("Binder of staples");
    expect(counted.cardCount).toBe(2);
    expect(empty.description).toBe("");
    expect(empty.cardCount).toBe(0);
  });
});

describe("GET /api/collections/[id]?details=true", () => {
  it("returns the collection's card entries plus a deduplicated cardData map", async () => {
    const card = await seedCard({ name: "Llanowar Elves" });
    const collectionId = await seedCollection(owner);
    await seedPhysicalCard(owner, card.id, collectionId);
    await seedPhysicalCard(owner, card.id, collectionId);

    const res = await getCollection(
      jsonRequest(`/api/collections/${collectionId}?details=true`, "GET"),
      ctx({ id: collectionId })
    );
    expect(res.status).toBe(200);
    const { collection, cardData } = await res.json();
    expect(collection.cards).toHaveLength(2);
    expect(collection.cards[0].cardId).toBe(card.id);
    // Card data is not embedded per entry — it ships once in the map.
    expect(collection.cards[0].card).toBeUndefined();
    expect(Object.keys(cardData)).toEqual([card.id]);
    expect(cardData[card.id].name).toBe("Llanowar Elves");
  });
});

describe("GET /api/collections/[id]?details=true&q=... (Scryfall search scope)", () => {
  let collectionId: string;

  beforeEach(async () => {
    collectionId = await seedCollection(owner);
    const goblin = await seedCard({
      name: "Goblin Guide",
      type_line: "Creature — Goblin",
      colors: ["R"],
      color_identity: ["R"],
      cmc: 1,
      rarity: "rare"
    });
    const angel = await seedCard({
      name: "Serra Angel",
      type_line: "Creature — Angel",
      colors: ["W"],
      color_identity: ["W"],
      cmc: 5,
      rarity: "uncommon"
    });
    const bolt = await seedCard({
      name: "Lightning Bolt",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      cmc: 1,
      rarity: "common"
    });
    await seedPhysicalCard(owner, goblin.id, collectionId);
    await seedPhysicalCard(owner, angel.id, collectionId);
    await seedPhysicalCard(owner, bolt.id, collectionId);
  });

  const search = async (q: string) => {
    const res = await getCollection(
      jsonRequest(
        `/api/collections/${collectionId}?details=true&q=${encodeURIComponent(q)}`,
        "GET"
      ),
      ctx({ id: collectionId })
    );
    expect(res.status).toBe(200);
    const { collection, cardData } = await res.json();
    return (collection.cards as { cardId: string }[])
      .map((c) => (cardData as Record<string, { name: string }>)[c.cardId].name)
      .sort();
  };

  it("returns all cards when q is omitted", async () => {
    const res = await getCollection(
      jsonRequest(`/api/collections/${collectionId}?details=true`, "GET"),
      ctx({ id: collectionId })
    );
    const { collection } = await res.json();
    expect(collection.cards).toHaveLength(3);
  });

  it("filters by type", async () => {
    expect(await search("t:creature")).toEqual(["Goblin Guide", "Serra Angel"]);
  });

  it("filters by color", async () => {
    expect(await search("c:r")).toEqual(["Goblin Guide", "Lightning Bolt"]);
  });

  it("filters by a combined query (type + color)", async () => {
    expect(await search("t:creature c:r")).toEqual(["Goblin Guide"]);
  });

  it("filters by rarity comparison", async () => {
    expect(await search("r>=rare")).toEqual(["Goblin Guide"]);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await search("t:planeswalker")).toEqual([]);
  });

  it("does not leak cards from other collections", async () => {
    const other = await seedCollection(owner, { name: "Other" });
    const dragon = await seedCard({ name: "Shivan Dragon", type_line: "Creature — Dragon" });
    await seedPhysicalCard(owner, dragon.id, other);
    expect(await search("t:creature")).toEqual(["Goblin Guide", "Serra Angel"]);
  });
});

describe("GET /api/collections/[id] (missing ids)", () => {
  it("404s for a malformed id instead of surfacing a cast error", async () => {
    const res = await getCollection(
      jsonRequest("/api/collections/doesnt-exist?details=true", "GET"),
      ctx({ id: "doesnt-exist" })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Collection not found" });
  });

  it("404s for a well-formed id that matches nothing", async () => {
    const id = "000000000000000000000000";
    const res = await getCollection(
      jsonRequest(`/api/collections/${id}?details=true`, "GET"),
      ctx({ id })
    );
    expect(res.status).toBe(404);
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
