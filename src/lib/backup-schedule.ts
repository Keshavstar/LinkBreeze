/**
 * Scheduled-backup pure logic (#83).
 *
 * No `@/db`, no `node:fs` — everything here is fixture-testable and shared
 * between the server scheduler, the settings actions, and the UI card.
 *
 * Scheduling semantics (opportunistic, no external cron): a backup is due
 * when the latest scheduled slot (the configured time-of-day, stepping back
 * in whole frequency intervals) is NEWER than the last successful run. The
 * trigger fires on the first activity after that moment, so "time of day"
 * means "first activity at or after the preferred time" — never exact.
 */

export type BackupFrequency = "daily" | "weekly" | "monthly";

export const BACKUP_FREQUENCIES: readonly BackupFrequency[] = [
  "daily",
  "weekly",
  "monthly",
] as const;

/** Step between slots, in days. Monthly = 30 days (calendar months would
 *  make the due math DST/length-dependent for no user-visible gain). */
export const FREQUENCY_INTERVAL_DAYS: Record<BackupFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export function isBackupFrequency(v: unknown): v is BackupFrequency {
  return typeof v === "string" && (BACKUP_FREQUENCIES as readonly string[]).includes(v);
}

/** Retention: keep last N backups (issue #83 default). */
export const DEFAULT_BACKUP_RETENTION = 7;
export const MIN_BACKUP_RETENTION = 1;
export const MAX_BACKUP_RETENTION = 52;

/** Settings keys (settings KV table). One key per setting — same shape as
 *  `analyticsRetentionDays`. Result keys are written by the scheduler. */
export const BACKUP_SETTING_KEYS = {
  enabled: "backupEnabled",
  frequency: "backupFrequency",
  timeOfDay: "backupTimeOfDay",
  retention: "backupRetentionCount",
  lastRunAt: "backupLastRunAt",
  lastResult: "backupLastResult",
  lastErrorAt: "backupLastErrorAt",
  noticeDismissedAt: "backupNoticeDismissedAt",
} as const;

/** Result codes stored in `backupLastResult`. Kept as stable wire codes so
 *  the UI can map them to localized strings. */
export type BackupResultCode = "ok" | "disk_full" | "write_failed" | "serialize_failed" | "busy";

/** Don't retry a failing backup more often than this (ms) — a persistent
 *  failure (full disk) otherwise hammers on every throttled trigger tick. */
export const BACKUP_ERROR_BACKOFF_MS = 60 * 60 * 1000;

export interface BackupConfig {
  enabled: boolean;
  frequency: BackupFrequency;
  /** Preferred time of day, minutes since local midnight (0–1439). */
  timeOfDayMinutes: number;
  retention: number;
}

export const DEFAULT_BACKUP_TIME_MINUTES = 3 * 60; // 03:00 local

/** Parse a "HH:MM" string into minutes since midnight. Returns null when
 *  absent or malformed — callers fall back to the default. */
export function parseTimeOfDay(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format minutes-since-midnight back to "HH:MM" (zero-padded, 24h). */
export function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Resolve the effective backup config from raw settings-KV values.
 *  Missing/invalid values fall back to defaults (same pattern as
 *  getAnalyticsRetentionDays). */
export function parseBackupConfig(raw: {
  enabled?: string | null;
  frequency?: string | null;
  timeOfDay?: string | null;
  retention?: string | null;
}): BackupConfig {
  return {
    enabled: raw.enabled === "true",
    frequency: isBackupFrequency(raw.frequency) ? raw.frequency : "daily",
    timeOfDayMinutes:
      parseTimeOfDay(raw.timeOfDay) ?? DEFAULT_BACKUP_TIME_MINUTES,
    retention: /^\d+$/.test(raw.retention ?? "")
      ? Math.min(
          Math.max(Number(raw.retention), MIN_BACKUP_RETENTION),
          MAX_BACKUP_RETENTION,
        )
      : DEFAULT_BACKUP_RETENTION,
  };
}

/**
 * Is a backup due at `nowMs`, given the last SUCCESSFUL run?
 *
 * Scheduled slots land on specific DAYS (UTC day-number anchored, so every
 * process and restart agrees) at the configured local time-of-day: daily =
 * every day, weekly = every 7th day-number (a fixed weekday), monthly =
 * every 30th day-number. The backup is due when a scheduled slot instant
 * lies strictly AFTER the last run and at or before now. A run made after
 * a slot (an activity-triggered early run, or a late one) suppresses that
 * slot until the next one. A backup that has NEVER run is due immediately
 * on the first activity after enabling — no waiting for the clock.
 */
export function isBackupDue(
  nowMs: number,
  lastRunMs: number | null,
  frequency: BackupFrequency,
  timeOfDayMinutes: number,
): boolean {
  if (lastRunMs === null) return true;
  const interval = FREQUENCY_INTERVAL_DAYS[frequency];
  const hours = Math.floor(timeOfDayMinutes / 60);
  const minutes = timeOfDayMinutes % 60;

  const slot = new Date(nowMs);
  slot.setHours(hours, minutes, 0, 0);
  // Step back (max ~interval+1 iterations in practice; the hard cap guards
  // clock corruption) to the most recent scheduled slot at or before now.
  for (let i = 0; i < 400; i++) {
    if (slot.getTime() <= nowMs && isScheduledDay(slot, interval)) break;
    slot.setDate(slot.getDate() - 1);
  }
  if (slot.getTime() > nowMs) return false;
  return lastRunMs < slot.getTime();
}

/** Scheduled days are UTC day-numbers divisible by the interval. Jan 1 1970
 *  (day 0) was a Thursday, so weekly lands on Thursdays; monthly on every
 *  30th day-number. Deterministic, DST-proof, no stored anchor needed. */
function isScheduledDay(d: Date, interval: number): boolean {
  const dayNumber = Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
  return ((dayNumber % interval) + interval) % interval === 0;
}

/** Backup artifact filenames — UTC timestamps keep listings sort-stable
 *  across server timezone moves. `linkbreeze-backup-YYYYMMDDTHHMMSS.json` */
export const BACKUP_FILENAME_RE =
  /^linkbreeze-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.json$/;

export function makeBackupFilename(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `linkbreeze-backup-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(
      d.getUTCDate(),
    )}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`
  );
}

/** Parse a filename back to its creation instant (UTC), null when the name
 *  isn't a backup artifact. Used for listing display. */
export function parseBackupFilename(
  filename: string,
): Date | null {
  const m = BACKUP_FILENAME_RE.exec(filename);
  if (!m) return null;
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ),
  );
}

export interface BackupFileMeta {
  filename: string;
  sizeBytes: number;
  createdAt: string; // ISO
}

/**
 * Given backups sorted NEWEST-first, return the ones to DELETE (everything
 * past the retention window). Pure — the caller performs the unlink.
 */
export function backupsToDelete<T>(newestFirst: T[], retention: number): T[] {
  if (retention < MIN_BACKUP_RETENTION) retention = MIN_BACKUP_RETENTION;
  return newestFirst.slice(retention);
}
