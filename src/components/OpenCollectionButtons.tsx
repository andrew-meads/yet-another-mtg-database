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
import { useCollectionDropTarget } from "@/hooks/drag-drop/useCollectionDropTarget";
import clsx from "clsx";
import { Separator } from "./ui/separator";

/**
 * OpenCollectionsList Component
 *
 * Mobile drawer version of open collections display.
 * Renders collections as a vertical list with action buttons.
 */
export function OpenCollectionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const { openCollections, removeOpenCollection, setActiveCollection } =
    useOpenCollectionsContext();

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

/**
 * OpenCollectionButtons Component
 *
 * Desktop version of open collections display.
 * Shows individual buttons or a dropdown menu depending on number of collections.
 */
export default function OpenCollectionButtons() {
  const router = useRouter();
  const pathname = usePathname();
  const { openCollections, removeOpenCollection, setActiveCollection } =
    useOpenCollectionsContext();

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

  // If we have more than threshold collections, use dropdown menu
  // if (openCollections.length > threshold) {
  //   return (
  //     <OpenCollectionsDropdownMenu
  //       openCollections={openCollections}
  //       pathname={pathname}
  //       router={router}
  //       handleCloseButton={handleCloseButton}
  //       setActiveCollection={setActiveCollection}
  //     />
  //   );
  // }

  // Otherwise, show individual buttons
  return openCollections.map((collection) => (
    <OpenCollectionButton
      key={collection._id}
      collection={collection}
      onClose={handleCloseButton}
    />
  ));
}

/**
 * Props for OpenCollectionButton component
 */
interface OpenCollectionButtonProps {
  /** The collection to display as a button */
  collection: CollectionSummary;
  /** Callback invoked when the close button is clicked */
  onClose: (id: string) => void;
}

/**
 * OpenCollectionButton Component
 *
 * Renders an individual collection as a button with drag-and-drop support.
 * The button acts as a drop target for cards and card entries.
 * Includes a context menu for making the collection active.
 */
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

// /**
//  * Props for OpenCollectionsDropdownMenu component
//  */
// interface OpenCollectionsDropdownMenuProps {
//   /** Array of all open collections to display in the dropdown */
//   openCollections: CollectionSummary[];
//   /** Current pathname for highlighting the active page */
//   pathname: string;
//   /** Next.js router instance for navigation */
//   router: any;
//   /** Callback to close a collection */
//   handleCloseButton: (id: string) => void;
//   /** Callback to set a collection as active */
//   setActiveCollection: (collection: CollectionSummary) => void;
// }

// /**
//  * OpenCollectionsDropdownMenu Component
//  *
//  * Dropdown menu for displaying multiple open collections when the count exceeds the threshold.
//  * Shows a trigger button with collection count and a menu with all collections.
//  */
// function OpenCollectionsDropdownMenu({
//   openCollections,
//   pathname,
//   router,
//   handleCloseButton,
//   setActiveCollection
// }: OpenCollectionsDropdownMenuProps) {
//   const { isDraggingCards } = useDragLayer((monitor) => ({
//     isDraggingCards: monitor.getItemType() === "CARD" || monitor.getItemType() === "CARD_ENTRY"
//   }));

//   return (
//     <div className="relative">
//       <DropdownMenu>
//         <DropdownMenuTrigger asChild>
//           <Button variant="outline" size="sm" className="gap-2">
//             <FolderOpen className="h-4 w-4" />
//             <span>{openCollections.length} open collections</span>
//             <ChevronDown className="h-4 w-4" />
//           </Button>
//         </DropdownMenuTrigger>
//         <DropdownMenuContent align="end" className="w-64">
//           {openCollections.map((collection, index) => (
//             <div key={collection._id}>
//               <CollectionDropdownMenuItem
//                 collection={collection}
//                 pathname={pathname}
//                 router={router}
//                 handleCloseButton={handleCloseButton}
//                 setActiveCollection={setActiveCollection}
//               />
//               {index < openCollections.length - 1 && <DropdownMenuSeparator />}
//             </div>
//           ))}
//         </DropdownMenuContent>
//       </DropdownMenu>
//       {isDraggingCards && <CollectionButtonsFloatingDropTarget />}
//     </div>
//   );
// }

