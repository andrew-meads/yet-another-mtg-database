import Image from "next/image";
import { NOUGHTY_NAME } from "@/lib/easterEggs";

/**
 * Easter egg: the app mascot, revealed in place of an empty search result when the
 * user searches for "Noughty the Dreadnought" by name (see `isNoughtyQuery`).
 * The favicon is a crop of this same image.
 */
export default function NoughtyEasterEgg() {
  return (
    <div
      data-testid="noughty-easter-egg"
      className="bg-muted/50 flex max-h-full flex-col items-center gap-3 overflow-y-auto rounded-md border p-6 text-center"
    >
      <Image
        src="/noughty.png"
        alt={`${NOUGHTY_NAME}, the app mascot, happily eating a slice of strawberry cake`}
        width={1374}
        height={1145}
        sizes="(max-width: 640px) 80vw, 24rem"
        className="h-auto max-h-[45vh] w-full max-w-sm object-contain"
      />
      <p className="text-lg font-semibold">You found {NOUGHTY_NAME}!</p>
      <p className="text-muted-foreground text-sm">
        Not a card, just the mascot. Noughty has no oracle text, only cake.
      </p>
    </div>
  );
}
