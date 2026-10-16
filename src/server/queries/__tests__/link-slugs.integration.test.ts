/**
 * #96 — redirect slug integration tests: slug CRUD through the real sql.js
 * DB layer, numeric-vs-slug resolution, and slug release on delete.
 */
import { describe, it, expect } from "vitest";
import "./integration-setup";
import * as schema from "@/db/schema";
// Import queries via the @/server/queries alias AFTER integration-setup so
// the vi.mock("@/db") applies — a relative import could bind the real module.
import { db } from "@/server/queries/__tests__/integration-setup";
import {
  createLink as createLinkQuery,
  updateLink as updateLinkQuery,
  deleteLink as deleteLinkQuery,
  getLinkByRef as getLinkByRefQuery,
  isSlugTaken as isSlugTakenQuery,
} from "@/server/queries";

describe("redirect slug CRUD (#96)", () => {
  it("creates a link with a slug and resolves it via getLinkByRef", async () => {
    const link = await createLinkQuery({ title: "Consulting", url: "https://example.com", redirectSlug: "my-consulting" });
    expect(link.redirectSlug).toBe("my-consulting");

    const bySlug = await getLinkByRefQuery("my-consulting");
    expect(bySlug?.id).toBe(link.id);

    // Case-insensitive: slugs are stored lowercase, URLs are matched lowercase.
    const byUpper = await getLinkByRefQuery("MY-Consulting");
    expect(byUpper?.id).toBe(link.id);
  });

  it("resolves numeric refs through the id form, never the slug column", async () => {
    const link = await createLinkQuery({ title: "By id", url: "https://example.com/a", redirectSlug: null });
    const byId = await getLinkByRefQuery(String(link.id));
    expect(byId?.id).toBe(link.id);
    // A numeric ref that matches no id is 404 — it can never leak into a slug.
    expect(await getLinkByRefQuery("999999")).toBeNull();
  });

  it("enforces slug uniqueness", async () => {
    await createLinkQuery({ title: "One", url: "https://example.com/1", redirectSlug: "taken-slug" });
    expect(await isSlugTakenQuery("taken-slug")).toBe(true);
    expect(await isSlugTakenQuery("free-slug")).toBe(false);

    // The UNIQUE index backs it up at the DB level.
    await expect(
      db.insert(schema.links).values({ title: "Two", url: "https://example.com/2", redirectSlug: "taken-slug" }),
    ).rejects.toThrow();
  });

  it("isSlugTaken excludes the link being edited", async () => {
    const link = await createLinkQuery({ title: "Own", url: "https://example.com/own", redirectSlug: "own-slug" });
    expect(await isSlugTakenQuery("own-slug", link.id)).toBe(false);
    expect(await isSlugTakenQuery("own-slug", link.id + 1)).toBe(true);
  });

  it("updating the slug moves the redirect; clearing it removes it", async () => {
    const link = await createLinkQuery({ title: "Movable", url: "https://example.com/m", redirectSlug: "old-slug" });
    await updateLinkQuery(link.id, { redirectSlug: "new-slug" });
    expect(await getLinkByRefQuery("old-slug")).toBeNull();
    expect((await getLinkByRefQuery("new-slug"))?.id).toBe(link.id);

    await updateLinkQuery(link.id, { redirectSlug: null });
    expect(await getLinkByRefQuery("new-slug")).toBeNull();
    // Numeric form still works after the slug is cleared.
    expect((await getLinkByRefQuery(String(link.id)))?.id).toBe(link.id);
  });

  it("a hard delete releases the slug for reuse", async () => {
    const link = await createLinkQuery({ title: "Doomed", url: "https://example.com/d", redirectSlug: "doomed-slug" });
    expect(await isSlugTakenQuery("doomed-slug")).toBe(true);

    await deleteLinkQuery(link.id);
    expect(await isSlugTakenQuery("doomed-slug")).toBe(false);
    expect(await getLinkByRefQuery("doomed-slug")).toBeNull();

    // The freed slug can be assigned to a new link.
    const next = await createLinkQuery({ title: "Reborn", url: "https://example.com/r", redirectSlug: "doomed-slug" });
    expect(next.redirectSlug).toBe("doomed-slug");
  });

  it("deactivated links keep their slug row (302 target, not deleted)", async () => {
    const link = await createLinkQuery({ title: "Paused", url: "https://example.com/p", redirectSlug: "paused-slug", isActive: false });
    const row = await getLinkByRefQuery("paused-slug");
    expect(row?.id).toBe(link.id);
    expect(row?.isActive).toBe(false);
    expect(row?.redirectSlug).toBe("paused-slug");
  });
});
