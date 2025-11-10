"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { NewCollectionDialog } from "./NewCollectionDialog";
import { CollectionSummary, CollectionType } from "@/types/CardCollection";
import { useRetrieveCollectionSummaries } from "@/hooks/useRetrieveCollectionSummaries";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { ChevronDown } from "lucide-react";

interface HomeTabProps {
  onNewCollection: (data: {
    name: string;
    description: string;
    collectionType: CollectionType;
  }) => void;
  onCollectionClicked: (collection: CollectionSummary) => void;
  isCreating?: boolean;
}

export default function HomeTab({
  onNewCollection,
  onCollectionClicked,
  isCreating = false
}: HomeTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<CollectionType>("collection");

  const { data, isLoading, error } = useRetrieveCollectionSummaries();

  const handleButtonClick = (type: CollectionType) => {
    setSelectedType(type);
    setDialogOpen(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">My Cards</h2>
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
          <p className="text-sm text-muted-foreground">Keep track of cards you want to acquire.</p>
          <Button className="w-full" onClick={() => handleButtonClick("wishlist")}>
            New Wishlist
          </Button>
        </div>

        <div className="border rounded-lg p-6 space-y-4">
          <h3 className="text-xl font-semibold">Decks</h3>
          <p className="text-sm text-muted-foreground">Build and manage your decks for play.</p>
          <Button className="w-full" onClick={() => handleButtonClick("deck")}>
            New Deck
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Recent Collections</h3>

        {isLoading && <p className="text-sm text-muted-foreground">Loading collections...</p>}

        {error && (
          <p className="text-sm text-destructive">Failed to load collections: {error.message}</p>
        )}

        {data && data.collections.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No collections yet. Create your first collection above!
          </p>
        )}

        {data && data.collections.length > 0 && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.collections.slice(0, 6).map((collection) => (
              <li key={collection._id}>
                <Button
                  variant="ghost"
                  className="w-full cursor-pointer"
                  onClick={() => onCollectionClicked(collection)}
                >
                  {getCollectionIcon(collection.collectionType)}
                  <span>
                    {collection.name} <em className="text-muted-foreground">({collection.collectionType})</em>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">All Collections</h3>

        {isLoading && <p className="text-sm text-muted-foreground">Loading collections...</p>}

        {error && (
          <p className="text-sm text-destructive">Failed to load collections: {error.message}</p>
        )}

        {data && data.collections.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No collections yet. Create your first collection above!
          </p>
        )}

        {data && data.collections.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Collections Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    {getCollectionIcon("collection")}
                    Collections
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {data.collections
                  .filter((c) => c.collectionType === "collection")
                  .map((collection) => (
                    <DropdownMenuItem
                      key={collection._id}
                      onClick={() => onCollectionClicked(collection)}
                    >
                      {collection.name}
                    </DropdownMenuItem>
                  ))}
                {data.collections.filter((c) => c.collectionType === "collection").length === 0 && (
                  <DropdownMenuItem disabled>No collections yet</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Wishlists Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    {getCollectionIcon("wishlist")}
                    Wishlists
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {data.collections
                  .filter((c) => c.collectionType === "wishlist")
                  .map((collection) => (
                    <DropdownMenuItem
                      key={collection._id}
                      onClick={() => onCollectionClicked(collection)}
                    >
                      {collection.name}
                    </DropdownMenuItem>
                  ))}
                {data.collections.filter((c) => c.collectionType === "wishlist").length === 0 && (
                  <DropdownMenuItem disabled>No wishlists yet</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Decks Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    {getCollectionIcon("deck")}
                    Decks
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {data.collections
                  .filter((c) => c.collectionType === "deck")
                  .map((collection) => (
                    <DropdownMenuItem
                      key={collection._id}
                      onClick={() => onCollectionClicked(collection)}
                    >
                      {collection.name}
                    </DropdownMenuItem>
                  ))}
                {data.collections.filter((c) => c.collectionType === "deck").length === 0 && (
                  <DropdownMenuItem disabled>No decks yet</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <NewCollectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultCollectionType={selectedType}
        onCreate={onNewCollection}
        isCreating={isCreating}
      />
    </div>
  );
}
