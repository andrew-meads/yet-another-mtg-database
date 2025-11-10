"use client";

import { use, useEffect } from "react";
import { useActiveCollectionsContext } from "@/context/ActiveCollectionsContext";
import { useRetrieveCollectionDetails } from "@/hooks/useRetrieveCollectionDetails";
import { getCollectionIcon } from "@/lib/collectionUtils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function Page({ params }: PageProps) {
  const { id } = use(params);
  const { addActiveCollection } = useActiveCollectionsContext();
  const { data, isLoading, error } = useRetrieveCollectionDetails(id);

  if (data) addActiveCollection(data.collection);

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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          {getCollectionIcon(collection.collectionType, "h-6 w-6")}
          {collection.name}
        </h2>
        <p className="text-muted-foreground">
          {collection.description || "No description provided"}
        </p>
      </div>
    </div>
  );
}
