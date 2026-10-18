import { describe, expect, it } from "vitest";
import {
  BACKUP_FILENAME_RE,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_BACKUP_TIME_MINUTES,
  FREQUENCY_INTERVAL_DAYS,
  backupsToDelete,
  formatTimeOfDay,
  isBackupDue,
  makeBackupFilename,
  parseBackupConfig,
  parseBackupFilename,
  parseTimeOfDay,
} from "@/lib/backup-schedule";

/** UTC-anchored local instant: new Date(2026, 0, 15, 3, 30) etc. Time-of-day
 *  scheduling is LOCAL time (that's the point — "3am my time"), so tests
 *  construct local Dates and read back with local getters. */
function localTs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe("parseTimeOfDay / formatTimeOfDay", () => {
  it("parses valid HH:MM strings", () => {
    expect(parseTimeOfDay("03:00")).toBe(180);
    expect(parseTimeOfDay("0:05")).toBe(5);
    expect(parseTimeOfDay("23:59")).toBe(1439);
  });

  it("rejects malformed or out-of-range values", () => {
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("12:60")).toBeNull();
    expect(parseTimeOfDay("3pm")).toBeNull();
    expect(parseTimeOfDay("3")).toBeNull();
  });

  it("round-trips through formatTimeOfDay", () => {
    for (const minutes of [0, 5, 60, 180, 1439]) {
      expect(parseTimeOfDay(formatTimeOfDay(minutes))).toBe(minutes);
    }
    expect(formatTimeOfDay(180)).toBe("03:00");
    expect(formatTimeOfDay(0)).toBe("00:00");
  });
});

describe("parseBackupConfig", () => {
  it("falls back to sane defaults for missing settings", () => {
    const config = parseBackupConfig({});
    expect(config.enabled).toBe(false);
    expect(config.frequency).toBe("daily");
    expect(config.timeOfDayMinutes).toBe(DEFAULT_BACKUP_TIME_MINUTES);
    expect(config.retention).toBe(DEFAULT_BACKUP_RETENTION);
  });

  it("parses valid stored values", () => {
    const config = parseBackupConfig({
      enabled: "true",
      frequency: "weekly",
      timeOfDay: "04:30",
      retention: "12",
    });
    expect(config).toEqual({
      enabled: true,
      frequency: "weekly",
      timeOfDayMinutes: 270,
      retention: 12,
    });
  });

  it("treats invalid values as defaults, not as enabled", () => {
    const config = parseBackupConfig({
      enabled: "yes",
      frequency: "hourly",
      timeOfDay: "25:00",
      retention: "999",
    });
    expect(config.enabled).toBe(false);
    expect(config.frequency).toBe("daily");
    expect(config.timeOfDayMinutes).toBe(DEFAULT_BACKUP_TIME_MINUTES);
    // Out-of-range retention clamps to the max instead of the default:
    // an explicit (invalid) large value means the user wanted many.
    expect(config.retention).toBe(52);
  });

  it("respects retention 1 (minimum)", () => {
    expect(parseBackupConfig({ retention: "1" }).retention).toBe(1);
  });
});

