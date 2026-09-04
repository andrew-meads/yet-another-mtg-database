import { expect, Page } from "@playwright/test";

export interface OpenEntityRefSeed {
  id: string;
  kind: "collection" | "deck";
  pinned?: boolean;
}

/**
 * Seed which entities are "open" (and pinned) in the app bar before a page
 * loads. Open entities are server-synced user settings (the `openEntities`
 * section of the seeded user's settings doc), so this writes them through the
 * real `PATCH /api/settings` route with the test's session cookie — replacing
 * whatever earlier specs left behind. (The legacy "open-entity-ids"
 * localStorage key is only migrated when the server has no value yet, so
 * seeding it is not reliable once any spec has persisted open entities.)
 */
export async function seedOpenEntities(page: Page, refs: OpenEntityRefSeed[]): Promise<void> {
  const res = await page.request.patch("/api/settings", { data: { openEntities: refs } });
  expect(
    res.ok(),
    `seeding open entities failed: ${res.status()} ${await res.text()}`
  ).toBeTruthy();
}