// function CollectionButtonsFloatingDropTarget() {
//   return (
//     <div className="flex items-center gap-2 absolute -right-2 top-10 bg-accent border border-foreground rounded-md p-2">
//       <OpenCollectionButtons threshold={1000} />
//     </div>
//   );
// }

// /**
//  * Props for CollectionDropdownMenuItem component
//  */
// interface CollectionDropdownMenuItemProps {
//   /** The collection to display as a menu item */
//   collection: CollectionSummary;
//   /** Current pathname for highlighting the active page */
//   pathname: string;
//   /** Next.js router instance for navigation */
//   router: any;
//   /** Callback to close a collection */
//   handleCloseButton: (id: string) => void;
//   /** Callback to set a collection as active */
//   setActiveCollection: (collection: CollectionSummary) => void;
// }

// /**
//  * CollectionDropdownMenuItem Component
//  *
//  * Renders a single collection item within the dropdown menu.
//  * Handles navigation and displays the collection icon, name, and action buttons.
//  */
// function CollectionDropdownMenuItem({
//   collection,
//   pathname,
//   router,
//   handleCloseButton,
//   setActiveCollection
// }: CollectionDropdownMenuItemProps) {
//   const isCurrentPage = pathname === `/my-cards/${collection._id}`;

//   return (
//     <DropdownMenuItem
//       className={clsx(
//         "flex items-center justify-between gap-2 cursor-pointer",
//         isCurrentPage && "bg-accent"
//       )}
//       onSelect={(e) => {
//         e.preventDefault();
//         router.push(`/my-cards/${collection._id}`);
//       }}
//     >
//       <div className="flex items-center gap-2 flex-1 min-w-0">
//         <span>{getCollectionIcon(collection.collectionType)}</span>
//         <span className="truncate">{collection.name}</span>
//       </div>
//       <CollectionDropdownMenuItemActions
//         collection={collection}
//         handleCloseButton={handleCloseButton}
//         setActiveCollection={setActiveCollection}
//       />
//     </DropdownMenuItem>
//   );
// }

// /**
//  * Props for CollectionDropdownMenuItemActions component
//  */
// interface CollectionDropdownMenuItemActionsProps {
//   /** The collection associated with these actions */
//   collection: CollectionSummary;
//   /** Callback to close a collection */
//   handleCloseButton: (id: string) => void;
//   /** Callback to set a collection as active */
//   setActiveCollection: (collection: CollectionSummary) => void;
// }

// /**
//  * CollectionDropdownMenuItemActions Component
//  *
//  * Renders the action buttons for a collection in the dropdown menu.
//  * Displays a star button (for setting active collection) and a close button.
//  * Shows filled star icon for active collections.
//  */
// function CollectionDropdownMenuItemActions({
//   collection,
//   handleCloseButton,
//   setActiveCollection
// }: CollectionDropdownMenuItemActionsProps) {
//   return (
//     <div className="flex items-center gap-1 shrink-0">
//       {collection.isActive ? (
//         <div className="rounded-sm p-1">
//           <Star className="h-3 w-3 fill-current" />
//         </div>
//       ) : (
//         <button
//           onClick={(e) => {
//             e.preventDefault();
//             e.stopPropagation();
//             setActiveCollection(collection);
//           }}
//           className="rounded-sm p-1 hover:bg-accent transition-colors"
//           aria-label={`Make ${collection.name} active`}
//         >
//           <Star className="h-3 w-3" />
//         </button>
//       )}
//       <button
//         onClick={(e) => {
//           e.preventDefault();
//           e.stopPropagation();
//           handleCloseButton(collection._id);
//         }}
//         className="rounded-sm p-1 hover:bg-accent transition-colors"
//         aria-label={`Close ${collection.name}`}
//       >
//         <X className="h-3 w-3" />
//       </button>
//     </div>
//   );
// }
