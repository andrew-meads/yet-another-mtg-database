"use client";

import type React from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import CardArtView from "@/components/CardArtView";
import { CardTextView } from "@/components/CardTextView";
import { useCardSelection } from "@/context/CardSelectionContext";
import CardLocationsView from "./CardLocationsView";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useIsDesktop } from "@/hooks/useIsDesktop";

/**
 * localStorage key for persisting desktop panel layout sizes
 */
const STORAGE_KEY = "layout/main-panels";

/**
 * MainWorkspace Component
 *
 * Root component that provides a responsive workspace for viewing MTG cards and search results.
 * - On mobile (<768px): Simple scrollable layout
 * - On desktop (≥768px): Uses a resizable panel layout with card details on the left and content on the right
 *
 * @param props - Component props
 * @param props.children - Content to display in the main workspace area
 */
export default function MainWorkspace({ children }: React.PropsWithChildren) {
  const { isDesktop, mounted } = useIsDesktop();
  console.log("MainWorkspace isDesktop:", isDesktop);

  return (
    <div className="w-full h-[calc(100dvh-64px)] md:h-[calc(100vh-120px)] min-h-[600px]">
      {!mounted ? (
        <div className="w-full h-full" />
      ) : isDesktop ? (
        <DesktopMainWorkspace>{children}</DesktopMainWorkspace>
      ) : (
        <MobileMainWorkspace>{children}</MobileMainWorkspace>
      )}
    </div>
  );
}

/**
 * MobileMainWorkspace Component
 *
 * Mobile-optimized workspace for small screens (<768px).
 *
 * Features:
 * - Simple single-view layout displaying children content (search results, collections, etc.)
 * - Full-height scrollable area
 *
 * @param props - Component props
 * @param props.children - Content to display in the mobile workspace
 */
function MobileMainWorkspace({ children }: React.PropsWithChildren) {
  return <div className="h-full overflow-y-auto">{children}</div>;
}

/**
 * DesktopMainWorkspace Component
 *
 * Desktop-optimized workspace using resizable panels for larger screens (≥768px).
 *
 * Layout:
 * - Left panel: Card details (20% default width, collapsible, min 15%)
 *   - Top: Card image (45% default height)
 *   - Middle: Card locations (20% default height)
 *   - Bottom: Card text (35% default height)
 * - Right panel: Main content area (80% default width, min 30%)
 *   - Displays children (search results, collections, etc.)
 *
 * Features:
 * - Resizable panels with drag handles - user can adjust sizes
 * - Layout sizes are persisted to localStorage
 * - Left panel can be collapsed when not needed
 * - Cards are draggable in desktop mode
 * - All panels have vertical scrolling when content overflows
 *
 * @param props - Component props
 * @param props.children - Content to display in the right panel
 */
function DesktopMainWorkspace({ children }: React.PropsWithChildren) {
  const { selectedCard } = useCardSelection();
  const [layout, setLayout] = useLocalStorage<number[]>(STORAGE_KEY, [20, 80]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => {
        setLayout(sizes);
      }}
      className="rounded-md border"
    >
      {/* Left: Card Details - split into image (top) and text (bottom) */}
      <ResizablePanel defaultSize={layout[0]} minSize={15} collapsible>
        {selectedCard ? (
          <ResizablePanelGroup direction="vertical">
            {/* Top: Card Image */}
            <ResizablePanel defaultSize={45} minSize={30} className="p-4 overflow-hidden">
              <div className="h-full w-full">
                <CardArtView
                  card={selectedCard}
                  variant="large"
                  flippable={true}
                  draggable={true}
                  width="100%"
                  height="100%"
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Middle: Card locations */}
            <ResizablePanel defaultSize={20} minSize={10}>
              <div className="h-full p-4 overflow-y-auto">
                <CardLocationsView cardName={selectedCard?.name} />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Bottom: Card Text */}
            <ResizablePanel defaultSize={35} minSize={30}>
              <div className="h-full p-4 overflow-y-auto">
                <CardTextView card={selectedCard} />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="h-full w-full grid place-items-center text-muted-foreground p-4">
            <div className="text-center space-y-2">
              <div className="font-semibold text-lg">Card Details</div>
              <div className="text-sm">Select a card to see its art and rules text</div>
            </div>
          </div>
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right: Page content (search or other) */}
      <ResizablePanel defaultSize={layout[1]} minSize={30} className="p-2">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
