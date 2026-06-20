import { describe, it, expect, beforeEach } from "vitest";
import { GET as searchCards } from "@/app/api/cards/route";
import { jsonRequest, seedCard, seedCollection, seedPhysicalCard, seedUser } from "./helpers";

beforeEach(async () => {
  await seedCard({ id: "c1", name: "Shivan Dragon", type_line: "Creature — Dragon", power: "5" });
  await seedCard({ id: "c2", name: "Goblin Guide", type_line: "Creature — Goblin", power: "2" });
  await seedCard({ id: "c3", name: "Counterspell", type_line: "Instant", power: undefined });
});

function names(json: { cards: { name: string }[] }) {
  return json.cards.map((c) => c.name);
}

describe("GET /api/cards", () => {
  it("searches by bare name term", async () => {
    const res = await searchCards(jsonRequest("/api/cards?q=dragon", "GET"));
    const json = await res.json();
    expect(names(json)).toEqual(["Shivan Dragon"]);
    expect(json.pagination.total).toBe(1);
  });

  it("supports operator search (type)", async () => {
    const res = await searchCards(jsonRequest("/api/cards?q=t:creature", "GET"));
    const json = await res.json();
    expect(names(json).sort()).toEqual(["Goblin Guide", "Shivan Dragon"]);
  });

  it("sorts by name ascending by default", async () => {
    const res = await searchCards(jsonRequest("/api/cards", "GET"));
    const json = await res.json();
    expect(names(json)).toEqual(["Counterspell", "Goblin Guide", "Shivan Dragon"]);
  });

  it("uses the aggregation path for power sort (non-numeric first when asc)", async () => {
    const res = await searchCards(jsonRequest("/api/cards?order=power&dir=asc", "GET"));
    const json = await res.json();
    // Counterspell has no power -> treated as non-numeric -> sorts first ascending.
    expect(names(json)[0]).toBe("Counterspell");
    expect(names(json).slice(1)).toEqual(["Goblin Guide", "Shivan Dragon"]);
  });

  it("filters to owned cards via the physicalcards $lookup", async () => {
    const owner = await seedUser();
    const collectionId = await seedCollection(owner);
    await seedPhysicalCard(owner, "c2", collectionId); // only Goblin Guide is owned

    const res = await searchCards(jsonRequest("/api/cards?owned=true", "GET"));
    const json = await res.json();
    expect(names(json)).toEqual(["Goblin Guide"]);
    expect(json.pagination.total).toBe(1);
  });

  it("paginates", async () => {
    const res = await searchCards(jsonRequest("/api/cards?page=1&page-len=2", "GET"));
    const json = await res.json();
    expect(json.cards).toHaveLength(2);
    expect(json.pagination).toMatchObject({ total: 3, page: 1, pageLen: 2, hasMore: true });
  });

  it("validates order and dir parameters", async () => {
    expect((await searchCards(jsonRequest("/api/cards?order=bogus", "GET"))).status).toBe(400);
    expect((await searchCards(jsonRequest("/api/cards?dir=sideways", "GET"))).status).toBe(400);
    expect((await searchCards(jsonRequest("/api/cards?page=0", "GET"))).status).toBe(400);
  });

  /** Page through every page of a query and collect the returned card ids. */
  async function collectAllPages(query: string, pageLen: number): Promise<string[]> {
    const ids: string[] = [];
    let page = 1;
    // Guard against runaway loops if hasMore never goes false.
    for (let i = 0; i < 100; i++) {
      const res = await searchCards(
        jsonRequest(`/api/cards?${query}&page=${page}&page-len=${pageLen}`, "GET")
      );
      const json = await res.json();
      for (const c of json.cards as { id: string }[]) ids.push(c.id);
      if (!json.pagination.hasMore) break;
      page++;
    }
    return ids;
  }

  it("paginates a tie-heavy name sort without dropping or duplicating results", async () => {
    // Many cards share the same name -> ties on the default `name` sort. Without a
    // unique tiebreaker, MongoDB orders ties inconsistently per query, so paging
    // with skip/limit drops some results and repeats others.
    const total = 10;
    for (let i = 0; i < total; i++) {
      await seedCard({ id: `crusade-${i}`, name: "Crusade", set: `s${i}` });
    }

    const ids = await collectAllPages("q=Crusade", 2);

    expect(new Set(ids).size).toBe(total); // no duplicates across pages
    expect(ids.sort()).toEqual(Array.from({ length: total }, (_, i) => `crusade-${i}`).sort()); // nothing missing
  });

  it("paginates a tie-heavy custom (rarity) sort without dropping or duplicating results", async () => {
    // Exercises the aggregation-pipeline sort path in sortConfig.ts. Rarity has only
    // a few distinct values, so every same-rarity card ties.
    const total = 10;
    for (let i = 0; i < total; i++) {
      await seedCard({ id: `rare-${i}`, name: `Card ${i}`, rarity: "rare" });
    }

    const ids = await collectAllPages("order=rarity", 2);

    // The three uniquely-named cards from beforeEach are commons; all share rarity
    // ties too. Just assert the rare cards all appear exactly once.
    const rareIds = ids.filter((id) => id.startsWith("rare-"));
    expect(new Set(rareIds).size).toBe(total);
    expect(rareIds.sort()).toEqual(Array.from({ length: total }, (_, i) => `rare-${i}`).sort());
  });
});
