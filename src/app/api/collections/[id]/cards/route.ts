import { NextResponse } from "next/server";
import { inspect } from "util";
import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";
import { CardCollection, CardEntry } from "@/types/CardCollection";

type PatchCardsActions = "add" | "append" | "remove" | "swap" | "move" | "merge" | "swap-or-merge";
const VALID_ACTIONS = ["add", "append", "remove", "swap", "move", "merge", "swap-or-merge"];

interface PatchCardsBody {
  /** Which action to take */
  action: PatchCardsActions;
  /** If the action is "add" or "append", this entry will be added / appended */
  entry?: CardEntry;
  /** If the action is "remove", "swap", or "move", this is the index to remove/move from */
  fromIndex?: number;
  /** If the action is "swap" or "move", this is the index to move/swap to */
  toIndex?: number;
  /**
   * If the action is "add" or "append", this is the quantity to add (defaults to 1).
   * If the action is "remove", this is the quantity to remove (defaults to all).
   * If the action is "move", this specifies how many cards to move (defaults to all).
   */
  quantity?: number;
}

/**
 * PATCH /api/collections/[id]/cards
 * Adds a CardEntry to the cards array of the collection with the given id.
 *
 * Request Body:
 * - action: "add" | "append" | "remove" | "swap" | "move"
 * - entry?: CardEntry (required for "add" and "append" actions)
 * - fromIndex?: number (required for "remove", "swap", and "move" actions)
 * - toIndex?: number (required for "swap" and "move" actions)
 *
 * @returns The updated collection, or 404 if collection not found
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action, entry, fromIndex, toIndex, quantity } =
      (await request.json()) as PatchCardsBody;

    // console.log(
    //   `PATCH /api/collections/${id}/cards called with action: ${action}, fromIndex: ${fromIndex}, toIndex: ${toIndex}, quantity: ${quantity}, entry: ${inspect(entry, { depth: null, colors: true })}`
    // );

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    await connectDB();

    const collection = await CardCollectionModel.findById(id);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    try {
      switch (action) {
        case "add":
          await handleAddEntry(collection, entry, toIndex, quantity);
          break;
        case "append":
          await handleAppendEntry(collection, entry, quantity);
          break;
        case "remove":
          await handleRemoveEntry(collection, fromIndex, quantity);
          break;
        case "swap":
          await handleSwapEntry(collection, fromIndex, toIndex);
          break;
        case "move":
          await handleMoveEntry(collection, fromIndex, toIndex, quantity);
          break;
        case "merge":
          await handleMergeEntry(collection, fromIndex, toIndex);
          break;
        case "swap-or-merge":
          await handleSwapOrMergeEntry(collection, fromIndex, toIndex, quantity);
          break;
        default:
          return NextResponse.json({ error: "Action not implemented" }, { status: 501 });
      }
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    collection.markModified("cards");
    await collection.save();
    return NextResponse.json({ collection });
  } catch (error) {
    console.error("Error adding card entry:", inspect(error, { depth: null, colors: true }));
    return NextResponse.json({ error: "Failed to add card entry" }, { status: 500 });
    return NextResponse.json({ error: "Failed to add card entry" }, { status: 500 });
  }
}

/**
/**
 * Adds a CardEntry to the collection, merging with existing entry if cardId, notes, and tags match
 *
 * @param collection the collection to update
 * @param entry the entry to add
 * @param toIndex optional index to insert the entry at (if not provided, adds to the first matching entry or end)
 * @param quantity optional quantity to add (overrides entry.quantity if provided)
 */
async function handleAddEntry(
  collection: CardCollection,
  entry?: CardEntry,
  toIndex?: number,
  quantity?: number
) {
  validateCardEntry(entry);

  if (quantity !== undefined) entry!.quantity = quantity;

  // If toIndex is provided, check if the entry at that position matches
  if (toIndex !== undefined) {
    if (toIndex < 0 || toIndex > collection.cards.length) {
      throw new Error("Invalid toIndex: must be a valid index in the cards array.");
    }

    // If there's an entry at toIndex and it matches, merge
    if (toIndex < collection.cards.length && entriesMatch(collection.cards[toIndex], entry!)) {
      collection.cards[toIndex].quantity += entry!.quantity;
      return;
    }

    // Otherwise, insert at the specified position
    collection.cards.splice(toIndex, 0, entry!);
    return;
  }

  // No toIndex provided: find any matching entry in the collection
  const match = collection.cards.find((e) => entriesMatch(e, entry!));

  if (match) {
    match.quantity += entry!.quantity;
  } else {
    collection.cards.push(entry!);
  }
}

