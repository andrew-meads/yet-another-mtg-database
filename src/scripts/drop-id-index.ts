import "dotenv/config";
import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";

async function dropIdIndex() {
  try {
    await connectDB();
    console.log("Connected to database");

    // Get all indexes
    const indexes = await CardCollectionModel.collection.getIndexes();
    console.log("Current indexes:", JSON.stringify(indexes, null, 2));

    // Drop the id_1 index if it exists
    try {
      await CardCollectionModel.collection.dropIndex("id_1");
      console.log("✓ Successfully dropped id_1 index");
    } catch (error: any) {
      if (error.codeName === "IndexNotFound") {
        console.log("Index id_1 does not exist (already dropped or never existed)");
      } else {
        throw error;
      }
    }

    // Show remaining indexes
    const remainingIndexes = await CardCollectionModel.collection.getIndexes();
    console.log("Remaining indexes:", JSON.stringify(remainingIndexes, null, 2));

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

dropIdIndex();
