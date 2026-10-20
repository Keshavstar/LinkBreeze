import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for LinkBreeze.
 *
 * Tests run against the live demo instance (Docker container on port 3010).
 * This avoids needing better-sqlite3 to work natively on the dev machine.
 *
 * The demo DB is read-only (DEMO_MODE), so tests verify read paths and
 * the public-facing UI. Write-path tests use the API with auth cookies.
 *
 * To run locally:
 *   npx playwright test
 *
 * In CI, set BASE_URL to point at a preview deployment.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3010",
    trace: "on-first-retry",
    headless: true,
    // Local boxes without the Playwright browser download can point at the
    // system chromium: PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
            args: ["--no-sandbox"],
          },
        }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
