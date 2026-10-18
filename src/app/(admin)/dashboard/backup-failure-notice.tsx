"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { dismissBackupNotice } from "@/server/actions/backups";

/** Subtle dashboard notice shown while scheduled backups are failing.
 *  Dismissal re-arms only on the NEXT failure (the server compares against
 *  the last-error timestamp), never on the same stale one. */
export function BackupFailureNotice() {
  const t = useTranslations("dashboard.backupNotice");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-xs text-muted-foreground">{t("body")}</p>
        </div>
      </div>
      <button
        type="button"
        aria-label={t("dismiss")}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await dismissBackupNotice();
            router.refresh();
          })
        }
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
