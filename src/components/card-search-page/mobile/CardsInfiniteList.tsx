// src/components/card-search-page/mobile/CardsInfiniteList.tsx
"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MtgCard } from "@/types/MtgCard";
import CardListItem from "./CardListItem";

interface CardsInfiniteListProps {
  cardPages: MtgCard[][];
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

const SCROLL_POSITION_KEY = "cards-infinite-list-scroll";

export default function CardsInfiniteList({
  cardPages,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage
}: CardsInfiniteListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);

  // Flatten all pages into single array and remove duplicates by card id
  const allCards = cardPages?.flat(1) || [];
  const uniqueCards = Array.from(new Map(allCards.map((card) => [card.id, card])).values());

  // Initialize virtualizer
  const virtualizer = useVirtualizer({
    count: uniqueCards.length + (hasNextPage ? 1 : 0), // +1 for loading indicator
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 167.664 + 24 + 1, // Estimated height of each card row in pixels (card image + padding + text)
    overscan: 5 // Number of items to render outside viewport
  });

  // Restore scroll position when component mounts (after navigation back)
  useEffect(() => {
    // Wait for both the container to exist and cards to be loaded
    if (!scrollContainerRef.current || hasRestoredScroll.current || uniqueCards.length === 0)
      return;

    const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
    // In the scroll restoration useEffect
    if (savedPosition) {
      const position = parseInt(savedPosition, 10);

      // Validate: only restore if position is reasonable for current content
      const maxValidScroll = virtualizer.getTotalSize();
      const doScroll = position <= maxValidScroll;
      if (!doScroll) return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = position;
            hasRestoredScroll.current = true;
          }
        });
      });
    } else {
      hasRestoredScroll.current = true;
    }
  }, [uniqueCards.length]);

  // Save scroll position on scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      sessionStorage.setItem(SCROLL_POSITION_KEY, String(container.scrollTop));
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Scroll to top when cardPages resets (search params changed)
  useEffect(() => {
    if (scrollContainerRef.current && cardPages.length === 1) {
      // When we only have 1 page, it means the search was reset
      scrollContainerRef.current.scrollTop = 0;
      sessionStorage.removeItem(SCROLL_POSITION_KEY);
    }
  }, [cardPages.length]);

  // Trigger infinite scroll when scrolling near bottom
  useEffect(() => {
    const [lastItem] = [...virtualizer.getVirtualItems()].reverse();

    if (!lastItem) return;

    // If we're rendering the last item (or close to it) and there's more to load
    if (lastItem.index >= uniqueCards.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    virtualizer.getVirtualItems(),
    uniqueCards.length
  ]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="rounded-md border overflow-hidden">
      <div ref={scrollContainerRef} className="overflow-y-auto max-h-[calc(100vh-20rem)]">
        {uniqueCards.length === 0 && !isLoading && (
          <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
            No cards found
          </div>
        )}

        {/* Virtual container with total height */}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative"
          }}
        >
          {/* Render only visible items */}
          {virtualItems.map((virtualItem) => {
            const isLoaderRow = virtualItem.index >= uniqueCards.length;
            const card = uniqueCards[virtualItem.index];

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`
                }}
              >
                {isLoaderRow ? (
                  // Loading indicator at bottom
                  hasNextPage ? (
                    <div className="p-4 text-center text-muted-foreground">
                      {isFetchingNextPage ? "Loading more..." : "Scroll to load more"}
                    </div>
                  ) : (
                    // End of results indicator
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      End of results
                    </div>
                  )
                ) : (
                  <CardListItem card={card} priority={virtualItem.index < 4} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
