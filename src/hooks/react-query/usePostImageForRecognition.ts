"use client";

import { useMutation, UseMutationOptions, UseMutationResult } from "@tanstack/react-query";
import { MtgCard } from "@/types/MtgCard";
import { RecognizedCard } from "@/types/RecognizedCard";

interface RecognitionResponse {
  recognized: RecognizedCard;
  cards: MtgCard[];
}

/**
 * Sends a card image to the recognition API for processing.
 * 
 * The API uses OpenAI Vision to recognize the card and then searches
 * the database for matching cards.
 * 
 * @param image - The card image as a Blob
 * @returns Promise resolving to recognition results including matched cards
 * @throws Error if the API request fails or returns an error response
 */
async function postImageForRecognition(image: Blob): Promise<RecognitionResponse> {
  const formData = new FormData();
  formData.append("image", image);

  const res = await fetch("/api/recognize", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    const errorMessage = errorData?.error || `Request failed with ${res.status}`;
    throw new Error(errorMessage);
  }

  return res.json();
}

/**
 * React Query mutation hook for card image recognition.
 * 
 * Uploads a card image to the recognition API and returns the recognized
 * card information along with matching cards from the database.
 * 
 * @param options - Optional mutation options (onSuccess, onError, etc.)
 * @returns Mutation object with mutate function and state (isPending, data, error)
 * 
 * @example
 * ```tsx
 * const { mutate, isPending, data } = usePostImageForRecognition({
 *   onSuccess: (data) => {
 *     console.log('Recognized:', data.recognized);
 *     console.log('Matches:', data.cards);
 *   }
 * });
 * 
 * mutate(imageBlob);
 * ```
 */
export function usePostImageForRecognition(
  options?: Omit<UseMutationOptions<RecognitionResponse, Error, Blob>, "mutationFn">
): UseMutationResult<RecognitionResponse, Error, Blob> {
  return useMutation<RecognitionResponse, Error, Blob>({
    mutationFn: postImageForRecognition,
    ...options,
  });
}
