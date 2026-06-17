import { describe, it, expect } from "vitest";
import { entityHref } from "@/lib/collectionUtils";

describe("entityHref", () => {
  it("links to the deck detail page for decks", () => {
    expect(entityHref({ _id: "abc", kind: "deck" })).toBe("/my-cards/decks/abc");
  });

  it("links to the collection detail page for collections", () => {
    expect(entityHref({ _id: "xyz", kind: "collection" })).toBe("/my-cards/collections/xyz");
  });
});
