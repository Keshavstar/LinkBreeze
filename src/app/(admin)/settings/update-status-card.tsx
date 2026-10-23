"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowUpCircle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { refreshUpdateStatus } from "@/server/actions/update-check";
import type { UpdateSourceStatus, UpdateStatusResult } from "@/lib/update-check";

interface UpdateStatusCardProps {
  initial: UpdateStatusResult;
  checksEnabled: boolean;
}

function formatTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceRow(
  label: string,
  source: UpdateSourceStatus,
  linkOverride?: string,
): React.ReactNode {
  const versionLabel = source.version ? `v${source.version}` : null;
  const href = linkOverride ?? source.url;
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-medium">
        {versionLabel ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
            >
              {versionLabel}
              <ExternalLink className="size-3 text-muted-foreground" />
            </a>
          ) : (
            versionLabel
          )
        ) : (
          <span className="text-muted-foreground" aria-label={label}>
            —
          </span>
        )}
      </dd>
    </div>
  );
}

// Where the "Latest on the website" row links: the website's changelog
// lists the newest release.
const WEBSITE_CHANGELOG_URL = "https://linkbreeze.omnirise.dev/changelog";

export function UpdateStatusCard({ initial, checksEnabled }: UpdateStatusCardProps) {
  const t = useTranslations("update");
  const locale = useLocale();
  const [status, setStatus] = React.useState(initial);
  const [refreshing, setRefreshing] = React.useState(false);

  const recheck = async () => {
    setRefreshing(true);
    try {
      setStatus(await refreshUpdateStatus());
    } finally {
      setRefreshing(false);
    }
  };

  const releaseUrl = status.website.url ?? status.github.url;
  const lastCheckedIso =
    [status.website.checkedAt, status.github.checkedAt]
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;
  const lastChecked = formatTime(lastCheckedIso, locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpCircle className="size-5" />
          {t("cardTitle")}
        </CardTitle>
        <CardDescription>{t("cardDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("installed")}</dt>
            <dd className="font-medium">v{status.currentVersion}</dd>
          </div>
          {sourceRow(t("githubLatest"), status.github)}
          {sourceRow(t("websiteLatest"), status.website, WEBSITE_CHANGELOG_URL)}
        </dl>

        {status.hasUpdate && status.latestVersion ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ArrowUpCircle className="size-4 shrink-0 text-warning" />
              <span>{t("updateAvailable", { version: status.latestVersion })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              {releaseUrl ? (
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground hover:underline"
                >
                  {t("viewReleaseNotes")}
                </a>
              ) : null}
              <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 whitespace-nowrap">
                {t("updateCommand")}
              </code>
            </div>
            <span className="text-xs text-muted-foreground">{t("orScript")}</span>
          </div>
        ) : status.latestVersion ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <span>{t("onLatest")}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <CircleDashed className="size-4 shrink-0" />
            <span>{t("statusUnknown")}</span>
          </div>
        )}

        {status.github.error && status.github.checkedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("staleSource", {
              source: t("githubLatest"),
              time: formatTime(status.github.checkedAt, locale) ?? "",
            })}
          </p>
        ) : null}
        {status.website.error && status.website.checkedAt && checksEnabled ? (
          <p className="text-xs text-muted-foreground">
            {t("staleSource", {
              source: t("websiteLatest"),
              time: formatTime(status.website.checkedAt, locale) ?? "",
            })}
          </p>
        ) : null}

        {!checksEnabled ? (
          <p className="text-xs text-muted-foreground">{t("checksDisabled")}</p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {lastChecked ? t("lastChecked", { time: lastChecked }) : ""}
          </span>
          <Button variant="outline" size="sm" onClick={recheck} disabled={refreshing}>
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {t("recheck")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
