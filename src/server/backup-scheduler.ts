import "server-only";

import {
  getSettings,
  updateSetting,
} from "@/server/queries";
import { getBackupPayload } from "@/server/backup-restore";
import {
  BACKUP_DIR,
  MIN_FREE_MB,
  deleteBackupFile,
  freeDiskMb,
  listBackupFiles,
  writeBackupFile,
} from "@/lib/backup-store";
import { acquireBackupLock, releaseBackupLock } from "@/lib/backup-lock";
import {
  BACKUP_ERROR_BACKOFF_MS,
  BACKUP_SETTING_KEYS,
  backupsToDelete,
  isBackupDue,
  parseBackupConfig,
  type BackupConfig,
  type BackupFileMeta,
  type BackupResultCode,
} from "@/lib/backup-schedule";
import { demoBlock } from "@/lib/demo";
import { logError } from "@/lib/errors";

/**
 * Scheduled-backup engine (#83).
 *
 * Opportunistic scheduling, same philosophy as the analytics pruner: no
 * external cron, no timers that die with the process. `maybeRunScheduledBackup()`
 * is called on activity (public pageviews/clicks, admin dashboard/settings
 * loads), throttled to at most one settings-read per minute; a backup runs
 * when the first activity after the preferred time-of-day slot arrives.
 *
 * Concurrency: the backup/restore lock (lib/backup-lock) guarantees never
 * two backups at once and never a backup during a restore.
 */

// ── Trigger ──────────────────────────────────────────────────────────────

let lastTriggerCheck = 0;
const TRIGGER_THROTTLE_MS = 60_000;

/** Fire-and-forget trigger for hot paths (pageviews, clicks, admin loads).
 *  Reads settings at most once per minute; the backup itself runs async so
 *  it never adds latency to the calling request. Never throws. */
export function maybeRunScheduledBackup(): void {
  const now = Date.now();
  if (now - lastTriggerCheck < TRIGGER_THROTTLE_MS) return;
  lastTriggerCheck = now;
  void runScheduledBackup(false).catch((err) => logError("backup-scheduler", err));
}

export interface BackupRunResult {
  ok: boolean;
  code: BackupResultCode;
  /** true when nothing was attempted (disabled, not due, throttled backoff). */
  skipped?: boolean;
}

/**
 * Run one scheduled backup attempt. `force` (the "Run now" button) bypasses
 * the due-check but still honors the lock and the disk guard.
 */
export async function runScheduledBackup(force: boolean): Promise<BackupRunResult> {
  // Demo instances are read-only and ephemeral — scheduled backups would
  // just fill the demo volume with copies of demo data.
  if (demoBlock()) return { ok: false, code: "busy", skipped: true };

  const s = await getSettings();
  const config = parseBackupConfig({
    enabled: s[BACKUP_SETTING_KEYS.enabled],
    frequency: s[BACKUP_SETTING_KEYS.frequency],
    timeOfDay: s[BACKUP_SETTING_KEYS.timeOfDay],
    retention: s[BACKUP_SETTING_KEYS.retention],
  });
  if (!config.enabled && !force) {
    return { ok: false, code: "busy", skipped: true };
  }

  if (!acquireBackupLock()) {
    return { ok: false, code: "busy" };
  }

  const now = Date.now();
  try {
    if (!force) {
      // Back off a failing backup for an hour — a persistent failure (full
      // disk) would otherwise retry on every throttled trigger tick.
      const lastErrorAt = parseMs(s[BACKUP_SETTING_KEYS.lastErrorAt]);
      if (lastErrorAt !== null && now - lastErrorAt < BACKUP_ERROR_BACKOFF_MS) {
        return { ok: false, code: "busy", skipped: true };
      }
      const lastRunAt = parseMs(s[BACKUP_SETTING_KEYS.lastRunAt]);
      if (!isBackupDue(now, lastRunAt, config.frequency, config.timeOfDayMinutes)) {
        return { ok: false, code: "busy", skipped: true };
      }
    }

    // Disk guard: refuse to write when free space is low. A null reading
    // (unstatable volume) can't guard and proceeds.
    const freeMb = await freeDiskMb();
    if (freeMb !== null && freeMb < MIN_FREE_MB) {
      await recordResult("disk_full", false);
      return { ok: false, code: "disk_full" };
    }

    let payload: string;
    try {
      payload = JSON.stringify(await getBackupPayload());
    } catch (err) {
      logError("backup-scheduler:serialize", err);
      await recordResult("serialize_failed", false);
      return { ok: false, code: "serialize_failed" };
    }

    try {
      await writeBackupFile(payload);
    } catch (err) {
      logError("backup-scheduler:write", err);
      await recordResult("write_failed", false);
      return { ok: false, code: "write_failed" };
    }

    // Retention: keep the newest N, delete the rest. Only regex-validated
    // backup artifacts are ever listed, so only those can be deleted here.
    const files = await listBackupFiles();
    for (const stale of backupsToDelete(files, config.retention)) {
      await deleteBackupFile(stale.filename);
    }

    await recordResult("ok", true);
    return { ok: true, code: "ok" };
  } finally {
    releaseBackupLock();
  }
}

