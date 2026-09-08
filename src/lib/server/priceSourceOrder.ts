import { getUserSettingsDoc } from "@/lib/server/userSettings";
import { PriceSourceId, enabledSourceOrder, normalizeSourcePreferences } from "@/lib/priceSources";

/**
 * The price sources a user has enabled, in their chosen priority order (every
 * source in default order when they never customized it).
 */
export async function userPriceSourceOrder(userId: string): Promise<PriceSourceId[]> {
  const doc = await getUserSettingsDoc(userId);
  return enabledSourceOrder(normalizeSourcePreferences(doc?.pricing?.sources));
}
