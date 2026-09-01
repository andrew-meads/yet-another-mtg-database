# AI Assistant Roadmap

This document parks the remaining phases of the AI-agent plan so a future agent (or
human) can continue it without the original planning conversation. **Read CLAUDE.md
first** — it documents the codebase architecture and the already-shipped AI
foundations this roadmap builds on. Phases 0 and 1 are **done and shipped**; work
continues from Phase 2.

## Where things stand (Phases 0–1, shipped)

**Phase 0 — server-synced user settings + AI provider plumbing**

- Per-user settings live in the `usersettings` collection (`UserSettingsModel` in
  `src/db/schema.ts`), sections `cardPreview`, `openEntities`, `ai`
  (`{ baseUrl?, model?, apiKeySealed?, apiKeyHint? }`). Routes: `GET/PATCH
  /api/settings`, `PUT /api/settings/ai` (key: omitted = keep, `""` = clear, else
  replace), `GET /api/ai/status`, `POST /api/ai/status/test`. zod schemas +
  persistence helpers in `src/lib/server/userSettings.ts`; the key is sealed at rest
  by `src/lib/server/secretBox.ts` (AES-256-GCM under `SETTINGS_ENCRYPTION_KEY`,
  `plain.`-prefixed otherwise).
- `src/lib/ai/provider.ts` — `getAiModel(userId)` builds a per-request
  `createOpenAICompatible({ baseURL, apiKey })` model (Vercel AI SDK: `ai` +
  `@ai-sdk/openai-compatible`); throws `AiNotConfiguredError`, mapped to
  **`409 { error: "ai_not_configured" }`**. Client-side, every AI entry point gates
  on `useAiStatus` and renders `src/components/ai/AiNotConfigured.tsx` when
  unconfigured. Settings UI: `src/components/settings/AiSettingsSection.tsx`.
- Client sync seam: `useServerSetting(section, initial, { legacyStorageKey?,
  reconcile? })` in `src/hooks/useServerSetting.ts` (hydrate once from
  `["user-settings"]`, debounced PATCH, one-time localStorage migration).

**Phase 1 — natural-language card search**

- `POST /api/ai/translate-search`: one tool-less `generateText` call → `{ query,
  notes? }`; the client (`src/components/ai/NlSearchButton.tsx` in `CardSearchBar`)
  inserts the editable query into the search bar. Persona + prompt:
  `src/lib/ai/agents/searchTranslator.ts` (strict-JSON output contract, parsed
  leniently by `parseTranslateSearchResult`) + `src/lib/ai/prompts/searchSyntax.ts`
  (cheat-sheet generated from `SEARCH_DOC_SECTIONS`).

**Lessons already learned (apply to all later phases)**

- **Reasoning models eat output tokens**: a starved `maxOutputTokens` yields an
  empty reply with `finishReason: "length"`. Use generous ceilings and surface
  `finishReason` in errors.
- **Error diagnostics matter**: AI-route 502s include `detail`, `finishReason`, and
  a trimmed `raw` model reply, and log the full reply server-side (see
  `translate-search/route.ts` + `buildErrorMessage` in
  `src/hooks/react-query/useTranslateSearch.ts`). Follow this pattern for new AI
  routes.
- **`maxRetries`**: keep low (0–1) for interactive calls; the SDK default retries
  5xx with backoff and feels like a hang.
- **Prompt quality**: syntax alone is not enough — the translator needed MTG
  oracle-text conventions (o: is a literal substring match; symbols are
  `{T}`/`{G}`-style) plus few-shot examples (`SEARCH_TRANSLATOR_EXAMPLES`, each
  unit-test-guarded to parse against the real operator registry). Extend the
  examples list rather than ad-hoc prompt text; expect deck-advisor prompts to need
  equivalent domain grounding.
- **Testing pattern**: integration tests impersonate the OpenAI-compatible endpoint
  with a per-file MSW node server (`tests/integration/aiTranslateSearch.test.ts` is
  the template — canned `chat.completion` JSON, auth-header/model assertions).
  Component tests mock `next-auth/react` + wrap `QueryClientProvider` and register
  MSW handlers on the shared server (`tests/msw/server.ts`).

