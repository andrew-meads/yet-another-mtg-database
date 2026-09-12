# Client state, data fetching & UI

## TanStack Query

All server state goes through TanStack Query. Hooks live in `src/hooks/react-query/`
(e.g. `useInfiniteCardsSearch`, `useRetrieveCollectionDetails`, `useRetrieveDeckDetails`,
`useCreatePhysicalCard`, `useDeckCardOp`). Query keys: `["collection-summaries"]`,
`["collection-details", id]`, `["deck-summaries"]`, `["deck-details", id]`,
`["card-locations", name]`, `["tags"]`, `["user-settings"]`, `["ai-status"]`,
`["card-prices", ids]`, `["exchange-rate", target]`.

Cross-kind moves (deck placement ↔ collection membership) change a badge on the "other"
side, so the physical-card/deck mutations broadly invalidate both `["collection-details"]`
and `["deck-details"]` plus `["card-locations"]` (see `src/hooks/react-query/invalidate.ts`).
Provider in `src/context/QueryProvider.tsx`; all providers composed in
`src/context/Providers.tsx`.

## React Context (cross-component UI state)

- **`CardSelectionContext`** — the selected printing **plus, optionally, the physical
  copies it was clicked as** — `selectedCopies: { cardId, physicalCardIds, finish, condition, isProxy, copyPrice?, locationName? }`,
  set via `setSelectedCard(card, copies?)`; omitting `copies` (as the search page does)
  clears it, and a `cardId` mismatch is dropped; both persist in localStorage. Collection
  rows (`copiesFromRow`), deck cards (`copiesFromPhysical`, both in
  `src/lib/selectedCopies.ts`) and card-locations rows pass their copies.
- **`OpenEntitiesContext`** — holds the user's open collections **and** decks as a
  `kind`-discriminated `OpenEntitySummary[]`, its `{ id, kind, pinned? }` refs server-synced
  via `useServerSetting("openEntities", …)` with a one-time migration from the legacy
  `"open-entity-ids"` localStorage key and a union-merge reconcile for entities opened
  while the settings query was in flight; exposes `activeCollection`/`activeDeck` +
  `setActiveCollection`/`setActiveDeck`/`setActiveEntity`, and treats either active entity
  as always-pinned. Closing a collection (`removeOpenEntity`) deletes its persisted search
  string.
- **`ScanContext`** — scan results between `/scan` and `/scan/results`.
- **`SettingsContext`** — server-synced user preferences (see
  [user-settings-and-ai.md](user-settings-and-ai.md)); `useCardPreviewSettings()` holds the
  card-preview preferences with safe defaults + delay clamping, persisted via
  `useServerSetting` with a one-time migration from the legacy `"settings/card-preview"`
  localStorage key. Currently controls the hover
  card preview (`CardPopup`): `enabled`, `size` (`small`/`normal`/`large`), and `delayMs`
  (500–2000, 100ms steps). `CardsTable` and `CollectionTable` read it to gate the popup,
  set the hover delay, and pass the size; `CardPopup` is **size-aware** (size → container
  height + Scryfall image variant). Edited live on the `/settings` page (saves immediately,
  no save button).
- **`SearchDocsContext`** — open-state + example-inserter bridge for the docked search-help
  panel (see [search-engine.md](search-engine.md)).
- **`AiChatContext`** — open-state + viewed-entity context for the docked AI chat panel;
  only one docked panel open at a time (see [user-settings-and-ai.md](user-settings-and-ai.md)).

## Device-local state (localStorage via `useLocalStorage`)

Deliberately **not** server-synced: panel layout, per-page search strings, the selected
card, the collection price toggle, and the selected-card panel's tab.

- **Search-string persistence**: the Card Search page persists its full
  `SearchControlsValues` under `"search-panel-params"`, and each collection's search string
  is persisted separately under `collection-search-<id>` (`collectionSearchStorageKey` in
  `src/lib/collectionUtils.tsx`). The collection detail page (`collections/[id]/page.tsx`)
  holds the keyed body in a `key={id}` child so the hook re-reads the right key per
  collection.
- **Collection price toggle**: `useLocalStorage("collection-show-prices")`.
- **Panel layout**: `react-resizable-panels` `autoSaveId`s `layout/main-panels` and
  `layout/card-panel`; the selected-card tab under `layout/card-panel-tab`.

## Selected-card panel

