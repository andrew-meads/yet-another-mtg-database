import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const m = vi.hoisted(() => ({
  update: vi.fn(),
  updateAsync: vi.fn(async () => ({})),
  refresh: vi.fn()
}));

vi.mock("@/hooks/react-query/useUpdatePhysicalCard", () => ({
  useUpdatePhysicalCard: () => ({ mutate: m.update, mutateAsync: m.updateAsync })
}));
vi.mock("@/hooks/react-query/useRefreshCopyPrices", () => ({
  useRefreshCopyPrices: () => ({ mutate: m.refresh })
}));
vi.mock("@/hooks/react-query/useRetrieveTags", () => ({
  useRetrieveTags: () => ({ data: [] })
}));

import EntryDetailsEditor from "@/components/my-cards-page/EntryDetailsEditor";

// Radix Select needs pointer-capture + scrollIntoView APIs jsdom doesn't ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => vi.clearAllMocks());

describe("EntryDetailsEditor", () => {
  it("shows the row's current finish and condition", () => {
    render(<EntryDetailsEditor finish="foil" condition="LP" physicalCardIds={["p1"]} />);
    expect(screen.getByRole("combobox", { name: "Finish" })).toHaveTextContent("Foil");
    expect(screen.getByRole("combobox", { name: "Condition" })).toHaveTextContent("LP");
  });

  it("applies a condition change to every copy, then re-fetches their prices", async () => {
    const user = userEvent.setup();
    render(<EntryDetailsEditor finish="nonfoil" condition="NM" physicalCardIds={["p1", "p2"]} />);
    await user.click(screen.getByRole("combobox", { name: "Condition" }));
    await user.click(await screen.findByRole("option", { name: /MP — Moderately Played/ }));
    expect(m.updateAsync).toHaveBeenCalledTimes(2);
    expect(m.updateAsync).toHaveBeenCalledWith({ physicalCardId: "p1", condition: "MP" });
    expect(m.updateAsync).toHaveBeenCalledWith({ physicalCardId: "p2", condition: "MP" });
    await waitFor(() => expect(m.refresh).toHaveBeenCalledWith(["p1", "p2"]));
  });

  it("applies a finish change to every copy, then re-fetches their prices", async () => {
    const user = userEvent.setup();
    render(<EntryDetailsEditor finish="nonfoil" condition="NM" physicalCardIds={["p1", "p2"]} />);
    await user.click(screen.getByRole("combobox", { name: "Finish" }));
    await user.click(await screen.findByRole("option", { name: "Etched foil" }));
    expect(m.updateAsync).toHaveBeenCalledTimes(2);
    expect(m.updateAsync).toHaveBeenCalledWith({ physicalCardId: "p1", finish: "etched" });
    await waitFor(() => expect(m.refresh).toHaveBeenCalledWith(["p1", "p2"]));
  });

  it("does not re-fetch when the value is unchanged", async () => {
    const user = userEvent.setup();
    render(<EntryDetailsEditor finish="nonfoil" condition="NM" physicalCardIds={["p1"]} />);
    await user.click(screen.getByRole("combobox", { name: "Finish" }));
    await user.click(await screen.findByRole("option", { name: "Non-foil" }));
    expect(m.updateAsync).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
