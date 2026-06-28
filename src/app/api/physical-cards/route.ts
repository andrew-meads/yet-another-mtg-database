import connectDB from "@/db/mongoose";
import { PhysicalCardModel, CollectionModel, DeckModel } from "@/db/schema";
import { upsertTags } from "@/lib/server/cardDetails";
import { findOrCreateColumn } from "@/lib/server/deckArrange";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/auth";

interface CreatePhysicalCardBody {
  cardId: string;
  /** Owning collection. Omit (or null) to create an ephemeral, deck-only card. */
  collectionId?: string | null;
  notes?: string;
  tags?: string[];
  /** If set, the created card(s) are also assigned to this deck. */
  deckId?: string;
  sectionId?: string;
  columnId?: string;
  index?: number;
  /** How many copies to create (default 1). */
  quantity?: number;
}

/**
 * POST /api/physical-cards
 * Creates one or more physical cards, optionally placing them in a deck. Powers
 * search-add, scan-add, grouped-row increment, and ephemeral (deck-only) adds.
 *
 * Two modes:
 *  - collectionId given → cards belong to that collection (deck optional).
 *  - collectionId omitted → ephemeral cards (collectionId null); deckId required,
 *    since an ephemeral card with no deck would be unreachable.
 *
 * Write order: create the cards (with deckId back-ref) first, then splice them
 * into the deck arrangement — so a mid-failure is reconciled on the next deck read.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const session = await getAuthSession();
    const userId = session!.user._id;

    const body = (await request.json()) as CreatePhysicalCardBody;
    const { cardId, collectionId, notes, tags, deckId, sectionId, columnId, index } = body;
    const quantity = Math.max(1, Math.floor(body.quantity ?? 1));

    if (!cardId) {
      return Response.json({ error: "cardId is required" }, { status: 400 });
    }

    const isEphemeral = !collectionId;
    if (isEphemeral && !deckId) {
      return Response.json(
        { error: "deckId is required when creating an ephemeral card (no collectionId)" },
        { status: 400 }
      );
    }

    if (!isEphemeral) {
      const collection = await CollectionModel.findOne(
        { _id: collectionId, owner: userId },
        { _id: 1 }
      ).lean();
      if (!collection) {
        return Response.json({ error: "Collection not found" }, { status: 404 });
      }
    }

    let deck = null;
    if (deckId) {
      deck = await DeckModel.findOne({ _id: deckId, owner: userId });
      if (!deck) {
        return Response.json({ error: "Deck not found" }, { status: 404 });
      }
    }

    await upsertTags(tags);

    const created = await PhysicalCardModel.insertMany(
      Array.from({ length: quantity }, () => ({
        owner: userId,
        cardId,
        collectionId: collectionId ?? null,
        deckId: deckId ?? null,
        notes,
        tags
      }))
    );
    const createdIds = created.map((c) => c._id);

    if (deck) {
      const column = findOrCreateColumn(deck, sectionId, columnId);
      const at = typeof index === "number" ? index : column.cards.length;
      column.cards.splice(at, 0, ...createdIds);
      deck.markModified("sections");
      await deck.save();
    }

    return Response.json({ physicalCardIds: createdIds.map(String) }, { status: 201 });
  } catch (error) {
    console.error("Error creating physical card(s):", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