One shared component, **`src/components/card-details/CardDetailsPanel.tsx`**, renders the
selected card on both desktop (`DesktopMainWorkspace`'s left column, `layout="split"`) and
the mobile `/selected-card` page (`layout="stack"`): the `CardArtView` image plus
**`CardDetailsTabs`** — **Text** (`CardTextView`, the default), **Copies**
(`CardLocationsView`, with the owned-copy count as a badge on the tab, read from the same
`useCardLocations` query so it costs nothing extra) and **Prices** (`CardPricesPanel`, see
[pricing.md](pricing.md)).

Tabs replaced the former three-way vertical split (image / locations / text), which at the
~340px column width the resizable layout encourages left the locations table scrolling
sideways and the rules text below the fold; each tab now gets the whole lower pane. Radix
unmounts inactive tab content, so the Copies and Prices tabs fetch only when shown. The
split layout is a vertical `ResizablePanelGroup` persisted by react-resizable-panels
itself via `autoSaveId` (**`layout/card-panel`**; image pane `collapsible`, min 20%, tabs
min 25%), and the last tab is remembered under **`layout/card-panel-tab`**
(`useLocalStorage`; unknown values fall back to Text).

**`CardLocationsView`** is a narrow-column **list**, not a table: one row per (collection,
printing, finish, condition, notes, tags) group (`data-testid="card-location-row"`,
`data-location-type`), deck rows nested (indented) under their collection row; line one is
the location name, `N (M free)` count and an explicit **open** icon button
(`aria-label="Open collection|deck <name>"`), line two (collection rows only) the set icon
+ code, `CardAttributeBadges`, tag chips and notes with **no "—" placeholders**, and the
copies' price (`data-testid="card-location-price"`, `data-price-kind` copy/estimate/proxy
via `copySetFromCopies` + `copyPriceView`, quotes from one `useCardPriceQuotes` over the
listed printings, with a `RefreshPriceButton physicalCardIds` for that row). Clicking a
row selects the card with those copies.

**Hydration:** the selection and the remembered tab come from localStorage, which the
server can't see, so `/selected-card` (a client page that is SSR'd) renders a blank frame
until **`useMounted()`** (`src/hooks/useMounted.ts`, a `useSyncExternalStore` with a
`false` server snapshot — no effect, no state, no lint suppression) reports true; without
that guard React logged a hydration mismatch on every visit with a card selected. Desktop
needs nothing extra because `MainWorkspace` already renders nothing until
`useIsDesktop().mounted`. **Use `useMounted` for any other SSR'd client UI whose first
frame depends on `useLocalStorage`.**

**Loading placeholders:** the Copies tab's count badge is replaced by a same-sized pulsing
pill (`data-testid="copies-tab-count-pending"`) while `useCardLocations` is loading, so the
label never jumps; and every card image rendered through **`CardArtView`** /
`SimpleCardArtView` (the selected-card panel, deck-view stacks, drag previews, hover popup,
Fill dialog) goes through the internal `CardImage`, which keys the `next/image` by its URI
(so a newly selected card never keeps showing the previous card's bitmap) and shows the
pulsing **`CardImagePlaceholder`** (`data-testid="card-image-placeholder"`) beneath a
transparent image until `onLoad` fires — an SVG drawn in the variant's natural aspect ratio
with `preserveAspectRatio="xMidYMid meet"`, so it letterboxes exactly like the image's
`object-contain` and is always the card-shaped area the image will occupy (`data-loaded`
on the `card-image` wrapper; loaded/failed state is tracked per URI so a card change resets
it without an effect; `onError` falls back to the "No image available" box,
`data-testid="card-image-unavailable"`).

Tests: jsdom `src/components/__tests__/CardArtView.test.tsx`,
`src/components/card-details/__tests__/CardDetailsPanel.test.tsx`,
`src/components/__tests__/CardLocationsView.test.tsx`,
`src/app/selected-card/__tests__/page.test.tsx` (server render via `renderToString` vs
client render), `src/hooks/__tests__/useMounted.test.tsx`; e2e
`e2e/cardDetailsPanel.spec.ts` (Text tab first, nested deck row, no horizontal overflow,
tab persistence, open button).

## Search-page keyboard shortcuts & context menu

In `CardsTable.tsx` (desktop only — gated on the table container having focus): arrow
up/down move the selection, `+`/`=` adds the selected card to the **active collection**
(`handleAddToCollection`), and `d` adds it to the **active deck** via
`useAddCardToActiveDeck` (`src/hooks/useAddCardToActiveDeck.ts`), which mirrors the
search→deck drag — creates the copy in the active collection, places it into the deck's
first section/column, and toasts if either active entity is missing. `shift+d` calls the
same hook with `{ ephemeral: true }`, creating the copy as an **ephemeral** (no
`collectionId` sent, no active collection required). `CardsTableRow` surfaces all three as
context-menu items (plus "Add to collection"/"Add to deck" submenus over the open
entities). The collection table's equivalents are described in
[data-model.md](data-model.md#quantity-is-display-only).

## Drag-and-drop (react-dnd, HTML5 backend)

Sources/targets in `src/hooks/drag-drop/`. Two drag item types: `NEW_CARD` (from search)
and `PHYSICAL_CARD` (one or more existing copies). All drop targets delegate to a single
dispatcher, **`useDropDispatch`**, which implements the six drag scenarios:
search→collection (create), search→deck (create in active collection, then place — errors
via toast if no active collection), collection↔collection (change `collectionId`),
collection/deck→deck (place, clearing any prior deck), deck→collection (clear `deckId`,
optionally change collection). Ephemeral cards may only be reordered within their own deck
(`PhysicalCardDragItem.isEphemeral`). The collection table shows each card's deck badge;
the deck view shows each card's collection badge. The collection table is **virtualized**
with `@tanstack/react-virtual` (no pagination, no manual row reorder).

## UI toolkit

**shadcn/ui** (Radix primitives) in `src/components/ui/` + **Tailwind CSS v4** (config in
`globals.css` / `postcss.config.mjs`, no `tailwind.config`). `mana-font` renders mana
symbols. `sonner` toasts report every disallowed user action.
