import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/exchange-rate/route";
import { ExchangeRateModel } from "@/db/schema";
import { seedExchangeRate } from "./helpers";
import "./setup";

function rateRequest(target: string | null) {
  const qs = target === null ? "" : `?target=${target}`;
  return new NextRequest(`http://localhost/api/exchange-rate${qs}`);
}

let fetchMock: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  fetchMock?.mockRestore();
});

const HOUR = 60 * 60 * 1000;

describe("GET /api/exchange-rate", () => {
  it("short-circuits USD to rate 1 without fetching", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await GET(rateRequest("USD"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ base: "USD", target: "USD", rate: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a fresh cached rate without fetching", async () => {
    await seedExchangeRate("NZD", 1.6, new Date(Date.now() - HOUR));
    fetchMock = vi.spyOn(globalThis, "fetch");

    const res = await GET(rateRequest("nzd")); // lower-case is normalised
    const body = await res.json();
    expect(body.rate).toBe(1.6);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches, upserts, and returns a missing rate", async () => {
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ base: "USD", date: "2026-07-11", rates: { NZD: 1.63 } }));

    const res = await GET(rateRequest("NZD"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ base: "USD", target: "NZD", rate: 1.63 });
    expect(fetchMock).toHaveBeenCalledOnce();

    const cached = await ExchangeRateModel.findOne({ base: "USD", target: "NZD" });
    expect(cached?.rate).toBe(1.63);
  });

  it("refreshes a stale cached rate", async () => {
    await seedExchangeRate("NZD", 1.5, new Date(Date.now() - 48 * HOUR));
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ rates: { NZD: 1.7 } }));

    const res = await GET(rateRequest("NZD"));
    const body = await res.json();
    expect(body.rate).toBe(1.7);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid target with 400", async () => {
    expect((await GET(rateRequest(null))).status).toBe(400);
    expect((await GET(rateRequest("US"))).status).toBe(400);
    expect((await GET(rateRequest("dollars"))).status).toBe(400);
  });

  it("returns 502 when the rate service fails", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await GET(rateRequest("NZD"))).status).toBe(502);
  });

  it("returns 502 when the currency is unknown to the rate service", async () => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ rates: {} }));
    expect((await GET(rateRequest("ZZZ"))).status).toBe(502);
  });
});