describe("isBackupDue", () => {
  it("is due when it has never run and the slot time passed", () => {
    const now = localTs(2026, 10, 18, 3, 5);
    expect(isBackupDue(now, null, "daily", 180)).toBe(true);
  });

  it("is not due before the slot time when the previous slot was covered", () => {
    // Yesterday 23:00 (after yesterday's 03:00 slot); today 02:00 is still
    // before today's 03:00 slot — nothing new to cover.
    const now = localTs(2026, 10, 18, 2, 0);
    expect(isBackupDue(now, localTs(2026, 10, 17, 23, 0), "daily", 180)).toBe(
      false,
    );
  });

  it("is not due when the last run already covered this slot", () => {
    const now = localTs(2026, 10, 18, 9, 0);
    // Ran at 03:05, slot is 03:00 → covered.
    expect(isBackupDue(now, localTs(2026, 10, 18, 3, 5), "daily", 180)).toBe(
      false,
    );
  });

  it("is due again the next day after the slot passes", () => {
    const now = localTs(2026, 10, 19, 3, 1);
    // Last ran yesterday at 03:05; today's 03:00 slot is uncovered.
    expect(isBackupDue(now, localTs(2026, 10, 18, 3, 5), "daily", 180)).toBe(
      true,
    );
  });

  it("an activity-triggered early run suppresses the same slot", () => {
    const now = localTs(2026, 10, 18, 4, 0);
    // First activity after the 03:00 slot ran it at 03:20; later activity
    // the same day must not run it again.
    expect(isBackupDue(now, localTs(2026, 10, 18, 3, 20), "daily", 180)).toBe(
      false,
    );
  });

  it("weekly steps in whole intervals on the anchored weekday", () => {
    // Scan for the scheduled (dayNumber % 7 === 0) days around Oct 2026 —
    // same anchor rule as the implementation, used here to assert spacing.
    const scheduledDay = (y: number, m: number, d: number) =>
      ((Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) % 7) + 7) % 7 === 0;
    // Find the first scheduled day >= Oct 10.
    let slotDay = 10;
    while (!scheduledDay(2026, 10, slotDay)) slotDay++;
    const slot = localTs(2026, 10, slotDay, 3, 0);
    const lastRun = slot + 10 * 60_000; // ran 10 min after the slot

    // One minute before the NEXT slot (slotDay + 7): not due.
    const beforeNext = localTs(2026, 10, slotDay + 7, 2, 59);
    expect(isBackupDue(beforeNext, lastRun, "weekly", 180)).toBe(false);
    // One minute after the next slot: due.
    const afterNext = localTs(2026, 10, slotDay + 7, 3, 1);
    expect(isBackupDue(afterNext, lastRun, "weekly", 180)).toBe(true);
  });

  it("monthly uses 30-day steps on anchored days", () => {
    expect(FREQUENCY_INTERVAL_DAYS.monthly).toBe(30);
    const scheduledDay = (y: number, m: number, d: number) =>
      ((Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) % 30) + 30) % 30 === 0;
    let slotDay = 1;
    while (!scheduledDay(2026, 9, slotDay)) slotDay++;
    const slot = localTs(2026, 9, slotDay, 3, 0);
    const lastRun = slot + 10 * 60_000;

    // The next monthly slot is ~30 days later; just before it: not due.
    const beforeNext = slot + 30 * 86_400_000 - 60_000;
    expect(isBackupDue(beforeNext, lastRun, "monthly", 180)).toBe(false);
    // Just after: due.
    const afterNext = slot + 30 * 86_400_000 + 60_000;
    expect(isBackupDue(afterNext, lastRun, "monthly", 180)).toBe(true);
  });

  it("a run made AFTER the slot pushes the next due slot back correctly", () => {
    // Ran late today at 23:00 for the 03:00 slot. Tomorrow 03:01 must be due.
    const lastRun = localTs(2026, 10, 18, 23, 0);
    expect(isBackupDue(localTs(2026, 10, 19, 3, 1), lastRun, "daily", 180)).toBe(
      true,
    );
  });
});

describe("backup filenames", () => {
  it("makes UTC-stamped filenames", () => {
    const d = new Date(Date.UTC(2026, 9, 18, 3, 4, 5));
    expect(makeBackupFilename(d)).toBe("linkbreeze-backup-20261018T030405.json");
  });

  it("round-trips through parseBackupFilename", () => {
    const d = new Date(Date.UTC(2026, 9, 18, 3, 4, 5));
    const parsed = parseBackupFilename(makeBackupFilename(d));
    expect(parsed?.getTime()).toBe(d.getTime());
  });

  it("rejects non-backup names (no traversal, no junk)", () => {
    expect(BACKUP_FILENAME_RE.test("../../etc/passwd")).toBe(false);
    expect(BACKUP_FILENAME_RE.test("linkbreeze-backup-20261018T030405.json.bak")).toBe(false);
    expect(BACKUP_FILENAME_RE.test("backup.json")).toBe(false);
    expect(BACKUP_FILENAME_RE.test("linkbreeze-backup-2026-10-18.json")).toBe(false);
    expect(parseBackupFilename("backup.json")).toBeNull();
  });
});

describe("backupsToDelete", () => {
  it("keeps the newest N from a newest-first list", () => {
    const files = ["f1", "f2", "f3", "f4", "f5"];
    expect(backupsToDelete(files, 3)).toEqual(["f4", "f5"]);
  });

  it("deletes nothing when under retention", () => {
    expect(backupsToDelete(["f1", "f2"], 7)).toEqual([]);
  });

  it("always keeps at least one", () => {
    expect(backupsToDelete(["f1", "f2"], 0)).toEqual(["f2"]);
  });
});
