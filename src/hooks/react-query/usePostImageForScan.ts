"use client";

import { useMutation, UseMutationOptions, UseMutationResult } from "@tanstack/react-query";
import { ScanResponse } from "@/types/ScanResult";

/**
 * Sends a card photo to the scanning API (`POST /api/scan`), which proxies to the
 * external card-scanner backend. The backend detects/de-skews every card in the
 * image and returns ranked Scryfall matches for each.
 *
 * @param image - The photo as a Blob (camera capture or an uploaded file)
 * @returns Promise resolving to the scan results
 * @throws Error if the API request fails or returns an error response
 */
async function postImageForScan(image: Blob): Promise<ScanResponse> {
  const formData = new FormData();
  formData.append("image", image);

  const res = await fetch("/api/scan", {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    const errorMessage = errorData?.error || `Request failed with ${res.status}`;
    throw new Error(errorMessage);
  }

  return res.json();
}

/**
 * React Query mutation hook for card scanning. Accepts a Blob (camera capture or
 * uploaded file) and returns the scanner's results.
 */
export function usePostImageForScan(
  options?: Omit<UseMutationOptions<ScanResponse, Error, Blob>, "mutationFn">
): UseMutationResult<ScanResponse, Error, Blob> {
  return useMutation<ScanResponse, Error, Blob>({
    mutationFn: postImageForScan,
    ...options
  });
}
