/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import mongoose from "mongoose";
import { CardData } from "@/db/schema";
import { applyCardPrices, extractPrices } from "@/lib/server/cardPrices";
import fs from "fs";
import { Command } from "commander";
import { Duplex, Readable } from "stream";
import { SCRYFALL_HEADERS } from "@/lib/scryfall";
import { createCardStream } from "@/lib/server/scryfallBulkStream";

const program = new Command();
program
  .name("init-db")
  .description("Initialize the MongoDB database with card data")
  .version("1.0.0")
  .option(
    "-f, --file <path>",
    "Path to a Scryfall bulk file (*.jsonl.gz, *.jsonl, or legacy *.json)"
  )
  .option("--data-url <url>", "URL to download a Scryfall bulk file from")
  .option(
    "--bulk-type <type>",
    "Look up the current download URL of a Scryfall bulk-data type (e.g. oracle_cards, default_cards, all_cards) and import it"
  )
  .option("-c, --clear", "Clear existing data before importing", false)
  .parse(process.argv);

const options = program.opts();
console.log(options);

const mongoDbUri = process.env.MONGO_DB_URI;
if (!mongoDbUri) {
  throw new Error("MONGO_DB_URI environment variable is not defined");
}

/**
 * Main entry point for the database initialization script.
 * Connects to MongoDB, optionally clears existing data, creates default collections,
 * and imports card data from a file or URL.
 */
async function run() {
  try {
    await mongoose.connect(mongoDbUri!);
    console.log("Connected to MongoDB");

    // Get pipeline for reading card data
    const pipeline = await getReadPipeline();

    // Clear existing data if --clear flag is set. Do this after getting the pipeline to
    // avoid deleting data then not being able to read the new data.
    if (options.clear) {
      await clearDb();
    } else {
      console.log("Skipping database clear");
    }

    // Import card data
    await importCards(pipeline);
  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

/**
 * Creates a streaming pipeline for reading card data from various sources.
 * Supports four input methods: a local file (--file), a URL download (--data-url),
 * a Scryfall bulk-data type resolved to its current download URL (--bulk-type),
 * or the ALL_CARDS_FILE environment variable. The source is sniffed, so it may
 * be gzipped or not and use Scryfall's current JSON Lines layout (*.jsonl.gz)
 * or the legacy top-level JSON array; cards stream out one at a time.
 *
 * @returns An object stream that emits individual `{ key, value }` card items
 * @throws Error if more than one source option is given, or if none is available
 */
async function getReadPipeline(): Promise<Duplex> {
  const sources = [options.file, options.dataUrl, options.bulkType].filter(Boolean);
  if (sources.length > 1) {
    throw new Error("Specify only one of --file, --data-url, or --bulk-type");
  }

  if (options.file) {
    console.log(`Importing cards from file: ${options.file}`);
    return createCardStream(fs.createReadStream(options.file));
  }

  let dataUrl: string | undefined = options.dataUrl;
  if (options.bulkType) {
    dataUrl = await resolveBulkDownloadUrl(options.bulkType);
    console.log(`Resolved bulk-data type "${options.bulkType}" to ${dataUrl}`);
  }

  if (dataUrl) {
    console.log(`Downloading and importing cards from URL: ${dataUrl}`);
    const res = await fetch(dataUrl, { headers: SCRYFALL_HEADERS });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download data from URL: ${res.status} ${res.statusText}`);
    }
    // Convert Web Stream to Node.js stream. Scryfall serves the .gz with no
    // Content-Encoding, so fetch hands us the compressed bytes; the sniffer
    // gunzips them.
    return createCardStream(Readable.fromWeb(res.body as any));
  }

  if (!process.env.ALL_CARDS_FILE) {
    throw new Error("No input file specified and ALL_CARDS_FILE env variable is not set");
  }

  console.log(`Importing cards from default ALL_CARDS_FILE: ${process.env.ALL_CARDS_FILE}`);
  return createCardStream(fs.createReadStream(process.env.ALL_CARDS_FILE!));
}

/**
 * Ask Scryfall's bulk-data API for the current download URL of a bulk type
 * (file names carry a timestamp and change daily). Scryfall now publishes the
 * JSON Lines file only (`jsonl_download_uri`); the legacy `download_uri` is
 * accepted as a fallback for an older API mirror.
 */
async function resolveBulkDownloadUrl(type: string): Promise<string> {
  const base = process.env.SCRYFALL_API_BASE_URL || "https://api.scryfall.com";
  const res = await fetch(`${base}/bulk-data/${encodeURIComponent(type)}`, {
    headers: SCRYFALL_HEADERS
  });
  if (!res.ok) {
    throw new Error(
      `Scryfall bulk-data lookup for "${type}" failed: ${res.status} ${res.statusText}`
    );
  }
  const body = (await res.json()) as { jsonl_download_uri?: string; download_uri?: string };
  const url = body.jsonl_download_uri ?? body.download_uri;
  if (!url) throw new Error(`Scryfall bulk-data entry "${type}" has no download URL`);
  return url;
}

/**
 * Streams and imports card data from the provided pipeline into MongoDB.
 * Processes cards in batches for efficiency, filtering out variations, digital-only cards,
 * oversized cards, and cards with invalid type_line values.
 * Implements backpressure handling by pausing/resuming the stream during batch inserts.
 *
 * @param pipeline - The card item stream from getReadPipeline
 * @returns Promise that resolves when all cards have been processed
 */
async function importCards(pipeline: Duplex) {
  return new Promise<void>((resolve, reject) => {
    const BATCH_SIZE = 1000;
    let batch: any[] = [];
    let processedCount = 0;

    pipeline
      .on("data", async (data: any) => {
        if (!data.value) return;

        // Skip variations, digital-only cards, and oversized cards.
        if (data.value.variation || data.value.digital || data.value.oversized) return;

        // For now, skip cards without a type_line (I may want to add this back in later)
        if (!data.value.type_line) return;

        // Cards whose type_line is "Card" or "Card // Card" should be skipped.
        if (data.value.type_line === "Card" || data.value.type_line === "Card // Card") {
          return;
        }

        // Prices are kept on the card document exactly as Scryfall delivers them;
        // normalize the six fields and stamp when they were written so the
        // on-demand refresh (getCardPrices) knows they are fresh.
        batch.push({
          ...data.value,
          prices: extractPrices(data.value),
          prices_updated_at: new Date()
        });

        if (batch.length >= BATCH_SIZE) {
          pipeline.pause();

          try {
            processedCount = await insertCards(batch, processedCount);
            batch = [];
          } catch (error: any) {
            batch = [];
            pipeline.destroy(error);
          }

          pipeline.resume();
        }
      })
      .on("end", async () => {
        if (pipeline.destroyed || pipeline.errored) {
          console.log("Stream ended abnormally");
          return;
        }

        try {
          if (batch.length > 0) {
            processedCount = await insertCards(batch, processedCount);
            batch = [];
          }
          console.log(`Completed! Total cards processed: ${processedCount}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (error: any) => {
        console.error("Stream error:", error);
        reject(error);
      });
  });
}

