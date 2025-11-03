import { ICard } from "@/types/ICard";
import clsx from "clsx";
import styles from "./CardTextView.module.css";
import { Fragment } from "react/jsx-runtime";

/**
 * Interface representing a single face of a Magic: The Gathering card.
 * Used for multi-faced cards like MDFCs (Modal Double-Faced Cards) or transforming cards.
 */
interface IFace {
  name: string;
  oracle_text: string;
  mana_cost?: string;
  type_line: string;
  flavor_text?: string;
  loyalty?: string;
  power?: string;
  toughness?: string;
}

/**
 * Main component that displays the oracle text (rules text) of a Magic: The Gathering card.
 * Splits the card's oracle_text by newlines and renders each line separately.
 *
 * @param card - The card object containing oracle_text and other card data
 */
export function CardTextView({ card }: { card: ICard }) {
  const faces: IFace[] = (card.card_faces as IFace[]) || [];
  if (faces.length === 0) faces.push(card as IFace);
  const oracleTexts =
    card.card_faces?.map((f) => f.oracle_text).filter((t) => t && t.trim() !== "") || [];
  if (card.oracle_text && card.oracle_text.trim() !== "") oracleTexts.unshift(card.oracle_text);
  return (
    <div className="flex flex-col gap-5 text-foreground">
      {faces.map((face, index) => (
        <Fragment key={index}>
          <CardFace face={face} />
          {index < faces.length - 1 && <hr className="border-t border-muted" />}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Renders a single face of a card, including its name, mana cost, type line, rules text, and flavor text.
 * Displays the card information in a structured layout with proper formatting for each section.
 *
 * @param face - The card face object containing name, oracle_text, mana_cost, type_line, and optional flavor_text
 */
function CardFace({ face }: { face: IFace }) {
  const rulesText = face.oracle_text.split("\n");

  return (
    <div className="text-foreground">
      {/* Card Face Header - Name and Mana Cost */}
      <div className="flex justify-between items-center gap-4">
        <h3 className="text-lg font-bold">{face.name}</h3>
        {face.mana_cost && <ManaCost cost={face.mana_cost} />}
      </div>

      {/* Type line */}
      <p className="italic mb-2">{face.type_line}</p>

      {/* Rules Text */}
      <div className="flex flex-col gap-3">
        {rulesText.map((line, index) => (
          <RulesTextLine key={index} text={line} />
        ))}
      </div>

      {/* Flavor text, if it exists */}
      {face.flavor_text && (
        <p className="mt-2 italic opacity-80">
          <TextWithSymbols text={face.flavor_text} />
        </p>
      )}

      {/* Power/Toughness or Loyalty */}
      {(face.power || face.loyalty) && (
        <div className="flex justify-end mt-2">
          {face.loyalty ? (
            <LoyaltyDisplay loyalty={face.loyalty} />
          ) : (
            face.power &&
            face.toughness && (
              <div className="font-bold text-lg">
                {face.power}/{face.toughness}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a mana cost as a series of mana symbols.
 * Extracts symbols from the cost string (e.g., "{2}{U}{U}") and renders each as a Symbol component.
 *
 * @param cost - The mana cost string with symbols in curly braces (e.g., "{2}{U}{U}")
 */
export function ManaCost({ cost }: { cost: string }) {
  const symbols = cost.match(/\{[^}]+\}/g) || [];

  return (
    <div className="flex gap-1 items-center">
      {symbols.map((symbol, index) => (
        <Symbol key={index} symbol={symbol.slice(1, -1)} />
      ))}
    </div>
  );
}

/**
 * Renders a planeswalker's starting loyalty value using a mana-font loyalty icon.
 * Displays the loyalty number inside a loyalty shield symbol.
 *
 * @param loyalty - The starting loyalty value as a string (e.g., "3", "4", "5")
 */
function LoyaltyDisplay({ loyalty }: { loyalty: string }) {
  return (
    <div className="flex items-center">
      <i
        className={clsx(
          styles.ms,
          styles["ms-loyalty-start"],
          styles[`ms-loyalty-${loyalty.toLowerCase()}`],
          styles["ms-4x"]
        )}
      />
    </div>
  );
}

/**
 * Renders a single line of rules text, detecting and handling special ability formats:
 * - Planeswalker loyalty abilities (e.g., "+2:", "-3:", "0:")
 * - Saga chapter abilities (e.g., "I —", "II, III —")
 * - Regular rules text with symbols and reminder text
 *
 * @param text - A single line of rules text from the card's oracle text
 */
function RulesTextLine({ text }: { text: string }) {
  // Do not render empty lines
  if (!text || text.trim() === "") return null;

  // Check for saga chapter ability (e.g., "I, II — ability text" or "III — ability text")
  const sagaMatch = text.match(/^([IVX]+(?:,\s*[IVX]+)*)\s*[—−-]\s*(.+)$/);

  if (sagaMatch) {
    const [, chapters, ability] = sagaMatch;
    return <SagaAbility chapters={chapters} ability={ability} />;
  }

  // Check for loyalty ability at the start of the line
  const loyaltyMatch = text.match(/^([+\-−]?\d+|0|X): (.+)$/);

  if (loyaltyMatch) {
    const [, cost, ability] = loyaltyMatch;
    return <LoyaltyAbility cost={cost} ability={ability} />;
  }

  return (
    <p>
      <TextWithSymbols text={text} />
    </p>
  );
}

/**
 * Renders a Saga chapter ability with its chapter icon(s) and ability text.
 * Displays the chapter symbols on the left and the ability description on the right
 * in a flexbox layout. Multiple chapters are stacked vertically.
 *
 * @param chapters - The chapter designation(s) as Roman numerals (e.g., "I", "I, II", "III")
 * @param ability - The ability text that may contain mana symbols and reminder text
 */
function SagaAbility({ chapters, ability }: { chapters: string; ability: string }) {
  // Split multiple chapters (e.g., "I, II" -> ["I", "II"])
  const chapterList = chapters.split(/,\s*/);

  return (
    <p className="flex gap-2 items-center">
      <span className="flex flex-col gap-1">
        {chapterList.map((chapter, index) => (
          <SagaChapter key={index} chapter={chapter.trim()} />
        ))}
      </span>
      <span className="flex-1">
        <TextWithSymbols text={ability} />
      </span>
    </p>
  );
}

/**
 * Renders a planeswalker loyalty ability with its cost symbol and ability text.
 * Displays the loyalty cost icon on the left and the ability description on the right
 * in a flexbox layout.
 *
 * @param cost - The loyalty cost string (e.g., "+2", "-3", "0", "X")
 * @param ability - The ability text that may contain mana symbols and reminder text
 */
function LoyaltyAbility({ cost, ability }: { cost: string; ability: string }) {
  return (
    <p className="flex gap-2 items-center">
      <LoyaltyCost cost={cost} />
      <span className="flex-1">
        <TextWithSymbols text={ability} />
      </span>
    </p>
  );
}

/**
 * Parses text containing mana symbols (e.g., {W}, {2}, {T}) and reminder text (text in parentheses).
 * Splits the text into tokens and renders:
 * - Mana symbols as Symbol components with mana-font icons
 * - Reminder text in italics with reduced opacity (may contain symbols)
 * - Regular text as plain spans
 *
 * @param text - Text that may contain mana symbols {X} and/or reminder text (X)
 */
function TextWithSymbols({ text }: { text: string }) {
  // First split by reminder text (parentheses), capturing them
  const tokens = text.split(/(\([^)]+\))/g).filter((t) => t !== "");

  return (
    <>
      {tokens.map((token, index) => {
        // If it's reminder text, render it in italics but parse symbols within it
        if (token.startsWith("(") && token.endsWith(")")) {
          return (
            <span key={index} className="italic opacity-80">
              <ParseSymbols text={token} />
            </span>
          );
        }
        // Otherwise, parse symbols in regular text
        return <ParseSymbols key={index} text={token} />;
      })}
    </>
  );
}

/**
 * Parses text for mana symbols and renders them as Symbol components.
 * Regular text is rendered as plain spans.
 *
 * @param text - Text that may contain mana symbols {X}
 */
function ParseSymbols({ text }: { text: string }) {
  const tokens = text.split(/(\{[^}]+\})/g).filter((t) => t !== "");

  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith("{") && token.endsWith("}"))
          return <Symbol key={index} symbol={token.slice(1, -1)} />;
        return <span key={index}>{token}</span>;
      })}
    </>
  );
}

/**
 * Renders a Saga chapter symbol using mana-font classes.
 * Converts Roman numerals to Arabic numbers for the CSS class.
 *
 * @param chapter - The chapter as a Roman numeral (e.g., "I", "II", "III")
 */
function SagaChapter({ chapter }: { chapter: string }) {
  const chapterNumber = romanToArabic(chapter);

  return (
    <i
      className={clsx(
        styles.ms,
        styles["ms-saga"],
        styles[`ms-saga-${chapterNumber}`],
        styles["ms-2x"]
      )}
    />
  );
}

/**
 * Renders a planeswalker loyalty cost symbol using mana-font classes.
 * Determines the direction (up, down, zero) based on the cost string and generates
 * appropriate CSS classes (e.g., "ms-loyalty-up ms-loyalty-2" for "+2").
 *
 * @param cost - The loyalty cost string (e.g., "+2", "-3", "0", "X")
 */
function LoyaltyCost({ cost }: { cost: string }) {
  // Determine if it's up, down, or zero
  let direction: "up" | "down" | "zero" = "zero";
  let value = cost;

  if (cost.startsWith("+")) {
    direction = "up";
    value = cost.slice(1);
  } else if (cost.startsWith("-") || cost.startsWith("−")) {
    direction = "down";
    value = cost.slice(1);
  } else if (cost === "0") {
    direction = "zero";
  } else if (cost === "X") {
    direction = "up";
    value = "x";
  }

  return (
    <i
      className={clsx(
        styles.ms,
        styles[`ms-loyalty-${direction}`],
        styles[`ms-loyalty-${value.toLowerCase()}`],
        styles["ms-3x"]
      )}
    />
  );
}

/**
 * Renders a mana or game symbol using mana-font icon classes.
 * Converts MTG symbol notation (e.g., "W", "2", "T") into appropriate CSS classes
 * via the symbolLookup function. Applies cost styling and shadow effects.
 *
 * @param symbol - The symbol content without braces (e.g., "W", "U", "2", "T")
 */
function Symbol({ symbol }: { symbol: string }) {
  return (
    <i
      className={clsx(
        styles.ms,
        styles[symbolLookup(symbol)],
        styles["ms-cost"],
        styles["ms-shadow"]
      )}
    />
  );
}

/**
 * Lookup table for special MTG symbols that require specific mana-font class names.
 * Maps symbol codes to their corresponding CSS class names.
 */
const SYMBOL_LOOKUP: Record<string, string> = {
  t: "ms-tap",
  q: "ms-untap"
};

/**
 * Converts a symbol string into the appropriate mana-font CSS class name.
 * Handles special cases via SYMBOL_LOOKUP, removes slashes for hybrid mana symbols,
 * and falls back to a standard "ms-{symbol}" format for common symbols.
 *
 * @param symbol - The symbol string (e.g., "W", "T", "W/U")
 * @returns The corresponding mana-font CSS class name (e.g., "ms-w", "ms-tap", "ms-wu")
 */
function symbolLookup(symbol: string): string {
  const lower = symbol.toLowerCase().replace("/", "");
  return SYMBOL_LOOKUP[lower] || `ms-${lower}`;
}

/**
 * Converts a Roman numeral to an Arabic number for Saga chapter icons.
 * Supports Roman numerals I through X (1-10).
 *
 * @param roman - The Roman numeral string (e.g., "I", "II", "III", "IV", "V")
 * @returns The Arabic number as a string (e.g., "1", "2", "3", "4", "5")
 */
function romanToArabic(roman: string): string {
  const romanMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10
  };

  return String(romanMap[roman] || 1);
}