/** Run-now entry point used by the server action — lock conflicts surface
 *  as a real "busy" result instead of a silent skip. */
export async function performBackupNow(): Promise<BackupRunResult> {
  return runScheduledBackup(true);
}

async function recordResult(code: BackupResultCode, success: boolean): Promise<void> {
  const now = new Date().toISOString();
  await updateSetting(BACKUP_SETTING_KEYS.lastResult, code);
  if (success) {
    await updateSetting(BACKUP_SETTING_KEYS.lastRunAt, now);
  } else {
    await updateSetting(BACKUP_SETTING_KEYS.lastErrorAt, now);
  }
}

function parseMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// ── Read model for the settings card + dashboard notice ──────────────────

/** Lightweight status for the dashboard notice — no directory listing. */
export interface BackupStatus {
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: BackupResultCode | null;
  lastErrorAt: string | null;
  noticeDismissedAt: string | null;
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const s = await getSettings();
  return {
    enabled: s[BACKUP_SETTING_KEYS.enabled] === "true",
    lastRunAt: s[BACKUP_SETTING_KEYS.lastRunAt] ?? null,
    lastResult: (s[BACKUP_SETTING_KEYS.lastResult] as BackupResultCode) ?? null,
    lastErrorAt: s[BACKUP_SETTING_KEYS.lastErrorAt] ?? null,
    noticeDismissedAt: s[BACKUP_SETTING_KEYS.noticeDismissedAt] ?? null,
  };
}

export interface BackupOverview {
  config: BackupConfig;
  lastRunAt: string | null;
  lastResult: BackupResultCode | null;
  lastErrorAt: string | null;
  noticeDismissedAt: string | null;
  backups: BackupFileMeta[];
  backupDir: string;
  freeMb: number | null;
  minFreeMb: number;
}

export async function getBackupOverview(): Promise<BackupOverview> {
  const s = await getSettings();
  return {
    config: parseBackupConfig({
      enabled: s[BACKUP_SETTING_KEYS.enabled],
      frequency: s[BACKUP_SETTING_KEYS.frequency],
      timeOfDay: s[BACKUP_SETTING_KEYS.timeOfDay],
      retention: s[BACKUP_SETTING_KEYS.retention],
    }),
    lastRunAt: s[BACKUP_SETTING_KEYS.lastRunAt] ?? null,
    lastResult: (s[BACKUP_SETTING_KEYS.lastResult] as BackupResultCode) ?? null,
    lastErrorAt: s[BACKUP_SETTING_KEYS.lastErrorAt] ?? null,
    noticeDismissedAt: s[BACKUP_SETTING_KEYS.noticeDismissedAt] ?? null,
    backups: await listBackupFiles(),
    backupDir: BACKUP_DIR,
    freeMb: await freeDiskMb(),
    minFreeMb: MIN_FREE_MB,
  };
}

/** Dismiss the dashboard failure notice. Re-arms on the NEXT failure only
 *  (dismissal is compared against lastErrorAt), never on a stale one. */
export async function dismissBackupFailureNotice(): Promise<void> {
  await updateSetting(BACKUP_SETTING_KEYS.noticeDismissedAt, new Date().toISOString());
}
