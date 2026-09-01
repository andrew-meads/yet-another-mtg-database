/**
 * Backfills `released_at` on existing card documents from Scryfall's set list.
 *
 * Cards imported before `released_at` was added to the card schema had the
 * field silently dropped (the schema is strict). This script fetches every set
 * from Scryfall's `GET /sets` and stamps each card with its set's release date:
 *
 *   npm run backfill-release-dates            # only cards missing released_at
 *   npm run backfill-release-dates -- --force # re-stamp every card
 *
 * It is idempotent and safe to re-run; re-running is the recovery path for any
 * mid-run failure. New bulk imports (`init-db`) carry the card-level
 * `released_at` from the Scryfall JSON natively, so this is only needed once to
 * upgrade a pre-existing database.
 *
 * Note: stamping is per SET, so the handful of printings whose card-level
 * `released_at` differs from their set's date (e.g. some promos) get the set
 * date. That's exactly what set-level ordering wants; a later `--clear`
 * re-import replaces them with the exact card-level values.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { CardData } from "@/db/schema";
import { scryfallFetch } from "@/lib/scryfall";
import { extractSetDates } from "@/lib/scryfallSets";
import { Command } from "commander";

const program = new Command();
program
  .name("backfill-release-dates")
  .description("Stamp released_at on existing cards from Scryfall's set list")
  .version("1.0.0")
  .option("--force", "re-stamp all cards, not just those missing released_at")
  .parse(process.argv);

const mongoDbUri = process.env.MONGO_DB_URI;
if (!mongoDbUri) {
  throw new Error("MONGO_DB_URI environment variable is not defined");
}

/** Fetch every set object from Scryfall, following list pagination. */
async function fetchAllSets(): Promise<unknown[]> {
  const baseUrl = process.env.SCRYFALL_API_BASE_URL || "https://api.scryfall.com";
  const sets: unknown[] = [];
  let url: string | null = `${baseUrl}/sets`;

  while (url) {
    const res = await scryfallFetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Scryfall ${url} responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const page = (await res.json()) as { data?: unknown[]; has_more?: boolean; next_page?: string };
    sets.push(...(page.data ?? []));
    url = page.has_more && page.next_page ? page.next_page : null;
  }

  return sets;
}

async function run() {
  const force = Boolean(program.opts().force);

  try {
    await mongoose.connect(mongoDbUri!);
    console.log("Connected to MongoDB");

    console.log("Fetching set list from Scryfall...");
    const setDates = extractSetDates(await fetchAllSets());
    console.log(`Fetched ${setDates.size} sets`);

    let totalModified = 0;
    for (const [code, releasedAt] of setDates) {
      const filter = force
        ? { set: code }
        : { set: code, released_at: { $exists: false as const } };
      const { modifiedCount } = await CardData.updateMany(filter, {
        $set: { released_at: releasedAt }
      });
      if (modifiedCount > 0) {
        totalModified += modifiedCount;
        console.log(`  ${code}: stamped ${modifiedCount} card(s) with ${releasedAt}`);
      }
    }
    console.log(`Stamped ${totalModified} card(s) in total`);

    const missing = await CardData.countDocuments({ released_at: { $exists: false } });
    if (missing > 0) {
      const codes = await CardData.distinct("set", { released_at: { $exists: false } });
      console.warn(
        `${missing} card(s) still missing released_at (unknown set codes: ${codes.join(", ")})`
      );
    } else {
      console.log("All cards have a released_at");
    }
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

run();
