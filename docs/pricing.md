# Card pricing & currency

Prices live **on the card document itself**, exactly as Scryfall's bulk data delivers
them — `MtgCard.prices` (typed `CardPrices` in `src/types/CardPrice.ts`: `usd`,
`usd_foil`, `usd_etched`, `eur`, `eur_foil`, `tix`, plus an optional `source`) and the
app-stamped `prices_updated_at` (`Date`; absent on cards imported before prices were kept,
which therefore count as stale — no backfill needed). `init-db` writes them on import
(see [database-seeding.md](database-seeding.md)); the on-demand refresh below keeps them
current. There is no separate price collection. USD is native; currency conversion
(USD × rate) is done client-side so the backend stays stateless about the user's currency
choice.

## Server: quotes & refresh (`src/lib/server/cardPrices.ts`)

- **`getCardPrices(ids)`** reads `{ id, prices, prices_updated_at }` for the requested ids,
  serves cards stamped younger than `PRICE_STALENESS_MS` (24h, matching Scryfall's ~daily
  cadence) as-is, and batch-refreshes stale/never-priced cards through the source chain,
  writing the results back onto the card documents with a fresh stamp (`buildPriceUpdates`
  bulk ops). Ids we hold **no card for** resolve to all-null `EMPTY_PRICES` with no
  external call; a held card nothing can price is stamped `EMPTY_PRICES` (see the outage
  rule below) so it isn't re-fetched on every request. `isFresh` accepts a `Date` or ISO
  string. Test helper: `seedCardPrices(cardId, prices, updatedAt?)`.
- **Routes** (public read data, gated only by `src/proxy.ts`):
  `POST /api/cards/prices` (body `{ ids: string[] }`, ≤ 500 →
  `{ prices: { [cardId]: CardPrices }, updatedAt: { [cardId]: ISO | null } }` — built from
  `getCardPriceQuotes`, whose `PriceQuote = { prices, updatedAt }` is the wire/typed shape;
  `400` bad input, `502` when the chain can answer nothing) and
  `POST /api/cards/prices/refresh` (body `{ ids }`, ≤ 100; re-fetches **regardless of
  freshness** via `refreshCardPriceQuotes`; only held ids are sent; same response shape via
  the shared `toPriceQuotesResponse`; `502` when the chain can answer nothing). Both read
  the requesting user's source order via `userPriceSourceOrder(userId)`
  (`src/lib/server/priceSourceOrder.ts`).

## Exchange rates (`src/lib/server/exchangeRate.ts`)

`exchangerates` (`ExchangeRateModel`) — `{ base ("USD"), target, rate, updatedAt }`, unique
on `{ base, target }`. **`getExchangeRate(target)`** short-circuits `USD` to 1, else serves
a cached rate < 24h old or fetches from Frankfurter (`EXCHANGE_RATE_API_BASE_URL`,
free/no key, plain `fetch` — different host from Scryfall) and upserts.
`GET /api/exchange-rate?target=NZD` → `{ base, target, rate, updatedAt }` (`400` on a
malformed code, `502` if the rate service is unreachable/unknown).

## Price sources

Prices can come from several sources, tried in the user's priority order.

**Registry** (pure, client-safe **`src/lib/priceSources.ts`**):
`PRICE_SOURCE_IDS = ["scryfall", "tcgplayer", "manapool"]`, `PRICE_SOURCES`
(name/description/`via` host), `PriceSourcePreference = { id, enabled }`,
`normalizeSourcePreferences` (drops unknown/duplicate ids, appends any missing source
enabled in default order — so an absent list = every source, Scryfall first, and adding a
source later never hides it), `enabledSourceOrder`, `moveSourcePreference`, and
`effectivePriceSource(prices)` / `priceSourceName` (**`prices.source` is optional and
never backfilled: absent means Scryfall**; the card schema declares `prices.source: String`). The user's list lives in the `pricing.sources`
settings section (zod: known ids only, no repeats; the settings UI
`PricingSettingsSection` renders it as an ordered list with up/down buttons and an enable
switch).

**Adapters** (`src/lib/server/priceSources/`; `types.ts`:
`SourceCard = { id, set, tcgplayer_id?, tcgplayer_etched_id? }`,
`PriceSourceAdapter.fetchPrices(cards)` returns prices ONLY for cards it could price, each
stamped with `source`, and throws on transport failure; also `EMPTY_PRICES`,
`fetchWithTimeout`, `hasAnyPrice`):

- **`scryfall.ts`** — `POST /cards/collection` batcher (max **75** identifiers/request via
  `scryfallFetch`), `extractPrices`, `chunk`.
- **`tcgplayer.ts`** — TCGCSV: set code → TCGplayer group id via Scryfall `/sets/:code`
  `tcgplayer_id` (24h in-memory cache) → `GET {TCGCSV_BASE_URL}/tcgplayer/1/{group}/prices`
  (1h cache, ≤3 groups in flight), indexed by `productId|subTypeName`;
  `pricesFromTcgcsv` maps `tcgplayer_id` Normal/Foil rows to `usd`/`usd_foil` and
  `tcgplayer_etched_id` to `usd_etched`, market → mid → low.
