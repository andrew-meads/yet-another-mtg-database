"use client";

import { use, useEffect, useState } from "react";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { useRetrieveCollectionDetails } from "@/hooks/react-query/useRetrieveCollectionDetails";
import { useDeleteCollection } from "@/hooks/react-query/useDeleteEntity";
import { useUpdateCollection } from "@/hooks/react-query/useUpdateCollection";
import { getEntityIcon } from "@/lib/collectionUtils";
import CollectionTable from "@/components/my-cards-page/collection-view/CollectionTable";
import { NewCollectionDialog } from "@/components/my-cards-page/NewCollectionDialog";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function CollectionPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { addOpenEntity } = useOpenEntitiesContext();
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, error } = useRetrieveCollectionDetails(id, searchQuery);
  const deleteCollection = useDeleteCollection();
  const updateCollection = useUpdateCollection();
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (data?.collection) addOpenEntity(data.collection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.collection?._id]);

  if (isLoading) {
    return <p className="text-muted-foreground">Loading collection...</p>;
  }
  if (error) {
    return (
      <div className="border-destructive bg-destructive/10 rounded-lg border p-4">
        <h3 className="text-destructive mb-2 text-lg font-semibold">Error Loading Collection</h3>
        <p className="text-destructive/90 text-sm">{error.message}</p>
      </div>
    );
  }
  if (!data?.collection) {
    return <p className="text-muted-foreground">Collection not found</p>;
  }

  const { collection } = data;

  const handleDelete = () => {
    if (!confirm(`Delete "${collection.name}" and all its cards? This cannot be undone.`)) return;
    deleteCollection.mutate(collection._id, { onSuccess: () => router.push("/my-cards") });
  };

  return (
    <div className="mx-auto flex h-full flex-col space-y-6">
      <div className="flex shrink-0 items-start justify-between">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-2xl font-bold">
            {getEntityIcon("collection", "h-6 w-6")}
            {collection.name}
          </h2>
          <p className="text-muted-foreground">
            {collection.description || "No description provided"}
          </p>
        </div>
        <div className="flex items-center gap-2 lg:mr-3">
          <Button
            variant="outline"
            size="icon"
            className="cursor-pointer"
            onClick={() => setEditOpen(true)}
            aria-label="Edit collection"
          >
            <Pencil className="size-[1.2rem]" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="cursor-pointer"
            onClick={handleDelete}
            aria-label="Delete collection"
          >
            <Trash2 className="size-[1.2rem]" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <CollectionTable collection={collection} onSearchChange={setSearchQuery} />
      </div>
      <NewCollectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entityLabel="Collection"
        initialValues={{ name: collection.name, description: collection.description }}
        onSave={(data) => updateCollection.mutate({ collectionId: id, ...data })}
        isSaving={updateCollection.isPending}
      />
    </div>
  );
}
