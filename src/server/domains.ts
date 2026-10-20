import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { domains, pages, settings } from "@/db/schema";
import {
  normalizeHost,
  type DomainBinding,
  type DomainPolicy,
  type DomainScope,
} from "@/lib/host-routing";

/**
 * Data access for custom domains (#85). Two consumers:
 *   - src/proxy.ts — the per-request read path (policy + bindings).
 *   - the /domains admin section — CRUD + policy editing.
 *
 * Settings keys (instances that never touch the feature have none of them,
 * so getDomainPolicy() returns pure defaults = current behavior):
 *   domainsPrimaryHost, domainsAdminLock, domainsUnknownFallback,
 *   domainsWwwPolicy, domainsCanonical
 */

// ── Policy ───────────────────────────────────────────────────────────────

export async function getDomainPolicy(): Promise<DomainPolicy> {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));

  // env beats the DB: primary host is deployment topology, like PORT.
  const envHost = normalizeHost(process.env.LINKBREEZE_PRIMARY_HOST);
  const settingsHost = normalizeHost(map.get("domainsPrimaryHost") ?? "");

  const lock = map.get("domainsAdminLock");
  const fallback = map.get("domainsUnknownFallback");
  const www = map.get("domainsWwwPolicy");
  const canonical = map.get("domainsCanonical");

  return {
    primaryHost: envHost || settingsHost || null,
    adminLock: lock === "off" ? "off" : "strict",
    unknownFallback:
      fallback === "404" || fallback === "redirect_primary" ? fallback : "path",
    wwwPolicy: www === "off" || www === "serve" ? www : "redirect",
    canonical: canonical === "tag" || canonical === "off" ? canonical : "301",
  };
}

export async function saveDomainPolicy(partial: {
  primaryHost?: string | null;
  adminLock?: DomainPolicy["adminLock"];
  unknownFallback?: DomainPolicy["unknownFallback"];
  wwwPolicy?: DomainPolicy["wwwPolicy"];
  canonical?: DomainPolicy["canonical"];
}): Promise<void> {
  const entries: Array<[string, string]> = [];
  if (partial.primaryHost !== undefined) {
    entries.push(["domainsPrimaryHost", partial.primaryHost ?? ""]);
  }
  if (partial.adminLock !== undefined) entries.push(["domainsAdminLock", partial.adminLock]);
  if (partial.unknownFallback !== undefined) {
    entries.push(["domainsUnknownFallback", partial.unknownFallback]);
  }
  if (partial.wwwPolicy !== undefined) entries.push(["domainsWwwPolicy", partial.wwwPolicy]);
  if (partial.canonical !== undefined) entries.push(["domainsCanonical", partial.canonical]);

  for (const [key, value] of entries) {
    const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    if (existing[0]) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }
}

// ── Bindings (proxy read path) ───────────────────────────────────────────

/** Every binding joined with its page slug — one indexed query. */
export async function getDomainBindings(): Promise<DomainBinding[]> {
  const rows = await db
    .select({
      id: domains.id,
      host: domains.host,
      pageId: domains.pageId,
      pageSlug: pages.slug,
      kind: domains.kind,
      behavior: domains.behavior,
      status: domains.status,
    })
    .from(domains)
    .innerJoin(pages, eq(pages.id, domains.pageId))
    .orderBy(asc(domains.id));

  return rows.map((r) => ({
    id: r.id,
    // Defensive re-normalization: rows written before a normalization bug
    // fix (or by hand) must never break per-request matching.
    host: normalizeHost(r.host),
    pageId: r.pageId,
    pageSlug: r.pageSlug,
    kind: r.kind as DomainBinding["kind"],
    behavior: r.behavior as DomainBinding["behavior"],
    status: r.status as DomainBinding["status"],
  }));
}

/** pageId → scope for the pages referenced by the given bindings. */
export async function getDomainScopeMap(
  bindings: DomainBinding[],
): Promise<Map<number, DomainScope>> {
  const map = new Map<number, DomainScope>();
  if (bindings.length === 0) return map;
  const pageIds = [...new Set(bindings.map((b) => b.pageId))];
  const rows = await db.select({ id: pages.id, scope: pages.domainScope }).from(pages);
  for (const row of rows) {
    if (pageIds.includes(row.id)) {
      map.set(row.id, row.scope === "hub" ? "hub" : "exclusive");
    }
  }
  return map;
}

