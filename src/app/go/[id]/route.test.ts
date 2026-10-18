/**
 * #96 — /go/[id] route behavior: numeric id (unchanged), slug resolution
 * (case-insensitive), unknown ref 404, and a deactivated link WITH a slug
 * 302-redirecting to its public page instead of a bare 404.
 */
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLinkByRef: vi.fn(),
  getPageById: vi.fn(),
  recordClick: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
}));

vi.mock("@/server/queries", () => ({
  getLinkByRef: mocks.getLinkByRef,
  getPageById: mocks.getPageById,
  recordClick: mocks.recordClick,
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, remaining: 59, resetAt: Date.now() + 60000 })),
}));
vi.mock("@/lib/bot-detect", () => ({ isBot: vi.fn(() => false) }));
vi.mock("@/lib/visitor", () => ({
  getVisitorHash: vi.fn(() => "hash"),
  stripReferrer: vi.fn((r: string) => r),
}));

import { GET } from "@/app/go/[id]/route";
import { NextRequest } from "next/server";

function makeRequest(ref: string) {
  return new NextRequest(`http://localhost:3000/go/${ref}`);
}

function activeLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    pageId: 1,
    title: "Link",
    url: "https://example.com",
    isActive: true,
    redirectSlug: null,
    ...overrides,
  };
}

describe("GET /go/[ref] (#96)", () => {
  it("resolves a numeric ref by id (behavior unchanged)", async () => {
    mocks.getLinkByRef.mockResolvedValue(activeLink({ id: 7, url: "https://example.com/x" }));
    const res = await GET(makeRequest("7"), { params: Promise.resolve({ id: "7" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/x");
    expect(mocks.getLinkByRef).toHaveBeenCalledWith("7");
  });

  it("resolves a slug ref and redirects to the link URL", async () => {
    mocks.getLinkByRef.mockResolvedValue(activeLink({ id: 9, url: "https://example.com/y", redirectSlug: "my-consulting" }));
    const res = await GET(makeRequest("my-consulting"), { params: Promise.resolve({ id: "my-consulting" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/y");
  });

  it("resolves slug refs case-insensitively", async () => {
    mocks.getLinkByRef.mockResolvedValue(activeLink({ id: 9, url: "https://example.com/y", redirectSlug: "my-consulting" }));
    const res = await GET(makeRequest("MY-CONSULTING"), { params: Promise.resolve({ id: "MY-CONSULTING" }) });
    expect(res.status).toBe(302);
    expect(mocks.getLinkByRef).toHaveBeenCalledWith("MY-CONSULTING");
  });

  it("404s an unknown ref", async () => {
    mocks.getLinkByRef.mockResolvedValue(null);
    const res = await GET(makeRequest("nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("a deactivated link WITHOUT a slug still 404s", async () => {
    mocks.getLinkByRef.mockResolvedValue(activeLink({ isActive: false, redirectSlug: null }));
    const res = await GET(makeRequest("7"), { params: Promise.resolve({ id: "7" }) });
    expect(res.status).toBe(404);
  });

  it("a deactivated link WITH a slug 302s to its public page", async () => {
    mocks.getLinkByRef.mockResolvedValue(
      activeLink({ isActive: false, redirectSlug: "paused-slug", pageId: 3 }),
    );
    mocks.getPageById.mockResolvedValue({ id: 3, slug: "about-me" });
    const res = await GET(makeRequest("paused-slug"), { params: Promise.resolve({ id: "paused-slug" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/about-me");
    // The click must NOT be recorded — this is not a link click-through.
    expect(mocks.recordClick).not.toHaveBeenCalled();
  });

  it("a deactivated link whose page is gone falls back to 404", async () => {
    mocks.getLinkByRef.mockResolvedValue(
      activeLink({ isActive: false, redirectSlug: "orphan-slug", pageId: 99 }),
    );
    mocks.getPageById.mockResolvedValue(null);
    const res = await GET(makeRequest("orphan-slug"), { params: Promise.resolve({ id: "orphan-slug" }) });
    expect(res.status).toBe(404);
  });
});
