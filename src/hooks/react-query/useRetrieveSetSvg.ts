import { useQuery, UseQueryResult } from "@tanstack/react-query";

/**
 * Fetches the SVG icon for a Magic: The Gathering set by its set code.
 *
 * @param setCode - The set code (e.g., "mkm", "lci", "one")
 * @returns The SVG content as a string
 */
async function fetchSetSvg(setCode: string): Promise<string> {
  const res = await fetch(`/api/sets/${setCode.toLowerCase()}/svg`);
  if (!res.ok) throw new Error(`Failed to fetch SVG for set: ${setCode}`);
  return await res.text();
}

/**
 * React Query hook for fetching and caching set SVG icons.
 *
 * @param setCode - The set code to fetch the SVG for
 * @param options - Optional configuration for enabling/disabling the query
 * @returns UseQueryResult containing the SVG content string
 */
export function useRetrieveSetSvg(
  setCode: string | undefined,
  options?: { enabled?: boolean }
): UseQueryResult<string, Error> {
  return useQuery({
    queryKey: ["setSvg", setCode?.toLowerCase()],
    queryFn: () => fetchSetSvg(setCode!),
    enabled: options?.enabled !== false && !!setCode,
    staleTime: Infinity, // SVGs never change
    gcTime: 1000 * 60 * 60 * 24 // Cache for 24 hours in memory
  });
}
