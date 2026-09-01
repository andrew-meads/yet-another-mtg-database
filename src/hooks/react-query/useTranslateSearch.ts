"use client";

import { useMutation, UseMutationResult } from "@tanstack/react-query";

export interface TranslateSearchRequest {
  prompt: string;
}

export interface TranslateSearchResponse {
  query: string;
  notes?: string;
}

/** Error payload for a 502: what the model actually said, for diagnostics. */
interface TranslateSearchErrorBody {
  error?: string;
  /** Why the reply was rejected (e.g. "AI response did not contain a JSON object"). */
  detail?: string;
  /** The model's finish reason ("length" usually means the token budget ran out). */
  finishReason?: string;
  /** The (trimmed) raw model reply. */
  raw?: string;
}

/** Exported for tests. */
export function buildErrorMessage(status: number, body: TranslateSearchErrorBody): string {
  let message = body.error || `Request failed with status ${status}`;
  if (body.detail) message += ` ${body.detail}.`;
  if (body.finishReason && body.finishReason !== "stop") {
    message += ` Finish reason: ${body.finishReason}.`;
  }
  if (body.raw !== undefined) {
    message +=
      body.raw.trim() === ""
        ? " The model returned no text."
        : ` Raw reply: “${body.raw.length > 200 ? `${body.raw.slice(0, 200)}…` : body.raw}”`;
  }
  return message;
}

async function translateSearch(body: TranslateSearchRequest): Promise<TranslateSearchResponse> {
  const res = await fetch("/api/ai/translate-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorData: TranslateSearchErrorBody = await res
      .json()
      .catch(() => ({ error: "Failed to translate search" }));
    throw new Error(buildErrorMessage(res.status, errorData));
  }

  return res.json();
}

/**
 * Translate a natural-language card request into the app's search syntax via
 * the AI endpoint. The resulting query string is meant to be inserted into the
 * search bar (editable) and run through the normal search pipeline.
 */
export function useTranslateSearch(): UseMutationResult<
  TranslateSearchResponse,
  Error,
  TranslateSearchRequest
> {
  return useMutation({ mutationFn: translateSearch });
}
