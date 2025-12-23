import "dotenv/config";
import mongoose from "mongoose";
import { UserModel } from "@/db/schema";
import { Command } from "commander";

const program = new Command();
program
  .name("whitelist-user")
  .description("Add a user to the whitelist")
  .version("1.0.0")
  .argument("<email>", "Email address of the user to whitelist")
  .parse(process.argv);

const mongoDbUri = process.env.MONGO_DB_URI;
if (!mongoDbUri) {
  throw new Error("MONGO_DB_URI environment variable is not defined");
}

async function run() {
  try {
    await mongoose.connect(mongoDbUri!);
    console.log("Connected to MongoDB");

    const emailAddress = program.args[0];
    
    if (!emailAddress) {
      console.error("Error: Email address is required");
      program.help();
    }
    
    console.log(`Whitelisting user: ${emailAddress}`);

    const userExists = (await UserModel.countDocuments({ emailAddress })) > 0;
    if (userExists) return console.log("User already whitelisted");

    const user = new UserModel({ emailAddress });
    await user.save();
    console.log("User whitelisted successfully");
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

run();