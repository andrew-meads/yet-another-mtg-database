"use client";

import { useScanContext } from "@/context/ScanContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";
import CardArtView from "@/components/CardArtView";
import { MtgCard } from "@/types/MtgCard";
import { RecognizedCard } from "@/types/RecognizedCard";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { useUpdateCollectionCards } from "@/hooks/react-query/useUpdateCollectionCards";
import { toast } from "sonner";

/**
 * Scan Results Page
 *
 * Displays the results of card recognition from the scan page.
 * Shows the recognized card name in the header and a sorted list of matching
 * cards from the database. Cards are sorted by name match quality and set code proximity.
 *
 * Mobile-first design with sticky header and scrollable card list.
 */
export default function ScanResultsPage() {
  const { recognized, cards } = useScanContext();
  const { activeCollection } = useOpenCollectionsContext();
  const { mutate: updateCollectionCards } = useUpdateCollectionCards();

  // Log recognized card details
//   console.log("🎴 Recognized card details:", {
//     name: recognized?.name,
//     setCode: recognized?.setCode,
//     collectorNumber: recognized?.collectorNumber,
//     matchingCardsCount: cards.length
//   });

  const sortedCards = sortCardsByRelevance(cards, recognized);

  /**
   * Handles adding a card to a collection with a specified quantity.
   *
   * @param card - The MTG card to add
   * @param quantity - The quantity of cards to add
   */
  const handleAddToCollection = (card: MtgCard, quantity: number) => {
    if (!activeCollection) {
      console.error("❌ No active collection to add card to");
      toast.error("No active collection", {
        description: "Please open a collection first."
      });
      return;
    }

    // console.log("➕ Adding card to collection:", {
    //   cardName: card.name,
    //   set: card.set,
    //   collectorNumber: card.collector_number,
    //   quantity,
    //   collectionId: activeCollection._id
    // });

    updateCollectionCards(
      {
        collectionId: activeCollection._id,
        action: "add",
        entry: {
          cardId: card.id,
          quantity
        },
        quantity
      },
      {
        onSuccess: () => {
          toast.success("Card added!", {
            description: `Added ${quantity}x ${card.name} to ${activeCollection.name}`
          });
        },
        onError: (error) => {
          console.error("❌ Failed to add card:", error);
          toast.error("Failed to add card", {
            description: error.message || "An error occurred while adding the card."
          });
        }
      }
    );
  };

  /**
   * Handles closing the scan results and returning to the previous page.
   * Uses router.replace() to navigate back, which prevents forward navigation
   * to the scan pages and effectively removes them from the history stack.
   */
  const handleClose = () => {
    // Go back in history (before /scan was entered)
    window.history.go(-2);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border-b">
        <div className="flex items-center gap-3 p-4">
          <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {recognized?.name || "Recognition Results"}
            </h1>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} className="shrink-0">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {cards.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No matching cards found</div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {cards.length} matching card{cards.length !== 1 ? "s" : ""}
            </p>

            {/* Card results list */}
            <div className="space-y-3">
              {sortedCards.map((card) => (
                <CardResultItem
                  key={card.id}
                  card={card}
                  activeCollection={activeCollection}
                  onAddToCollection={handleAddToCollection}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Props for the CardResultItem component
 */
interface CardResultItemProps {
  /** The MTG card to display */
  card: MtgCard;
  /** The currently active collection, if any */
  activeCollection: { _id: string; name: string } | null;
  /** Callback function to handle adding card to collection */
  onAddToCollection: (card: MtgCard, quantity: number) => void;
}

/**
 * Card Result Item Component
 *
 * Displays a single card from the search results with its image and metadata.
 * Renders as a clickable button with card image on the left and card details
 * (name, set code, collector number) on the right.
 *
 * @param props - Component props
 * @param props.card - The MTG card to display
 * @param props.activeCollection - The currently active collection
 * @param props.onAddToCollection - Callback to handle adding card to collection
 */
function CardResultItem({ card, activeCollection, onAddToCollection }: CardResultItemProps) {
  return (
    <div className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card">
      {/* Card Image */}
      <div className="shrink-0 w-40 h-56">
        <CardArtView
          card={card}
          variant="normal"
          className="rounded-md"
          flippable={true}
          draggable={false}
        />
      </div>

      {/* Card Info */}
      <div className="flex-1 min-w-0 space-y-3">
        <div>
          <h3 className="font-semibold truncate">
            {card.flavor_name || card.name}
          </h3>
          {card.flavor_name && (
            <p className="text-sm text-muted-foreground italic truncate">
              {card.name}
            </p>
          )}
          <p className="text-sm text-muted-foreground truncate">
            {card.set_name} ({card.set.toUpperCase()})
            {card.collector_number && ` #${card.collector_number}`}
          </p>
        </div>

        <div>
          {activeCollection ? (
            <>
              <p className="text-sm font-medium mb-2">
                Add to active collection: {activeCollection.name}
              </p>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((quantity) => (
                  <Button
                    key={quantity}
                    size="sm"
                    variant="outline"
                    onClick={() => onAddToCollection(card, quantity)}
                    className="w-10 h-10 p-0"
                  >
                    {quantity}x
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No active collection. Open a collection to add cards.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Sorts cards by name match quality and set code proximity.
 *
 * Uses a three-tier sorting algorithm:
 *
 * Primary sort (name match quality):
 * 1. Exact name match (highest priority)
 * 2. Name starts with recognized name (medium priority)
 * 3. All other cards (lowest priority)
 *
 * Secondary sort (within each category):
 * - By Levenshtein distance to recognized set code (closer matches first)
 *
 * Tertiary sort (within same name category and set distance):
 * - By collector number proximity to recognized collector number
 *
 * @param cards - Array of MTG cards to sort
 * @param recognized - The recognized card data from image recognition (may be null)
 * @returns A new sorted array of cards (does not mutate original)
 */
function sortCardsByRelevance(cards: MtgCard[], recognized: RecognizedCard | null): MtgCard[] {
  if (!recognized) return cards;

  const recognizedName = recognized.name.toLowerCase();
  const recognizedSet = recognized.setCode?.toLowerCase() || "";
  const recognizedCollectorNum = recognized.collectorNumber || "";

  return [...cards].sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    // Determine name match category for each card
    const aExactMatch = aName === recognizedName;
    const bExactMatch = bName === recognizedName;
    const aStartsWith = aName.startsWith(recognizedName);
    const bStartsWith = bName.startsWith(recognizedName);

    // Assign priority scores (lower is better)
    let aPriority = 2; // Other cards
    let bPriority = 2;

    if (aExactMatch) aPriority = 0;
    else if (aStartsWith) aPriority = 1;

    if (bExactMatch) bPriority = 0;
    else if (bStartsWith) bPriority = 1;

    // If different priorities, sort by priority
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Same priority - sort by set code proximity
    const aSetDistance = levenshteinDistance(a.set, recognizedSet);
    const bSetDistance = levenshteinDistance(b.set, recognizedSet);

    if (aSetDistance !== bSetDistance) {
      return aSetDistance - bSetDistance;
    }

    // Same priority and set distance - sort by collector number string proximity
    if (recognizedCollectorNum) {
      const aCollectorNum = a.collector_number || "";
      const bCollectorNum = b.collector_number || "";

      // Cards without collector numbers go to the end
      if (!aCollectorNum && !bCollectorNum) return 0;
      if (!aCollectorNum) return 1;
      if (!bCollectorNum) return -1;

      const aCollectorDist = levenshteinDistance(aCollectorNum, recognizedCollectorNum);
      const bCollectorDist = levenshteinDistance(bCollectorNum, recognizedCollectorNum);

      return aCollectorDist - bCollectorDist;
    }

    return 0;
  });
}

/**
 * Calculates the Levenshtein distance between two strings.
 *
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into another.
 * Used to determine "closeness" between set codes for sorting purposes.
 *
 * Case-insensitive comparison.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns The edit distance between the two strings (0 means identical)
 *
 * @example
 * levenshteinDistance("neo", "NEO") // returns 0 (case-insensitive)
 * levenshteinDistance("neo", "snc") // returns 3 (all different)
 * levenshteinDistance("neo", "one") // returns 2 (two edits needed)
 */
function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower.charAt(i - 1) === aLower.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bLower.length][aLower.length];
}