/**
 * Deletes all existing card documents from the database.
 * Used when the --clear flag is specified to start with a clean slate.
 */
async function clearDb() {
  await CardData.deleteMany({});
  console.log("Cleared Card database");
}

/**
 * Inserts a batch of cards into MongoDB with automatic retry logic for failures.
 * Uses bulk insert for efficiency, then individually retries any failed cards.
 * This handles duplicate key errors and other insertion failures gracefully.
 *
 * New cards carry their Scryfall `prices` in the insert itself; cards that
 * already existed (a re-import without --clear) are left as they are EXCEPT
 * for their prices, which are overwritten from the batch so a re-import doubles
 * as a price refresh.
 *
 * Note the driver throws a BulkWriteError when ANY document in an unordered
 * insertMany fails (e.g. duplicate ids on a re-import) even though the other
 * documents were inserted, so that error is caught and the per-card recovery
 * below runs off what actually landed in the collection.
 *
 * @param batch - Array of card objects to insert
 * @param initialProcessedCount - Running count of successfully processed cards
 * @returns Updated count of successfully processed cards
 */
async function insertCards(batch: any[], initialProcessedCount: number = 0) {
  let insertedCount: number;
  try {
    const result = await CardData.insertMany(batch, { ordered: false, rawResult: true });
    insertedCount = result.insertedCount;
  } catch (err: any) {
    insertedCount = err?.insertedDocs?.length ?? err?.result?.insertedCount ?? 0;
    const firstLine = String(err?.message ?? err).split("\n")[0];
    console.log(`Batch insert reported errors (${firstLine}); recovering per card...`);
  }
  let processedCount = initialProcessedCount + insertedCount;
  console.log(`Processed ${processedCount} cards...`);

  // Check for partial failures
  if (insertedCount !== batch.length) {
    const failedCount = batch.length - insertedCount;
    console.log(`${failedCount} cards in this batch failed, retrying individually...`);

    // Query which cards from the batch were successfully inserted
    const batchCardIds = batch.map((card) => card.id);
    const insertedCards = await CardData.find({ id: { $in: batchCardIds } }).select("id");
    const insertedCardIds = new Set(insertedCards.map((card) => card.id));

    // Cards already present (duplicates from a re-import) still get this
    // batch's prices written onto them.
    const refreshed = await applyCardPrices(batch.filter((card) => insertedCardIds.has(card.id)));
    if (refreshed > 0) console.log(`Refreshed prices on ${refreshed} existing cards`);

    // Retry only the cards that failed
    for (const card of batch) {
      // Skip if this card was already inserted
      if (insertedCardIds.has(card.id)) continue;

      try {
        await CardData.create(card);
        processedCount++;
        console.log(`Successfully retried card: ${card?.name} (${card?.id})`);
      } catch (err: any) {
        console.error(`Failed to insert card: ${card?.name} (${card?.id}) - ${err.message}`);
      }
    }
  }

  return processedCount;
}

run();
