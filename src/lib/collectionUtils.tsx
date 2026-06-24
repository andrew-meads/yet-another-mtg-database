import { SquareLibrary, Layers } from "lucide-react";
import { OpenEntitySummary } from "@/types/Deck";

export type EntityKind = "collection" | "deck";

/** Icon for a workspace entity (collection or deck). */
export function getEntityIcon(kind: EntityKind, size: string = "h-4 w-4") {
  switch (kind) {
    case "collection":
      return <SquareLibrary className={size} />;
    case "deck":
      return <Layers className={size} />;
  }
}

/**
 * localStorage key for a collection's persisted Scryfall-style search string.
 * Keyed by collection id so each collection remembers its own search; cleared
 * when the collection is closed (see `removeOpenEntity` in OpenEntitiesContext).
 */
export const collectionSearchStorageKey = (collectionId: string) =>
  `collection-search-${collectionId}`;

/** The detail-page href for a collection or deck. */
export function entityHref(entity: Pick<OpenEntitySummary, "_id" | "kind">) {
  return entity.kind === "deck"
    ? `/my-cards/decks/${entity._id}`
    : `/my-cards/collections/${entity._id}`;
}
