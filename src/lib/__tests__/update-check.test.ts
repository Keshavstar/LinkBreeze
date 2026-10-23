import { describe, it, expect, vi } from "vitest";
import {
  isNewerVersion,
  normalizeTagVersion,
  newestOf,
  resolveUpdateStatus,
  type UpdateSourceStatus,
} from "@/lib/update-check";

// Mock the DB layer so we don't load better-sqlite3 in unit tests
vi.mock("@/server/queries", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
}));

describe("isNewerVersion", () => {
  it("returns true when latest has higher major", () => {
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
  });

  it("returns true when latest has higher minor", () => {
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
  });

  it("returns true when latest has higher patch", () => {
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false when latest is older (major)", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
  });

  it("returns false when latest is older (minor)", () => {
    expect(isNewerVersion("1.2.0", "1.1.0")).toBe(false);
  });

  it("returns false when latest is older (patch)", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(false);
  });

  it("returns false for unparseable current version", () => {
    expect(isNewerVersion("invalid", "2.0.0")).toBe(false);
  });

  it("returns false for unparseable latest version", () => {
    expect(isNewerVersion("1.0.0", "v2.0")).toBe(false);
  });

  it("returns false for both unparseable", () => {
    expect(isNewerVersion("foo", "bar")).toBe(false);
  });

  it("handles pre-release suffixes (ignores them)", () => {
    expect(isNewerVersion("1.0.0-beta", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "2.0.0-rc1")).toBe(true);
  });
});

describe("normalizeTagVersion", () => {
  it("strips a leading v", () => {
    expect(normalizeTagVersion("v1.4.2")).toBe("1.4.2");
  });

  it("handles an uppercase V", () => {
    expect(normalizeTagVersion("V2.0.0")).toBe("2.0.0");
  });

  it("keeps a bare version untouched", () => {
    expect(normalizeTagVersion("1.4.2")).toBe("1.4.2");
  });

  it("trims a suffix after the numeric core", () => {
    expect(normalizeTagVersion("v1.4.2-beta.1")).toBe("1.4.2");
  });

  it("returns null for garbage tags", () => {
    expect(normalizeTagVersion("release-9")).toBeNull();
    expect(normalizeTagVersion("")).toBeNull();
  });
});

describe("newestOf", () => {
  it("returns the greatest version", () => {
    expect(newestOf(["1.2.0", "1.10.0", "1.3.0"])).toBe("1.10.0");
  });

  it("skips null and unparseable entries", () => {
    expect(newestOf([null, "junk", "1.2.3"])).toBe("1.2.3");
  });

  it("returns null when nothing resolves", () => {
    expect(newestOf([null, undefined, "nope"])).toBeNull();
    expect(newestOf([])).toBeNull();
  });
});

describe("resolveUpdateStatus", () => {
  const source = (overrides: Partial<UpdateSourceStatus> = {}): UpdateSourceStatus => ({
    version: null,
    url: null,
    checkedAt: "2026-10-22T12:00:00.000Z",
    error: null,
    ...overrides,
  });

  it("flags an update when a source is newer", () => {
    const res = resolveUpdateStatus(
      "1.4.1",
      source({ version: "1.4.2", url: "https://example.com/release" }),
      source(),
    );
    expect(res.latestVersion).toBe("1.4.2");
    expect(res.hasUpdate).toBe(true);
  });

  it("picks the newest across both sources", () => {
    const res = resolveUpdateStatus(
      "1.4.1",
      source({ version: "1.4.2" }),
      source({ version: "2.0.0" }),
    );
    expect(res.latestVersion).toBe("2.0.0");
    expect(res.hasUpdate).toBe(true);
  });

  it("reports no update when current equals latest", () => {
    const res = resolveUpdateStatus(
      "1.4.2",
      source({ version: "1.4.2" }),
      source({ version: "1.4.2" }),
    );
    expect(res.hasUpdate).toBe(false);
  });

  it("reports no update when both sources failed", () => {
    const res = resolveUpdateStatus(
      "1.4.1",
      source({ error: "fetch_failed" }),
      source({ error: "fetch_failed_stale" }),
    );
    expect(res.latestVersion).toBeNull();
    expect(res.hasUpdate).toBe(false);
  });
});
