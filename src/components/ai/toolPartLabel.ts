/**
 * Human-readable labels for `tool-*` UI-message parts rendered as activity
 * chips in the chat panel ("searched cards: t:goblin (14 results)"). Pure —
 * unit-tested without rendering.
 */

export interface ToolPartLike {
  /** e.g. "tool-searchCards" */
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface AnyRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" ? (value as AnyRecord) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Whether the part finished with an error (thrown or in-band `{ error }`). */
export function isToolPartError(part: ToolPartLike): boolean {
  if (part.state === "output-error") return true;
  return str(asRecord(part.output).error) !== undefined;
}

/** One-line description of a tool call for its activity chip. */
export function describeToolPart(part: ToolPartLike): string {
  const name = part.type.replace(/^tool-/, "");
  const input = asRecord(part.input);
  const output = asRecord(part.output);

  if (isToolPartError(part)) {
    const reason = str(output.error) ?? str(part.errorText);
    return `${name} failed${reason ? `: ${reason}` : ""}`;
  }

  const done = part.state === "output-available";

  switch (name) {
    case "searchCards":
    case "searchMyCards": {
      const scope = name === "searchMyCards" ? "your cards" : "all cards";
      const total = num(output.total);
      const suffix = done && total !== undefined ? ` (${total} ${total === 1 ? "match" : "matches"})` : "";
      return `searched ${scope}: ${str(input.q) ?? "…"}${suffix}`;
    }
    case "readDeck": {
      const deckName = str(output.name);
      const count = num(output.totalCards);
      return done && deckName
        ? `read deck "${deckName}"${count !== undefined ? ` (${count} cards)` : ""}`
        : "reading deck…";
    }
    case "readCollection": {
      const collName = str(output.name);
      const q = str(input.q);
      return done && collName
        ? `read collection "${collName}"${q ? `: ${q}` : ""}`
        : "reading collection…";
    }
    case "getCardDetails": {
      const names = Array.isArray(input.names) ? input.names.filter((n) => typeof n === "string") : [];
      return `looked up ${names.length > 0 ? names.join(", ") : "card details"}`;
    }
    case "manaBaseStats": {
      const deckName = str(output.deckName);
      return done && deckName ? `analyzed mana base of "${deckName}"` : "analyzing mana base…";
    }
    case "getRulings": {
      const cardName = str(output.cardName) ?? str(input.cardName);
      return `fetched rulings${cardName ? ` for ${cardName}` : ""}`;
    }
    case "lookupRule": {
      const query = str(input.query);
      return `looked up ${input.kind === "rule" ? "rule" : "keyword"}${query ? ` ${query}` : ""}`;
    }
    case "findCombos": {
      const deckName = str(output.deckName);
      const found = num(output.totalIncluded);
      return done && deckName
        ? `searched combos in "${deckName}" (${found ?? 0} found)`
        : "searching combos…";
    }
    case "proposeDeckChanges": {
      const changes = Array.isArray(input.changes) ? input.changes.length : undefined;
      return done
        ? `proposed ${changes ?? "deck"} change${changes === 1 ? "" : "s"}`
        : "drafting a proposal…";
    }
    default:
      return done ? `used ${name}` : `using ${name}…`;
  }
}
