"use client";

import { use, useEffect, useState } from "react";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useRetrieveDeckDetails } from "@/hooks/react-query/useRetrieveDeckDetails";
import { useDeleteDeck } from "@/hooks/react-query/useDeleteEntity";
import { useUpdateDeck } from "@/hooks/react-query/useUpdateDeck";
import { getEntityIcon } from "@/lib/collectionUtils";
import DeckView from "@/components/my-cards-page/deck-view/DeckView";
import { NewCollectionDialog } from "@/components/my-cards-page/NewCollectionDialog";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DeckPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { addOpenEntity } = useOpenEntitiesContext();
  const { data, isLoading, error } = useRetrieveDeckDetails(id);
  const deleteDeck = useDeleteDeck();
  const updateDeck = useUpdateDeck();
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (data?.deck) addOpenEntity(data.deck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.deck?._id]);

  if (isLoading) {
    return <p className="text-muted-foreground">Loading deck...</p>;
  }
  if (error) {
    return (
      <div className="border-destructive bg-destructive/10 rounded-lg border p-4">
        <h3 className="text-destructive mb-2 text-lg font-semibold">Error Loading Deck</h3>
        <p className="text-destructive/90 text-sm">{error.message}</p>
      </div>
    );
  }
  if (!data?.deck) {
    return <p className="text-muted-foreground">Deck not found</p>;
  }

  const { deck } = data;

  const handleDelete = () => {
    if (!confirm(`Delete deck "${deck.name}"? Its cards stay in their collections.`)) return;
    deleteDeck.mutate(deck._id, { onSuccess: () => router.push("/my-cards") });
  };

  return (
    <div className="mx-auto flex h-full flex-col space-y-6">
      <div className="flex shrink-0 items-start justify-between">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-2xl font-bold">
            {getEntityIcon("deck", "h-6 w-6")}
            {deck.name}
          </h2>
          <p className="text-muted-foreground">{deck.description || "No description provided"}</p>
        </div>
        <div className="flex items-center gap-2 lg:mr-3">
          <Button
            variant="outline"
            size="icon"
            className="cursor-pointer"
            onClick={() => setEditOpen(true)}
            aria-label="Edit deck"
          >
            <Pencil className="size-[1.2rem]" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="cursor-pointer"
            onClick={handleDelete}
            aria-label="Delete deck"
          >
            <Trash2 className="size-[1.2rem]" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DeckView deck={deck} />
      </div>
      <NewCollectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entityLabel="Deck"
        initialValues={{ name: deck.name, description: deck.description }}
        onSave={(data) => updateDeck.mutate({ deckId: id, ...data })}
        isSaving={updateDeck.isPending}
      />
    </div>
  );
}
