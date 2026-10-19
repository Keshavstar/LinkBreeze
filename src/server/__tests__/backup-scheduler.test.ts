/**
 * Scheduled-backup engine — branch coverage for the paths the integration
 * test can't reach (disk guard, demo skip) with fully mocked boundaries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoBlock: vi.fn(() => null as string | null),
  getSettings: vi.fn(async () => ({}) as Record<string, string>),
  updateSetting: vi.fn(async () => {}),
  getBackupPayload: vi.fn(async () => ({ version: 1, links: [] })),
  freeDiskMb: vi.fn(async () => 10_000 as number | null),
  listBackupFiles: vi.fn(async () => [] as Array<{ filename: string }>),
  writeBackupFile: vi.fn(async () => ({ filename: "f", sizeBytes: 1, createdAt: "" })),
  deleteBackupFile: vi.fn(async () => true),
  acquireBackupLock: vi.fn(() => true),
  releaseBackupLock: vi.fn(),
}));

vi.mock("@/lib/demo", () => ({ demoBlock: mocks.demoBlock }));
vi.mock("@/server/queries", () => ({
  getSettings: mocks.getSettings,
  updateSetting: mocks.updateSetting,
}));
vi.mock("@/server/backup-restore", () => ({
  getBackupPayload: mocks.getBackupPayload,
}));
vi.mock("@/lib/backup-store", () => ({
  BACKUP_DIR: "/tmp/x",
  MIN_FREE_MB: 50,
  freeDiskMb: mocks.freeDiskMb,
  listBackupFiles: mocks.listBackupFiles,
  writeBackupFile: mocks.writeBackupFile,
  deleteBackupFile: mocks.deleteBackupFile,
}));
vi.mock("@/lib/backup-lock", () => ({
  acquireBackupLock: mocks.acquireBackupLock,
  releaseBackupLock: mocks.releaseBackupLock,
}));

import { runScheduledBackup } from "@/server/backup-scheduler";
import { BACKUP_SETTING_KEYS } from "@/lib/backup-schedule";

function enabledSettings(extra: Record<string, string> = {}) {
  return {
    [BACKUP_SETTING_KEYS.enabled]: "true",
    [BACKUP_SETTING_KEYS.frequency]: "daily",
    [BACKUP_SETTING_KEYS.timeOfDay]: "00:00",
    [BACKUP_SETTING_KEYS.retention]: "7",
    ...extra,
  };
}

describe("runScheduledBackup — guard branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(enabledSettings());
    mocks.freeDiskMb.mockResolvedValue(10_000);
    mocks.acquireBackupLock.mockReturnValue(true);
  });

  it("skips entirely in demo mode without touching the lock", async () => {
    mocks.demoBlock.mockReturnValueOnce("read-only demo");

    const res = await runScheduledBackup(false);

    expect(res.skipped).toBe(true);
    expect(mocks.acquireBackupLock).not.toHaveBeenCalled();
    expect(mocks.writeBackupFile).not.toHaveBeenCalled();
  });

  it("refuses to write below the free-space floor and records disk_full", async () => {
    mocks.freeDiskMb.mockResolvedValue(10);

    const res = await runScheduledBackup(true);

    expect(res).toEqual({ ok: false, code: "disk_full" });
    expect(mocks.writeBackupFile).not.toHaveBeenCalled();
    expect(mocks.updateSetting).toHaveBeenCalledWith(BACKUP_SETTING_KEYS.lastResult, "disk_full");
    expect(mocks.updateSetting).toHaveBeenCalledWith(BACKUP_SETTING_KEYS.lastErrorAt, expect.any(String));
    expect(mocks.releaseBackupLock).toHaveBeenCalled();
  });

  it("proceeds when the free-space reading is undeterminable (null)", async () => {
    mocks.freeDiskMb.mockResolvedValue(null);

    const res = await runScheduledBackup(true);

    expect(res.ok).toBe(true);
    expect(mocks.writeBackupFile).toHaveBeenCalled();
  });

  it("records write_failed when the file write throws, and releases the lock", async () => {
    mocks.writeBackupFile.mockRejectedValueOnce(new Error("EACCES"));

    const res = await runScheduledBackup(true);

    expect(res).toEqual({ ok: false, code: "write_failed" });
    expect(mocks.updateSetting).toHaveBeenCalledWith(BACKUP_SETTING_KEYS.lastResult, "write_failed");
    expect(mocks.releaseBackupLock).toHaveBeenCalled();
  });

  it("records serialize_failed when payload serialization throws", async () => {
    mocks.getBackupPayload.mockRejectedValueOnce(new Error("db gone"));

    const res = await runScheduledBackup(true);

    expect(res).toEqual({ ok: false, code: "serialize_failed" });
    expect(mocks.writeBackupFile).not.toHaveBeenCalled();
    expect(mocks.releaseBackupLock).toHaveBeenCalled();
  });

  it("deletes stale artifacts beyond retention after a successful run", async () => {
    mocks.getSettings.mockResolvedValue(enabledSettings({ [BACKUP_SETTING_KEYS.retention]: "1" }));
    mocks.listBackupFiles.mockResolvedValue([
      { filename: "new.json" },
      { filename: "old1.json" },
      { filename: "old2.json" },
    ]);

    const res = await runScheduledBackup(true);

    expect(res.ok).toBe(true);
    expect(mocks.deleteBackupFile).toHaveBeenCalledWith("old1.json");
    expect(mocks.deleteBackupFile).toHaveBeenCalledWith("old2.json");
    expect(mocks.updateSetting).toHaveBeenCalledWith(BACKUP_SETTING_KEYS.lastResult, "ok");
    expect(mocks.updateSetting).toHaveBeenCalledWith(BACKUP_SETTING_KEYS.lastRunAt, expect.any(String));
  });

  it("disabled config blocks the scheduled path but never the forced run", async () => {
    mocks.getSettings.mockResolvedValue({ [BACKUP_SETTING_KEYS.enabled]: "false" });

    const skipped = await runScheduledBackup(false);
    expect(skipped.skipped).toBe(true);
    expect(mocks.acquireBackupLock).not.toHaveBeenCalled();

    const forced = await runScheduledBackup(true);
    expect(forced.ok).toBe(true);
  });
});