## Standing architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent runtime | Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`; add `@ai-sdk/react` in Phase 2) — **not LangGraph** | Every feature is a single-agent tool loop; per-request provider construction from user settings; `streamText`/`useChat` provide streaming + tool-call wire format. |
| "One agent per feature" | Persona configs: `{ id, system prompt, tool subset, params }` in a registry (`src/lib/ai/agents/`) | Per-feature tuning without a graph framework. |
| MCP server | Not now; tool layer stays transport-agnostic (plain async fns + zod) so an MCP adapter can be added later (e.g. Claude Desktop over the collection, gated by a personal token) | Tools must be scoped to `session.user._id`; in-process factories get that from `getAuthSession()` for free. |
| Write actions | **Propose-and-confirm**: the agent gets NO mutating tools. A `proposeDeckChanges` tool validates + echoes a structured proposal; the client renders it as a card with checkboxes and an Apply button that calls the existing mutation hooks (`useCreatePhysicalCard`, `useDeckCardOp`) so ownership checks, ephemeral semantics, and `invalidateCardMembership` come for free | Zero blast radius from a misbehaving model; no server→client invalidation channel needed. |
| Conversation state | Client-held (`useChat` resends the transcript); no persistence collection | Personal app; avoids schema/retention. Chat history persistence is backlog. |
| Token cost | Deck/collection context enters via tools (`readDeck`), never client-stuffed prompts; LLM-facing card payloads slimmed (no `image_uris`), ~20-result caps with totals; `stopWhen: stepCountIs(8)` loop cap | |
| Errors | 400 bad body, `409 ai_not_configured`, 502 provider/output failures with diagnostics | Established convention. |

## Phase 2 — Chat infrastructure + deck advisor (read-only)

New dep: `@ai-sdk/react` (^2 at planning time; check current).

- **`POST /api/ai/chat`** — the app's **first streaming route**:
  `streamText({ model, system, tools, stopWhen: stepCountIs(8) })` →
  `result.toUIMessageStreamResponse()`. Body `{ messages: UIMessage[], agentId,
  context: { deckId?, collectionId? } }`. Add `export const maxDuration = 120` and
  `Cache-Control: no-cache, no-transform`. The system prompt names the viewed
  deck/collection ids; the model fetches contents via tools.
- **Streaming risks to verify explicitly**: `src/proxy.ts` middleware should pass
  streams through (curl the dev server to confirm chunked delivery); in production
  Caddy's `encode zstd gzip` label may buffer SSE — if so, exclude the route via an
  `@sse` matcher in `docker-compose.yml`'s Caddy labels. This was never tested.
- **Agent registry** (`src/lib/ai/agents/index.ts`): `agentId → persona`; first
  persona `deck-advisor`. Deck-advisor prompting will need MTG deckbuilding
  grounding (mana-base heuristics, archetype vocabulary) — same lesson as the
  search translator: put domain knowledge and worked examples in the prompt.
- **Tool layer** (`src/lib/ai/tools/`): each tool a factory
  `makeXTool({ userId })` closing over the session user (every Mongo query includes
  `owner`), wrapping server helpers directly — never HTTP self-calls. AI SDK
  `tool({ description, inputSchema: zod, execute })`. Tools must never throw out of
  `execute`: return `{ error: "unavailable" }`-style results; external fetches get
  `AbortSignal.timeout(5–10s)`.
  - `readDeck` / `readCollection` — via `detailPhysicalCards`
    (`src/lib/server/cardDetails.ts`, returns entries + deduped card map with
    collection/deck names). Serialize compactly (`src/lib/ai/prompts/deckSerialize.ts`,
    e.g. "Lands / 4x Forest [neo]"); collections return counts + q-scoped slices
    only (a 9k-card dump would blow the context).
  - `searchCards` / `searchMyCards` — **first extract the shared query core of
    `GET /api/cards` into `src/lib/server/cardSearch.ts`** (behavior-preserving
    refactor guarded by `tests/integration/cards.test.ts`; isolated first commit).
    `searchMyCards` reuses the owned-path `$lookup` on `physicalcards`, owner-scoped.
  - `getCardDetails` — full oracle text + prices (`getCardPrices` in
    `src/lib/server/cardPrices.ts`) for named cards.
  - `manaBaseStats` — deterministic pure helper `src/lib/ai/manaBase.ts`: land
    count, color sources (`produced_mana` field, oracle-text "Add {G}" fallback),
    pip counts by color from `mana_cost` across nonlands, curve histogram,
    sources-vs-pips table. **The LLM interprets numbers; it never counts cards**
    (models miscount). Highest-value unit-test target of the phase.
  - `getRulings` — Scryfall `GET /cards/{id}/rulings` via `scryfallFetch`
    (`src/lib/scryfall.ts` handles UA + 10 req/s limit); cache in a new
    `cardrulings` collection mirroring the `cardprices` pattern (~7-day staleness);
    helper `src/lib/server/cardRulings.ts`.
  - `lookupRule` — Academy Ruins API (`https://api.academyruins.com`, docs at
    /docs): keyword abilities, rule-by-number, glossary. Covers Comprehensive-Rules
    knowledge with zero ingestion. 24h Mongo cache keyed by endpoint+query; plain
    `fetch` with an explicit User-Agent.
  - `src/lib/ai/slim.ts` — LLM-facing card projection
    `{ id, name, mana_cost, type_line, oracle_text, colors, cmc, rarity, set, prices? }`,
    no images.
