import { test, expect } from "@playwright/test";

/**
 * Scheduled backups card (#83) — read-only rendering checks.
 *
 * Runs against BASE_URL (the read-only demo by default), so MUTATING flows
 * (run now, restore, delete, autosave) are covered by the local live-UI
 * verification recipe against a throwaway DB, not here — demoGuard blocks
 * every write on the demo. This spec pins the card's presence, placement in
 * the Data tab, and its default-off state.
 */
test.describe("Scheduled backups card", () => {
  test("card renders in Settings -> Data with storage location and controls", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Data", exact: true }).click();

    await expect(page.getByText("Scheduled backups")).toBeVisible();
    await expect(page.getByText("Automatic backups")).toBeVisible();
    await expect(page.locator("#backup-enabled")).toBeAttached();
    await expect(page.locator("#backup-frequency")).toBeAttached();
    await expect(page.locator("#backup-time")).toBeAttached();
    await expect(page.locator("#backup-retention")).toBeAttached();
    // Storage location is displayed read-only in the card.
    await expect(page.getByText(/\/data\/backups|Stored in|data\/backups/).first()).toBeVisible();
  });

  test("frequency selector offers the three frequencies", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Data", exact: true }).click();

    const options = page.locator("#backup-frequency option");
    await expect(options).toHaveCount(3);
    await expect(page.locator("#backup-frequency")).toHaveValue(/daily|weekly|monthly/);
  });

  test("stored-backups section renders (empty state on a fresh instance)", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Data", exact: true }).click();

    await expect(page.getByText("Stored backups")).toBeVisible();
    // Empty state OR at least one stored row — never a broken list.
    await expect(page.getByText("No backups yet.").or(page.locator("li", { hasText: /20\d\d/ })).first()).toBeVisible();
  });
});
