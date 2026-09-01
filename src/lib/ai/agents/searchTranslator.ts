import { z } from "zod";
import { buildSearchSyntaxCheatSheet } from "@/lib/ai/prompts/searchSyntax";

/**
 * The "search translator" agent persona: a single, tool-less LLM call that turns
 * a natural-language card request into this app's Scryfall-style query string.
 * Output contract is strict JSON so it works on any OpenAI-compatible endpoint
 * (no reliance on provider-specific structured-output modes).
 */

export const translateSearchResultSchema = z.object({
  query: z.string().min(1),
  notes: z.string().optional()
});

export type TranslateSearchResult = z.infer<typeof translateSearchResultSchema>;

/**
 * Worked natural-language → query examples embedded in the system prompt.
 * Few-shot examples are the strongest lever for translation quality; a unit
 * test verifies every query here still parses against the real operator set.
 */
export const SEARCH_TRANSLATOR_EXAMPLES: { request: string; query: string }[] = [
  { request: "non-green creatures that tap for mana", query: 't:creature -c:green o:"{t}: add"' },
  { request: "colorless mana rocks", query: 't:artifact o:"{t}: add"' },
  {
    request: "cheap white removal",
    query: 'c:w mv<=2 (o:"destroy target" or o:"exile target")'
  },
  { request: "blue counterspells", query: 'c:u o:"counter target"' },
  { request: "artifacts that make treasure tokens", query: "t:artifact o:create o:treasure" },
  { request: "big green creatures with trample", query: "c:g t:creature pow>=4 kw:trample" },
  { request: "black card draw under three mana", query: 'c:b o:/draw . card/ mv<=3' },
  {
    request: "mythic planeswalkers with high starting loyalty",
    query: "t:planeswalker r:mythic loy>=4"
  },
  { request: "lands that can search my library", query: 't:land o:"search your library"' },
  {
    request: "spells that draw more than one card at once",
    query: "o:/draw (two|three|four|x) cards/ -t:land"
  },
  {
    request: "creatures that deal damage when they enter",
    query: "t:creature o:/enters, .* deals? .* damage/"
  },
  { request: "lands that produce blue mana", query: "t:land produces:u" },
  { request: "artifacts that make colorless mana, printed since 2020", query: "t:artifact produces:c year>=2020" },
  { request: "modal double-faced lands", query: "is:mdfc t:land" }
];

export function buildSearchTranslatorSystemPrompt(): string {
  const examples = SEARCH_TRANSLATOR_EXAMPLES.map(
    (example) => `- "${example.request}" -> {"query": ${JSON.stringify(example.query)}}`
  );

  return [
    "You translate natural-language Magic: The Gathering card requests into a search query for a card database.",
    "The database uses the following Scryfall-style syntax — this is the COMPLETE set of supported operators:",
    "",
    buildSearchSyntaxCheatSheet(),
    "",
    "How to match rules text (important):",
    "- o: is a case-insensitive LITERAL SUBSTRING match on the card's oracle (rules) text — it is not semantic. Always translate a concept into a phrase that literally appears printed on cards.",
    "- Symbols in oracle text are written in curly braces: {T} = the tap symbol, {Q} = untap, mana symbols {W} {U} {B} {R} {G}, {C} = colorless, generic costs {1} {2} {X}.",
    '- Canonical oracle phrasings: a card "taps for mana" (a "mana dork" or "mana rock") when its text contains "{T}: Add" -> o:"{t}: add". Card draw -> o:"draw a card". Destroy-based removal -> o:"destroy target". Exile-based removal -> o:"exile target". Counterspells -> o:"counter target". Token makers -> o:create o:token (or the token name, e.g. o:treasure). Tutors -> o:"search your library".',
    "- o:, name:, and t: accept a REGULAR EXPRESSION when the value is wrapped in slashes: o:/draw .{1,3} cards?/, t:/^legendary creature/ (case-insensitive; escape a literal slash as \\/). Use a regex when one concept has several printed phrasings (numbers, plurals, alternatives like (two|three)); use a plain value for a single literal phrase.",
    "- Multiple o: terms combine with AND — use that to require several phrases at once.",
    "- Prefer kw: for keyword abilities (flying, trample, deathtouch, …) instead of o:.",
    '- "non-X" conditions use the - prefix: non-green -> -c:green, non-creature -> -t:creature.',
    "",
    "Worked examples (request -> output):",
    ...examples,
    "",
    "Rules:",
    "- Use ONLY the operators documented above. Do not invent operators (there is no price, format, legality, artist, or year operator).",
    '- If part of the request cannot be expressed with the available operators, approximate it as closely as possible and mention the limitation in "notes".',
    "- Prefer precise operators over bare name terms (e.g. use t: for types, o: for rules text).",
    "- Quote multi-word values.",
    "- Respond with a single JSON object and NOTHING else, in this exact shape:",
    '  {"query": "<the search string>", "notes": "<optional one-sentence caveat or explanation>"}',
    '- Omit "notes" entirely when there is nothing worth flagging.'
  ].join("\n");
}

/**
 * Parse the model's reply into a validated result. Tolerates code fences and
 * surrounding prose by extracting the outermost JSON object.
 *
 * @throws Error when no valid `{ query }` object can be extracted.
 */
export function parseTranslateSearchResult(text: string): TranslateSearchResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response did not contain a JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("AI response contained malformed JSON");
  }

  const result = translateSearchResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("AI response JSON did not match the expected shape");
  }
  return result.data;
}
