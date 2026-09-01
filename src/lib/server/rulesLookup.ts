import { RulesCacheModel } from "@/db/schema";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";

/**
 * Comprehensive-Rules lookups via the Academy Ruins API
 * (https://api.academyruins.com, docs at /docs). Covers rule-by-number and
 * keyword/glossary definitions with zero local ingestion. Successful responses
 * are cached in the `rulescaches` collection for 24h keyed by endpoint+query.
 *
 * Endpoint notes (verified against the live API):
 * - `GET /cr/{rule}?find_definition=true` → `{ ruleNumber, ruleText }`.
 * - `GET /cr/example/{rule}` → `{ ruleNumber, examples: string[] | null }`.
 * - `GET /cr/glossary/{term}` is unreliable (404s for known terms), so keyword
 *   terms fall back to `GET /cr/keywords`, whose ordered lists map by index to
 *   rules 702.(i+2) (keyword abilities) and 701.(i+2) (keyword actions).
 */

export const RULES_CACHE_STALENESS_MS = 24 * 60 * 60 * 1000;

/** Request timeout — external fetches inside AI tools must never hang a chat turn. */
const RULES_FETCH_TIMEOUT_MS = 8000;

export type RulesLookupKind = "rule" | "glossary";

export interface RulesLookupResult {
  /** e.g. "702.19b" for rules; "Trample (rule 702.19)" for keyword hits. */
  title: string;
  text: string;
  /** Printed examples following the rule, when Academy Ruins has them. */
  examples?: string[];
  /** Set when the lookup found nothing. */
  notFound?: boolean;
}

interface KeywordLists {
  keywordAbilities?: string[];
  keywordActions?: string[];
  abilityWords?: string[];
}

function baseUrl(): string {
  return process.env.ACADEMY_RUINS_API_BASE_URL || "https://api.academyruins.com";
}

/** Whether a cached record's timestamp is still within the staleness window. */
export function isRulesCacheFresh(updatedAt: Date | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  return now - updatedAt.getTime() < RULES_CACHE_STALENESS_MS;
}

/**
 * Map a keyword term to its Comprehensive Rules rule number using the ordered
 * lists from `/cr/keywords`: keyword abilities are rules 702.2 onward, keyword
 * actions 701.2 onward, in list order. Pure — unit-testable with fixture lists.
 */
export function keywordToRuleNumber(term: string, lists: KeywordLists): string | null {
  const needle = term.trim().toLowerCase();
  const abilityIndex = (lists.keywordAbilities ?? []).findIndex(
    (k) => k.toLowerCase() === needle
  );
  if (abilityIndex >= 0) return `702.${abilityIndex + 2}`;
  const actionIndex = (lists.keywordActions ?? []).findIndex((k) => k.toLowerCase() === needle);
  if (actionIndex >= 0) return `701.${actionIndex + 2}`;
  return null;
}

async function fetchJson(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl()}${path}`, {
    // Identify ourselves (same UA string we send Scryfall) and never hang.
    headers: { "User-Agent": SCRYFALL_HEADERS["User-Agent"], Accept: "application/json" },
    signal: AbortSignal.timeout(RULES_FETCH_TIMEOUT_MS)
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Read a cached payload if fresh; otherwise null. */
async function readCache(key: string) {
  const cached = await RulesCacheModel.findOne({ key });
  return { cached, fresh: cached ? isRulesCacheFresh(cached.updatedAt) : false };
}

async function writeCache(key: string, payload: unknown) {
  await RulesCacheModel.findOneAndUpdate({ key }, { payload }, { upsert: true });
}

/** Fetch a single rule (with its examples, best-effort). Returns null on 404. */
async function fetchRule(ruleNumber: string): Promise<RulesLookupResult | null> {
  const { status, body } = await fetchJson(
    `/cr/${encodeURIComponent(ruleNumber)}?find_definition=true`
  );
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Academy Ruins returned ${status}`);
  const b = (body ?? {}) as Record<string, unknown>;
  const result: RulesLookupResult = {
    title: typeof b.ruleNumber === "string" ? b.ruleNumber : ruleNumber,
    text: typeof b.ruleText === "string" ? b.ruleText : ""
  };
  try {
    const ex = await fetchJson(`/cr/example/${encodeURIComponent(ruleNumber)}`);
    const exBody = (ex.body ?? {}) as Record<string, unknown>;
    if (ex.status === 200 && Array.isArray(exBody.examples)) {
      const examples = exBody.examples.filter((e): e is string => typeof e === "string");
      if (examples.length > 0) result.examples = examples;
    }
  } catch {
    // Examples are optional garnish; ignore failures.
  }
  return result;
}

/** Resolve a glossary/keyword term to a result. Returns notFound in-band. */
async function fetchGlossaryTerm(term: string): Promise<RulesLookupResult> {
  // First try the dedicated glossary endpoint (fuzzy, incl. unofficial terms).
  const { status, body } = await fetchJson(
    `/cr/glossary/${encodeURIComponent(term)}?fuzzy=true&unofficial=true`
  );
  if (status === 200) {
    const b = (body ?? {}) as Record<string, unknown>;
    const definition = typeof b.definition === "string" ? b.definition : "";
    if (definition) {
      return { title: typeof b.term === "string" ? b.term : term, text: definition };
    }
  } else if (status !== 404) {
    throw new Error(`Academy Ruins returned ${status}`);
  }

  // Fall back to the keyword lists → rule number mapping.
  const listsKey = "keywords:index";
  const { cached, fresh } = await readCache(listsKey);
  let lists: KeywordLists | null = fresh ? (cached!.payload as KeywordLists) : null;
  if (!lists) {
    try {
      const res = await fetchJson("/cr/keywords");
      if (res.status === 200 && res.body && typeof res.body === "object") {
        lists = res.body as KeywordLists;
        await writeCache(listsKey, lists);
      }
    } catch (error) {
      if (cached) lists = cached.payload as KeywordLists;
      else throw error;
    }
  }

  const ruleNumber = lists ? keywordToRuleNumber(term, lists) : null;
  if (!ruleNumber) return { title: term, text: "", notFound: true };

  const rule = await fetchRule(ruleNumber);
  if (!rule) return { title: term, text: "", notFound: true };
  return { ...rule, title: `${term} (rule ${rule.title})` };
}

/**
 * Look up a Comprehensive Rules rule by number (e.g. "702.19b") or a
 * keyword/glossary term (e.g. "trample", "scry"). Serves a < 24h cached copy
 * when available; "not found" is returned in-band (never thrown).
 *
 * @throws only on network/timeout/server errors with no cached fallback.
 */
export async function lookupRules(kind: RulesLookupKind, query: string): Promise<RulesLookupResult> {
  const normalizedQuery = query.trim().toLowerCase();
  const key = `${kind}:${normalizedQuery}`;

  const { cached, fresh } = await readCache(key);
  if (cached && fresh) return cached.payload as RulesLookupResult;

  let payload: RulesLookupResult;
  try {
    if (kind === "rule") {
      payload = (await fetchRule(normalizedQuery)) ?? {
        title: query,
        text: "",
        notFound: true
      };
    } else {
      payload = await fetchGlossaryTerm(normalizedQuery);
    }
  } catch (error) {
    // Serve a stale copy over failing outright when we have one.
    if (cached) return cached.payload as RulesLookupResult;
    throw error;
  }

  await writeCache(key, payload);
  return payload;
}
