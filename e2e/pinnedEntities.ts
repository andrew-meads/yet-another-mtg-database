import { expect, Page } from "@playwright/test";

export interface PinnedEntityRefSeed {
  id: string;
  kind: "collection" | "deck";
}

/**
 * Seed which entities are pinned to the app bar before a page loads. Pins are
 * server-synced user settings (the `pinnedEntities` section of the seeded user's
 * settings doc), so this writes them through the real `PATCH /api/settings`
 * route with the test's session cookie — replacing whatever earlier specs left
 * behind. The active collection/deck needn't be listed: they are always pinned.
 */
export async function seedPinnedEntities(page: Page, refs: PinnedEntityRefSeed[]): Promise<void> {
  const res = await page.request.patch("/api/settings", { data: { pinnedEntities: refs } });
  expect(
    res.ok(),
    `seeding pinned entities failed: ${res.status()} ${await res.text()}`
  ).toBeTruthy();
}
