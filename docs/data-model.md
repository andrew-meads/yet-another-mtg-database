# Data model: cards, physical copies, collections & decks

This is the core domain model. Read it before touching collections, decks, or
drag-and-drop.

## Data layer (`src/db/`, `src/types/`)

- **`src/db/mongoose.ts`** — `connectDB()` caches the connection on `global.mongoose` to
  survive Next.js hot-reload. **Every API route must `await connectDB()` before touching a
  model.**
- **`src/db/schema.ts`** — all Mongoose schemas/models, guarded with the
  `mongoose.models.X || mongoose.model(...)` pattern (required so re-imports during
  hot-reload don't throw). **Consequence: a running dev server keeps the first-registered
  schema for the life of the process** — after editing any schema (adding a field, a
  sub-schema, an enum) restart `next dev`, or writes silently drop the new field under
  `strict: true` while the reloaded route/zod code accepts it (symptom: the API returns 200
  but the response/document lacks the field). Models: `CardData`, `PhysicalCardModel`,
  `CollectionModel`, `DeckModel`, `UserModel`, `TagModel`, `SetSvgModel`,
  `CardRulingModel`, `RulesCacheModel`, `ExchangeRateModel`, `UserSettingsModel`.
- Plain TS interfaces in `src/types/` are the source of truth for document shapes; schemas
  are typed against them. The `MtgCard` shape mirrors Scryfall's card JSON.

## Entities

### `CardData` (`src/types/MtgCard.ts`)

Scryfall reference card data. The model is named `CardData` to disambiguate from physical
copies, but is **pinned to the Mongo collection `cards`** (`{ collection: "cards" }` in the
schema) so the bulk import and `$lookup`s stay stable. Cards are referenced everywhere by
Scryfall string `id`, **not** Mongo `_id`. Cards also carry `prices` /
`prices_updated_at` (see [pricing.md](pricing.md)) and `released_at`
(see [database-seeding.md](database-seeding.md)).

### `PhysicalCard` (`src/types/PhysicalCard.ts`)

One document per physical card copy:
`{ owner, cardId, collectionId? (nullable), deckId? (optional), notes?, tags?, finish?, condition?, price? }`.

**Invariant: every physical card belongs to at most one collection and is assigned to at
most one deck.** The `collectionId`/`deckId` back-refs are the **source of truth for
membership** and power the cross-membership badges.

#### Finish & condition

Per-copy physical attributes, defined once in the pure, client-safe
**`src/lib/cardAttributes.ts`**: `finish` ∈ `nonfoil | foil | etched` (mirrors Scryfall's
`finishes` vocabulary, which its price fields key on: `usd` / `usd_foil` / `usd_etched`)
and `condition` ∈ `NM | LP | MP | HP | DMG` (the TCGplayer five-grade scale).

**Both are optional on the document and an absent value IS the default
(`nonfoil` / `NM`)** — there is deliberately no schema default and no backfill;
pre-existing copies are simply plain Near Mint. Always read them through
`effectiveFinish` / `effectiveCondition`, group/compare with `attributesKey` /
`attributesMatch`, and persist through `sparseAttributes` (which drops default values so
plain copies store nothing extra).

- `POST /api/physical-cards` and `PATCH /api/physical-cards/[id]` accept both fields (400
  on an unknown value via `isCardFinish` / `isCardCondition`); `remove-group` matches them
  by effective value.
- The collection table groups rows by `cardId + notes + tags + finish + condition + deckId`
  (`grouping.ts`; sort order within a printing is non-foil → foil → etched, then best
  condition first), `CardLocationsView` groups the same way and shows the badges on each
  row, and `detailPhysicalCards` passes the stored values through on every detail response.
- UI: **`CardAttributePickers`** (the two `Select`s; used by the search page's "applied on
  add" bar via `SearchAddMetaContext` — whose `createFields` is the sparse `NewCopyMeta`
  every search-page add path spreads into its create call — and by the collection row's
  expanded **`EntryDetailsEditor`**, which applies a change to every copy in the group) and
  **`CardAttributeBadges`** (renders only NON-default values — "Foil"/"Etched" and the
  condition code — inline in collection rows and the locations table, and as an overlay on
  deck-view card images).
- Not yet finish-aware: deck archive placeholders (an archived foil becomes a plain
  placeholder), Fill matching, deck export, the AI tools, and the scan-results add flow.
- A copy carrying the `Proxy` tag (`PROXY_TAG` / `isProxyCopy`, case-insensitive) is worth
  $0 by rule — see [pricing.md](pricing.md).

Tests: unit `src/lib/__tests__/cardAttributes.test.ts` + `grouping.test.ts`; integration
`physicalCards.test.ts` (create/patch/validation/remove-group matching) +
`serverHelpers.test.ts`; jsdom `CardAttributeBadges`, `EntryDetailsEditor`,
`SearchAddMetaContext`/`SearchAddMetaInput`, `CollectionTableRow`, `DeckColumn`,
`CardLocationsView`; e2e `e2e/cardAttributes.spec.ts`.

#### Ephemeral cards

A physical card with `collectionId === null` is **ephemeral**: it lives only inside its
deck (no collection). Created via `POST /api/physical-cards` with `collectionId` omitted
(then `deckId` is **required**). They are **deleted from existence** when they leave their
deck: the deck `cards` `op:"remove"` deletes an ephemeral card instead of clearing `deckId`,
and `DELETE /api/decks/[id]` deletes its ephemeral cards (collection-backed cards just lose
their deck).

In the deck view they carry a corner `Sparkles` badge (`DeckColumn.tsx`) and may only be
**reordered within their own deck** — dropping them on a collection or a different deck is
a no-op (guarded in `useDropDispatch` + the drop targets' `canDrop`; ephemeral state flows
via `PhysicalCardDragItem.isEphemeral`).

The create-any-card-as-ephemeral primitive is generic; its consumers are the per-section
**"Add land"** control (`AddBasicLandButton.tsx`, adds Unhinged basic lands resolved by
`getBasicLands()` in `src/lib/server/basicLands.ts` and served from
`GET /api/cards/basic-lands`), the search page's **shift+d** / "Add to active deck
(ephemeral)" quick-add, deck archiving (below), and the AI proposal card's "Placeholder"
action.

### `Collection` (`src/types/Collection.ts`)

`{ owner, name, description, isActive? }`. No stored card order: membership is purely
`PhysicalCard.collectionId`, and the collection table groups + sorts deterministically
client-side.

### `Deck` (`src/types/Deck.ts`)

`{ owner, name, description, isActive?, sections: [{ name, columns: [{ cards: ObjectId[] }] }] }`.
A deck is an *arrangement* layered over physical cards that still live in their
collections: named sections, each with any number of unnamed columns, each an ordered list
of `PhysicalCard` ids. Sections/columns get auto `_id`s used by the UI/API.

Card totals are derived client-side from the loaded `DeckWithCards` by
`src/lib/deckUtils.ts` (`countSectionCards` / `countDeckCards` / `formatCardCount`) and
shown next to the deck name (deck detail page) and each section name (`DeckSection.tsx`) —
nothing is stored. The summary-list routes additionally return each entity's `description`
and a server-computed `cardCount` from the `PhysicalCard` back-refs: `GET /api/decks`
counts by `deckId` (typed `DeckListSummary`) and `GET /api/collections/summaries` counts by
`collectionId` (typed `CollectionListSummary`); both are shown on the My Cards landing
page's lists.

### Active collection / active deck

Both collections and decks carry an optional `isActive` flag, each with its own
single-active invariant enforced server-side by `PATCH /api/collections/[id]/isActive` and
`PATCH /api/decks/[id]/isActive` (activating one deactivates the user's others *of the
same kind* only). The two slots are independent: a collection and a deck can be active
simultaneously. Only the collection is auto-provisioned (`ensureMainCollection` on first
sign-in); having no active deck is normal. Both are set from the app-bar entity context
menu / mobile star (`OpenCollectionButtons.tsx` → `setActiveEntity`) and read from
`OpenEntitiesContext` as `activeCollection` / `activeDeck`.

## Write ordering & reconciliation

**No multi-doc transactions** (dev Mongo is a single mongod). Mutations write the
`PhysicalCard` back-ref **first**, then fix up the deck's ordered arrays.
`GET /api/decks/[id]?details=true` **reconciles** by appending any card whose `deckId`
points at the deck but is missing from the arrays into a default column — so a
mid-failure is always recoverable. Shared helpers: `src/lib/server/cardDetails.ts`
(`detailPhysicalCards`, `upsertTags`), `src/lib/server/deckArrange.ts`
(`findOrCreateColumn`, `pullCardFromAllDecks`), and `src/lib/server/deckLoad.ts`
(`loadDeckWithCards`, the reconciling loader shared by the details route and deck export).

## Archive & fill

- `POST /api/decks/[id]/archive` dismantles a deck while keeping the decklist: every
  collection-backed card gets `deckId` cleared (it stays in its collection) and is replaced
  **in place** in the `sections[].columns[].cards` arrays by a newly created ephemeral card
  of the same `cardId` (notes/tags are *not* copied).
- `POST /api/decks/[id]/fill` is the inverse: body `{ swaps: [{ ephemeralId, physicalCardId }] }`
  replaces each ephemeral in place with an owned collection-backed card (pulled from any
  prior deck), deleting the ephemeral; the whole body is validated before anything is
  written (400 `{ error, invalid }` with no partial application).
- Both follow the back-refs-first write order so `GET ?details=true` reconciliation
  self-heals a mid-failure.
- Client side: the deck page header has Archive (confirm + `useArchiveDeck`) and Fill
  buttons — Fill opens `FillDeckDialog.tsx`, which shows each candidate copy with a small
  flippable `CardArtView` thumbnail (the thumbnail `preventDefault`s its click so flipping
  doesn't toggle the row's checkbox) and matches the deck's ephemerals against the
  **active collection's** unassigned copies via the pure helper `src/lib/fillDeck.ts`
  (`buildFillGroups` groups by `oracle_id` with name fallback, same-printing candidates
  first, oldest printing first within a name; `assignSwaps` pairs selections to slots) and
  posts via `useFillDeck`.

Deck export is documented separately in [deck-export.md](deck-export.md).

## Detail responses are deduplicated + slim

The three detail endpoints (`GET /api/collections/[id]?details=true`,
`GET /api/decks/[id]?details=true`, `GET /api/cards/locations`) do **not** embed a card
object per physical copy. `detailPhysicalCards` returns `{ entries, cardData }`: entries
carry a `cardId` (typed `DetailedPhysicalCardEntry`), and each route adds a top-level
**`cardData`** map (`Record<scryfallId, SlimMtgCard>`) shipped **once** per response.

Card data is projected to `SLIM_CARD_PROJECTION` (`src/lib/server/cardDetails.ts`) — only
the fields the client renders, with `image_uris` limited to `small`/`normal`/`large`, plus
`prices` / `prices_updated_at`. The projection mirrors **`SlimMtgCard`** in
`src/types/MtgCard.ts`; **when a component starts reading a new card field, extend both.**

The client fetch hooks (`useRetrieveCollectionDetails`, `useRetrieveDeckDetails`,
`useCardLocations`) re-join entries with the map via `joinCardEntries`
(`src/lib/cardEntries.ts`) into the `DetailedPhysicalCard` shape (duplicate copies share
one card object reference), so components/grouping/dnd never see the wire shape.
`SlimMtgCard` includes the selected-card panel's text/image needs, so
`setSelectedCard(row.card)` works with no hydration fetch (a full `MtgCard` — e.g. from the
search page — remains assignable to `SlimMtgCard`). For a ~9k-card collection this cut the
details payload from ~16 MB to ~5 MB raw.

## API surface

- `/api/collections` — CRUD + `summaries` + `[id]/isActive`; `GET [id]?details=true`
  accepts an optional `q` Scryfall search param scoped to that collection (see
  [search-engine.md](search-engine.md)).
- `/api/decks` — CRUD + `[id]/isActive` + `/sections`, `/columns`, `/cards` placement ops
  `place|move|remove`, `/archive`, `/fill`, `/export`.
- `/api/physical-cards` — POST create-N (`collectionId` optional, omit for ephemeral) /
  PATCH notes·tags·collection·finish·condition / DELETE / `remove-group` decrement /
  `prices/refresh`.
- `/api/cards/basic-lands` — the five Unhinged basic lands for the deck-view land picker.
- `/api/cards/locations` — every copy of a card name across the user's collections/decks.

The old `/api/collections/[id]/cards` action API is gone.

## "Quantity" is display-only

The collection table groups copies by `cardId + notes + tags + finish + condition + deckId`
(see `src/components/my-cards-page/collection-view/grouping.ts`) into one row with a count
and a single deck badge (loose copies sort before deck-assigned ones). There is no
`quantity` field on any document. A toggle button beside the collection search bar hides
deck-assigned rows (client-side `excludeDeckRows` in `grouping.ts`, applied on top of the
server-filtered cards; not persisted).

Collection rows also have a **right-click context menu + keyboard shortcuts** mirroring the
search page but acting on **existing copies, one per invocation** (never creating any):
`+`/`=` moves one copy to the active collection, `d` places one loose copy into the active
deck, and the menu adds submenus over the open entities plus "Remove copy from deck", "Add
another copy", and a destructive "Delete a copy". Shared action logic (with error toasts
for every disallowed case — deck-assigned rows can't be deck-placed, same-collection moves
refuse) lives in `src/hooks/useCollectionRowActions.ts`; menu items for disallowed deck
actions render disabled with a hint instead of toasting.
