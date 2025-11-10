import "dotenv/config";
import connectDB from "@/db/mongoose";
import { CardCollectionModel } from "@/db/schema";

async function backfillTimestamps() {
  try {
    await connectDB();
    console.log("Connected to database");

    // Find all collections without timestamps
    const collectionsWithoutTimestamps = await CardCollectionModel.find({
      $or: [{ createdAt: { $exists: false } }, { updatedAt: { $exists: false } }]
    }).lean();

    console.log(`Found ${collectionsWithoutTimestamps.length} collections without timestamps`);

    if (collectionsWithoutTimestamps.length === 0) {
      console.log("✓ All collections already have timestamps");
      
      // Check what fields exist
      const allCollections = await CardCollectionModel.find({}).limit(3).lean();
      console.log("Sample collection fields:", allCollections.map(c => {
        const doc = c as any;
        return {
          _id: c._id,
          name: c.name,
          hasCreatedAt: 'createdAt' in c,
          hasUpdatedAt: 'updatedAt' in c,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt
        };
      }));
      
      process.exit(0);
    }

    // Set timestamps for each document using direct MongoDB update
    const now = new Date();
    
    const result = await CardCollectionModel.collection.updateMany(
      {
        $or: [{ createdAt: { $exists: false } }, { updatedAt: { $exists: false } }]
      },
      {
        $set: {
          createdAt: now,
          updatedAt: now
        }
      }
    );

    console.log(`✓ Successfully backfilled timestamps for ${result.modifiedCount} collections`);
    
    // Verify the results
    const sample = await CardCollectionModel.find({}).limit(3).lean();
    console.log("\nSample collections after update:");
    sample.forEach(c => {
      const doc = c as any;
      console.log(`  ${c.name}:`, {
        hasCreatedAt: 'createdAt' in c,
        hasUpdatedAt: 'updatedAt' in c,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      });
    });
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

backfillTimestamps();
