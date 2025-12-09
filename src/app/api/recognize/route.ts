import { NextRequest } from "next/server";
import OpenAI from "openai";
import connectDB from "@/db/mongoose";
import { Card } from "@/db/schema";
import { MtgCard } from "@/types/MtgCard";
import { RecognizedCard } from "@/types/RecognizedCard";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Recognizes a Magic: The Gathering card from an image using OpenAI Vision API.
 *
 * Converts the image blob to base64 format and sends it to OpenAI's Vision model
 * along with a prompt to identify the card.
 *
 * @param image - The card image as a Blob
 * @returns Promise resolving to the recognized card data
 */
async function recognizeCardWithOpenAI(image: Blob): Promise<RecognizedCard> {
  // Convert blob to base64
  const bytes = await image.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const base64Image = buffer.toString("base64");
  const dataUrl = `data:${image.type};base64,${base64Image}`;

  // Call OpenAI Vision API
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: [
          "You are a Magic: The Gathering card recognition assistant.",
          "Analyze the provided card image and identify the card's name, set code (setCode), and collector number (collectorNumber) accurately.",
          "Respond with JSON containing the name, setCode, and collectorNumber.",
          "Remember that some cards (e.g. split cards) may be shown sideways, so take that into account.",
          "When determining a card's set code, prioritize the set symbol visible on the card image (if any), then the artwork style, and finally the collector number format.",
          "If a card is not English, return the English card details instead.",
          "Split cards should return the name of both halves, from left to right, separated by ' // '.",
          "If you cannot identify the card, respond with 'Unknown Card'."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          },
          {
            type: "text",
            text: "What is the name of this Magic: The Gathering card?"
          }
        ]
      }
    ],
    max_tokens: 100
  });

  const rawContent = response.choices[0]?.message?.content || "";

  if (rawContent.includes("Unknown Card")) {
    throw new Error("Card could not be recognized");
  }

  // Remove markdown code block formatting if present
  const jsonContent = rawContent
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  // Parse JSON response
  const parsed = JSON.parse(jsonContent) as RecognizedCard;
  return parsed;
}

/**
 * Validates and extracts the image from the FormData request.
 *
 * @param request - The Next.js request object
 * @returns The image Blob or null if validation fails
 */
async function extractImageFromRequest(request: NextRequest): Promise<Blob | null> {
  const formData = await request.formData();
  const image = formData.get("image");

  if (!image || !(image instanceof Blob)) {
    return null;
  }

  return image;
}

/**
 * Checks if an error is a JSON parsing error that should trigger a retry.
 *
 * @param error - The error to check
 * @returns True if the error is a JSON parsing error
 */
function isJsonParseError(error: unknown): boolean {
  if (error instanceof Error && error.message === "Card could not be recognized") {
    return false;
  }
  return error instanceof SyntaxError || (error instanceof Error && error.message.includes("JSON"));
}

/**
 * Creates an error response for non-retryable API errors.
 *
 * @param error - The error to handle
 * @returns A Response object with appropriate status code and message
 */
function handleApiError(error: unknown): Response {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage === "Card could not be recognized") {
    return Response.json(
      {
        error: "Unable to recognize the card from the image. Please try again with a clearer photo."
      },
      { status: 422 }
    );
  } else if (errorMessage.includes("rate_limit")) {
    return Response.json(
      { error: "OpenAI API rate limit exceeded. Please try again later." },
      { status: 429 }
    );
  } else if (errorMessage.includes("insufficient_quota") || errorMessage.includes("quota")) {
    return Response.json(
      { error: "OpenAI API quota exceeded. Please contact support." },
      { status: 402 }
    );
  } else if (errorMessage.includes("invalid_api_key") || errorMessage.includes("authentication")) {
    return Response.json({ error: "OpenAI API authentication failed." }, { status: 503 });
  } else {
    return Response.json(
      {
        error: "OpenAI API request failed",
        details: errorMessage
      },
      { status: 503 }
    );
  }
}

/**
 * Attempts to recognize a card with retry logic for JSON parsing errors.
 *
 * @param image - The card image to recognize
 * @param maxAttempts - Maximum number of retry attempts
 * @returns The recognized card data or throws an error
 */