/**
 * Appends a CardEntry to the end of the collection's cards array
 *
 * @param collection the collection to update
 * @param entry the entry to append
 * @param quantity optional quantity to set on the appended entry (overrides entry.quantity if provided)
 */
async function handleAppendEntry(collection: CardCollection, entry?: CardEntry, quantity?: number) {
  validateCardEntry(entry);
  if (quantity !== undefined) entry!.quantity = quantity;
  collection.cards.push(entry!);
}

/**
 * Removes a CardEntry from the collection at the specified index
 *
 * @param collection the collection to update
 * @param fromIndex the index of the entry to remove
 * @param quantity optional quantity to remove (if not provided, removes the entire entry)
 */
async function handleRemoveEntry(
  collection: CardCollection,
  fromIndex?: number,
  quantity?: number
) {
  if (fromIndex === undefined || fromIndex < 0 || fromIndex >= collection.cards.length) {
    throw new Error("Invalid fromIndex: must be a valid index in the cards array.");
  }

  // Partially remove quantity if specified
  const numToRemove = quantity ?? collection.cards[fromIndex].quantity;
  if (numToRemove < collection.cards[fromIndex].quantity) {
    collection.cards[fromIndex].quantity -= numToRemove;
    return;
  }

  // Remove the entire entry
  collection.cards.splice(fromIndex, 1);
}

/**
 * Swaps two CardEntries in the collection at the specified indices
 *
 * @param collection the collection to update
 * @param fromIndex the index of the first entry
 * @param toIndex the index of the second entry
 */
async function handleSwapEntry(collection: CardCollection, fromIndex?: number, toIndex?: number) {
  if (fromIndex === undefined || fromIndex < 0 || fromIndex >= collection.cards.length) {
    throw new Error("Invalid fromIndex: must be a valid index in the cards array.");
  }
  if (toIndex === undefined || toIndex < 0 || toIndex >= collection.cards.length) {
    throw new Error("Invalid toIndex: must be a valid index in the cards array.");
  }

  // If indices are the same, no-op
  if (fromIndex === toIndex) {
    return;
  }

  // Swap the entries
  const temp = collection.cards[fromIndex];
  collection.cards[fromIndex] = collection.cards[toIndex];
  collection.cards[toIndex] = temp;
}

/**
 * Moves a CardEntry from one index to another, shifting other entries as needed
 *
 * @param collection the collection to update
 * @param fromIndex the index of the entry to move
 * @param toIndex the destination index
 * @param quantity optional quantity to move (if not provided, moves the entire entry)
 */
async function handleMoveEntry(
  collection: CardCollection,
  fromIndex?: number,
  toIndex?: number,
  quantity?: number
) {
  if (fromIndex === undefined || fromIndex < 0 || fromIndex >= collection.cards.length) {
    throw new Error("Invalid fromIndex: must be a valid index in the cards array.");
  }
  if (toIndex === undefined || toIndex < 0 || toIndex > collection.cards.length) {
    throw new Error("Invalid toIndex: must be a valid index in the cards array.");
  }

  // If indices are the same, no-op
  if (fromIndex === toIndex) {
    return;
  }

  const numToMove = quantity ?? collection.cards[fromIndex].quantity;

  // If doing a partial move, adjust the quantity in the existing entry and create a new entry at the destination
  if (numToMove < collection.cards[fromIndex].quantity) {
    collection.cards[fromIndex].quantity -= numToMove;

    const entryToMove: CardEntry = {
      cardId: collection.cards[fromIndex].cardId,
      quantity: numToMove,
      notes: collection.cards[fromIndex].notes,
      tags: collection.cards[fromIndex].tags
    };
    // console.log("Moving partial entry:", entryToMove);
    collection.cards.splice(toIndex, 0, entryToMove);
    return;
  }

  // Otherwise, remove the entry from fromIndex and insert it at toIndex
  const [movedEntry] = collection.cards.splice(fromIndex, 1);

  // Account for the shift if moving forward in the array
  if (toIndex > fromIndex) toIndex--;

  collection.cards.splice(toIndex, 0, movedEntry);
}

