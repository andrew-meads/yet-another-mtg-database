# Routing & pages (`src/app/`)

App Router with route groups (folders in parentheses don't affect URL paths):

- `(with-app-bar)/` — adds the global `AppBar`. `(main)/` nested group adds the auth gate +
  `MainWorkspace` (the two-pane layout), containing `/search` and `/my-cards`.
- `(with-app-bar)/settings/` — the user **Settings page**, a sibling of `(main)` so it gets
  the app bar but **not** `MainWorkspace`'s two-pane layout. Its own `layout.tsx` mirrors
  the `(main)` auth gate (`getAuthSession()` → `/login`). Reached via the gear icon in
  `AppBar`.
- `/my-cards` is a landing page (create/list collections + decks; the lists show each
  entity's `description` and server-computed `cardCount`). Collections and decks are
  **distinct** entities with separate detail pages: `/my-cards/collections/[id]`
  (→ `CollectionTable`) and `/my-cards/decks/[id]` (→ `DeckView`). There is no single page
  that toggles between table and deck views.
- `/scan` + `/scan/results` — camera capture and recognition results (client-side, uses
  `ScanContext`). See [card-scanning.md](card-scanning.md).
- `/selected-card` — the mobile full-screen version of the selected-card panel (see
  [client-state.md](client-state.md)).
- API routes under `app/api/`: `cards` (incl. `cards/prices`, `cards/basic-lands`,
  `cards/locations`), `collections`, `decks`, `physical-cards`, `sets`, `tags`, `scan`,
  `exchange-rate`, `settings`, `ai`, `auth`.

## 404 page

`src/app/not-found.tsx` (Next's `not-found` convention, so any unmatched route gets it with
a real 404 status) shows the mascot eating a web page (`public/noughty-404.png`, an
AI-edited variant of `noughty.png`) with links to `/` and `/my-cards`. It sits at the root,
outside `(with-app-bar)`, so unmatched URLs render it without the app bar (works for
signed-out visitors too).

**Unknown entity ids** get the same page: the detail fetch hooks
(`useRetrieveCollectionDetails` / `useRetrieveDeckDetails`) throw **`ApiError`**
(`src/lib/apiError.ts`, carries the HTTP status) and use `retryUnlessNotFound` so a 404
isn't retried, and the collection/deck detail pages call Next's `notFound()` when
`isNotFoundError(error)` — the not-found UI then renders inside the `(with-app-bar)` layout
(app bar kept, `MainWorkspace` dropped) with a 200 status, since the shell was already
served and the check is client-side. The `GET /api/collections/[id]` and
`GET /api/decks/[id]` routes guard with `Types.ObjectId.isValid` so a malformed id is a 404
rather than a Mongoose CastError 500.

Tests: jsdom `src/app/__tests__/not-found.test.tsx` + the two hooks' 404 cases;
integration malformed-id cases in `collections.test.ts` / `decks.test.ts`; e2e
`e2e/notFound.spec.ts` (unmatched URL + both nested entity URLs).

## Mascot easter egg

Searching for the mascot by its full name, `noughty the dreadnought` (case-insensitive;
plain, quoted, or `name:`-prefixed — see the accepted forms in `src/lib/easterEggs.ts`,
`isNoughtyQuery`), never matches a card, so the **empty result** of the Card Search page
(`CardsTable` / mobile `CardsInfiniteList`, both taking a `query` prop from the page's
`searchParams.q`) and of a collection search (`CollectionTable`, on its `activeQuery`)
renders `src/components/NoughtyEasterEgg.tsx` — the full `public/noughty.png` — instead of
"No cards found". The matcher is pure and only ever swaps an *empty* result; the server
still decides what matches.

Tests: unit `src/lib/__tests__/easterEggs.test.ts`; jsdom `CardsTable`,
`CardsInfiniteList`, and `CollectionTable` empty-state cases.

## Site icons

Next's file-convention metadata: `src/app/favicon.ico` (16/32/48 PNG-encoded entries),
`icon.png` (256px) and `apple-icon.png` (180px) are picked up automatically and emitted as
`<link rel="icon">` / `apple-touch-icon` tags — nothing is declared in `layout.tsx`'s
`metadata`. All three are a face crop of the mascot `public/noughty.png` (the full image is
unreadable at favicon sizes); regenerate them with `sharp` (crop
`{ left: 320, top: 220, width: 520, height: 520 }`, lanczos resize) if the mascot changes.
