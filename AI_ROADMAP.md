# AI Assistant Roadmap

This document parks the remaining phases of the AI-agent plan so a future agent (or
human) can continue it without the original planning conversation. **Read CLAUDE.md
first** — it documents the codebase architecture and the already-shipped AI
foundations this roadmap builds on. Phases 0, 1, and 2 are **done and shipped**;
work continues from Phase 3.

## Where things stand (Phases 0–2, shipped)

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

**Phase 2 — chat infrastructure + deck advisor (read-only)** — see CLAUDE.md's
"AI deck advisor chat" section for the full architecture. In brief:

- `POST /api/ai/chat` (`streamText` → `toUIMessageStreamResponse`, client-held
  transcript), agent registry (`src/lib/ai/agents/`, persona `deck-advisor`),
  read-only tool layer (`src/lib/ai/tools/`: readDeck, readCollection,
  searchCards/searchMyCards on the extracted `runCardSearch` core, getCardDetails,
  manaBaseStats over pure `src/lib/ai/manaBase.ts`, getRulings w/ `cardrulings`
  7-day cache, lookupRule w/ `rulescaches` 24h cache), docked `AiChatPanel` +
  `AiChatContext` UI mirroring the SearchDocsPanel pattern, sparkle entry on the
  deck page. New dep: `@ai-sdk/react@^2` (pairs with `ai@5`).
- **Streaming through `src/proxy.ts` middleware is verified working in dev**
  (browser-tested with a local stub endpoint streaming word-by-word — chunks
  arrive progressively). **Still untested: production Caddy** — its
  `encode zstd gzip` label may buffer SSE; if so, exclude the route via an `@sse`
  matcher in `docker-compose.yml`'s Caddy labels.
- Academy Ruins gotcha: `GET /cr/glossary/{term}` 404s even for known terms (their
  data pipeline currently collapses the glossary into one blob), so keyword lookups
  fall back to the ordered `GET /cr/keywords` lists, which map by index to rules
  702.(i+2) (abilities) / 701.(i+2) (actions). If the glossary endpoint comes back,
  the primary path in `src/lib/server/rulesLookup.ts` starts working again on its
  own.
- Verification stub: `scratchpad`-style ~80-line node server that answers the
  first request with a scripted tool call and follow-ups with slowly streamed text
  proved the whole loop in the browser without a real key (same trick as Phases
  0–1, now SSE-shaped).

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
