// MUST be the first non-vitest import: it swaps @/db to the sql.js
// in-memory engine with all migrations applied. The real better-sqlite3
// file DB starts EMPTY in CI ("no such table") — same reason the #94
// search-visibility integration suite uses this harness.
import "@/server/queries/__tests__/integration-setup";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/server/queries/__tests__/integration-setup";
import { domains, pages } from "@/db/schema";
import {
  activateDomain,
  createDomain,
  getDomainBindings,
  getDomainPolicy,
  getDomainScopeMap,
  getServingBindingForHost,
  listAdminDomains,
  markDomainActive,
  setPageDomainScope,
  updateDomainBehavior,
  updateDomainKind,
} from "@/server/domains";
import { normalizeHost } from "@/lib/host-routing";

/**
 * Integration tests for the domains data layer (#85), on the shared
 * in-memory harness. Fixture pages/hosts are dedicated and removed in
 * afterAll so the shared in-memory DB stays clean for other suites.
 */

const FIX_SLUG = "lb-domains-test-page";
const HOSTS = [
  "lb-test-primary.example",
  "lb-test-alias.example",
  "BÜCHER.lb-test.example", // inserted raw; must normalize on read
];

let pageId = -1;
let primaryId = -1;
let aliasId = -1;

async function cleanup() {
  if (pageId !== -1) await db.delete(pages).where(eq(pages.id, pageId));
  for (const h of HOSTS) {
    await db.delete(domains).where(eq(domains.host, normalizeHost(h)));
  }
}

afterAll(cleanup);

describe("domains data layer (#85)", () => {
  it("creates a page + bindings, listing normalizes hosts", async () => {
    await cleanup();

    const page = db
      .insert(pages)
      .values({ slug: FIX_SLUG, title: "Domains test page" })
      .returning()
      .get();
    pageId = page.id;

    primaryId = await createDomain({
      host: normalizeHost(HOSTS[0]),
      pageId,
      kind: "primary",
      behavior: "serve",
    });
    aliasId = await createDomain({
      host: normalizeHost(HOSTS[1]),
      pageId,
      kind: "alias",
      behavior: "redirect_canonical",
    });
    // A row stored un-normalized (as a hand edit or legacy bug might) must
    // still match: the read path re-normalizes. The create action always
    // normalizes, so the raw form is written directly through drizzle.
    const [raw] = await db
      .insert(domains)
      .values({ host: HOSTS[2], pageId, kind: "alias", behavior: "serve", status: "active" })
      .returning({ id: domains.id });
    expect(raw.id).toBeGreaterThan(0);

    const rows = await listAdminDomains();
    const mine = rows.filter((r) => r.pageId === pageId);
    expect(mine).toHaveLength(3);
    expect(mine.map((r) => r.host).sort()).toEqual(
      ["lb-test-alias.example", "lb-test-primary.example", "xn--bcher-kva.lb-test.example"].sort(),
    );
    expect(mine.every((r) => r.scope === "exclusive")).toBe(true);
  });

  it("proxy read path returns bindings joined with the page slug", async () => {
    const bindings = await getDomainBindings();
    const mine = bindings.filter((b) => b.pageId === pageId);
    expect(mine.some((b) => b.host === "lb-test-primary.example" && b.pageSlug === FIX_SLUG)).toBe(true);
  });

  it("scope map reflects hub/exclusive and NULL defaults to exclusive", async () => {
    const bindings = await getDomainBindings();
    await setPageDomainScope(pageId, "hub");
    let map = await getDomainScopeMap(bindings);
    expect(map.get(pageId)).toBe("hub");

    await setPageDomainScope(pageId, "exclusive");
    map = await getDomainScopeMap(bindings);
    expect(map.get(pageId)).toBe("exclusive");
  });

  it("activation flips pending → active; first-hit path does the same", async () => {
    let binding = (await getDomainBindings()).find((b) => b.id === primaryId)!;
    expect(binding.status).toBe("pending");

    await markDomainActive(primaryId);
    binding = (await getDomainBindings()).find((b) => b.id === primaryId)!;
    expect(binding.status).toBe("active");

    // Manual activation action is the same write.
    await activateDomain(aliasId);
    expect((await getDomainBindings()).find((b) => b.id === aliasId)!.status).toBe("active");
  });

  it("getServingBindingForHost normalizes the lookup host", async () => {
    const hit = await getServingBindingForHost("LB-Test-Primary.Example:8443");
    expect(hit?.host).toBe("lb-test-primary.example");
    expect(await getServingBindingForHost("unbound.example")).toBeNull();
    expect(await getServingBindingForHost("")).toBeNull();
  });

  it("behavior/kind updates round-trip", async () => {
    await updateDomainBehavior(aliasId, "redirect_slug");
    await updateDomainKind(aliasId, "primary");
    const rows = await listAdminDomains();
    const alias = rows.find((r) => r.id === aliasId)!;
    expect(alias.behavior).toBe("redirect_slug");
    expect(alias.kind).toBe("primary");
  });

  it("deleting the page cascades its bindings", async () => {
    await db.delete(pages).where(eq(pages.id, pageId));
    pageId = -1; // afterAll must not double-delete
    const leftovers = (await getDomainBindings()).filter((b) =>
      HOSTS.some((h) => b.host === normalizeHost(h)),
    );
    expect(leftovers).toHaveLength(0);
  });

  it("policy defaults match the spec (strict lock, path fallback, www redirect, 301)", async () => {
    const policy = await getDomainPolicy();
    // Defaults hold when the operator never saved domain settings.
    if (process.env.LINKBREEZE_PRIMARY_HOST) {
      expect(policy.primaryHost).toBe(normalizeHost(process.env.LINKBREEZE_PRIMARY_HOST));
    }
    expect(policy.adminLock).toBe("strict");
    expect(policy.unknownFallback).toBe("path");
    expect(policy.wwwPolicy).toBe("redirect");
    expect(policy.canonical).toBe("301");
  });
});