- **UI**: copy the `SearchDocsPanel` docked-panel pattern exactly (see CLAUDE.md
  "UI shell" notes): `src/context/AiChatContext.tsx` (open state + current agent
  context, registered in `Providers.tsx`) + `src/components/ai/AiChatPanel.tsx`
  rendered as a `shrink-0` flex sibling in `src/components/MainWorkspace.tsx`
  (desktop `w-96 max-w-[90vw]` right dock, mobile `max-h-[50%]` top stack). Opening
  one docked panel closes the other (simplest v1). Panel internals: `useChat`
  pointed at `/api/ai/chat`, message list, tool-activity chips rendered from
  `tool-*` UI-message parts ("🔧 searched cards: `t:goblin` (14 results)"),
  streaming indicator, stop button, "New chat". Entry: sparkle button on the deck
  page header (deck pages live inside `(main)`/`MainWorkspace`), `AiNotConfigured`
  when unconfigured.
- **Tests**: unit — `manaBase` against fixture decks, `deckSerialize`, `slim`;
  integration — each tool `execute` against seeded memory-Mongo **including
  cross-user isolation**, chat route with an MSW-scripted tool-call → final-answer
  exchange, rulings-cache staleness; jsdom — panel open/stream via mocked
  transport, tool chips, unconfigured state. Lint + README/CLAUDE.md updates.

**Cut line**: deck advisor answers mana-base / recommendation / rules questions
with visible tool calls; cannot modify anything.

## Phase 3 — Proposals, "alternatives I own", combos

- **`proposeDeckChanges` tool**: input IS the proposal
  `{ deckId, changes: [{ action: "add"|"remove"|"move", cardId, cardName,
  sectionName?, ephemeral? }], rationale }`; `execute` validates ids/ownership
  (reject foreign deckIds, unknown cards) and echoes it back as the tool result —
  **it writes nothing**. Client renders that tool part as
  `src/components/ai/ProposalCard.tsx`: per-change checkboxes + Apply, wired to the
  existing `useCreatePhysicalCard` / `useDeckCardOp` hooks (existing invalidations
  keep the UI live). Respect the ephemeral-card semantics documented in CLAUDE.md.
- **"Alternatives I own"**: no new endpoint — a recipe in the deck-advisor system
  prompt: (1) `getCardDetails(likedCard)` for function/colors/type, (2) one or more
  `searchMyCards` calls with functional q-syntax queries (`o:"return" c<=u`,
  `t:instant mv<=4`, …), (3) rank and explain trade-offs.
- **`findCombos`**: Commander Spellbook REST API (open-source backend:
  github.com/SpaceCowMedia/commander-spellbook-backend) — POST the decklist card
  names from `readDeck` to its find-my-combos endpoint; slim the verbose response
  hard (combo id, card names, result description).
- **Tests**: unit — proposal validation/normalization, combo slimming; integration
  — propose tool rejects foreign deckIds/unknown cards; jsdom — **ProposalCard
  Apply fires the correct mutations + invalidations** (the critical UI test).
  Optional Playwright smoke against a stubbed model endpoint.

**Cut line**: full advertised feature set; all writes user-confirmed.

## Phase 4 — Backlog (unscheduled)

- EDHREC tool (unofficial `json.edhrec.com` endpoints — brittle, commander-shaped;
  wrap defensively).
- Auto-apply opt-in for proposals.
- Chat persistence (`chatsessions` collection + `useChat` id/resume).
- MCP server adapter over `src/lib/ai/tools` (personal-token auth) for external
  clients like Claude Desktop.
- Comprehensive-Rules embeddings: only if Academy Ruins proves insufficient —
  brute-force cosine over a chunked CR corpus stored in Mongo is viable (no Atlas
  vector search on the dev mongod).

## House rules that trip up newcomers

- Every plan must include tests, `npm run lint`, and README/CLAUDE.md updates.
- Card identity is the Scryfall string `id`, never Mongo `_id`; `PhysicalCard`
  back-refs are the membership source of truth; writes go back-ref-first; no
  multi-doc transactions (see CLAUDE.md's physical-card-instance model).
- API conventions: `Response.json`, errors `{ error: string }`, routes trust
  `src/proxy.ts` for auth and read `session!.user._id` via `getAuthSession()`,
  ownership enforced by `owner: userId` in every query.
- `src/instrumentation.ts` patches `globalThis.fetch` with a default User-Agent —
  it only fills in a missing UA, so AI SDK calls are unaffected; explicit-UA
  callers pass through.
- A locally running verification stub for the OpenAI-compatible API is trivial
  (~40-line Node http server returning canned `chat.completion` JSON) and was used
  to verify Phases 0–1 end-to-end in the browser without a real key.
