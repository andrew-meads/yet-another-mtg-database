import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  mainCollectionId: string;
};

test("search results always show each card's price with an age indicator", async ({ page }) => {
  await page.goto("/search");
  const row = page.getByTestId("search-card-e2e-shivan");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByTestId("price-tag")).toHaveText(/\$12\.50/);
  await expect(row.getByTestId("price-tag").locator("[data-age-level]")).toHaveAttribute(
    "data-age-level",
    "fresh"
  );
  // A card Scryfall has no price for shows a dash, still with the age dot.
  await expect(page.getByTestId("search-card-e2e-llanowar").getByTestId("price-tag")).toHaveText(
    /—/
  );
});

test("the selected-card panel lists the printing's prices", async ({ page }) => {
  await page.goto("/search");
  await page.getByTestId("search-card-e2e-grizzly").click();
  // Prices live on their own tab of the card panel (Text is the default).
  await page.getByRole("tab", { name: "Prices" }).click();
  const panel = page.getByTestId("card-prices-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Non-foil");
  await expect(panel).toContainText("$0.25");
  await expect(panel).toContainText("Foil");
  await expect(panel).toContainText("$1.75");
  await expect(panel).toContainText(/updated (just now|\d+ minutes? ago)/);
});

test("the collection price toggle reveals per-row prices and the total value", async ({ page }) => {
  await page.goto(`/my-cards/collections/${fixtures.mainCollectionId}`);
  await expect(page.getByTestId(/^collection-row-/).first()).toBeVisible({ timeout: 30_000 });
  expect(await page.getByTestId("price-tag").count()).toBe(0);

  await page.getByRole("button", { name: "Show prices" }).click();
  await expect(page.getByText("Price", { exact: true })).toBeVisible();
  const value = page.getByTestId("collection-value");
  await expect(value).toBeVisible();
  await expect(value).toContainText("$");
  // The two loose Grizzly Bears copies were priced for their own finish + condition ($0.30 each,
  // fresh), so the row shows the copy price, not the printing's $0.25 estimate.
  const grizzly = page.getByTestId(/^collection-row-e2e-grizzly/).first();
  await expect(grizzly.getByTestId("price-tag")).toHaveText(/\$0\.30/);
  await expect(grizzly.getByTestId("price-tag")).toHaveAttribute("data-price-kind", "copy");
  await expect(grizzly.getByTestId("price-tag").locator("[data-age-level]")).toHaveAttribute(
    "data-age-level",
    "fresh"
  );
  // A row whose copies were never priced shows the printing's price as a stale estimate.
  const shivan = page.getByTestId(/^collection-row-e2e-shivan/).first();
  await expect(shivan.getByTestId("price-tag")).toHaveText(/\$12\.50/);
  await expect(shivan.getByTestId("price-tag")).toHaveAttribute("data-price-kind", "estimate");
  await expect(shivan.getByTestId("price-tag").locator("[data-age-level]")).toHaveAttribute(
    "data-age-level",
    "stale"
  );

  // The toggle is remembered on this device.
  await page.reload();
  await expect(page.getByRole("button", { name: "Show prices" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 30_000 }
  );
});

test("the refresh icon re-fetches a card's price and updates the row in place", async ({
  page
}) => {
  // Stand in for the price sources: the app's refresh route is answered here, so
  // the test needs no network and can assert the new price flows back into the
  // row. A real refresh also stores the price, so once it has happened the quotes
  // route must report it too — otherwise the client's post-refresh refetch would
  // "restore" the seeded price, which no real server would do.
  const refreshed = {
    usd: "99.00",
    usd_foil: null,
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null
  };
  let didRefresh = false;
  await page.route("**/api/cards/prices/refresh", async (route) => {
    const body = route.request().postDataJSON() as { ids: string[] };
    expect(body.ids).toEqual(["e2e-shivan"]);
    didRefresh = true;
    await route.fulfill({
      json: {
        prices: { "e2e-shivan": refreshed },
        updatedAt: { "e2e-shivan": new Date().toISOString() }
      }
    });
  });
  await page.route(
    (url) => url.pathname === "/api/cards/prices",
    (route) => {
      if (!didRefresh) return route.continue();
      // Answer from the fake store (no proxying, so nothing outlives the test).
      const ids = (route.request().postDataJSON() as { ids: string[] }).ids;
      const stamp = new Date().toISOString();
      return route.fulfill({
        json: {
          prices: ids.includes("e2e-shivan") ? { "e2e-shivan": refreshed } : {},
          updatedAt: ids.includes("e2e-shivan") ? { "e2e-shivan": stamp } : {}
        }
      });
    }
  );

  await page.goto("/search");
  const row = page.getByTestId("search-card-e2e-shivan");
  await expect(row.getByTestId("price-tag")).toHaveText(/\$12\.50/, { timeout: 30_000 });

  await row.getByRole("button", { name: "Refresh price" }).click();
  await expect(row.getByTestId("price-tag")).toHaveText(/\$99\.00/);
  // Refreshing must not select the row.
  await expect(page.getByTestId("card-prices-panel")).toHaveCount(0);
});

test("a failed refresh leaves the price alone and reports the error", async ({ page }) => {
  await page.route("**/api/cards/prices/refresh", (route) =>
    route.fulfill({
      status: 502,
      json: { error: "Failed to refresh prices from any price source" }
    })
  );
  await page.goto("/search");
  const row = page.getByTestId("search-card-e2e-shivan");
  await expect(row.getByTestId("price-tag")).toHaveText(/\$12\.50/, { timeout: 30_000 });

  await row.getByRole("button", { name: "Refresh price" }).click();
  await expect(page.getByText(/Couldn't refresh price/)).toBeVisible();
  await expect(row.getByTestId("price-tag")).toHaveText(/\$12\.50/);
});

test("a collection row's refresh icon prices its copies by finish and condition", async ({
  page
}) => {
  let posted: { physicalCardIds: string[] } | null = null;
  await page.route("**/api/physical-cards/prices/refresh", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { prices: {}, unknown: [] } });
  });
  await page.goto(`/my-cards/collections/${fixtures.mainCollectionId}`);
  await expect(page.getByTestId(/^collection-row-/).first()).toBeVisible({ timeout: 30_000 });
  // Persisted from the previous test; make sure it is on either way.
  const toggle = page.getByRole("button", { name: "Show prices" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();

  // Earlier specs may have moved one Grizzly copy into a deck, so the first row's
  // copy count varies; what matters is that the row's own copies were posted.
  const grizzly = page.getByTestId(/^collection-row-e2e-grizzly/).first();
  await grizzly.getByRole("button", { name: "Refresh price" }).click();
  await expect.poll(() => posted !== null).toBe(true);
  expect(posted!.physicalCardIds.length).toBeGreaterThanOrEqual(1);
  expect(posted!.physicalCardIds.every((id) => /^[0-9a-f]{24}$/.test(id))).toBe(true);
});

test("clicking a collection row shows that row's copies' price in the card panel", async ({
  page
}) => {
  await page.goto(`/my-cards/collections/${fixtures.mainCollectionId}`);
  const grizzly = page.getByTestId(/^collection-row-e2e-grizzly/).first();
  await expect(grizzly).toBeVisible({ timeout: 30_000 });
  await grizzly.click();
  await page.getByRole("tab", { name: "Prices" }).click();

  const copies = page.getByTestId("your-copies");
  await expect(copies).toBeVisible();
  await expect(copies).toHaveAttribute("data-price-kind", "copy");
  await expect(copies).toContainText("in Main Collection");
  await expect(page.getByTestId("your-copies-price")).toContainText("$0.30");
  await expect(copies.locator("[data-age-level]")).toHaveAttribute("data-age-level", "fresh");
  await expect(page.getByText("This printing")).toBeVisible();

  // Selecting a plain search result drops the copy block again (the Prices tab is remembered).
  await page.goto("/search");
  await page.getByTestId("search-card-e2e-grizzly").click();
  await expect(page.getByTestId("card-prices-panel")).toBeVisible();
  await expect(page.getByTestId("your-copies")).toHaveCount(0);
});
