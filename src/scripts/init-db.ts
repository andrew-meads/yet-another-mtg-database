import "dotenv/config";
import mongoose from "mongoose";
import { Card, CardCollectionModel } from "@/db/schema";
import fs from "fs";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/StreamArray";

const mongoDbUri = process.env.MONGO_DB_URI;
if (!mongoDbUri) {
  throw new Error("MONGO_DB_URI environment variable is not defined");
}

async function run() {
  try {
    await mongoose.connect(mongoDbUri!);
    console.log("Connected to MongoDB");

    await clearDb();
    await importCards();
  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

async function importCards() {
  return new Promise<void>((resolve, reject) => {
    const BATCH_SIZE = 1000;
    let batch: any[] = [];
    let processedCount = 0;

    const pipeline = fs
      .createReadStream(process.env.ALL_CARDS_FILE!)
      .pipe(parser())
      .pipe(streamArray());

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

async function clearDb() {
  await Card.deleteMany({});
  console.log("Cleared Card database");

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
