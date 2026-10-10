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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
 * Mobile drawer version of the app-bar entities: the pinned collections and
 * decks, then everything else, each row with make-active and pin/unpin buttons.
 */
export function OpenCollectionsList() {
  const { pinnedEntities, unpinnedEntities } = useOpenEntitiesContext();

  if (pinnedEntities.length === 0 && unpinnedEntities.length === 0) return null;

  return (
    <div className="w-full space-y-1">
      {pinnedEntities.map((entity) => (
        <MobileEntityRow key={entity._id} entity={entity} />
      ))}
      {unpinnedEntities.length > 0 && (
        <>
          {pinnedEntities.length > 0 && <Separator className="my-2" />}
          <p className="text-muted-foreground px-2 text-xs font-medium">Not pinned</p>
          {unpinnedEntities.map((entity) => (
            <MobileEntityRow key={entity._id} entity={entity} />
          ))}
        </>
      )}
    </div>
  );
}

function MobileEntityRow({ entity }: { entity: OpenEntitySummary }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setActiveEntity, isPinned, pinEntity, unpinEntity } = useOpenEntitiesContext();
  const href = entityHref(entity);
  const isActiveEntity = entity.isActive === true;
  const pinned = isPinned(entity._id);

  return (
    <div
      data-testid={`mobile-entity-${entity._id}`}
      className={clsx(
        "hover:bg-accent flex cursor-pointer items-center justify-between gap-2 rounded-md p-2 transition-colors",
        pathname === href && "bg-accent"
      )}
      onClick={() => router.push(href)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span>{getEntityIcon(entity.kind)}</span>
        <span className="truncate">{entity.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isActiveEntity ? (
          <div className="rounded-sm p-1">
            <Star className="size-3 fill-current" />
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveEntity(entity);
            }}
            className="hover:bg-accent rounded-sm p-1 transition-colors"
            aria-label={`Make ${entity.name} active`}
          >
            <Star className="size-3" />
          </button>
        )}
        {/* The active entity is always pinned, so it gets no unpin button. */}
        {!isActiveEntity && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (pinned) unpinEntity(entity._id);
              else pinEntity(entity);
            }}
            className="hover:bg-accent rounded-sm p-1 transition-colors"
            aria-label={pinned ? `Unpin ${entity.name}` : `Pin ${entity.name}`}
          >
            {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Desktop version: pinned collections/decks render inline as drop targets; every
 * other collection and deck lives behind a "More" dropdown (navigable, but not
 * drop targets).
 */
export default function OpenCollectionButtons() {
  const { pinnedEntities, unpinnedEntities } = useOpenEntitiesContext();

  // While any card is being dragged, the divs in the inline buttons are made visible and
  // advertise themselves as drop targets (expand + dashed outline).
  // Only NEW_CARD / PHYSICAL_CARD drags exist, so a plain isDragging() is sufficient.
  const isDragging = useDragLayer((monitor) => monitor.isDragging());

  if (pinnedEntities.length === 0 && unpinnedEntities.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Separator orientation="vertical" className="bg-foreground/20 mx-1 h-6! shrink-0" />
      <div className="flex min-w-0 items-center gap-2 transition-all">
        {pinnedEntities.map((entity) => (
          <OpenEntityButton key={entity._id} entity={entity} isDragging={isDragging} />
        ))}
      </div>
      {unpinnedEntities.length > 0 && <MoreEntitiesMenu entities={unpinnedEntities} />}
    </div>
  );
}

interface OpenEntityButtonProps {
  entity: OpenEntitySummary;
  isDragging: boolean;
}

function OpenEntityButton({ entity, isDragging }: OpenEntityButtonProps) {
  const pathname = usePathname();
  const { setActiveEntity, unpinEntity } = useOpenEntitiesContext();
  const href = entityHref(entity);

  const { isOver, dropRef } = useEntityButtonDropTarget(entity);
  // The active entity is always pinned, so it has no unpin affordances.
  const isActiveEntity = entity.isActive === true;

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
              {isActiveEntity ? (
                <Star className="size-3 fill-current" />
              ) : (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    unpinEntity(entity._id);
                  }}
                  className="ml-1 rounded-sm opacity-70 transition-opacity hover:opacity-100"
                  aria-label={`Unpin ${entity.name}`}
                >
                  <X className="size-3" />
                </button>
              )}
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
                  "size-5 transition-colors",
                  isOver ? "text-primary" : "text-primary/50"
                )}
              />
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {isActiveEntity ? (
          <ContextMenuItem disabled>Active {entity.kind}s stay pinned</ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onClick={() => setActiveEntity(entity)}>Make active</ContextMenuItem>
            <ContextMenuItem onClick={() => unpinEntity(entity._id)}>
              Unpin from bar
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface MoreEntitiesMenuProps {
  entities: OpenEntitySummary[];
}

/**
 * Dropdown holding every unpinned collection and deck, grouped by kind. Rows
 * navigate on click and offer an inline pin button. Rows here are intentionally
 * not drop targets — pin an entity to make it a droppable inline button.
 */
function MoreEntitiesMenu({ entities }: MoreEntitiesMenuProps) {
  const pathname = usePathname();
  const collections = entities.filter((e) => e.kind === "collection");
  const decks = entities.filter((e) => e.kind === "deck");
  // Highlight the trigger when the current page belongs to an unpinned entity.
  const containsCurrentPage = entities.some((e) => pathname === entityHref(e));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={containsCurrentPage ? "default" : "outline"}
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
        <MoreEntitiesGroup label="Collections" entities={collections} />
        {collections.length > 0 && decks.length > 0 && <DropdownMenuSeparator />}
        <MoreEntitiesGroup label="Decks" entities={decks} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreEntitiesGroup({ label, entities }: { label: string; entities: OpenEntitySummary[] }) {
  const pathname = usePathname();
  const { pinEntity } = useOpenEntitiesContext();

  if (entities.length === 0) return null;

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-muted-foreground text-xs">{label}</DropdownMenuLabel>
      {entities.map((entity) => {
        const href = entityHref(entity);
        return (
          <div
            key={entity._id}
            data-testid={`open-entity-menu-${entity._id}`}
            className="flex items-center gap-1 pr-1"
          >
            <DropdownMenuItem
              asChild
              className={clsx("min-w-0 flex-1", pathname === href && "bg-accent")}
            >
              <Link href={href}>
                <span>{getEntityIcon(entity.kind)}</span>
                <span className="truncate">{entity.name}</span>
              </Link>
            </DropdownMenuItem>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pinEntity(entity);
              }}
              className="hover:bg-accent rounded-sm p-1.5 transition-colors"
              aria-label={`Pin ${entity.name}`}
              data-testid={`pin-toggle-${entity._id}`}
            >
              <Pin className="size-3.5" />
            </button>
          </div>
        );
      })}
    </DropdownMenuGroup>
  );
}