/**
 * Merges two CardEntries by adding the quantity from toIndex to fromIndex
 *
 * @param collection the collection to update
 * @param fromIndex the index of the entry to merge into (destination)
 * @param toIndex the index of the entry to merge from (will be removed after merge)
 */
async function handleMergeEntry(collection: CardCollection, fromIndex?: number, toIndex?: number) {
  if (fromIndex === undefined || fromIndex < 0 || fromIndex >= collection.cards.length) {
    throw new Error("Invalid fromIndex: must be a valid index in the cards array.");
  }
  if (toIndex === undefined || toIndex < 0 || toIndex >= collection.cards.length) {
    throw new Error("Invalid toIndex: must be a valid index in the cards array.");
  }

  // If indices are the same, no-op
  if (fromIndex === toIndex) {
    return;
  }

  const fromEntry = collection.cards[fromIndex];
  const toEntry = collection.cards[toIndex];

  // Validate that entries can be merged
  if (!entriesMatch(fromEntry, toEntry)) {
    throw new Error("Cannot merge entries with different cardIds, notes, or tags.");
  }

  // Merge quantities
  toEntry.quantity += fromEntry.quantity;

  // Remove the fromEntry entry
  collection.cards.splice(fromIndex, 1);
}

/**
 * Swaps or merges two CardEntries based on whether they match
 *
 * @param collection the collection to update
 * @param fromIndex the index of the first entry
 * @param toIndex the index of the second entry
 * @param quantity optional quantity to consider when moving
 */
async function handleSwapOrMergeEntry(
  collection: CardCollection,
  fromIndex?: number,
  toIndex?: number,
  quantity?: number
) {
  if (fromIndex === undefined || fromIndex < 0 || fromIndex >= collection.cards.length) {
    throw new Error("Invalid fromIndex: must be a valid index in the cards array.");
  }
  if (toIndex === undefined || toIndex < 0 || toIndex >= collection.cards.length) {
    throw new Error("Invalid toIndex: must be a valid index in the cards array.");
  }

  // If indices are the same, no-op
  if (fromIndex === toIndex) {
    return;
  }

  const fromEntry = collection.cards[fromIndex];
  const toEntry = collection.cards[toIndex];
  const numToMove = quantity ?? fromEntry.quantity;
  const moveEntireEntry = numToMove >= fromEntry.quantity;

  // If entries match, merge them
  if (entriesMatch(fromEntry, toEntry)) {
    if (moveEntireEntry) {
      // Merge all of fromEntry into toEntry
      toEntry.quantity += fromEntry.quantity;
      // Remove the fromIndex entry
      collection.cards.splice(fromIndex, 1);
    } else {
      // Partial merge: move specified quantity from fromEntry to toEntry
      fromEntry.quantity -= numToMove;
      toEntry.quantity += numToMove;
    }
  } else {
    // Entries don't match
    if (moveEntireEntry) {
      // Swap the entire entries
      const temp = collection.cards[fromIndex];
      collection.cards[fromIndex] = collection.cards[toIndex];
      collection.cards[toIndex] = temp;
    } else {
      // Partial move: move specified quantity from fromIndex to toIndex
      fromEntry.quantity -= numToMove;
      const entryToMove: CardEntry = {
        cardId: fromEntry.cardId,
        quantity: numToMove,
        notes: fromEntry.notes,
        tags: fromEntry.tags
      };
      collection.cards.splice(toIndex, 0, entryToMove);
    }
  }
}

/**
 * Checks if two CardEntries match based on cardId, notes, and tags
 * @param entry1 the first entry
 * @param entry2 the second entry
 * @returns true if the entries match
 */
function entriesMatch(entry1: CardEntry, entry2: CardEntry): boolean {
  if (entry1.cardId !== entry2.cardId) return false;
  if ((entry1.notes || "") !== (entry2.notes || "")) return false;

  const tags1 = (entry1.tags || []).slice().sort();
  const tags2 = (entry2.tags || []).slice().sort();
  return JSON.stringify(tags1) === JSON.stringify(tags2);
}

/**
 * Validates that the given entry is a valid CardEntry
 * @param entry the entry to validate
 * @returns true if valid, otherwise throws an error
 */
function validateCardEntry(entry?: any): entry is CardEntry {
  if (!entry || typeof entry.cardId !== "string" || typeof entry.quantity !== "number") {
    throw new Error("Invalid CardEntry: cardId and quantity are required.");
  }
  return true;
}
