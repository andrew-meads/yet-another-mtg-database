# Search engine (`src/lib/search/`)

Parses Scryfall-like query strings into MongoDB query objects. Entry point:
`parseSearchQuery(queryString)` (re-exported from `index.ts`). It is the **single,
canonical matcher** used by both search experiences (the Card Search page and collection
search) — there is no separate client-side filter.

## Pipeline

1. **`parser.ts`** — `tokenizeQuery` (handles quotes, parentheses, and slash-delimited
   regex values — a `/` directly after `key:` opens a regex whose spaces/quotes/parens
   stay in the token until the unescaped closing `/`) then `parseTerm` (splits
   `key:value`, comparison operators `>= <= > < =`, and `-` negation).
2. **`queryBuilder.ts`** — recursive-descent `parseExpression` builds boolean structure:
   implicit AND between terms, explicit `or`, parenthesized groups, and `$nor` for
   negation. Bare terms (no `key:`) become a name/`flavor_name` regex search.
3. **`config.ts` + `operators/`** — each operator (color, type, oracle, manavalue, set,
   rarity, produces, year/date, is, flavortext, etc.) is a `SearchOperatorConfig` with
   `aliases`, `buildQuery(value, operator)`, and optional `validate` (returning `null`
   from `buildQuery` skips the term — the unknown-value convention used by
   `exclude:`/`is:`/`year:`).

**To add a search operator:** create a file in `operators/`, export it from
`operators/index.ts`, register it in `searchOperators` in `config.ts`, and add it to
`src/components/search/searchDocs.tsx` (the aliases there mirror `config.ts`; a unit test
cross-checks them, and the AI translator's cheat-sheet is generated from them).

## Operator notes

- The **oracle**, **name**, **type**, and **flavortext** operators support Scryfall-style
  regex values: `o:/draw . cards?/`, `t:/^legendary creature/` build the raw
  (case-insensitive) `RegExp` via `parseRegexValue` in `helpers.ts`, with literal-match
  fallback for invalid/unterminated patterns; plain and quoted values stay literal
  (regex-escaped).
- **Multi-faced cards are first-class:** transform/modal-DFC/adventure/split cards keep
  text (and colors) on `card_faces[]`, so the text operators match root-OR-face via
  `withCardFaces(field, cond)` in `helpers.ts` (`o:`/`t:`/`ft:`; `name:` also matches
  `card_faces.name` and `flavor_name`), and the **color** operator compares against the
  set union of top-level `colors` and all face colors (`EFFECTIVE_COLORS_EXPR`, `$expr`
  set ops — transform cards have an EMPTY top-level `colors`, so anything less misses
  them entirely and misreports them as colorless). `id:` needs no face handling
  (`color_identity` is always top-level), and `produced_mana` is top-level even on MDFC
  lands.
- `produces:` (`$all` on `produced_mana`; `c` = literal `{C}`), `year:`/`date:` (string
  comparisons on `released_at`; bare year = whole year), `is:` (predicates over
  layout/type: dfc, mdfc, transform, split, adventure, flip, meld, vanilla, permanent,
  spell — `IS_PREDICATE_NAMES`), `ft:`/`flavortext:` (regex-capable flavor-text match).

## Advanced search & the help panel

The field-based "Advanced Search" helper is one-way:
**`src/lib/search/filtersToQueryString.ts`** maps a `SearchFilters` field model (covering
every operator) to a Scryfall query string, which is then run through `parseSearchQuery`.

Shared UI lives in `src/components/search/`:

- **`CardSearchBar`** — the Scryfall text input + debounce + an "Advanced" button + an AI
  natural-language-search sparkle button (`NlSearchButton`, on by default via the
  `showAiSearch` prop; see [user-settings-and-ai.md](user-settings-and-ai.md)) + a
  "Search help" (`?`) button + prop-gated `owned`/default-filter toggles.
- **`AdvancedSearchDialog`** — the field builder; emits a string via `filtersToQueryString`.
- **`SearchDocsPanel`** — the search-help reference, with two tabs: the operator reference
  and a regular-expression primer. Both are rendered by **`SearchDocsContent`**
  (presentational sections; takes a `sections` prop) from two data modules —
  `searchDocs.tsx` (operator reference; also feeds the AI translator's cheat-sheet) and
  `regexPrimer.tsx` (regex primer; its clickable examples are unit-test-guarded to parse
  against the engine with valid regex values —
  `src/components/search/__tests__/regexPrimer.test.ts`).

The panel is **not** a modal — it is a docked, non-modal side panel coordinated by
**`SearchDocsContext`** (`src/context/SearchDocsContext.tsx`, provided globally in
`Providers.tsx`): `CardSearchBar`'s `?` button toggles `open` and registers an "inserter"
(so example chips **append**, space-separated, to that bar's query), while
**`MainWorkspace`** renders the panel as an in-flow flex sibling so opening it **reflows**
the workspace instead of overlaying it (right-docked on desktop, stacked on mobile). It
closes only via the `?` button or its own X — never on outside-click. Both the Card Search
page (`SearchControls` composes `CardSearchBar`) and the Collection page
(`CollectionTable`) use `CardSearchBar`, so the help panel appears on both (only one bar is
mounted at a time, so a single registered inserter suffices). Opening the AI chat panel
closes this one and vice versa.

## Sorting (`src/lib/sortConfig.ts`)

Some sort fields require a MongoDB aggregation pipeline (`useAggregation` +
`buildAggregationSort`); plain fields can declare a multi-key spec via `buildSort`, and
`buildSortSpec()` is the single seam that appends the `_id` pagination tiebreaker (used by
both sort paths in `GET /api/cards`).

- The **set** sort orders by `released_at` (release date; asc = oldest set first, set code
  + name as tiebreaks).
- The **name** sort uses `released_at` ascending as its secondary key so duplicate names
  always list oldest printing first — mirrored client-side in the collection table
  (`sortGroupRows` in `grouping.ts`) and the Fill dialog's candidate order (`fillDeck.ts`).

## `GET /api/cards` and `runCardSearch`

The query core of `GET /api/cards` (parse + owned filter + sort + paginate) lives in
**`src/lib/server/cardSearch.ts`** (`runCardSearch`), shared with the AI
`searchCards`/`searchMyCards` tools. `GET /api/cards` switches between `.find().sort()`
and an aggregation pipeline, using `$lookup` against `physicalcards` (localField `id` →
foreignField `cardId`) for the `owned=true` filter. The `owned` filter optionally takes an
`ownerId` to scope the join to one user (the route passes none — its owned filter is
app-wide; the AI tool passes the session user).

**Performance invariants:**

- The owned filter's `$lookup` must stay in `localField`/`foreignField` form (it uses the
  `physicalcards.cardId` index; a `$expr` sub-pipeline ignores it and is ~15x slower).
- Owner scoping happens post-join via `$elemMatch`.
- Callers can pass `maxTimeMS` — the AI search tools cap at 15s so a pathological query
  aborts in-band instead of hanging a chat turn (the route passes none).
- Broad owned searches hung for minutes before the index existed; **keep `cardId`
  indexed**.

## Collection search is server-side too

`GET /api/collections/[id]?details=true&q=...` runs `parseSearchQuery` intersected with
the collection's `cardId`s **before** loading physical cards (the matching card ids are
resolved first via `distinct("cardId")`, so only matching copies are ever fetched); the
collection table still groups/sorts/virtualizes the returned cards client-side.
