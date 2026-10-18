import "server-only";

import path from "node:path";
import { statfs, mkdir, readdir, readFile, writeFile, unlink, rename, stat } from "node:fs/promises";
import {
  BACKUP_FILENAME_RE,
  type BackupFileMeta,
} from "@/lib/backup-schedule";

/**
 * Scheduled-backup storage layer (#83) — filesystem only, no `@/db`.
 *
 * Backups live in `BACKUP_DIR` (default `./data/backups`), a sibling of the
 * uploads volume so one Docker volume mapping covers both. Every path that
 * reaches `fs` is either generated here or regex-validated first — there is
 * no user-controlled path traversal surface.
 */

export const BACKUP_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.BACKUP_DIR || "./data/backups",
);

/** Refuse to write when free space drops below this (MB). Env-overridable —
 *  instance sizes vary too much for a single hardcoded floor. */
export const MIN_FREE_MB = (() => {
  const raw = Number(process.env.BACKUP_MIN_FREE_MB);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
})();

export async function ensureBackupDir(): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true });
}

/** Free space on the backup volume in MB, null when it can't be determined
 *  (callers treat null as "can't guard" and proceed). */
export async function freeDiskMb(): Promise<number | null> {
  try {
    const stats = await statfs(BACKUP_DIR);
    return Math.floor((stats.bavail * stats.bsize) / (1024 * 1024));
  } catch {
    return null;
  }
}

/** Serialize + atomically write one backup. Writes to a temp file and renames
 *  so a crash mid-write never leaves a truncated file that looks restorable. */
export async function writeBackupFile(
  payload: string,
): Promise<BackupFileMeta> {
  await ensureBackupDir();
  const filename = backupFilenameNow();
  const finalPath = path.join(BACKUP_DIR, filename);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, finalPath);
  return {
    filename,
    sizeBytes: Buffer.byteLength(payload, "utf8"),
    createdAt: new Date().toISOString(),
  };
}

function backupFilenameNow(): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return (
    `linkbreeze-backup-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(
      d.getUTCDate(),
    )}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`
  );
}

/** List stored backups, newest first. Only files matching the strict backup
 *  filename pattern are listed — anything else in the dir is invisible. */
export async function listBackupFiles(): Promise<BackupFileMeta[]> {
  let names: string[];
  try {
    names = await readdir(BACKUP_DIR);
  } catch {
    return []; // dir doesn't exist yet = no backups
  }
  const metas: BackupFileMeta[] = [];
  for (const filename of names) {
    if (!BACKUP_FILENAME_RE.test(filename)) continue;
    try {
      const st = await stat(path.join(BACKUP_DIR, filename));
      metas.push({
        filename,
        sizeBytes: st.size,
        createdAt: parseCreatedAt(filename, st),
      });
    } catch {
      // File vanished between readdir and stat — skip it.
    }
  }
  metas.sort((a, b) => (a.filename < b.filename ? 1 : -1));
  return metas;
}

/** createdAt from the filename's UTC timestamp (not fs mtime — that changes
 *  on restore/copy). Falls back to mtime only for a stat race, never to a
 *  user-controlled value. */
function parseCreatedAt(filename: string, st: { mtime: Date }): string {
  const m = BACKUP_FILENAME_RE.exec(filename);
  if (!m) return st.mtime.toISOString();
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ),
  ).toISOString();
}

/** Validate a filename against the strict pattern and resolve it inside
 *  BACKUP_DIR. The single gate every by-name fs operation goes through. */
export function validatedBackupPath(filename: string): string | null {
  if (!BACKUP_FILENAME_RE.test(filename)) return null;
  const resolved = path.resolve(BACKUP_DIR, filename);
  if (!resolved.startsWith(BACKUP_DIR + path.sep)) return null;
  return resolved;
}

/** Read one backup's JSON payload by validated filename. Returns null when
 *  the name is invalid or the file is gone. */
export async function readBackupFile(filename: string): Promise<string | null> {
  const p = validatedBackupPath(filename);
  if (!p) return null;
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function deleteBackupFile(filename: string): Promise<boolean> {
  const p = validatedBackupPath(filename);
  if (!p) return false;
  try {
    await unlink(p);
    return true;
  } catch {
    return false;
  }
}
