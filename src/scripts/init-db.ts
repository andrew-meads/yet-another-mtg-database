import "dotenv/config";
import mongoose from "mongoose";
import { Card, CardCollectionModel } from "@/db/schema";
import fs from "fs";
import { parser } from "stream-json";
import StreamArray, { streamArray } from "stream-json/streamers/StreamArray";
import { Command } from "commander";
import { Readable } from "stream";

const program = new Command();
program
  .name("init-db")
  .description("Initialize the MongoDB database with card data")
  .version("1.0.0")
  .option("-f, --file <path>", "Path to all-cards.json file")
  .option("--data-url <url>", "URL to download all-cards.json from")
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

    // Create default collections if none exist
    // await createDefaultCollections();

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
 * Supports three input methods: command-line specified file, URL download, or environment variable file path.
 * The pipeline parses JSON and streams individual array elements for memory-efficient processing.
 *
 * @returns A StreamArray pipeline that emits individual card objects
 * @throws Error if both --file and --data-url options are specified, or if no input source is available
 */
async function getReadPipeline(): Promise<StreamArray> {
  if (options.file && options.dataUrl)
    throw new Error("Cannot specify both --file and --data-url options");

  if (options.file) {
    console.log(`Importing cards from file: ${options.file}`);
    return fs.createReadStream(options.file).pipe(parser()).pipe(streamArray());
  }

  if (options.dataUrl) {
    console.log(`Downloading and importing cards from URL: ${options.dataUrl}`);
    const res = await fetch(options.dataUrl);
    if (!res.ok) {
      throw new Error(`Failed to download data from URL: ${res.status} ${res.statusText}`);
    }
    // Convert Web Stream to Node.js stream
    return Readable.fromWeb(res.body as any)
      .pipe(parser())
      .pipe(streamArray());
  }

  if (!process.env.ALL_CARDS_FILE) {
    throw new Error("No input file specified and ALL_CARDS_FILE env variable is not set");
  }

  console.log(`Importing cards from default ALL_CARDS_FILE: ${process.env.ALL_CARDS_FILE}`);
  return fs.createReadStream(process.env.ALL_CARDS_FILE!).pipe(parser()).pipe(streamArray());
}

/**
 * Streams and imports card data from the provided pipeline into MongoDB.
 * Processes cards in batches for efficiency, filtering out variations, digital-only cards,
 * oversized cards, and cards with invalid type_line values.
 * Implements backpressure handling by pausing/resuming the stream during batch inserts.
 *
 * @param pipeline - The StreamArray pipeline that provides card data
 * @returns Promise that resolves when all cards have been processed
 */
async function importCards(pipeline: StreamArray) {
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

        batch.push(data.value);

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
  await Card.deleteMany({});
  console.log("Cleared Card database");
}

/**
 * Ensures at least one default card collection exists in the database.
 * Creates a "My Collection" collection if no collections are found.
 * This provides users with a starting point for organizing their cards.
 */
async function createDefaultCollections() {
  // If CardCollectionModel is empty, create a default "My Collection"
  const collectionCount = await CardCollectionModel.countDocuments();
  if (collectionCount === 0) {
    await CardCollectionModel.create({
      name: "My Collection",
      description: "Main collection",
      collectionType: "collection",
      cards: []
    });
    console.log("Created default 'My Collection' CardCollection");
  }
}

/**
 * Inserts a batch of cards into MongoDB with automatic retry logic for failures.
 * Uses bulk insert for efficiency, then individually retries any failed cards.
 * This handles duplicate key errors and other insertion failures gracefully.
 *
 * @param batch - Array of card objects to insert
 * @param initialProcessedCount - Running count of successfully processed cards
 * @returns Updated count of successfully processed cards
 */
async function insertCards(batch: any[], initialProcessedCount: number = 0) {
  const result = await Card.insertMany(batch, { ordered: false, rawResult: true });
  const insertedCount = result.insertedCount;
  let processedCount = initialProcessedCount + insertedCount;
  console.log(`Processed ${processedCount} cards...`);

  // Check for partial failures
  if (insertedCount !== batch.length) {
    const failedCount = batch.length - insertedCount;
    console.log(`${failedCount} cards in this batch failed, retrying individually...`);

    // Query which cards from the batch were successfully inserted
    const batchCardIds = batch.map((card) => card.id);
    const insertedCards = await Card.find({ id: { $in: batchCardIds } }).select("id");
    const insertedCardIds = new Set(insertedCards.map((card) => card.id));

    // Retry only the cards that failed
    for (const card of batch) {
      // Skip if this card was already inserted
      if (insertedCardIds.has(card.id)) continue;

      try {
        await Card.create(card);
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
