"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { chartLocaleTag } from "@/app/(admin)/dashboard/views-chart-inner";
import {
  saveBackupSettings,
  runBackupNow,
  restoreScheduledBackup,
  deleteStoredBackup,
} from "@/server/actions/backups";
import { useSavedAction, useAutosavedForm } from "@/hooks/use-saved-action";
import { localizeActionError } from "@/lib/action-error-i18n";
import type {
  BackupFileMeta,
  BackupResultCode,
} from "@/lib/backup-schedule";
import { HardDriveDownload, Play, RotateCcw, Trash2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

/** Direct key per result code — no template-literal key building (the
 *  i18n:audit unused-key scanner can't see dynamic keys). */
const RESULT_KEYS = {
  ok: "result_ok",
  disk_full: "result_disk_full",
  write_failed: "result_write_failed",
  serialize_failed: "result_serialize_failed",
  busy: "result_busy",
} as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsCard({
  enabled,
  frequency,
  timeOfDay,
  retention,
  backups,
  lastRunAt,
  lastResult,
  backupDir,
  freeMb,
  minFreeMb,
}: {
  enabled: boolean;
  frequency: Frequency;
  timeOfDay: string; // "HH:MM"
  retention: number;
  backups: BackupFileMeta[];
  lastRunAt: string | null;
  lastResult: BackupResultCode | null;
  backupDir: string;
  freeMb: number | null;
  minFreeMb: number;
}) {
  const t = useTranslations("settings.backups");
  const tErr = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();


  const savedAction = useSavedAction();
  const [runMsg, setRunMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [rowMsg, setRowMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const [rowPending, setRowPending] = React.useState(false);

  // Debounced autosave: one FormData per save covering every field on the
  // card. An unchecked enable-checkbox is ABSENT from the FormData, which
  // the action reads as "disabled" — the tri-state rule does not apply here
  // because the toggle is itself a complete value, not a partial save.
  const { formRef, schedule, flushNow, status } = useAutosavedForm((formData) => {
    return savedAction.run(saveBackupSettings, formData);
  });

  const handleRunNow = async () => {
    setRunMsg(null);
    const res = await savedAction.run(runBackupNow);
    setRunMsg(
      res.success
        ? { ok: true, text: t("runDone") }
        : { ok: false, text: localizeActionError(tErr, res.error) },
    );
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    const filename = restoreTarget;
    setRestoreTarget(null);
    setRowPending(true);
    setRowMsg(null);
    try {
      const res = await restoreScheduledBackup(filename);
      setRowMsg(
        res.success
          ? { ok: true, text: t("backupRestored") }
          : { ok: false, text: localizeActionError(tErr, res.error) },
      );
      if (res.success) router.refresh();
    } catch {
      setRowMsg({ ok: false, text: t("restoreFailed") });
    } finally {
      setRowPending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const fd = new FormData();
    fd.set("filename", deleteTarget);
    setDeleteTarget(null);
    setRowPending(true);
    setRowMsg(null);
    try {
      const res = await deleteStoredBackup(fd);
      setRowMsg(
        res.success
          ? { ok: true, text: t("backupDeleted") }
          : { ok: false, text: localizeActionError(tErr, res.error) },
      );
      if (res.success) router.refresh();
    } catch {
      setRowMsg({ ok: false, text: t("deleteFailed") });
    } finally {
      setRowPending(false);
    }
  };

  const lowDisk = freeMb !== null && freeMb < minFreeMb;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveDownload className="size-5" />{t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form ref={formRef} action={undefined} onBlurCapture={() => flushNow()}>
          {/* Toggle — the action reads an absent checkbox as "off". */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("enable")}</p>
              <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
            </div>
            <label htmlFor="backup-enabled" className="relative inline-flex cursor-pointer items-center">
              <input
                id="backup-enabled"
                type="checkbox"
                name="backupEnabled"
                role="switch"
                aria-label={t("enable")}
                defaultChecked={enabled}
                className="peer sr-only"
                onChange={() => schedule()}
              />
              <div className="peer h-5 w-9 rounded-full bg-muted transition-colors after:absolute after:left-[2px] after:top-[2px] after:size-4 after:rounded-full after:bg-foreground after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4" />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="backup-frequency">{t("frequency")}</Label>
              {/* Native select: form-native so the autosaved FormData carries
                  the value without wiring a headless component into it.
                  color-scheme is scoped here (the app sets none globally) so
                  the native dropdown list and its options follow the theme
                  instead of rendering UA-white with unreadable text. */}
              <select
                id="backup-frequency"
                name="backupFrequency"
                defaultValue={frequency}
                onChange={() => schedule()}
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none transition-colors [color-scheme:light] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:[color-scheme:dark]"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f} className="bg-background text-foreground">
                    {t(f)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="backup-time">{t("timeLabel")}</Label>
              <Input
                id="backup-time"
                name="backupTimeOfDay"
                type="time"
                defaultValue={timeOfDay}
                onChange={() => schedule()}
                className="max-w-32 [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="backup-retention">{t("retentionLabel")}</Label>
              <Input
                id="backup-retention"
                name="backupRetention"
                type="number"
                min={1}
                max={52}
                defaultValue={retention}
                onChange={() => schedule()}
                className="max-w-24"
              />
            </div>
          </div>
          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
            {t("timeHint")}
          </p>
          {status === "saving" ? (
            <p className="mt-1 text-sm text-muted-foreground">{tCommon("saving")}</p>
          ) : status === "saved" ? (
            <p className="mt-1 text-sm text-success">{tCommon("saved")}</p>
          ) : null}
        </form>

        {/* Status + run now */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleRunNow}
              disabled={savedAction.pending}
              className="w-fit"
            >
              <Play className="size-4" />
              {savedAction.pending ? t("running") : t("runNow")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {lastRunAt
                ? t("lastRun", {
                    time: new Date(lastRunAt).toLocaleString(chartLocaleTag(locale)),
                  })
                : t("never")}
              {lastResult
                ? ` · ${t(RESULT_KEYS[lastResult])}`
                : ""}
            </span>
          </div>
          {runMsg ? (
            <p className={runMsg.ok ? "text-sm text-success" : "text-sm text-destructive"}>
              {runMsg.text}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("storageLabel")}: <code className="rounded bg-muted px-1 py-0.5">{backupDir}</code>
            {freeMb !== null ? ` · ${t("freeSpace", { mb: freeMb })}` : ""}
          </p>
          {lowDisk ? (
            <p className="text-sm text-destructive" role="alert">{t("lowDisk", { mb: minFreeMb })}</p>
          ) : null}
        </div>

        {/* Stored backups list */}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">{t("storedBackups")}</p>
          {backups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noBackups")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {backups.map((b) => (
                <li
                  key={b.filename}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm">
                    {new Date(b.createdAt).toLocaleString(chartLocaleTag(locale), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    <span className="ml-2 text-xs text-muted-foreground">{formatSize(b.sizeBytes)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rowPending}
                      onClick={() => setRestoreTarget(b.filename)}
                    >
                      <RotateCcw className="size-3.5" />
                      {t("restore")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={rowPending}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(b.filename)}
                      aria-label={t("delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rowMsg ? (
            <p className={rowMsg.ok ? "text-sm text-success" : "text-sm text-destructive"}>
              {rowMsg.text}
            </p>
          ) : null}
        </div>
      </CardContent>

      {/* Restore confirmation — same destructive flow as the manual restore */}
      <Dialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("restoreTitle")}</DialogTitle>
            <DialogDescription>{t("restoreWarning")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setRestoreTarget(null)}>{t("cancel")}</Button>
            <Button variant="destructive" type="button" onClick={confirmRestore}>{t("restoreConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteWarning")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDeleteTarget(null)}>{t("cancel")}</Button>
            <Button variant="destructive" type="button" onClick={confirmDelete}>{t("deleteConfirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
