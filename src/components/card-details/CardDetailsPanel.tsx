"use client";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CardArtView from "@/components/CardArtView";
import { CardTextView } from "@/components/CardTextView";
import CardLocationsView from "@/components/CardLocationsView";
import CardPricesPanel from "@/components/pricing/CardPricesPanel";
import { useCardLocations } from "@/hooks/react-query/useCardLocations";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { cn } from "@/lib/utils";
import { SlimMtgCard } from "@/types/MtgCard";

/** localStorage key (via react-resizable-panels' `autoSaveId`) for the image/details split. */
export const CARD_PANEL_LAYOUT_KEY = "layout/card-panel";
/** localStorage key remembering which details tab was last open. */
export const CARD_PANEL_TAB_KEY = "layout/card-panel-tab";

export type CardDetailsTab = "text" | "copies" | "prices";
const TABS: readonly CardDetailsTab[] = ["text", "copies", "prices"];
const isTab = (v: unknown): v is CardDetailsTab => TABS.includes(v as CardDetailsTab);

interface CardDetailsPanelProps {
  card: SlimMtgCard;
  /**
   * `split` — the desktop side column: a resizable vertical split with the image on
   * top and the tabbed details filling the rest (the ratio is remembered).
   * `stack` — the mobile page: image at natural size, then the tabs beneath.
   */
  layout: "split" | "stack";
  className?: string;
}

/**
 * The selected card, presented as its image plus one tabbed details pane:
 * **Text** (rules text, the default), **Copies** (where the user's copies live,
 * with their prices) and **Prices** (the printing's per-finish prices and the
 * selected copies' price). Tabs give each block the pane's full height instead
 * of squeezing three panes into a ~340px-wide column, and the last-used tab is
 * remembered per device. Shared by the desktop workspace and the mobile
 * `/selected-card` page so the two never drift apart.
 */
export default function CardDetailsPanel({ card, layout, className }: CardDetailsPanelProps) {
  if (layout === "stack") {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <div className="mx-auto aspect-5/7 w-full max-w-md">
          <CardArtView
            card={card}
            variant="large"
            flippable={true}
            draggable={false}
            width="100%"
            height="100%"
          />
        </div>
        <CardDetailsTabs card={card} fill={false} />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      direction="vertical"
      autoSaveId={CARD_PANEL_LAYOUT_KEY}
      className={className}
    >
      {/* Top: card image — collapsible so the details can take the whole column. */}
      <ResizablePanel
        defaultSize={50}
        minSize={20}
        collapsible
        className="overflow-hidden p-3"
        data-testid="card-image-pane"
      >
        <div className="size-full">
          <CardArtView
            card={card}
            variant="large"
            flippable={true}
            draggable={true}
            width="100%"
            height="100%"
            priority
          />
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Bottom: the tabbed details, filling whatever height is left. */}
      <ResizablePanel defaultSize={50} minSize={25}>
        <CardDetailsTabs card={card} fill className="h-full" />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * The Text / Copies / Prices tabs. `fill` makes each tab body its own scroller
 * inside a fixed-height host (the desktop pane); without it the content flows
 * at natural height (the mobile page's single scroller).
 */
export function CardDetailsTabs({
  card,
  fill,
  className
}: {
  card: SlimMtgCard;
  fill: boolean;
  className?: string;
}) {
  const [storedTab, setStoredTab] = useLocalStorage<CardDetailsTab>(CARD_PANEL_TAB_KEY, "text");
  const tab = isTab(storedTab) ? storedTab : "text";
  // Same query key as the Copies tab's own fetch, so the badge costs no extra request.
  const { data: locations, isLoading: locationsLoading } = useCardLocations(card.name);
  const copyCount = (locations?.locations ?? []).reduce((sum, l) => sum + l.cards.length, 0);

  const content = cn("min-h-0 px-3 pb-3", fill && "overflow-y-auto");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        if (isTab(v)) setStoredTab(v);
      }}
      className={cn("flex flex-col gap-2", fill && "min-h-0", className)}
      data-testid="card-details-tabs"
    >
      <TabsList className="mx-3 mt-3 w-[calc(100%-1.5rem)] shrink-0">
        <TabsTrigger value="text">Text</TabsTrigger>
        <TabsTrigger value="copies">
          Copies
          {/* While the copies are being fetched (e.g. right after switching cards) keep a
              same-sized pulsing pill in the badge's place, so the tab label doesn't
              jump as the count vanishes and reappears. */}
          {locationsLoading && (
            <span
              className="bg-muted-foreground/25 inline-block h-4 w-5 animate-pulse rounded-full"
              data-testid="copies-tab-count-pending"
              aria-hidden="true"
            />
          )}
          {!locationsLoading && copyCount > 0 && (
            <span
              className="bg-primary/15 text-foreground rounded-full px-1.5 text-[11px] leading-4 font-semibold tabular-nums"
              data-testid="copies-tab-count"
            >
              {copyCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="prices">Prices</TabsTrigger>
      </TabsList>
      <TabsContent value="text" className={content}>
        <CardTextView card={card} />
      </TabsContent>
      <TabsContent value="copies" className={content}>
        <CardLocationsView cardName={card.name} />
      </TabsContent>
      <TabsContent value="prices" className={content}>
        <CardPricesPanel card={card} />
      </TabsContent>
    </Tabs>
  );
}
