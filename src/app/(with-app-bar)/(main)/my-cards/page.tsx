"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { NewCollectionDialog } from "@/components/my-cards-page/NewCollectionDialog";
import { useCreateCollection } from "@/hooks/react-query/useCreateCollection";
import { useCreateDeck } from "@/hooks/react-query/useCreateDeck";
import { useRetrieveCollectionSummaries } from "@/hooks/react-query/useRetrieveCollectionSummaries";
import { useRetrieveDeckSummaries } from "@/hooks/react-query/useRetrieveDeckSummaries";
import { getEntityIcon } from "@/lib/collectionUtils";
import { HomeIcon } from "lucide-react";

type CreateKind = "collection" | "deck";

export default function Page() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialogKind, setDialogKind] = useState<CreateKind | null>(null);
  const router = useRouter();

  const createCollection = useCreateCollection();
  const createDeck = useCreateDeck();
  const { data: collectionsData } = useRetrieveCollectionSummaries();
  const { data: decksData } = useRetrieveDeckSummaries();

  const collections = collectionsData?.collections ?? [];
  const decks = decksData?.decks ?? [];

  const handleCreate = (data: { name: string; description: string }) => {
    if (dialogKind === "collection") {
      createCollection.mutate(data, {
        onSuccess: (res) => router.push(`/my-cards/collections/${res.collection._id}`),
        onError: (err) => setErrorMessage(err.message || "Failed to create collection")
      });
    } else if (dialogKind === "deck") {
      createDeck.mutate(data, {
        onSuccess: (res) => router.push(`/my-cards/decks/${res.deck._id}`),
        onError: (err) => setErrorMessage(err.message || "Failed to create deck")
      });
    }
  };

  return (
    <>
      <div className="mx-auto space-y-6">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-2xl font-bold">
            <HomeIcon className="size-6" />
            My Cards
          </h2>
          <p className="text-muted-foreground">
            Manage your Magic: The Gathering collections and decks.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-lg border p-6">
            <h3 className="text-xl font-semibold">Collections</h3>
            <p className="text-muted-foreground text-sm">
              Track which cards you own and their quantities.
            </p>
            <Button className="w-full" onClick={() => setDialogKind("collection")}>
              New Collection
            </Button>
          </div>

          <div className="space-y-4 rounded-lg border p-6">
            <h3 className="text-xl font-semibold">Decks</h3>
            <p className="text-muted-foreground text-sm">
              Arrange your cards into decks with sections and columns.
            </p>
            <Button className="w-full" onClick={() => setDialogKind("deck")}>
              New Deck
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-semibold">
              {getEntityIcon("collection")} Collections
            </h3>
            {collections.length === 0 ? (
              <p className="text-muted-foreground text-sm">No collections yet.</p>
            ) : (
              <ul className="space-y-1">
                {collections.map((c) => (
                  <li key={c._id}>
                    <Button variant="ghost" className="w-full justify-start" asChild>
                      <Link href={`/my-cards/collections/${c._id}`}>{c.name}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border p-6">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-semibold">
              {getEntityIcon("deck")} Decks
            </h3>
            {decks.length === 0 ? (
              <p className="text-muted-foreground text-sm">No decks yet.</p>
            ) : (
              <ul className="space-y-1">
                {decks.map((d) => (
                  <li key={d._id}>
                    <Button variant="ghost" className="w-full justify-start" asChild>
                      <Link href={`/my-cards/decks/${d._id}`}>{d.name}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <NewCollectionDialog
        open={dialogKind !== null}
        onOpenChange={(open) => !open && setDialogKind(null)}
        entityLabel={dialogKind === "deck" ? "Deck" : "Collection"}
        onCreate={handleCreate}
        isCreating={createCollection.isPending || createDeck.isPending}
      />

      <AlertDialog open={!!errorMessage} onOpenChange={(open) => !open && setErrorMessage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Failed to Create</AlertDialogTitle>
            <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorMessage(null)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
