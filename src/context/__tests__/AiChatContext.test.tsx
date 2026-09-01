import { describe, it, expect } from "vitest";
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { SearchDocsProvider, useSearchDocs } from "@/context/SearchDocsContext";
import { AiChatProvider, useAiChat } from "@/context/AiChatContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SearchDocsProvider>
      <AiChatProvider>{children}</AiChatProvider>
    </SearchDocsProvider>
  );
}

function useBothPanels() {
  return { chat: useAiChat(), docs: useSearchDocs() };
}

describe("AiChatContext", () => {
  it("only one docked panel is open at a time", () => {
    const { result } = renderHook(useBothPanels, { wrapper });

    act(() => result.current.chat.setOpen(true));
    expect(result.current.chat.open).toBe(true);
    expect(result.current.docs.open).toBe(false);

    // Opening the docs closes the chat…
    act(() => result.current.docs.setOpen(true));
    expect(result.current.docs.open).toBe(true);
    expect(result.current.chat.open).toBe(false);

    // …and opening the chat closes the docs again.
    act(() => result.current.chat.setOpen(true));
    expect(result.current.chat.open).toBe(true);
    expect(result.current.docs.open).toBe(false);
  });

  it("toggle flips the open state", () => {
    const { result } = renderHook(useBothPanels, { wrapper });
    act(() => result.current.chat.toggle());
    expect(result.current.chat.open).toBe(true);
    act(() => result.current.chat.toggle());
    expect(result.current.chat.open).toBe(false);
  });

  it("holds the viewed-entity context for chat requests", () => {
    const { result } = renderHook(useBothPanels, { wrapper });
    act(() => result.current.chat.setChatContext({ deckId: "d1" }));
    expect(result.current.chat.chatContext).toEqual({ deckId: "d1" });
  });

  it("falls back to a no-op context outside the provider", () => {
    const { result } = renderHook(() => useAiChat());
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(false);
  });
});
