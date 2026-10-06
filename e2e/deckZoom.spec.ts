import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const fixtures = JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf-8")) as {
  skDeckId: string;
  skMaybeCardId: string;
};

// Zoom is device-local (localStorage), so this spec touches no server data.
test("the zoom slider resizes the deck's cards, snaps to 100%, and persists", async ({ page }) => {
  const { skDeckId, skMaybeCardId } = fixtures;
  await page.goto(`/my-cards/decks/${skDeckId}`);

  const card = page.getByTestId(`deck-card-${skMaybeCardId}`);
  const value = page.getByTestId("deck-zoom-value");
  const thumb = page.getByRole("slider", { name: "Zoom" });
  await expect(value).toHaveText("100%", { timeout: 15_000 });
  await expect(card).toHaveCSS("width", "146px");

  // Keyboard: End is 200%, Home is 20%.
  await thumb.focus();
  await page.keyboard.press("End");
  await expect(value).toHaveText("200%");
  await expect(card).toHaveCSS("width", "292px");
  await page.keyboard.press("Home");
  await expect(value).toHaveText("20%");
  await expect(card).toHaveCSS("width", "29px");

  // Pointer: dropping the thumb just off the middle of the track snaps to 100%.
  const track = (await page.locator('[data-slot="slider"]').boundingBox())!;
  const thumbBox = (await thumb.boundingBox())!;
  const y = track.y + track.height / 2;
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2 + 4, y, { steps: 5 });
  await page.mouse.up();
  await expect(value).toHaveText("100%");

  // ...but further out it doesn't.
  await page.mouse.move(track.x + track.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.85, y, { steps: 5 });
  await page.mouse.up();
  await expect(value).not.toHaveText("100%");
  const zoomed = await value.textContent();

  // The zoom survives a reload; the percentage button resets it.
  await page.reload();
  await expect(value).toHaveText(zoomed!, { timeout: 15_000 });
  await value.click();
  await expect(value).toHaveText("100%");
  await expect(card).toHaveCSS("width", "146px");
});
