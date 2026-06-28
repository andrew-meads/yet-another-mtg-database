import { describe, it, expect, beforeEach } from "vitest";
import { GET as getBasicLands } from "@/app/api/cards/basic-lands/route";
import { resetBasicLandsCache } from "@/lib/server/basicLands";
import { seedCard, seedUser, setTestUser } from "./helpers";

const LANDS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

beforeEach(async () => {
  resetBasicLandsCache();
  setTestUser(await seedUser());
});

describe("GET /api/cards/basic-lands", () => {
  it("returns the five UNH basic lands in WUBRG order", async () => {
    // Seed the five lands (with a decoy non-UNH Plains and a higher-numbered variant).
    for (const name of LANDS) {
      await seedCard({ id: `unh-${name}`, name, set: "unh", collector_number: "100" });
    }
    await seedCard({ id: "unh-Plains-alt", name: "Plains", set: "unh", collector_number: "150" });
    await seedCard({ id: "m21-Plains", name: "Plains", set: "m21", collector_number: "1" });

    const res = await getBasicLands();
    expect(res.status).toBe(200);
    const { cards } = await res.json();
    expect(cards.map((c: { name: string }) => c.name)).toEqual(LANDS);
    // The lowest-collector-number UNH Plains is chosen (not the alt, not the m21 print).
    const plains = cards.find((c: { name: string }) => c.name === "Plains");
    expect(plains.id).toBe("unh-Plains");
  });
});
