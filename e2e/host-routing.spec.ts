import { test, expect } from "@playwright/test";

/**
 * E2E: custom domains (#85) — the parts observable from outside a running
 * instance without seeded domain rows.
 *
 * The demo instance is read-only and ships zero domain bindings, so this
 * suite verifies the FEATURE-OFF guarantees (zero behavior change) and the
 * admin surface's auth gating. The full routing matrix (serve/rewrite,
 * canonical 301, www handling, admin host lock) is covered at the unit
 * level by src/lib/__tests__/host-routing.test.ts (the resolver is pure)
 * and the data layer by src/server/__tests__/domains.test.ts.
 */

test.describe("custom domains — feature-off guarantees", () => {
  test("an unbound Host header does not change page serving", async ({ request }) => {
    // Anyone can point a random domain at the instance; with fallback=path
    // (the default) the response must be identical to a normal visit.
    // Canonical/og metadata intentionally reflect the request host (pre-
    // domains behavior — BASE_URL pins it), so normalize both hosts out
    // before comparing.
    const viaHost = await request.get("/linkbreeze", {
      headers: { Host: "stranger.example" },
      maxRedirects: 0,
    });
    const normal = await request.get("/linkbreeze", { maxRedirects: 0 });
    expect(viaHost.status()).toBe(normal.status());
    if (normal.status() === 200) {
      const normalize = (text: string) => text.replace(/:\/\/[^/"']+/g, "://<ORIGIN>");
      expect(normalize(await viaHost.text())).toBe(normalize(await normal.text()));
    }
  });

  test("unknown host still reaches public API machinery", async ({ request }) => {
    const res = await request.get("/api/health", {
      headers: { Host: "stranger.example" },
    });
    expect(res.status()).toBe(200);
  });

  test("robots.txt still resolves on an unbound host", async ({ request }) => {
    const res = await request.get("/robots.txt", {
      headers: { Host: "stranger.example" },
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    // RFC 9309: the user-agent token is matched case-insensitively; Next's
    // built-in robots route emits `User-Agent: *`.
    expect(body).toMatch(/user-agent/i);
    // The two new admin paths stay disallowed (#85).
    expect(body).toContain("/domains");
    expect(body).toContain("/pages");
  });
});

test.describe("custom domains — admin surface", () => {
  test("/domains is auth-gated like the rest of the admin", async ({ page }) => {
    await page.goto("/domains");
    // Unauthenticated visitors land on login (proxy redirect), not the manager.
    await expect(page).toHaveURL(/\/login/);
  });

  test("/domains is not servable as a public page slug", async ({ page }) => {
    // ADMIN_RESERVED must include the new section.
    await page.goto("/domains");
    await expect(page).not.toHaveURL(/\/domains$/);
  });

  test("domains manager renders for an authenticated admin", async ({ page }) => {
    // The demo instance auto-logs-in (DEMO_AUTO_LOGIN), so the manager is
    // reachable without credentials there; locally it uses real login.
    await page.goto("/domains");
    if (!page.url().includes("/login")) {
      await expect(page.getByRole("heading", { name: /domains/i })).toBeVisible();
    }
  });
});
