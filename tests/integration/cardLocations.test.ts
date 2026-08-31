import { describe, it, expect, beforeEach } from "vitest";
import { GET as getLocations } from "@/app/api/cards/locations/route";
import {
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

beforeEach(async () => {
  owner = await seedUser();
  setTestUser(owner);
});

describe("GET /api/cards/locations", () => {
  it("returns empty locations without a name param or for an unknown card", async () => {
    const noName = await getLocations(jsonRequest("/api/cards/locations", "GET"));
    expect(await noName.json()).toEqual({ locations: [], cardData: {} });

    const unknown = await getLocations(jsonRequest("/api/cards/locations?name=Nope", "GET"));
    expect(await unknown.json()).toEqual({ locations: [], cardData: {} });
  });

  it("groups the user's copies by collection with entries + a deduplicated cardData map", async () => {
    const card = await seedCard({ name: "Shock" });
    const collA = await seedCollection(owner, { name: "Binder A" });
    const collB = await seedCollection(owner, { name: "Binder B" });
    await seedPhysicalCard(owner, card.id, collA);
    await seedPhysicalCard(owner, card.id, collA);
    await seedPhysicalCard(owner, card.id, collB);

    const res = await getLocations(
      jsonRequest(`/api/cards/locations?name=${encodeURIComponent("Shock")}`, "GET")
    );
    expect(res.status).toBe(200);
    const { locations, cardData } = await res.json();

    expect(locations).toHaveLength(2);
    const byName = Object.fromEntries(locations.map((l: any) => [l.collectionName, l]));
    expect(byName["Binder A"].cards).toHaveLength(2);
    expect(byName["Binder B"].cards).toHaveLength(1);
    expect(byName["Binder A"].cards[0].cardId).toBe(card.id);
    expect(byName["Binder A"].cards[0].card).toBeUndefined();
    // One card, three copies — the data ships exactly once.
    expect(Object.keys(cardData)).toEqual([card.id]);
    expect(cardData[card.id].name).toBe("Shock");
  });

  it("excludes ephemeral (deck-only) cards and other users' copies", async () => {
    const card = await seedCard({ name: "Shock" });
    const coll = await seedCollection(owner, { name: "Mine" });
    await seedPhysicalCard(owner, card.id, coll);

    const deck = await seedDeck(owner);
    await seedEphemeralCard(owner, card.id, deck._id.toString());

    const other = await seedUser("other@example.com");
    const otherColl = await seedCollection(other, { name: "Theirs" });
    await seedPhysicalCard(other, card.id, otherColl);

    const res = await getLocations(jsonRequest("/api/cards/locations?name=Shock", "GET"));
    const { locations } = await res.json();

    expect(locations).toHaveLength(1);
    expect(locations[0].collectionName).toBe("Mine");
    expect(locations[0].cards).toHaveLength(1);
  });
});
