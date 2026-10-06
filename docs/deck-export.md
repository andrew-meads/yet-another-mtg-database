# Deck export

`GET /api/decks/[id]/export?format=txt|csv|xlsx|pdf[&byPrinting=true][&ownership=true][&images=true][&tz=<IANA zone>]`
renders the deck as a downloadable file (`Content-Disposition: attachment`; 400 bad
format, 404 not the user's deck).

## Model (pure, client-safe: `src/lib/deckExport.ts`)

The deck is loaded through **`loadDeckWithCards`** (`src/lib/server/deckLoad.ts`, the
reconciling loader shared with `GET /api/decks/[id]?details=true`) and joined via
`joinDeckEntries` (`src/lib/cardEntries.ts`), then folded by `src/lib/deckExport.ts`:

- `buildDeckExportModel(deck, options)` visits cards in **column-then-section order** and
  aggregates per section by card name (or by Scryfall id with `separateByPrinting`), each
  row keeping its first-seen position/printing and carrying `owned`/`placeholder` counts
  (ephemeral copies are placeholders). Not finish-aware.
- **Section kinds** (see [data-model.md](data-model.md#section-kinds)): each
  `DeckExportSection` carries its `kind`, and the model's sections are stably reordered
  **normal → sideboard → scratch** (`sortSectionsByKind`; deck order within a kind).
  `totalCards` is the main deck only; `sideboardCards` / `scratchCards` hold the rest.
  `deckExportSectionGroups` splits the sections into per-kind groups with their titles
  (`SECTION_GROUP_TITLES`: "Main deck" / "Sideboard" / "Scratch area (not part of the
  deck)"), `formatModelCardCount` gives the header count (`60 cards + 15 sideboard (+3 in
  scratch area)`), and `hasSpecialSections` says whether any non-normal section exists.
  Per format:
  - **TXT** — each sideboard/scratch group is introduced by a
    `// ===== Sideboard: 15 cards =====` banner before its sections.
  - **CSV / XLSX** — a **Board** column (`Main` / `Sideboard` / `Scratch`) is added after
    Section, only when the deck has a sideboard or scratch section (plain decks keep the
    original columns). XLSX scratch rows are grey italic, and the Summary sheet lists
    main / sideboard / scratch totals and tags each non-normal section's name.
  - **PDF** — each sideboard/scratch group gets a ruled heading; scratch-area text is
    drawn in grey (with and without images).
- `formatRowLine` is the canonical `3x Name (SET) 123 [2 owned, 1 placeholder]` line used
  by TXT and the PDF text lines; `formatOwnership(row, true)` gives the capitalized
  `Owned`/`Placeholder` form used where the label stands alone (the CSV/XLSX `Ownership`
  cell and the PDF image-row detail line).
- `renderDeckTxt`, `renderDeckCsv` (RFC 4180 quoting, CRLF) over the shared
  `deckExportColumns(options, withBoard)` column set — Section/Count/Name, plus Board,
  printing, and ownership columns when applicable — that the XLSX renderer also consumes.
- `deckExportFileName`, `formatExportTimestamp` (**dayjs** + utc/timezone/advancedFormat
  plugins; `"h:mm A, MMMM Do, YYYY"` → `11:32 AM, September 4th, 2026`, rendered in the
  request's `tz` zone — the hook sends the browser's `Intl` zone so a UTC server still
  prints local time; unknown zones fall back to server-local — and stamped on the model as
  `exportedAt` for the PDF header and the XLSX Summary sheet).
- The option query (de)serializers `deckExportSearchParams` / `parseDeckExportOptions`
  (`images` is only honored for PDF).

## Server renderers

- `src/lib/server/deckExport.ts` — `renderDeckXlsx` via **exceljs** (a frozen-header
  `Decklist` sheet built from `deckExportColumns`, plus a `Summary` sheet);
  `fetchDeckImages` pulls each distinct row image once through `scryfallFetch` with a 15s
  timeout and small concurrency, never throwing; `renderDeckExport` dispatches by format.
- `src/lib/server/deckExportPdf.ts` — `renderDeckPdf` via **pdf-lib**, A4, hand-rolled
  wrap/page-break layout; without images one text line per row, with images two cards per
  row, each cell a 60pt-wide Scryfall `normal` image (grey "no image" box when missing)
  with a bold `Nx Name` headline beside it plus a printing line when `byPrinting` and an
  ownership line when `ownership` (row height = tallest cell); text is sanitized to
  WinAnsi so the standard fonts never throw.
- Both libraries are listed in `next.config.ts` `serverExternalPackages`.
- `package.json` `overrides` pins exceljs's transitive `uuid` to `^11.1.1` (exceljs 4.4
  still declares `uuid@^8`, which npm audit flags; uuid 11 keeps a CommonJS build so the
  override is transparent). Keep it until exceljs updates its own dependency.

## Client

The deck page header's Download button opens **`ExportDeckDialog.tsx`** (format radio +
the three checkboxes; images disabled unless PDF) which calls **`useExportDeck`**
(`src/hooks/react-query/useExportDeck.ts`: fetches the route with the session cookie,
reads the file name from `Content-Disposition`, and triggers a browser download via an
object URL — no query invalidation).

## Tests

Unit `src/lib/__tests__/deckExport.test.ts`; integration
`tests/integration/deckExport.test.ts` (parses the XLSX back with exceljs and the PDF with
pdf-lib, MSW-mocks `cards.scryfall.io`); jsdom `ExportDeckDialog` + `useExportDeck`; e2e
`e2e/exportDeck.spec.ts` (Playwright downloads of the TXT and CSV). Section-kind output is
covered by the unit tests, a "with sideboard and scratch sections" block in the
integration test (the PDF's drawn text is checked by inflating its content streams), and
`e2e/sectionKinds.spec.ts`.
