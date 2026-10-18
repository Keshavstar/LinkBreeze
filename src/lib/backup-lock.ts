/**
 * Backup/restore mutual-exclusion flag (#83).
 *
 * An in-process lock: never two backups at once, never a backup during a
 * restore. Both the scheduler (backups) and the restore actions set it for
 * the duration of the operation. This holds for every supported deployment
 * shape (single-process `next start` / plain Docker) — LinkBreeze has no
 * cluster mode, so no cross-process lock is needed.
 */

let busy = false;

/** Try to take the lock. false when a backup or restore is already running. */
export function acquireBackupLock(): boolean {
  if (busy) return false;
  busy = true;
  return true;
}

export function releaseBackupLock(): void {
  busy = false;
}

export function isBackupBusy(): boolean {
  return busy;
}
