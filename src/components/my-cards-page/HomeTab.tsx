"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NewCollectionDialog } from "./NewCollectionDialog";

interface HomeTabProps {
  onNewCollection: (data: {
    name: string;
    description: string;
    collectionType: "collection" | "wishlist" | "deck";
  }) => void;
}

export default function HomeTab({ onNewCollection }: HomeTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<"collection" | "wishlist" | "deck">("collection");

  const handleButtonClick = (type: "collection" | "wishlist" | "deck") => {
    setSelectedType(type);
    setDialogOpen(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-bold mb-2">My Cards</h2>
        <p className="text-muted-foreground">
          Manage your Magic: The Gathering card collections, wishlists, and decks.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border rounded-lg p-6 space-y-4">
          <h3 className="text-xl font-semibold">Collections</h3>
          <p className="text-sm text-muted-foreground">
            Track which cards you own and their quantities.
          </p>
          <Button className="w-full" onClick={() => handleButtonClick("collection")}>
            New Collection
          </Button>
        </div>

        <div className="border rounded-lg p-6 space-y-4">
          <h3 className="text-xl font-semibold">Wishlists</h3>
          <p className="text-sm text-muted-foreground">
            Keep track of cards you want to acquire.
          </p>
          <Button className="w-full" onClick={() => handleButtonClick("wishlist")}>
            New Wishlist
          </Button>
        </div>

        <div className="border rounded-lg p-6 space-y-4">
          <h3 className="text-xl font-semibold">Decks</h3>
          <p className="text-sm text-muted-foreground">
            Build and manage your decks for play.
          </p>
          <Button className="w-full" onClick={() => handleButtonClick("deck")}>
            New Deck
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Recent Collections</h3>
        <p className="text-sm text-muted-foreground">
          Your recently opened collections will appear here.
        </p>
      </div>

      <NewCollectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultCollectionType={selectedType}
        onCreate={onNewCollection}
      />
    </div>
  );
}
