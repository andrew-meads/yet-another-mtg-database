"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useActiveCollectionsContext } from "@/context/ActiveCollectionsContext";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { CollectionSummary } from "@/types/CardCollection";
import { X } from "lucide-react";
import { useDrop } from "react-dnd";
import { MtgCard } from "@/types/MtgCard";
import clsx from "clsx";

interface ActiveCollectionButtonProps {
  collection: CollectionSummary;
  onClose: (id: string) => void;
}

function ActiveCollectionButton({ collection, onClose }: ActiveCollectionButtonProps) {
  const pathname = usePathname();
  const { _id, name, collectionType } = collection;

  // Setup button to be a drop target for cards
  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: "CARD",
    collect: (monitor) => ({
      isOver: monitor.isOver()
    }),
    drop: ({ card }: { card: MtgCard }) => {
      console.log(`Dropped card ${card.name} into collection ${name}`);
    }
  }));

  return (
    <div ref={dropRef as unknown as React.LegacyRef<HTMLDivElement>}>
      <Button
        variant={pathname === `/my-cards/${_id}` ? "default" : "outline"}
        size="sm"
        className={clsx(
          "gap-1.5 pr-2 transition-all",
          isOver && "ring-4 ring-primary ring-offset-2 bg-primary/20"
        )}
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
    </div>
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
