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
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useOpenEntitiesContext } from "@/context/OpenEntitiesContext";
import { getEntityIcon, entityHref } from "@/lib/collectionUtils";
import { OpenEntitySummary } from "@/types/Deck";
import { X, Star, Pin, PinOff, ChevronDown, CirclePlus } from "lucide-react";
import { useEntityButtonDropTarget } from "@/hooks/drag-drop/useEntityButtonDropTarget";
import { useDragLayer } from "react-dnd";
import clsx from "clsx";
import { Separator } from "./ui/separator";

/**
 * Mobile drawer version of the open-entities display: a vertical list of the
 * user's open collections and decks.
 */
export function OpenCollectionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const { openEntities, removeOpenEntity, setActiveCollection, isPinned, togglePin } =
    useOpenEntitiesContext();

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
        const pinned = isPinned(entity._id);
        return (
          <div key={entity._id}>
            <div
              className={clsx(
                "hover:bg-accent flex cursor-pointer items-center justify-between gap-2 rounded-md p-2 transition-colors",
                isCurrentPage && "bg-accent"
              )}
              onClick={() => router.push(href)}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span>{getEntityIcon(entity.kind)}</span>
                <span className="truncate">{entity.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {entity.kind === "collection" &&
                  (isActiveCollection ? (
                    <div className="rounded-sm p-1">
                      <Star className="fill-current size-3" />
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveCollection(entity);
                      }}
                      className="hover:bg-accent rounded-sm p-1 transition-colors"
                      aria-label={`Make ${entity.name} active`}
                    >
                      <Star className="size-3" />
                    </button>
                  ))}
                {!isActiveCollection && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      togglePin(entity._id);
                    }}
                    className="hover:bg-accent rounded-sm p-1 transition-colors"
                    aria-label={pinned ? `Unpin ${entity.name}` : `Pin ${entity.name}`}
                  >
                    {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCloseButton(entity);
                  }}
                  className="hover:bg-accent rounded-sm p-1 transition-colors"
                  aria-label={`Close ${entity.name}`}
                >
                  <X className="size-3" />
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
 * Desktop version: pinned collections/decks render inline as drop targets; the
 * rest live behind a "More" dropdown (navigable, but not drop targets).
 */
export default function OpenCollectionButtons() {
  const router = useRouter();
  const pathname = usePathname();
  const { pinnedEntities, unpinnedEntities, removeOpenEntity } = useOpenEntitiesContext();

  // While any card is being dragged, the divs in the inline buttons are made visible and
  // advertise themselves as drop targets (expand + dashed outline).
  // Only NEW_CARD / PHYSICAL_CARD drags exist, so a plain isDragging() is sufficient.
  const isDragging = useDragLayer((monitor) => monitor.isDragging());

  const handleCloseButton = (entity: OpenEntitySummary) => {
    removeOpenEntity(entity._id);
    if (pathname === entityHref(entity)) router.push("/my-cards");
  };

  if (pinnedEntities.length === 0 && unpinnedEntities.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Separator orientation="vertical" className="bg-foreground/20 mx-1 h-6! shrink-0" />
      <div className="flex min-w-0 items-center gap-2 transition-all">
        {pinnedEntities.map((entity) => (
          <OpenEntityButton
            key={entity._id}
            entity={entity}
            onClose={handleCloseButton}
            isDragging={isDragging}
          />
        ))}
      </div>
      {unpinnedEntities.length > 0 && (
        <MoreEntitiesMenu entities={unpinnedEntities} onClose={handleCloseButton} />
      )}
    </div>
  );
}

interface OpenEntityButtonProps {
  entity: OpenEntitySummary;
  onClose: (entity: OpenEntitySummary) => void;
  isDragging: boolean;
}

function OpenEntityButton({ entity, onClose, isDragging }: OpenEntityButtonProps) {
  const pathname = usePathname();
  const { setActiveCollection, isPinned, togglePin } = useOpenEntitiesContext();
  const href = entityHref(entity);

  const { isOver, dropRef } = useEntityButtonDropTarget(entity);
  const isActiveCollection = entity.kind === "collection" && entity.isActive;
  const pinned = isPinned(entity._id);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div data-testid={`open-entity-${entity._id}`} className="relative shrink-0 transition-all">
          <Button
            variant={pathname === href ? "default" : "outline"}
            size="sm"
            className={clsx("gap-1.5 pr-2 transition-all", isDragging && "rounded-b-none")}
            asChild
          >
            <Link href={href}>
              <span>{getEntityIcon(entity.kind)}</span>
              <span>{entity.name}</span>
              {isActiveCollection && <Star className="fill-current size-3" />}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(entity);
                }}
                className="ml-1 rounded-sm opacity-70 transition-opacity hover:opacity-100"
                aria-label={`Close ${entity.name}`}
              >
                <X className="size-3" />
              </button>
            </Link>
          </Button>

          {/* Drop zone — absolutely positioned below the button. Invisible and
              non-interactive until a drag starts, then becomes a labelled target. */}
          <div
            ref={dropRef}
            data-testid={`drop-zone-${entity._id}`}
            data-drag-active={isDragging ? "" : undefined}
            className={clsx(
              "absolute top-full left-0 h-20 w-full rounded-b-md border-x border-b",
              !isDragging && "pointer-events-none invisible",
              isOver
                ? "border-primary bg-primary/50"
                : "border-primary/50 bg-primary/20 border-dashed"
            )}
          >
            <div className="flex h-full items-center justify-center">
              <CirclePlus
                className={clsx(
                  "transition-colors size-5",
                  isOver ? "text-primary" : "text-primary/50"
                )}
              />
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {entity.kind === "collection" && !isActiveCollection && (
          <ContextMenuItem onClick={() => setActiveCollection(entity)}>Make active</ContextMenuItem>
        )}
        {!isActiveCollection && (
          <ContextMenuItem onClick={() => togglePin(entity._id)}>
            {pinned ? "Unpin from bar" : "Pin to bar"}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onClose(entity)}>Close</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface MoreEntitiesMenuProps {
  entities: OpenEntitySummary[];
  onClose: (entity: OpenEntitySummary) => void;
}

/**
 * Dropdown holding the unpinned open entities. Rows navigate on click and offer
 * an inline pin toggle + close. Rows here are intentionally not drop targets —
 * pin an entity to make it a droppable inline button.
 */
function MoreEntitiesMenu({ entities, onClose }: MoreEntitiesMenuProps) {
  const { togglePin } = useOpenEntitiesContext();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          data-testid="open-entities-more"
        >
          More
          <span className="text-xs opacity-70">({entities.length})</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {entities.map((entity) => (
          <div
            key={entity._id}
            data-testid={`open-entity-menu-${entity._id}`}
            className="flex items-center gap-1 pr-1"
          >
            <DropdownMenuItem asChild className="min-w-0 flex-1">
              <Link href={entityHref(entity)}>
                <span>{getEntityIcon(entity.kind)}</span>
                <span className="truncate">{entity.name}</span>
              </Link>
            </DropdownMenuItem>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePin(entity._id);
              }}
              className="hover:bg-accent rounded-sm p-1.5 transition-colors"
              aria-label={`Pin ${entity.name}`}
              data-testid={`pin-toggle-${entity._id}`}
            >
              <Pin className="size-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose(entity);
              }}
              className="hover:bg-accent rounded-sm p-1.5 transition-colors"
              aria-label={`Close ${entity.name}`}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
