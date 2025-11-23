import { useQuery, UseQueryResult } from "@tanstack/react-query";

async function retrieveTags(): Promise<string[]> {
  const res = await fetch("/api/tags");
  if (!res.ok) throw new Error("Failed to fetch tags");
  const data = await res.json();
  return data.tags as string[];
}

export function useRetrieveTags(): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: ["tags"],
    queryFn: retrieveTags,
  });
}
