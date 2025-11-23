import connectDB from "@/db/mongoose";
import { TagModel } from "@/db/schema";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const tags = await TagModel.find({}, { label: 1, _id: 0 }).sort({ label: 1 }).lean();
    const labels = tags.map((tag) => tag.label);
    return Response.json({ tags: labels });
  } catch (error) {
    console.error("Error fetching tags:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
