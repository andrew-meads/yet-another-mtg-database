# User settings & AI features

Future AI phases and the standing architecture decisions are parked in `AI_ROADMAP.md`
(repo root). **Read it before starting any new AI feature.** Phases 0–3 (settings/provider
plumbing, NL search, the deck-advisor chat, proposals/combos) are shipped.

## User settings (`src/lib/server/userSettings.ts`)

Per-user settings live server-side in the **`usersettings`** collection
(`UserSettingsModel`, one doc per user, unique on `owner`) with optional sections:
`cardPreview`, `openEntities`, `pricing` (`{ currency, sources }` — see
[pricing.md](pricing.md)), and `ai` (`{ baseUrl?, model?, apiKeySealed?, apiKeyHint? }`).
Absent section = "never customized"; clients fall back to defaults. This is the app's only
server-side user-preference store — everything else stays localStorage (panel layout,
per-page search strings, selected card) as deliberate device-local UI state.

- **Routes**: `GET /api/settings` (all sections, AI masked to
  `{ baseUrl, model, hasApiKey, apiKeyHint }` — the key never leaves the server),
  `PATCH /api/settings` (zod-validated partial update of `cardPreview`/`openEntities`/`pricing`),
  `PUT /api/settings/ai` (key semantics: omitted = keep, `""` = clear, else replace —
  sealed via **`src/lib/server/secretBox.ts`**, AES-256-GCM when `SETTINGS_ENCRYPTION_KEY`
  is set, `plain.`-prefixed otherwise; the display hint is computed at write time so reads
  never decrypt), `GET /api/ai/status` (`{ configured, model?, baseUrlHost? }`),
  `POST /api/ai/status/test` (1-token smoke completion, `maxRetries: 0`). zod request
  schemas live next to the persistence helpers in `userSettings.ts`.
- **Client sync**: **`useServerSetting(section, initial, { legacyStorageKey?, reconcile? })`**
  (`src/hooks/useServerSetting.ts`) is the useState-like seam both `SettingsContext` and
  `OpenEntitiesContext` sit on: hydrates once from `["user-settings"]`, debounces PATCHes
  (600ms), migrates the legacy localStorage key (removed only after the seed write
  succeeds), and reconciles pre-hydration edits (open-entities uses a union merge).
  Mutation hooks write the PATCH/PUT response straight into the `["user-settings"]` cache.
- **Settings UI**: the `/settings` page (see [routing.md](routing.md)) —
  `PricingSettingsSection` and the card-preview controls live-save;
  `src/components/settings/AiSettingsSection.tsx` has an explicit Save + Test connection.

## AI provider (`src/lib/ai/provider.ts`)

`getAiModel(userId)` builds a per-request `createOpenAICompatible({ baseURL, apiKey })`
model (Vercel AI SDK, `ai` + `@ai-sdk/openai-compatible`) from `getAiConfig` (null unless
model + key present; baseUrl defaults to `https://api.openai.com/v1`), throwing
`AiNotConfiguredError` which routes map to **`409 { error: "ai_not_configured" }`**. Every
AI entry point in the UI gates on `useAiStatus` and renders
`src/components/ai/AiNotConfigured.tsx` (guidance → Settings) when unconfigured; the
server enforces independently. `src/instrumentation.ts`'s fetch wrapper only fills a
*missing* User-Agent, so AI SDK calls pass through untouched.

The app is on **AI SDK v7** (`ai@^7`, `@ai-sdk/react@^4`, `@ai-sdk/openai-compatible@^3`):
the system prompt option is `instructions` (not `system`), `convertToModelMessages` is
async, the per-step callback is `onStepEnd`, and `result.toUIMessageStreamResponse()` is
deprecated in favour of `createUIMessageStreamResponse` + `toUIMessageStream`.

## AI natural-language search (`src/app/api/ai/translate-search/`)

