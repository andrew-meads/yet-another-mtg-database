import "dotenv/config";
import mongoose from "mongoose";
import { Card } from "@/db/schema";
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
        // Skip variations, digital-only cards, and oversized cards.
        if (data.value?.variation || data.value?.digital || data.value?.oversized) return;

        batch.push(data.value);

        if (batch.length >= BATCH_SIZE) {
          pipeline.pause();

          try {
            await Card.insertMany(batch, { ordered: false });
            processedCount += batch.length;
            console.log(`Processed ${processedCount} cards...`);
            batch = [];
          } catch (error) {
            console.error("Error inserting batch:", error);
          }

          pipeline.resume();
        }
      })
      .on("end", async () => {
        try {
          if (batch.length > 0) {
            await Card.insertMany(batch, { ordered: false });
            processedCount += batch.length;
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
}

run();