async function recognizeCardWithRetry(
  image: Blob,
  maxAttempts: number = 3
): Promise<RecognizedCard> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔍 Recognition attempt ${attempt}/${maxAttempts}...`);
      const recognizedCard = await recognizeCardWithOpenAI(image);
      console.log("🎯 OpenAI Response:", recognizedCard);
      return recognizedCard;
    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Attempt ${attempt} failed:`, error);

      // If it's not a JSON parsing error, throw immediately
      if (!isJsonParseError(error)) {
        console.error("❌ Non-retryable error encountered");
        throw error;
      }

      // If this is a JSON parsing error and not the last attempt, continue to retry
      if (attempt < maxAttempts) {
        console.log(`🔄 Retrying due to JSON parsing error...`);
      }
    }
  }

  // If all attempts failed due to JSON parsing errors
  console.error("❌ All recognition attempts failed due to JSON parsing errors");
  throw new Error(
    `Failed to parse card recognition response after ${maxAttempts} attempts: ${lastError?.message}`
  );
}

/**
 * Searches the database for cards matching the recognized card data.
 *
 * First attempts to find cards matching both name and set code.
 * If no matches found, falls back to searching by name only.
 * Also handles split cards that may be recognized in reverse order.
 * Also searches flavor_name field for alternative card names.
 *
 * @param recognizedCard - The card data from OpenAI recognition
 * @returns Array of matching cards from the database
 */
async function searchForMatchingCards(recognizedCard: RecognizedCard): Promise<MtgCard[]> {
  await connectDB();

  const { name, setCode } = recognizedCard;

  console.log(`🔎 Searching for card: "${name}" in set "${setCode}"`);

  // Check if this is a split card (contains " // ")
  const isSplitCard = name.includes(" // ");
  let reversedName: string | null = null;
  
  if (isSplitCard) {
    // Reverse the split card name (e.g., "Dangerous // Armed" -> "Armed // Dangerous")
    const parts = name.split(" // ");
    reversedName = `${parts[1]} // ${parts[0]}`;
    console.log(`🔀 Split card detected. Also searching for reversed name: "${reversedName}"`);
  }

  // Build query to search for the original name OR reversed name (if split card) OR flavor_name
  const nameQuery = isSplitCard && reversedName
    ? { 
        $or: [
          { name: { $regex: `^${name}$`, $options: "i" } },
          { name: { $regex: `^${reversedName}$`, $options: "i" } },
          { flavor_name: { $regex: `^${name}$`, $options: "i" } },
          { flavor_name: { $regex: `^${reversedName}$`, $options: "i" } }
        ]
      }
    : { 
        $or: [
          { name: { $regex: name, $options: "i" } },
          { flavor_name: { $regex: name, $options: "i" } }
        ]
      };

  const cardsByName = await Card.find({
    ...nameQuery,
    lang: "en"
  }).lean();

  console.log(`✅ Found ${cardsByName.length} card(s) matching name`);

  return cardsByName as MtgCard[];
}

/**
 * POST /api/recognize
 *
 * Receives an image of a Magic: The Gathering card and uses OpenAI Vision API
 * to recognize and identify the card, then searches for matching cards in the database.
 *
 * Request body:
 * - FormData with "image" field containing the card image as a Blob
 *
 * Response:
 * - 200 OK with JSON array of matching cards
 * - 400 Bad Request if image is missing or invalid
 * - 402 Payment Required if OpenAI quota exceeded
 * - 429 Too Many Requests if rate limit exceeded
 * - 500 Internal Server Error if recognition fails after retries
 * - 503 Service Unavailable if OpenAI API is unavailable
 */
export async function POST(request: NextRequest) {
  try {
    // Extract and validate image from request
    const image = await extractImageFromRequest(request);

    if (!image) {
      return Response.json({ error: "No image provided or invalid image format" }, { status: 400 });
    }

    // Log successful upload
    console.log("✅ Image uploaded successfully");
    console.log("Image type:", image.type);
    console.log("Image size:", image.size, "bytes");

    // Recognize card with retry logic
    let recognizedCard: RecognizedCard;
    try {
      recognizedCard = await recognizeCardWithRetry(image);
    } catch (error) {
      // Check if it's a non-retryable API error
      if (!isJsonParseError(error)) {
        return handleApiError(error);
      }

      // If it's a JSON parsing error that exhausted retries
      return Response.json(
        {
          error: "Failed to parse card recognition response after multiple attempts",
          details: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }

    // Search for matching cards in database
    const matchingCards = await searchForMatchingCards(recognizedCard);

    // Return matching cards as JSON
    return Response.json({
      recognized: recognizedCard,
      cards: matchingCards
    });
  } catch (error) {
    console.error("Error processing image recognition:", error);
    return Response.json({ error: "Failed to process image" }, { status: 500 });
  }
}
