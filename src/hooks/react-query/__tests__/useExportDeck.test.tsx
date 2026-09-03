import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fileNameFromDisposition, useExportDeck } from "@/hooks/react-query/useExportDeck";
import { DEFAULT_DECK_EXPORT_OPTIONS } from "@/lib/deckExport";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "TestQueryWrapper";
  return Wrapper;
}

let fetchMock: ReturnType<typeof vi.spyOn>;
let clickSpy: ReturnType<typeof vi.spyOn>;
const createObjectURL = vi.fn(() => "blob:mock-url");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("Orzhov Taxes\n1 card\n", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="Orzhov Taxes.txt"; filename*=UTF-8''Orzhov%20Taxes.txt`
      }
    })
  );
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  fetchMock.mockRestore();
  clickSpy.mockRestore();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.useRealTimers();
});

describe("useExportDeck", () => {
  it("fetches the export with the option query string and triggers a download", async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useExportDeck(), { wrapper: wrapper(client) });

    let downloadName: string | undefined;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    const outcome = await result.current.mutateAsync({
      deckId: "deck-1",
      deckName: "Orzhov Taxes",
      options: {
        ...DEFAULT_DECK_EXPORT_OPTIONS,
        format: "pdf",
        separateByPrinting: true,
        includeImages: true
      }
    });

    const [url] = fetchMock.mock.calls[0];
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(url).toBe(`/api/decks/deck-1/export?format=pdf&byPrinting=true&images=true&tz=${tz}`);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe("Orzhov Taxes.txt");
    expect(outcome).toEqual({ fileName: "Orzhov Taxes.txt", size: expect.any(Number) });

    await vi.advanceTimersByTimeAsync(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("falls back to a computed file name without a Content-Disposition header", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 200 }));
    const client = new QueryClient();
    const { result } = renderHook(() => useExportDeck(), { wrapper: wrapper(client) });

    const outcome = await result.current.mutateAsync({
      deckId: "deck-1",
      deckName: "My: Deck!",
      options: { ...DEFAULT_DECK_EXPORT_OPTIONS, format: "xlsx" }
    });
    expect(outcome.fileName).toBe("My Deck.xlsx");
  });

  it("throws the server's error message on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Deck not found" }), { status: 404 })
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useExportDeck(), { wrapper: wrapper(client) });

    await expect(
      result.current.mutateAsync({
        deckId: "missing",
        deckName: "x",
        options: DEFAULT_DECK_EXPORT_OPTIONS
      })
    ).rejects.toThrow("Deck not found");
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe("fileNameFromDisposition", () => {
  it("prefers the UTF-8 form, then the plain form", () => {
    expect(
      fileNameFromDisposition(`attachment; filename="J_tun.txt"; filename*=UTF-8''J%C3%B6tun.txt`)
    ).toBe("Jötun.txt");
    expect(fileNameFromDisposition('attachment; filename="plain.pdf"')).toBe("plain.pdf");
    expect(fileNameFromDisposition("attachment; filename=bare.xlsx")).toBe("bare.xlsx");
    expect(fileNameFromDisposition(null)).toBeUndefined();
    expect(fileNameFromDisposition("inline")).toBeUndefined();
  });
});
