"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { CollectionSummary } from "@/types/CardCollection";
import { X, Star } from "lucide-react";
import { useDrop } from "react-dnd";
import { MtgCard } from "@/types/MtgCard";
import clsx from "clsx";

interface OpenCollectionButtonProps {
  collection: CollectionSummary;
  onClose: (id: string) => void;
}

function OpenCollectionButton({ collection, onClose }: OpenCollectionButtonProps) {
  const pathname = usePathname();
  const { _id, name, collectionType, isActive } = collection;
  const { setActiveCollection } = useOpenCollectionsContext();

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
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
              <span>{getCollectionIcon(collectionType)}</span>
              <span>{name}</span>
              {isActive && <Star className="h-3 w-3 fill-current" />}
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setActiveCollection(collection)}>
          Make active
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function OpenCollectionButtons() {
  const router = useRouter();
  const pathname = usePathname();
  const { openCollections, removeOpenCollection } = useOpenCollectionsContext();

  const handleCloseButton = (id: string) => {
    removeOpenCollection(id);
    // If we're currently on this collection page, navigate away
    if (pathname === `/my-cards/${id}`) {
      router.push("/my-cards");
    }
  };

  if (!openCollections || openCollections.length === 0) {
    return null;
  }

  return openCollections.map((collection) => (
    <OpenCollectionButton
      key={collection._id}
      collection={collection}
      onClose={handleCloseButton}
    />
  ));
}
