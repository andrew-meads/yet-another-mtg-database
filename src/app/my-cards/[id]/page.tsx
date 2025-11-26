"use client";

import { use } from "react";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { useRetrieveCollectionDetails } from "@/hooks/react-query/useRetrieveCollectionDetails";
import { getCollectionIcon } from "@/lib/collectionUtils";
import CollectionTable from "@/components/my-cards-page/CollectionTable";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import DeckView from "@/components/my-cards-page/deck-view/DeckView";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface PageProps {
  params: Promise<{ id: string }>;
}

type PageMode = "collection" | "deck-builder";

export default function Page({ params }: PageProps) {
  const { id } = use(params);
  const { addOpenCollection } = useOpenCollectionsContext();
  const { data, isLoading, error } = useRetrieveCollectionDetails(id);
  const [mode, setMode] = useLocalStorage<PageMode>(`my-cards-page-mode-${id}`, "collection");

  if (data) addOpenCollection(data.collection);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-muted-foreground">Loading collection...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <h3 className="text-lg font-semibold text-destructive mb-2">Error Loading Collection</h3>
          <p className="text-sm text-destructive/90">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data?.collection) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-muted-foreground">Collection not found</p>
        </div>
      </div>
    );
  }

  const { collection } = data;

  // Calculate total number of cards
  const totalCards = collection.cards.reduce((sum, entry) => sum + entry.quantity, 0);

  return (
    <div className="mx-auto space-y-6 h-full flex flex-col">
      <div className="flex items-start justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            {getCollectionIcon(collection.collectionType, "h-6 w-6")}
            {collection.name}
          </h2>
          <p className="text-muted-foreground">
            {collection.description || "No description provided"} • {totalCards} card
            {totalCards !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="mode-toggle"
            checked={mode === "deck-builder"}
            onCheckedChange={(checked) => setMode(checked ? "deck-builder" : "collection")}
          />
          <Label htmlFor="mode-toggle">Deck Builder</Label>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {mode === "collection" && <CollectionTable collection={collection} entriesPerPage={10} />}
        {mode === "deck-builder" && <DeckView deck={collection} />}
      </div>
    </div>
  );
}
