import { SelectedCopies } from "@/context/CardSelectionContext";
import { DetailedPhysicalCard } from "@/types/PhysicalCard";
import { CollectionGroupRow } from "@/components/my-cards-page/collection-view/grouping";
import { copySetFromCopies } from "@/lib/copyPricing";

/** The copy selection for a collection row (all of its copies share finish/condition/tags). */
export function copiesFromRow(row: CollectionGroupRow, locationName?: string): SelectedCopies {
  return {
    cardId: row.card.id,
    physicalCardIds: row.physicalCardIds,
    finish: row.finish,
    condition: row.condition,
    isProxy: row.isProxy,
    copyPrice: row.copyPrice,
    locationName
  };
}

/** The copy selection for one physical card (a deck-view card). */
export function copiesFromPhysical(
  copy: DetailedPhysicalCard,
  locationName?: string
): SelectedCopies {
  const set = copySetFromCopies([copy]);
  return {
    cardId: copy.card.id,
    physicalCardIds: [copy._id],
    ...set,
    locationName
  };
}
