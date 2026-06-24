/**
 * Field-based search model and a one-way builder that converts it into a
 * Scryfall-style query string (the same syntax `parseSearchQuery` consumes).
 *
 * This is the shared "helper" logic behind the Advanced Search dialog used on
 * both the Card Search page and the Collection page: the user fills in fields,
 * and we generate a query string that is then run through the single, canonical
 * server-side search engine (`parseSearchQuery`). There is intentionally no
 * inverse (string -> fields) parsing.
 */

/**
 * Numeric comparison operators exposed by the field-based helper.
 */
export type NumericOperator = "=" | ">" | "<" | ">=" | "<=";

/**
 * Color filter modes exposed by the field-based helper.
 */
export type ColorFilterMode = "contains" | "exactly" | "does-not-contain";

/**
 * The full set of fields the Advanced Search dialog can populate. Every field
 * maps to a Scryfall operator (see `src/lib/search/operators/`).
 */
export interface SearchFilters {
  name?: string;
  flavorName?: string;
  typeLine?: string;
  oracleText?: string;
  set?: string;
  lang?: string;
  layout?: string;
  keyword?: string;
  rarity?: string;
  rarityOperator?: NumericOperator;
  power?: string;
  powerOperator?: NumericOperator;
  toughness?: string;
  toughnessOperator?: NumericOperator;
  loyalty?: string;
  loyaltyOperator?: NumericOperator;
  cmc?: string;
  cmcOperator?: NumericOperator;
  colors?: string[]; // Selected color codes: W, U, B, R, G
  colorMode?: ColorFilterMode;
  colorIdentity?: string[]; // Selected color codes: W, U, B, R, G
  colorIdentityMode?: ColorFilterMode;
  excludeExtras?: boolean;
}

/** Wrap a value in double quotes if it contains whitespace. */
function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** `key:value` term (value quoted when needed). */
function colonTerm(key: string, value: string): string {
  return `${key}:${quote(value)}`;
}

/**
 * `key{op}value` term for a numeric/comparison field. `=` uses the colon form
 * (which the parser and the relevant operators treat as equality).
 */
function comparisonTerm(key: string, value: string, op: NumericOperator | undefined): string {
  const operator = op ?? "=";
  if (operator === "=") return colonTerm(key, value);
  return `${key}${operator}${quote(value)}`;
}

/**
 * Build the color/identity term(s) for the given mode.
 * - contains        => `key>=<letters>` (has at least these colors)
 * - exactly         => `key=<letters>`  (has exactly these colors)
 * - does-not-contain=> one negated term per color (`-key:w -key:r`) i.e. none present
 */
function colorTerms(key: string, colors: string[], mode: ColorFilterMode): string[] {
  const letters = colors.map((c) => c.toLowerCase());
  if (letters.length === 0) return [];

  switch (mode) {
    case "exactly":
      return [`${key}=${letters.join("")}`];
    case "does-not-contain":
      return letters.map((c) => `-${key}:${c}`);
    case "contains":
    default:
      return [`${key}>=${letters.join("")}`];
  }
}

/**
 * Convert a `SearchFilters` object into a Scryfall-style query string.
 * Empty/whitespace-only fields are ignored; an all-empty model yields "".
 */
export function filtersToQueryString(filters: SearchFilters): string {
  const terms: string[] = [];

  const text = (v: string | undefined) => (v ?? "").trim();

  if (text(filters.name)) terms.push(colonTerm("name", text(filters.name)));
  if (text(filters.flavorName)) terms.push(colonTerm("fn", text(filters.flavorName)));
  if (text(filters.typeLine)) terms.push(colonTerm("t", text(filters.typeLine)));
  if (text(filters.oracleText)) terms.push(colonTerm("o", text(filters.oracleText)));
  if (text(filters.set)) terms.push(colonTerm("e", text(filters.set)));
  if (text(filters.lang)) terms.push(colonTerm("lang", text(filters.lang)));
  if (text(filters.layout)) terms.push(colonTerm("layout", text(filters.layout)));
  if (text(filters.keyword)) terms.push(colonTerm("kw", text(filters.keyword)));

  if (text(filters.rarity)) {
    terms.push(comparisonTerm("r", text(filters.rarity), filters.rarityOperator));
  }
  if (text(filters.cmc)) {
    terms.push(comparisonTerm("mv", text(filters.cmc), filters.cmcOperator));
  }
  if (text(filters.power)) {
    terms.push(comparisonTerm("pow", text(filters.power), filters.powerOperator));
  }
  if (text(filters.toughness)) {
    terms.push(comparisonTerm("tou", text(filters.toughness), filters.toughnessOperator));
  }
  if (text(filters.loyalty)) {
    terms.push(comparisonTerm("loy", text(filters.loyalty), filters.loyaltyOperator));
  }

  if (filters.colors && filters.colors.length > 0) {
    terms.push(...colorTerms("c", filters.colors, filters.colorMode ?? "contains"));
  }
  if (filters.colorIdentity && filters.colorIdentity.length > 0) {
    terms.push(...colorTerms("id", filters.colorIdentity, filters.colorIdentityMode ?? "contains"));
  }

  if (filters.excludeExtras) terms.push("exclude:extras");

  return terms.join(" ");
}