- **`manapool.ts`** — Mana Pool has no per-card endpoint, only the ~50 MB
  `GET {MANAPOOL_API_BASE_URL}/api/v1/prices/singles` feed keyed by `scryfall_id` with
  cents — downloaded at most once a day into an in-memory index on `globalThis`, first use
  pays the download; `pricesFromManapoolEntry`: market → lowest NM → lowest any-condition,
  per finish.
- **`index.ts`** — **`resolvePricesViaSources(cards, order)`** walks the order, asking
  each source only for the still-unpriced cards, stamps `source`, counts a card as priced
  only when the answer carries a **USD** price for some finish (`hasUsdPrice` — a
  Cardmarket-EUR-only Scryfall answer, e.g. Unlimited Black Lotus, does not stop the walk),
  logs and skips a throwing source (reported in `failures`), and throws only when a source
  failed AND nothing at all was priced.

**Outage rule:** `getCardPriceQuotes` / `refreshCardPriceQuotes` take `{ sources }`
(default `DEFAULT_SOURCE_ORDER` = all, for the AI tools); their shared `fetchAndStore`
stamps `EMPTY_PRICES` (no source) onto cards nothing could price **only when every source
answered** — if a source failed, unpriced cards keep their old prices/stamp and are
returned as-is, so an outage is never recorded as "no price".

Both adapters expose `clearTcgcsvCaches` / `clearManapoolCache` test hooks. Sources that
need keys or partner approval (TCGplayer's own API, Cardmarket, Cardtrader, JustTCG,
PriceCharting) and bulk-only MTGJSON are deliberately not wired; **adding one = registry
entry + adapter + `PRICE_SOURCE_ADAPTERS` entry.**

## Per-copy prices (finish + condition)

A physical card may carry a **`price`** record (`CopyPrice` in `src/types/CardPrice.ts`:
`{ usd | null, source?, finish, condition, conditionMatched, updatedAt }`; sub-schema on
`physicalcards`, absent = never fetched; passed through by `detailPhysicalCards`).

- **`POST /api/physical-cards/prices/refresh`** (body `{ physicalCardIds }`, ≤ 100,
  owner-scoped — foreign/unknown ids are reported in `unknown`, never priced) →
  `refreshCopyPrices(userId, ids, order)` in `src/lib/server/copyPrices.ts`: groups the
  copies by effective (finish, condition), resolves each group via **`resolveCopyPrices`**
  (`priceSources/index.ts`) and writes the record onto every copy (null `usd` = fetched but
  unpriced — only when every source answered; if a source failed, unanswered copies are
  left untouched; 502 when a source failed and nothing was priced).
- `resolveCopyPrices` asks the sources in the user's order for each group; an adapter with
  **`fetchCopyPrices(cards, finish, condition)`** answers per condition tier (only
  **Mana Pool** does: NM → NM listing or market, LP → "LP or better", MP/HP/DMG → lowest
  listing of any condition; a missing tier falls back to a finish-level price flagged
  `matched: false` — `copyPriceFromManapoolEntry`), otherwise `copyPricesFromAdapter`
  derives from `fetchPrices` (`usdForFinish`, `matched` only for NM — Scryfall/TCGplayer
  are NM market prices). Per copy the **first source in order that matched the condition
  wins**, else the first finish-level answer (`conditionMatched: false`); later sources are
  skipped once a matched answer exists, so NM copies respect the order exactly.
- **Proxies**: a copy carrying the `Proxy` tag (`PROXY_TAG` / `isProxyCopy` in
  `src/lib/cardAttributes.ts`, case-insensitive) is worth **$0 by rule** —
  `groupCollectionCards` sets `row.isProxy`, `CopyPriceTag` renders `$0` with no age dot
  or refresh (`data-price-kind="proxy"`), the valuation counts it at 0 (neither estimated
  nor unpriced), and `refreshCopyPrices` skips proxies without consulting any source
  (returned in `proxies`, no record written) — so removing the tag simply reverts the row
  to its stored/estimated price.

## Client display

Pure helpers in **`src/lib/pricing.ts`**: `usdForFinish(prices, finish)` maps a copy's
finish to `usd`/`usd_foil`/`usd_etched` (strict, no fallback — a foil with no foil price is
unpriced), `bestUsd(prices)` picks the printing's most representative price for search
results (non-foil, else foil, else etched, reporting which), `priceAge(updatedAt)` grades a
stamp into `fresh` (< 24h, green) / `aging` (< 7 days, amber) / `stale` (red) / `unknown`
(grey), `totalUsd(rows)` sums quantity × finish price and counts unpriced/estimated
copies, `formatMoney` wraps `Intl.NumberFormat`, and `SUPPORTED_CURRENCIES` is
Frankfurter's list (USD first). `src/lib/copyPricing.ts` owns `rowCopyPrice` /
`RowCopyPrice` (re-exported by `grouping.ts`), `copyPriceView` and
`describeCopyPriceView` — the single decision used by the collection row cell, the
locations list, and the selected-card panel.

**Hooks:**

