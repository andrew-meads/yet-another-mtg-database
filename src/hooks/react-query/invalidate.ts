import { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates everything that can change when a physical card moves between a
 * collection and/or deck. Cross-kind moves change badges on the "other" side, so
 * we invalidate both collection and deck detail queries (by prefix) plus locations.
 */
export function invalidateCardMembership(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["collection-details"] });
  queryClient.invalidateQueries({ queryKey: ["deck-details"] });
  queryClient.invalidateQueries({ queryKey: ["card-locations"] });
}
