"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import CardArtView from "@/components/CardArtView";
import { CardTextView } from "@/components/CardTextView";
import { CardSelectionProvider, useCardSelection } from "@/context/CardSelectionContext";

const STORAGE_KEY = "layout/main-panels";

export default function MainWorkspace({ children }: { children?: ReactNode }) {
  const [layout, setLayout] = useState<number[] | null>(null);

  // Load persisted layout on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as number[];
        if (Array.isArray(arr)) {
          if (arr.length === 3) {
            // Migrate old 3-panel layout (left, deck, search) -> (left, searchCombined)
            setLayout([arr[0], arr[1] + arr[2]]);
            return;
          } else if (arr.length === 2) {
            setLayout(arr);
            return;
          }
        }
      }
    } catch {
      // ignore
    }
    // New default: 25% left (card details) / 75% right (search)
    setLayout([25, 75]);
  }, []);

  if (!layout) {
    // Wait for layout to load to avoid flicker
    return null;
  }

  return (
    <CardSelectionProvider>
      <div className="w-full h-[calc(100vh-120px)] min-h-[600px]">
        <InnerWorkspace layout={layout}>{children}</InnerWorkspace>
      </div>
    </CardSelectionProvider>
  );
}

function InnerWorkspace({ layout, children }: { layout: number[]; children?: ReactNode }) {
  const { selectedCard } = useCardSelection();

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
        } catch {
          // ignore
        }
      }}
      className="rounded-md border"
    >
      {/* Left: Card Details - split into image (top) and text (bottom) */}
      <ResizablePanel defaultSize={layout[0]} minSize={15} collapsible>
        {selectedCard ? (
          <ResizablePanelGroup direction="vertical">
            {/* Top: Card Image */}
            <ResizablePanel defaultSize={50} minSize={30} className="p-4 overflow-hidden">
              <div className="h-full w-full">
                <CardArtView card={selectedCard} variant="normal" flippable={true} />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Bottom: Card Text */}
            <ResizablePanel defaultSize={50} minSize={30}>
              <div className="h-full p-4 overflow-y-scroll">
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
      <ResizablePanel defaultSize={layout[1]} minSize={30} className="p-4">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
