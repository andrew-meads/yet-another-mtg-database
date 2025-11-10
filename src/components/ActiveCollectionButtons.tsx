"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useActiveCollectionsContext } from "@/context/ActiveCollectionsContext";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { CollectionSummary } from "@/types/CardCollection";
import { X } from "lucide-react";

interface ActiveCollectionButtonProps {
  collection: CollectionSummary;
  onClose: (id: string) => void;
}

function ActiveCollectionButton({ collection, onClose }: ActiveCollectionButtonProps) {
  const pathname = usePathname();
  const { _id, name, collectionType } = collection;

  return (
    <Button
      variant={pathname === `/my-cards/${_id}` ? "default" : "outline"}
      size="sm"
      className="gap-1.5 pr-2"
      asChild
    >
      <Link href={`/my-cards/${_id}`}>
        {getCollectionIcon(collectionType)}
        <span>{name}</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose(_id);
          }}
          className="ml-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          aria-label={`Close ${name}`}
        >
          <X className="h-3 w-3" />
        </button>
      </Link>
    </Button>
  );
}

export default function ActiveCollectionButtons() {
  const router = useRouter();
  const pathname = usePathname();
  const { activeCollections, removeActiveCollection } = useActiveCollectionsContext();

  const handleCloseButton = (id: string) => {
    removeActiveCollection(id);
    // If we're currently on this collection page, navigate away
    if (pathname === `/my-cards/${id}`) {
      router.push("/my-cards");
    }
  };

  if (!activeCollections || activeCollections.length === 0) {
    return null;
  }

  return activeCollections.map((collection) => (
    <ActiveCollectionButton
      key={collection._id}
      collection={collection}
      onClose={handleCloseButton}
    />
  ));
}
