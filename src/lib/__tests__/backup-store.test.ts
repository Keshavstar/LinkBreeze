import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// BACKUP_DIR is resolved at module-load time, so the env var must be set
// BEFORE the store module is first imported (hence the dynamic import below).
const dir = mkdtempSync(path.join(tmpdir(), "lb-backup-store-"));
process.env.BACKUP_DIR = dir;

const {
  BACKUP_DIR,
  MIN_FREE_MB,
  writeBackupFile,
  listBackupFiles,
  readBackupFile,
  deleteBackupFile,
  freeDiskMb,
  validatedBackupPath,
} = await import("@/lib/backup-store");

const NAME_A = "linkbreeze-backup-20261018T030000.json";
const NAME_B = "linkbreeze-backup-20261019T030000.json";

describe("backup-store", () => {
  it("resolves BACKUP_DIR from the env override", () => {
    expect(BACKUP_DIR).toBe(dir);
    expect(MIN_FREE_MB).toBeGreaterThanOrEqual(1);
  });

  it("writes a backup atomically with the strict filename", async () => {
    const meta = await writeBackupFile(JSON.stringify({ version: 1 }));
    expect(meta.filename).toMatch(/^linkbreeze-backup-\d{8}T\d{6}\.json$/);
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, meta.filename))).toBe(true);
    // no temp files left behind
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("lists only backup artifacts, newest first", async () => {
    // The write test above created a real timestamp-stamped backup — clear
    // any live-stamped files so the hardcoded oldest/newest fixtures below
    // control the ordering regardless of the wall clock. (This test used to
    // be a date bomb: once "now" moved past the NEWEST fixture's stamp
    // (2026-10-19T03:00Z), the freshly written file always sorted first.)
    for (const f of readdirSync(dir)) {
      if (/^linkbreeze-backup-\d{8}T\d{6}\.json$/.test(f)) rmSync(path.join(dir, f));
    }
    // Out-of-band older + newest files, plus junk that must stay invisible.
    writeFileSync(path.join(dir, NAME_A), '{"old":true}');
    writeFileSync(path.join(dir, NAME_B), '{"new":true}');
    writeFileSync(path.join(dir, "junk.json"), "{}");

    const list = await listBackupFiles();
    const names = list.map((f) => f.filename);
    expect(names).not.toContain("junk.json");
    expect(names.indexOf(NAME_B)).toBeLessThan(names.indexOf(NAME_A));
    expect(list[0].filename).toBe(NAME_B);
  });

  it("derives createdAt from the filename (UTC), not mtime", async () => {
    const list = await listBackupFiles();
    const a = list.find((f) => f.filename === NAME_A);
    expect(a?.createdAt).toBe("2026-10-18T03:00:00.000Z");
  });

  it("reads a stored backup by validated name", async () => {
    const json = await readBackupFile(NAME_A);
    expect(json).toBe('{"old":true}');
  });

  it("returns null for traversal names and missing files", async () => {
    expect(validatedBackupPath("../../etc/passwd")).toBeNull();
    expect(validatedBackupPath(NAME_A)).toBe(path.join(dir, NAME_A));
    expect(await readBackupFile("../../etc/passwd")).toBeNull();
    expect(await readBackupFile("linkbreeze-backup-20200101T000000.json")).toBeNull();
  });

  it("deletes only validated files and reports misses", async () => {
    expect(await deleteBackupFile(NAME_A)).toBe(true);
    expect(existsSync(path.join(dir, NAME_A))).toBe(false);
    expect(await deleteBackupFile("../escape.json")).toBe(false);
    expect(await deleteBackupFile(NAME_A)).toBe(false);
  });

  it("reports free disk space in MB (or null when undeterminable)", async () => {
    const mb = await freeDiskMb();
    expect(mb === null || mb > 0).toBe(true);
  });

  it("round-trips a full payload byte-exact", async () => {
    const payload = JSON.stringify({ version: 1, links: [{ title: "x" }] });
    const meta = await writeBackupFile(payload);
    expect(readFileSync(path.join(dir, meta.filename), "utf8")).toBe(payload);
  });

  it("never overwrites on a same-second collision — suffixes instead", async () => {
    const a = await writeBackupFile('{"first":true}');
    const b = await writeBackupFile('{"second":true}');
    expect(a.filename).not.toBe(b.filename);
    expect(existsSync(path.join(dir, a.filename))).toBe(true);
    expect(existsSync(path.join(dir, b.filename))).toBe(true);
    // Both remain valid, restorable artifacts per the strict pattern.
    expect(await readBackupFile(a.filename)).toBe('{"first":true}');
    expect(await readBackupFile(b.filename)).toBe('{"second":true}');
    // Both list.
    const names = (await listBackupFiles()).map((f) => f.filename);
    expect(names).toContain(a.filename);
    expect(names).toContain(b.filename);
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