/** Flip a pending binding to active on its first real request. */
export async function markDomainActive(id: number): Promise<void> {
  await db.update(domains).set({ status: "active" }).where(eq(domains.id, id));
}

/** The serving binding matching a host (for metadata canonical URLs). */
export async function getServingBindingForHost(
  host: string,
): Promise<DomainBinding | null> {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  const bindings = await getDomainBindings();
  return bindings.find((b) => b.host === normalized && b.behavior === "serve") ?? null;
}

// ── Admin CRUD ───────────────────────────────────────────────────────────

export interface AdminDomainRow extends DomainBinding {
  pageIsPublished: boolean;
  scope: DomainScope;
}

export async function listAdminDomains(): Promise<AdminDomainRow[]> {
  const rows = await db
    .select({
      id: domains.id,
      host: domains.host,
      pageId: domains.pageId,
      pageSlug: pages.slug,
      kind: domains.kind,
      behavior: domains.behavior,
      status: domains.status,
      pageIsPublished: pages.isPublished,
      scope: pages.domainScope,
    })
    .from(domains)
    .innerJoin(pages, eq(pages.id, domains.pageId))
    .orderBy(asc(domains.pageId), asc(domains.kind), asc(domains.id));

  return rows.map((r) => ({
    ...r,
    host: normalizeHost(r.host),
    kind: r.kind as DomainBinding["kind"],
    behavior: r.behavior as DomainBinding["behavior"],
    status: r.status as DomainBinding["status"],
    scope: r.scope === "hub" ? "hub" : "exclusive",
  }));
}

export async function createDomain(input: {
  host: string;
  pageId: number;
  kind: DomainBinding["kind"];
  behavior: DomainBinding["behavior"];
}): Promise<number> {
  const [row] = await db
    .insert(domains)
    .values({
      host: input.host,
      pageId: input.pageId,
      kind: input.kind,
      behavior: input.behavior,
      status: "pending",
    })
    .returning({ id: domains.id });
  return row.id;
}

export async function updateDomainBehavior(
  id: number,
  behavior: DomainBinding["behavior"],
): Promise<void> {
  await db.update(domains).set({ behavior }).where(eq(domains.id, id));
}

export async function updateDomainKind(
  id: number,
  kind: DomainBinding["kind"],
): Promise<void> {
  await db.update(domains).set({ kind }).where(eq(domains.id, id));
}

export async function activateDomain(id: number): Promise<void> {
  await db.update(domains).set({ status: "active" }).where(eq(domains.id, id));
}

export async function deleteDomain(id: number): Promise<void> {
  await db.delete(domains).where(eq(domains.id, id));
}

export async function setPageDomainScope(
  pageId: number,
  scope: DomainScope,
): Promise<void> {
  await db
    .update(pages)
    .set({ domainScope: scope === "hub" ? "hub" : null })
    .where(eq(pages.id, pageId));
}

export async function getDomainByHost(host: string) {
  const rows = await db.select().from(domains).where(eq(domains.host, host)).limit(1);
  return rows[0] ?? null;
}

/**
 * Exclusive-scope guard for slug-parameterized public routes (vCard, wallet
 * passes). A bound host in exclusive scope IS one page — its domain must not
 * hand out other pages' per-slug artifacts. Returns true when the request is
 * fine: unbound/unknown host (no domain logic) or hub scope (all slugs
 * intentionally resolve).
 */
export async function isSlugServedOnHost(
  host: string | null | undefined,
  slug: string,
): Promise<boolean> {
  const normalized = normalizeHost(host);
  if (!normalized) return true;
  const bindings = await getDomainBindings();
  const binding = bindings.find(
    (b) => b.host === normalized && b.behavior === "serve",
  );
  if (!binding) return true;
  const scopeMap = await getDomainScopeMap(bindings);
  if ((scopeMap.get(binding.pageId) ?? "exclusive") === "hub") return true;
  return binding.pageSlug === slug;
}
