"use client";

import { useMutation, UseMutationResult } from "@tanstack/react-query";

export interface TestAiConnectionResponse {
  ok: boolean;
}

async function testAiConnection(): Promise<TestAiConnectionResponse> {
  const res = await fetch("/api/ai/status/test", { method: "POST" });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Connection test failed" }));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}

/** Fire one tiny completion against the configured endpoint to verify it works. */
export function useTestAiConnection(): UseMutationResult<TestAiConnectionResponse, Error, void> {
  return useMutation({ mutationFn: testAiConnection });
}