The sparkle button in `CardSearchBar` (`src/components/ai/NlSearchButton.tsx`, popover +
textarea) POSTs `{ prompt }` to **`/api/ai/translate-search`**, which runs a single
tool-less `generateText` call (the "search-translator" persona,
`src/lib/ai/agents/searchTranslator.ts`) and returns `{ query, notes? }`; the client
replaces the search-bar text with the **editable** query and the normal search pipeline
takes over (works identically on the collection page's bar).

- The system prompt's operator cheat-sheet is **generated from `SEARCH_DOC_SECTIONS`**
  (`src/lib/ai/prompts/searchSyntax.ts` renders `src/components/search/searchDocs.tsx`),
  and a unit test (`src/lib/ai/__tests__/searchSyntax.test.ts`) cross-checks the docs
  against `searchOperators` in `config.ts` — so prompt, help panel, and engine stay in sync.
- The prompt also carries MTG **oracle-text conventions** (o: is a literal substring
  match; symbols are `{T}`/`{G}`-style; canonical phrasings like "taps for mana" →
  `o:"{t}: add"`) and few-shot worked examples (`SEARCH_TRANSLATOR_EXAMPLES` in
  `searchTranslator.ts`) — every example query is unit-test-guarded to use only registered
  operators and parse to a real filter, so **extend the examples list (not ad-hoc prompt
  text) when translations miss a concept.**
- The output contract is strict JSON parsed by `parseTranslateSearchResult` (tolerates
  fences/prose; zod-validated) rather than provider-specific structured output, for
  maximal endpoint compatibility; the result is sanity-passed through `parseSearchQuery`.
- Errors: 400 bad body, 409 unconfigured, 502 for provider failures or unusable model
  output. Integration tests impersonate the OpenAI-compatible endpoint with MSW
  (`tests/integration/aiTranslateSearch.test.ts`).

## AI deck advisor chat (`src/app/api/ai/chat/`, `src/lib/ai/`)

The app's first streaming route + tool-loop agent. **`POST /api/ai/chat`** takes
`{ messages: UIMessage[], agentId, context: { deckId?, collectionId? } }`, runs
`streamText({ model, instructions, tools, stopWhen: isStepCount(persona.stepLimit) })` and
returns `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`
(the `@ai-sdk/react` `useChat` wire format; `maxDuration = 120`,
`Cache-Control: no-cache, no-transform`). Conversation state is **client-held** — the
client resends the transcript each turn; nothing is persisted. Chunked delivery through
the `src/proxy.ts` middleware was verified working in dev; the production Caddy `encode`
label remains a possible SSE-buffering risk.

### Agent registry (`src/lib/ai/agents/index.ts`)

`agentId → AiAgentPersona` (`types.ts`: system-prompt builder, tool subset,
`maxOutputTokens`, `stepLimit`). First persona: **`deck-advisor`** (`deckAdvisor.ts`) — its
prompt embeds the search-syntax cheat sheet (same `buildSearchSyntaxCheatSheet` as the
translator), MTG deckbuilding heuristics (land counts, Karsten-style source/pip ratios,
curve/archetype vocabulary), and hard rules: never count cards itself (use
`manaBaseStats`), never invent card facts (verify via tools), and never write — deck
changes go through `proposeDeckChanges` and are applied only by the user; the prompt also
carries the "alternatives I own" recipe (getCardDetails → functional `searchMyCards`
queries → rank) and a Style section asking for Markdown answers.

### Tool layer (`src/lib/ai/tools/`)

Each tool is a factory `makeXTool({ userId })` closing over the session user (every Mongo
query is owner-scoped), wrapping server helpers directly — never HTTP self-calls.
`safeExecute` in `shared.ts` guarantees `execute` never throws (errors return in-band as
`{ error }`); external fetches carry timeouts. `buildAiTools` / `buildAiToolSubset` in
`index.ts` assemble a persona's set. LLM-facing card payloads use `slimCardForLlm`
(`src/lib/ai/slim.ts`) — no images, undefined keys dropped, `card_faces` text kept.

- **`readDeck`** — compact sectioned decklist via `serializeDeck`
  (`src/lib/ai/prompts/deckSerialize.ts` — "4x Forest [neo]" lines; unarranged back-ref
  copies appear under "(unsorted)").
- **`readCollection`** — counts + a q-scoped, 20-distinct-card-capped slice — never dumps
  a collection.
- **`searchCards`** / **`searchMyCards`** — shared `runCardSearch` core; 20/page;
  `searchMyCards` passes `ownerId` for an owner-scoped owned filter; 15s `maxTimeMS`.
- **`getCardDetails`** — exact-name lookup incl. face/flavor names, newest printing,
  + `getCardPrices` best-effort.
- **`manaBaseStats`** — deterministic analysis via pure `src/lib/ai/manaBase.ts` — lands,
  per-color sources incl. oracle-text "Add {G}" fallback, pips (hybrids count both
  halves), curve, sources-vs-pips; **the LLM interprets numbers, it never counts**;
  optional `sectionName` scope.
- **`getRulings`** — Scryfall rulings, 7-day cache in `cardrulings` via
  `src/lib/server/cardRulings.ts`.
- **`lookupRule`** — Academy Ruins CR/keyword lookups, 24h cache in `rulescaches` via
  `src/lib/server/rulesLookup.ts`; the per-term glossary endpoint is unreliable so keyword
  terms fall back to the ordered `/cr/keywords` lists mapped to rules 702.(i+2)/701.(i+2).
- **`findCombos`** — deck's card names → Commander Spellbook `/find-my-combos` via
  `src/lib/server/comboSearch.ts`, slimmed hard by pure `slimComboResponse` (combo
  id/url/cards/produces + capped description; almost-included combos get `missing`
  computed; no cache).
- **`proposeDeckChanges`** — the propose-and-confirm write path: its INPUT is the proposal
  (`{ deckId, changes: [{ action: add|remove|move, cardName, count?, sectionName? }], rationale }`);
  execute validates ownership/card names/copy counts/section names and echoes a normalized
  proposal (canonical names, resolved `sectionId`, and for adds a `cardId` resolved to the
  newest **native-language printing** — `NATIVE_CARD_LANG = "en"` in `tools/shared.ts`,
  `findNativePrintingByName` with any-language fallback) — it **writes nothing**, and an
  invalid proposal returns `{ error, invalid: [{index, reason}] }` so the model can retry.
  The model does NOT choose how adds are sourced — that choice belongs to the user in the
  ProposalCard.

Card-name matching throughout the proposal path is **punctuation-insensitive** via
`src/lib/cardNames.ts` (`normalizeCardName` / `relaxedNameRegex` — "Ach Hans Run" matches
`"Ach! Hans, Run!"`), also used by the tool layer's `findCardByName` /
`findNativePrintingByName` as a fallback after exact match.

### UI

Mirrors the SearchDocsPanel docked-panel pattern exactly. **`AiChatContext`**
(`src/context/AiChatContext.tsx`, inside `SearchDocsProvider` in `Providers.tsx`) holds
open state + the viewed-entity `chatContext`; opening either docked panel closes the
other. **`AiChatPanel`** (`src/components/ai/AiChatPanel.tsx`) renders as a flex sibling
in `MainWorkspace` (desktop `w-96 max-w-[90vw]` right dock, mobile `max-h-[50%]` top
stack): `useChat` + `DefaultChatTransport` pointed at `/api/ai/chat` (agentId + context
ride per-send via request `body`), message list with tool-activity chips
(`toolPartLabel.ts` — pure, unit-tested), streaming indicator, stop button, "New chat",
`AiNotConfigured` gate. Assistant text parts render as **Markdown** via `ChatMarkdown.tsx`
(`react-markdown` + `remark-gfm`, Tailwind-styled component overrides — no typography
plugin); user messages stay plain text. Entry point: the Sparkles button on the deck page
header, which also keeps `chatContext.deckId` synced to the viewed deck.

**Debuggability**: tool chips are click-expandable to the raw input/result JSON the model
exchanged; `reasoning` parts (streamed by providers that emit `reasoning_content`;
`sendReasoning` defaults on) render as a collapsed dashed "Reasoning" block that spins
while streaming. Server console gets one `[ai]` line per chat turn, per model step
(`onStepEnd`: finish reason, tool calls, token usage), and per tool call (via
`safeExecute`: input, duration, result size or in-band error); `AI_CHAT_DEBUG=true`
additionally dumps full tool-result JSON.

**Proposals**: a validated `tool-proposeDeckChanges` result renders as
**`ProposalCard.tsx`** instead of a chip, and the conversation **pauses on it**: every
change is decided individually with immediate-action row buttons — adds offer
**"My copies (N)"** (place N real unassigned copies from the active collection via
`op:"place"`, creating nothing; N counted from `useRetrieveCollectionDetails(activeCollection)`
entries with no `deckId`, disabled at 0), **"Placeholder"** (create ephemeral copies of the
proposal's native-language `cardId` via `useCreatePhysicalCard` with no `collectionId`),
or **"Skip"**; removes/moves offer **"Apply"**/**"Skip"** (physical ids resolved by
normalized card name from `useRetrieveDeckDetails`; the same copy is never handed to two
changes); a **"Done"** button auto-skips everything still undecided. While the latest
message holds an unresolved proposal the panel's input is disabled. Once every row is
decided the card fires `onResolve(summary)` exactly once and the panel **auto-sends a
`[Proposal outcome for "Deck"] …` user message** describing what was actually
applied/skipped/failed, so the model learns the real outcome (the persona prompt tells it
to end its turn after proposing and treat that message as ground truth); the panel tracks
resolutions in `proposalOutcomes` keyed by `messageId:partIndex` (a remounted resolved
proposal renders as a compact locked card).

### Tests

Unit — `manaBase`, `deckSerialize`, `slim`, `rulesLookup`/`cardRulings`/`comboSearch`
pure helpers, `toolPartLabel`, `searchSyntax`; integration —
`tests/integration/aiTools.test.ts` (every tool against seeded memory-Mongo incl.
cross-user isolation and cache staleness), `aiProposalsCombos.test.ts` (proposal
validation/rejection incl. write-nothing assertion; findCombos slimming + failure modes),
`aiChat.test.ts` (MSW-scripted SSE tool-call → final-answer exchange against the streaming
route), `aiTranslateSearch.test.ts`, `userSettings.test.ts`; jsdom — `AiChatPanel` (mocked
`useChat`), `ProposalCard` (Apply fires the correct mutations + invalidations),
`AiChatContext` mutual exclusion, `AiSettingsSection`, `NlSearchButton`.
