import { test, expect } from "@playwright/test";

test("my-cards landing lists the seeded collection", async ({ page }) => {
  await page.goto("/my-cards");
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Main Collection" })).toBeVisible({
    timeout: 15_000
  });
});

test("can open the new collection dialog", async ({ page }) => {
  await page.goto("/my-cards");
  await page.getByRole("button", { name: "New Collection" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
