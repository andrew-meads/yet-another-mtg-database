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
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { getEntityIcon, entityHref } from "@/lib/collectionUtils";
import { OpenEntitySummary } from "@/types/Deck";
import { X, Star } from "lucide-react";
import { useEntityButtonDropTarget } from "@/hooks/drag-drop/useEntityButtonDropTarget";
import clsx from "clsx";
import { Separator } from "./ui/separator";

/**
 * Mobile drawer version of the open-entities display: a vertical list of the
 * user's open collections and decks.
 */
export function OpenCollectionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const { openEntities, removeOpenEntity, setActiveCollection } = useOpenEntitiesContext();

  const handleCloseButton = (entity: OpenEntitySummary) => {
    removeOpenEntity(entity._id);
    if (pathname === entityHref(entity)) router.push("/my-cards");
  };

  if (!openEntities || openEntities.length === 0) return null;

  return (
    <div className="w-full space-y-1">
      {openEntities.map((entity, index) => {
        const href = entityHref(entity);
        const isCurrentPage = pathname === href;
        const isActiveCollection = entity.kind === "collection" && entity.isActive;
        return (
          <div key={entity._id}>
            <div
              className={clsx(
                "flex items-center justify-between gap-2 p-2 rounded-md cursor-pointer hover:bg-accent transition-colors",
                isCurrentPage && "bg-accent"
              )}
              onClick={() => router.push(href)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span>{getEntityIcon(entity.kind)}</span>
                <span className="truncate">{entity.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {entity.kind === "collection" &&
                  (isActiveCollection ? (
                    <div className="rounded-sm p-1">
                      <Star className="h-3 w-3 fill-current" />
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveCollection(entity);
                      }}
                      className="rounded-sm p-1 hover:bg-accent transition-colors"
                      aria-label={`Make ${entity.name} active`}
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  ))}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCloseButton(entity);
                  }}
                  className="rounded-sm p-1 hover:bg-accent transition-colors"
                  aria-label={`Close ${entity.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            {index < openEntities.length - 1 && <Separator className="my-1" />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Desktop version: a button per open collection/deck, each a drop target.
 */
export default function OpenCollectionButtons() {
  const router = useRouter();
  const pathname = usePathname();
  const { openEntities, removeOpenEntity } = useOpenEntitiesContext();

  const handleCloseButton = (entity: OpenEntitySummary) => {
    removeOpenEntity(entity._id);
    if (pathname === entityHref(entity)) router.push("/my-cards");
  };

  if (!openEntities || openEntities.length === 0) return null;

  return openEntities.map((entity) => (
    <OpenEntityButton key={entity._id} entity={entity} onClose={handleCloseButton} />
  ));
}

interface OpenEntityButtonProps {
  entity: OpenEntitySummary;
  onClose: (entity: OpenEntitySummary) => void;
}

function OpenEntityButton({ entity, onClose }: OpenEntityButtonProps) {
  const pathname = usePathname();
  const { setActiveCollection } = useOpenEntitiesContext();
  const href = entityHref(entity);

  const { isOver, dropRef } = useEntityButtonDropTarget(entity);
  const isActiveCollection = entity.kind === "collection" && entity.isActive;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={dropRef}>
          <Button
            variant={pathname === href ? "default" : "outline"}
            size="sm"
            className={clsx(
              "gap-1.5 pr-2 transition-all",
              isOver && "ring-4 ring-primary ring-offset-2 bg-primary/20"
            )}
            asChild
          >
            <Link href={href}>
              <span>{getEntityIcon(entity.kind)}</span>
              <span>{entity.name}</span>
              {isActiveCollection && <Star className="h-3 w-3 fill-current" />}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(entity);
                }}
                className="ml-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                aria-label={`Close ${entity.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Link>
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {entity.kind === "collection" && (
          <ContextMenuItem onClick={() => setActiveCollection(entity)}>
            Make active
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
