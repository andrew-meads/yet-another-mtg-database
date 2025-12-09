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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { useOpenCollectionsContext } from "@/context/OpenCollectionsContext";
import { getCollectionIcon } from "@/lib/collectionUtils";
import { CollectionSummary } from "@/types/CardCollection";
import { X, Star, FolderOpen, ChevronDown } from "lucide-react";
import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import clsx from "clsx";
import { Separator } from "./ui/separator";

interface OpenCollectionButtonsProps {
  mobileDrawerMode?: boolean;
}

interface OpenCollectionButtonProps {
  collection: CollectionSummary;
  onClose: (id: string) => void;
}

function OpenCollectionButton({ collection, onClose }: OpenCollectionButtonProps) {
  const pathname = usePathname();
  const { _id, name, collectionType, isActive } = collection;
  const { setActiveCollection } = useOpenCollectionsContext();

  // Setup button to be a drop target for cards
  const { isOver, dropRef } = useCollectionDropTarget({ collection, allowDrop: true });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={dropRef}>
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

export default function OpenCollectionButtons({ mobileDrawerMode = false }: OpenCollectionButtonsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { openCollections, removeOpenCollection, setActiveCollection } = useOpenCollectionsContext();

  const THRESHOLD = 3;

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

  // Mobile drawer mode: render as list items styled like dropdown menu
  if (mobileDrawerMode) {
    return (
      <div className="w-full space-y-1">
        {openCollections.map((collection, index) => {
          const isCurrentPage = pathname === `/my-cards/${collection._id}`;
          return (
            <div key={collection._id}>
              <div
                className={clsx(
                  "flex items-center justify-between gap-2 p-2 rounded-md cursor-pointer hover:bg-accent transition-colors",
                  isCurrentPage && "bg-accent"
                )}
                onClick={() => router.push(`/my-cards/${collection._id}`)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span>{getCollectionIcon(collection.collectionType)}</span>
                  <span className="truncate">{collection.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {collection.isActive ? (
                    <div className="rounded-sm p-1">
                      <Star className="h-3 w-3 fill-current" />
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveCollection(collection);
                      }}
                      className="rounded-sm p-1 hover:bg-accent transition-colors"
                      aria-label={`Make ${collection.name} active`}
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCloseButton(collection._id);
                    }}
                    className="rounded-sm p-1 hover:bg-accent transition-colors"
                    aria-label={`Close ${collection.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
              {index < openCollections.length - 1 && <Separator className="my-1" />}
            </div>
          );
        })}
      </div>
    );
  }

  // If we have more than THRESHOLD collections, use dropdown menu
  if (openCollections.length > THRESHOLD) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            <span>{openCollections.length} Collections</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {openCollections.map((collection, index) => {
            const isCurrentPage = pathname === `/my-cards/${collection._id}`;
            return (
              <div key={collection._id}>
                <DropdownMenuItem
                  className={clsx(
                    "flex items-center justify-between gap-2 cursor-pointer",
                    isCurrentPage && "bg-accent"
                  )}
                  onSelect={(e) => {
                    e.preventDefault();
                    router.push(`/my-cards/${collection._id}`);
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span>{getCollectionIcon(collection.collectionType)}</span>
                    <span className="truncate">{collection.name}</span>
                  </div>
                <div className="flex items-center gap-1 shrink-0">
                  {collection.isActive ? (
                    <div className="rounded-sm p-1">
                      <Star className="h-3 w-3 fill-current" />
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveCollection(collection);
                      }}
                      className="rounded-sm p-1 hover:bg-accent transition-colors"
                      aria-label={`Make ${collection.name} active`}
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCloseButton(collection._id);
                    }}
                    className="rounded-sm p-1 hover:bg-accent transition-colors"
                    aria-label={`Close ${collection.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </DropdownMenuItem>
              {index < openCollections.length - 1 && <DropdownMenuSeparator />}
            </div>
          );
        })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Otherwise, show individual buttons
  return openCollections.map((collection) => (
    <OpenCollectionButton
      key={collection._id}
      collection={collection}
      onClose={handleCloseButton}
    />
  ));
}
