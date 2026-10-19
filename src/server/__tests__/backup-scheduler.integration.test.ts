/**
 * Scheduled-backup engine — INTEGRATION against a real (in-memory) SQLite
 * engine + real filesystem.
 *
 * Uses the shared sql.js setup (mocks @/db with a migrated in-memory DB and
 * @/lib/auth with a live session) so the scheduler's full pipeline — settings
 * read → due check → serialize → atomic write → retention → result record —
 * runs end-to-end exactly as it does in production, minus the HTTP layer.
 *
 * BACKUP_DIR must be set before the scheduler module (→ backup-store) is
 * imported, hence the dynamic imports below.
 */
import "../queries/__tests__/integration-setup";

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "lb-backup-sched-"));
process.env.BACKUP_DIR = dir;
process.env.BACKUP_MIN_FREE_MB = "1"; // never trip the guard in these tests

const { db, schema } = await import("@/db");
const { acquireBackupLock, releaseBackupLock } = await import("@/lib/backup-lock");
const {
  runScheduledBackup,
  getBackupOverview,
} = await import("@/server/backup-scheduler");

const SET = (k: string, v: string) =>
  db.insert(schema.settings).values({ key: k, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();

const KV = () =>
  Object.fromEntries(
    db.select().from(schema.settings).all().map((r: { key: string; value: string }) => [r.key, r.value]),
  );

const jsonFiles = () => readdirSync(dir).filter((f) => f.endsWith(".json"));

async function seedContent() {
  // Migrations bootstrap a default page (slug "u"); reuse it instead of
  // inserting a duplicate. Insert a page only when the table is empty.
  const existing = db.select({ id: schema.pages.id }).from(schema.pages).all();
  let pageId: number;
  if (existing.length === 0) {
    await db.insert(schema.pages).values({ slug: "u", title: "Test", isDefault: true }).run();
    pageId = 1;
  } else {
    pageId = existing[0].id;
  }
  await db
    .insert(schema.links)
    .values({ pageId, type: "url", title: "My site", url: "https://example.com" })
    .run();
}

beforeAll(async () => {
  await seedContent();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runScheduledBackup (integration)", () => {
  it("force run: writes a restorable payload and records success", async () => {
    SET("backupEnabled", "true");
    SET("backupRetentionCount", "5");

    const res = await runScheduledBackup(true);

    expect(res).toEqual({ ok: true, code: "ok" });
    const files = jsonFiles();
    expect(files).toHaveLength(1);
    const payload = JSON.parse(readFileSync(path.join(dir, files[0]), "utf8"));
    expect(payload.version).toBe(1);
    expect(payload.links).toHaveLength(1);
    expect(payload.links[0].title).toBe("My site");
    const kv = KV();
    expect(kv.backupLastResult).toBe("ok");
    expect(kv.backupLastRunAt).toBeTruthy();
    // No error marker on success.
    expect(kv.backupLastErrorAt).toBeUndefined();
  });

  it("scheduled run fires only when the slot is uncovered", async () => {
    // Enabled, daily at 00:00, last success 2 days ago → due.
    SET("backupFrequency", "daily");
    SET("backupTimeOfDay", "00:00");
    SET("backupLastRunAt", new Date(Date.now() - 2 * 86_400_000).toISOString());
    const before = jsonFiles().length;

    const res = await runScheduledBackup(false);

    expect(res).toEqual({ ok: true, code: "ok" });
    expect(jsonFiles().length).toBe(before + 1);
    expect(KV().backupLastRunAt).not.toBe(new Date(Date.now() - 2 * 86_400_000).toISOString());
  });

  it("skips silently when disabled", async () => {
    SET("backupEnabled", "false");
    SET("backupLastRunAt", new Date(Date.now() - 30 * 86_400_000).toISOString());
    const before = jsonFiles().length;

    const res = await runScheduledBackup(false);

    expect(res.skipped).toBe(true);
    expect(jsonFiles().length).toBe(before);
  });

  it("skips silently when not yet due", async () => {
    SET("backupEnabled", "true");
    // Ran 1 minute ago — today's 00:00 slot already covered.
    SET("backupLastRunAt", new Date(Date.now() - 60_000).toISOString());
    const before = jsonFiles().length;

    const res = await runScheduledBackup(false);

    expect(res.skipped).toBe(true);
    expect(jsonFiles().length).toBe(before);
  });

  it("honors the 1h error backoff after a failure", async () => {
    SET("backupEnabled", "true");
    SET("backupLastRunAt", new Date(Date.now() - 2 * 86_400_000).toISOString());
    SET("backupLastErrorAt", new Date(Date.now() - 5 * 60_000).toISOString());
    const before = jsonFiles().length;

    const res = await runScheduledBackup(false);

    expect(res.skipped).toBe(true);
    expect(jsonFiles().length).toBe(before);
  });

  it("never runs while the lock is held (backup/restore mutual exclusion)", async () => {
    SET("backupEnabled", "true");
    SET("backupLastRunAt", new Date(Date.now() - 2 * 86_400_000).toISOString());
    SET("backupLastErrorAt", "");
    const before = jsonFiles().length;

    expect(acquireBackupLock()).toBe(true);
    try {
      const res = await runScheduledBackup(false);
      expect(res).toMatchObject({ ok: false, code: "busy" });
      expect(jsonFiles().length).toBe(before);
    } finally {
      releaseBackupLock();
    }
  });

  it("applies retention: keeps only the newest N artifacts", async () => {
    SET("backupRetentionCount", "1");
    // Two older artifacts placed out-of-band; the run must prune to 1 total.
    writeFileSync(path.join(dir, "linkbreeze-backup-20260101T000000.json"), "{}");
    writeFileSync(path.join(dir, "linkbreeze-backup-20260102T000000.json"), "{}");

    const res = await runScheduledBackup(true);

    expect(res.ok).toBe(true);
    const files = jsonFiles();
    expect(files).toHaveLength(1);
    // The kept one is the fresh run, not the seeded stale ones.
    expect(files[0].startsWith(`linkbreeze-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`)).toBe(true);
  });

  it("overview reflects the on-disk state and config", async () => {
    const overview = await getBackupOverview();
    expect(overview.config.enabled).toBe(true);
    expect(overview.config.retention).toBe(1);
    expect(overview.backupDir).toBe(dir);
    expect(overview.backups).toHaveLength(jsonFiles().length);
    expect(overview.lastResult).toBe("ok");
    expect(overview.freeMb === null || overview.freeMb > 0).toBe(true);
  });
});
