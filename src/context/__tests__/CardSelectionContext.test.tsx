import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import {
  CardSelectionProvider,
  SelectedCopies,
  useCardSelection
} from "@/context/CardSelectionContext";
import { MtgCard } from "@/types/MtgCard";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(CardSelectionProvider, null, children);

const card = { id: "card-1", name: "Test" } as MtgCard;
const copies: SelectedCopies = {
  cardId: "card-1",
  physicalCardIds: ["p1", "p2"],
  finish: "foil",
  condition: "LP",
  isProxy: false,
  locationName: "Main Collection"
};

beforeEach(() => window.localStorage.clear());

describe("CardSelectionContext", () => {
  it("starts with no selection and updates + persists on select", () => {
    const { result } = renderHook(() => useCardSelection(), { wrapper });
    expect(result.current.selectedCard).toBeNull();
    expect(result.current.selectedCopies).toBeNull();

    act(() => result.current.setSelectedCard(card));
    expect(result.current.selectedCard).toEqual(card);
    expect(JSON.parse(window.localStorage.getItem("selected-card")!)).toEqual(card);
  });

  it("keeps the copies selected with a card, and clears them when a card is selected alone", () => {
    const { result } = renderHook(() => useCardSelection(), { wrapper });
    act(() => result.current.setSelectedCard(card, copies));
    expect(result.current.selectedCopies).toEqual(copies);
    expect(JSON.parse(window.localStorage.getItem("selected-copies")!)).toEqual(copies);

    act(() => result.current.setSelectedCard(card));
    expect(result.current.selectedCard).toEqual(card);
    expect(result.current.selectedCopies).toBeNull();
  });

  it("drops copies that belong to a different printing than the selected card", () => {
    const { result } = renderHook(() => useCardSelection(), { wrapper });
    act(() => result.current.setSelectedCard(card, { ...copies, cardId: "other" }));
    expect(result.current.selectedCopies).toBeNull();
  });

  it("clears both when the card is cleared", () => {
    const { result } = renderHook(() => useCardSelection(), { wrapper });
    act(() => result.current.setSelectedCard(card, copies));
    act(() => result.current.setSelectedCard(null, copies));
    expect(result.current.selectedCard).toBeNull();
    expect(result.current.selectedCopies).toBeNull();
  });

  it("returns a safe noop fallback when used outside a provider", () => {
    const { result } = renderHook(() => useCardSelection());
    expect(result.current.selectedCard).toBeNull();
    expect(result.current.selectedCopies).toBeNull();
    expect(() => result.current.setSelectedCard(card, copies)).not.toThrow();
  });
});