- **`useCardPriceQuotes(ids, { enabled })`** (`src/hooks/react-query/useCardPriceQuotes.ts`;
  key `["card-prices", sortedDedupedIds]`, POSTs in 500-id chunks, `keepPreviousData` so
  rows don't flicker as id sets change, 5-minute `staleTime`; calling it is what triggers
  the server-side refresh of stale prices) with **`quoteForCard(card, quotes)`** falling
  back to the `prices`/`prices_updated_at` the card object itself carries (search results
  ship full cards and `SLIM_CARD_PROJECTION` includes both fields, so rows show something
  instantly).
- **`useRefreshCardPrices`** — mutation; on success it `setQueriesData`-merges the fresh
  quotes into every cached `["card-prices", …]` query so each tag showing the card updates
  in place, **then invalidates those queries** (a quote request still in flight would
  otherwise resolve with pre-refresh data and overwrite the merge); on failure it toasts.
- **`useRefreshCopyPrices`** — invalidates the details so rows re-derive.
- **`useExchangeRate(target)`** (`["exchange-rate", target]`, 1h `staleTime`, disabled for
  USD) and **`useCurrency()`** (`src/hooks/useCurrency.ts`) which combines the `pricing`
  setting (`usePricingSettings()` from `SettingsContext`, unknown codes degrade to USD)
  with the rate into `{ currency, rate, format(usd) }`, **degrading to USD** (and saying so
  via `currency`/`configured`) while a non-USD rate is loading or failed so prices are
  never hidden by a rate hiccup.

**Components** (`src/components/pricing/`):

- **`PriceAgeDot`** — the coloured indicator; `data-age-level` + accessible label with the
  exact age; `override` prop forces a level.
- **`PriceTag`** — price in the display currency + dot; `finish` prop prices a specific
  copy, `quantity` multiplies, "—" with a tooltip when unpriced; renders
  `RefreshPriceButton` when given a `cardId`; the tooltip names the source.
- **`CopyPriceTag`** — the collection row's cell: the copy price with its real age
  (`data-price-kind="copy"`), or the printing's `usdForFinish` as an **estimate with the
  age dot forced to `stale`** (`data-price-kind="estimate"`) — its refresh icon is
  `RefreshPriceButton` with `physicalCardIds`.
- **`RefreshPriceButton`** — a low-contrast `RefreshCw` icon, spins while pending, stops
  click propagation so it never selects the row.
- **`CardPricesPanel`** — the selected-card panel's Prices tab: a **"Your copies"** block
  first when the selection carries copies (reading the live records for those ids from
  `useCardLocations(card.name)` when it has them all, else the click-time snapshot, with a
  refresh for exactly those copies), then one line per quoted finish + "updated N ago" and
  the source name in the footer; fetches the card's quote on mount.

**Surfaces:** the **Card Search** table has a Price column (`CardsTable` fetches quotes
for the visible cards and passes `priceQuote` to each `CardsTableRow`; the mobile
`CardsInfiniteList` → `CardListItem` does the same); the **selected-card panel**'s Prices
tab (and its Copies tab prices each location row); the **collection table** has a toggle
(`DollarSign` button, persisted device-locally under `collection-show-prices`) that adds a
Price column (`COLLECTION_GRID_PRICED` / `collectionGrid(showPrices)` in `grouping.ts`;
each row shows its finish's unit price, the row total in the tooltip) and a header
valuation (`data-testid="collection-value"`: total of the listed rows, a dot for the oldest
stamp, forced stale while any row is estimated, and an "(N unpriced)" note) — quotes are
only fetched while it is on. `groupCollectionCards` derives **`row.copyPrice`**
(`rowCopyPrice`: present only when EVERY copy in the row has a record for the row's finish
+ condition; oldest stamp, `conditionMatched` = all matched). **`EntryDetailsEditor`**
re-fetches the row's copies after every copy's finish/condition PATCH resolves. Settings
page: `PricingSettingsSection` (currency `Select` + source order, live-saving).

## Tests

Unit `src/lib/__tests__/pricing.test.ts`, `priceSources.test.ts`,
`src/lib/server/priceSources/__tests__/` (pure mappings, `resolveCopies.test.ts`,
`adapters.test.ts` for Mana Pool tiers, resolver with fake adapters), `grouping.test.ts`
(`rowCopyPrice`); integration `cardPrices.test.ts` ("price source chain": URL-dispatching
`mockFetch`, fallback, per-card walk, user order/disable, outage-keeps-old-quote,
`updatedAt`), `copyPrices.test.ts`, `userSettings.test.ts` (pricing section); jsdom
`PriceAgeDot`/`PriceTag`/`CardPricesPanel`, `useCardPriceQuotes`, `useCurrency`,
`PricingSettingsSection`, `RefreshPriceButton`, `CollectionTable` toggle,
`CollectionTableRow` price cell, `EntryDetailsEditor`; e2e `e2e/pricing.spec.ts` (the seed
stamps every card with fresh prices; clicks the Prices tab before reading
`card-prices-panel` / `your-copies`; intercepts the refresh route with `page.route`).
