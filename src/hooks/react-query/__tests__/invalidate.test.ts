import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateCardMembership } from "@/hooks/react-query/invalidate";

describe("invalidateCardMembership", () => {
  it("invalidates the collection, deck, and card-location queries", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    invalidateCardMembership(qc);

    expect(spy).toHaveBeenCalledWith({ queryKey: ["collection-details"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["deck-details"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["card-locations"] });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
