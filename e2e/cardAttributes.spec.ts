import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  mainCollectionId: string;
};

/**
 * Finish/condition chosen in the search page's "applied on add" bar ride along on
 * the add and show up as badges on the collection row (grouped separately from
 * the plain copies).
 */
test("adding a foil, lightly played copy from search shows its badges in the collection", async ({
  page
}) => {
  await page.goto("/search");
  await page.getByPlaceholder(/Try:|Search/).fill("Grizzly Bears");
  const row = page
    .getByTestId(/^search-card-/)
    .filter({ hasText: "Grizzly Bears" })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  await page.getByRole("combobox", { name: "Finish" }).click();
  await page.getByRole("option", { name: "Foil", exact: true }).click();
  await page.getByRole("combobox", { name: "Condition" }).click();
  await page.getByRole("option", { name: /LP — Lightly Played/ }).click();

  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/physical-cards")
  );
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Add to active collection/ }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  expect(res.request().postDataJSON()).toMatchObject({ finish: "foil", condition: "LP" });

  await page.goto(`/my-cards/collections/${fixtures.mainCollectionId}`);
  const collectionRow = page
    .getByTestId(/^collection-row-/)
    .filter({ hasText: "Grizzly Bears" })
    .filter({ has: page.getByTestId("card-attribute-badges") });
  await expect(collectionRow).toBeVisible({ timeout: 30_000 });
  await expect(collectionRow.getByTestId("card-attribute-badges")).toContainText("Foil");
  await expect(collectionRow.getByTestId("card-attribute-badges")).toContainText("LP");
});
