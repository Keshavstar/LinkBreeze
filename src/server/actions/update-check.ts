"use server";

import { getSession } from "@/lib/auth";
import { checkForUpdates, setUpdateCheckEnabled } from "@/lib/update-check";

/**
 * Manual refresh — bypasses the 24h cache.
 */
export async function refreshUpdateCheck() {
  if (!(await getSession())) {
    throw new Error("Unauthorized");
  }
  return checkForUpdates(true);
}

/**
 * Toggle update checks on/off.
 */
export async function toggleUpdateCheck(enabled: boolean): Promise<void> {
  if (!(await getSession())) {
    throw new Error("Unauthorized");
  }
  await setUpdateCheckEnabled(enabled);
}
