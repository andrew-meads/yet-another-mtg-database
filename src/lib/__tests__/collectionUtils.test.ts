import { describe, it, expect } from "vitest";
import { entityHref, collectionSearchStorageKey } from "@/lib/collectionUtils";

describe("entityHref", () => {
  it("links to the deck detail page for decks", () => {
    expect(entityHref({ _id: "abc", kind: "deck" })).toBe("/my-cards/decks/abc");
  });

  it("links to the collection detail page for collections", () => {
    expect(entityHref({ _id: "xyz", kind: "collection" })).toBe("/my-cards/collections/xyz");
  });
});

describe("collectionSearchStorageKey", () => {
  it("namespaces the search-string key by collection id", () => {
    expect(collectionSearchStorageKey("abc")).toBe("collection-search-abc");
  });
});
