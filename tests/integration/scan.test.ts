import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/scan/route";
import { setTestUser, seedUser, seedCard } from "./helpers";
import "./setup";

/** A minimal raw scanner match (only `scryfallId` is actually consumed downstream). */
function rawMatch(scryfallId: string, name = "Whatever") {
  return {
    scryfallId,
    name,
    set: "zzz",
    collectorNumber: "999",
    face: "front",
    confident: true,
    imageUrl: "http://scanner/img",
    scryfallUri: "http://scryfall/uri"
  };
}

/** Build the multipart POST /api/scan request with a dummy image blob. */
function scanRequest(): NextRequest {
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "card.jpg");
  return new NextRequest("http://localhost/api/scan", {
    method: "POST",
    body: fd
  } as ConstructorParameters<typeof NextRequest>[1]);
}

let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  const userId = await seedUser();
  setTestUser(userId);
});

afterEach(() => {
  fetchMock?.mockRestore();
  setTestUser(null);
});

describe("POST /api/scan", () => {
  it("re-hydrates matches from local card data, in best-first order", async () => {
    await seedCard({ id: "card-a", name: "Llanowar Elves", set: "m19", rarity: "common" });
    await seedCard({ id: "card-b", name: "Shivan Dragon", set: "m19", rarity: "rare" });

    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        count: 1,
        debugUrl: null,
        cards: [
          {
            id: "scan_0",
            url: "/cards/scan_0.jpg",
            width: 488,
            height: 680,
            // Scanner order: card-b first (best), then card-a.
            matches: [rawMatch("card-b"), rawMatch("card-a")]
          }
        ]
      })
    );

    const res = await POST(scanRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cards).toHaveLength(1);
    const matches = body.cards[0].matches;
    expect(matches.map((m: { id: string }) => m.id)).toEqual(["card-b", "card-a"]);
    // Enriched with full local card data (rarity/set_name are not in the raw match).
    expect(matches[0]).toMatchObject({ id: "card-b", name: "Shivan Dragon", rarity: "rare" });
    expect(matches[0].set_name).toBeTruthy();
  });

  it("drops matches whose scryfallId is not in the local cards collection", async () => {
    await seedCard({ id: "known-id", name: "Known Card" });

    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        count: 1,
        debugUrl: null,
        cards: [
          {
            id: "scan_0",
            url: "/cards/scan_0.jpg",
            width: 488,
            height: 680,
            matches: [rawMatch("missing-id"), rawMatch("known-id")]
          }
        ]
      })
    );

    const res = await POST(scanRequest());
    const body = await res.json();
    expect(body.cards[0].matches.map((m: { id: string }) => m.id)).toEqual(["known-id"]);
  });

  it("passes a non-200 scanner response through unchanged", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("scanner boom", { status: 500 }));

    const res = await POST(scanRequest());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("scanner boom");
  });

  it("returns 502 when the scanner is unreachable", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(scanRequest());
    expect(res.status).toBe(502);
  });

  it("rejects an unauthenticated request", async () => {
    setTestUser(null);
    const res = await POST(scanRequest());
    expect(res.status).toBe(401);
  });
});
