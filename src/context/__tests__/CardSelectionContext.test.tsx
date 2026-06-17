import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { CardSelectionProvider, useCardSelection } from "@/context/CardSelectionContext";
import { MtgCard } from "@/types/MtgCard";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(CardSelectionProvider, null, children);

const card = { id: "card-1", name: "Test" } as MtgCard;

beforeEach(() => window.localStorage.clear());

describe("CardSelectionContext", () => {
  it("starts with no selection and updates + persists on select", () => {
    const { result } = renderHook(() => useCardSelection(), { wrapper });
    expect(result.current.selectedCard).toBeNull();

    act(() => result.current.setSelectedCard(card));
    expect(result.current.selectedCard).toEqual(card);
    expect(JSON.parse(window.localStorage.getItem("selected-card")!)).toEqual(card);
  });

  it("returns a safe noop fallback when used outside a provider", () => {
    const { result } = renderHook(() => useCardSelection());
    expect(result.current.selectedCard).toBeNull();
    expect(() => result.current.setSelectedCard(card)).not.toThrow();
  });
});
