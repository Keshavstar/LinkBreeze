"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Globe, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { localizeActionError } from "@/lib/action-error-i18n";
import { useSavedAction } from "@/hooks/use-saved-action";
import type { DomainPolicy } from "@/lib/host-routing";
import {
  activateDomainAction,
  addDomainAction,
  checkDomainDnsAction,
  type DnsCheckResult,
  deleteDomainAction,
  saveDomainPolicyAction,
  setPageDomainScopeAction,
  updateDomainAction,
} from "@/server/actions/domains";
import type { AdminDomainRow } from "@/server/domains";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

/**
 * Custom-domains manager (#85): bindings table + add form, per-page scope
 * selectors, and the instance routing policy card. All mutations go through
 * server actions; DNS check is a read-only diagnostic.
 */

interface PageLite {
  id: number;
  slug: string;
  title: string;
  isPublished: boolean;
  scope: "exclusive" | "hub";
}

const SELECT_CLASSES =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none transition-colors [color-scheme:light] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:[color-scheme:dark]";

export function DomainsManager({
  domains,
  pages,
  policy,
}: {
  domains: AdminDomainRow[];
  pages: PageLite[];
  policy: DomainPolicy;
}) {
  const t = useTranslations("domains");
  const tErr = useTranslations("errors");
  const savedAction = useSavedAction();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [dnsResults, setDnsResults] = React.useState<Record<string, DnsCheckResult | "none">>({});
  const [dnsPending, setDnsPending] = React.useState<string | null>(null);

  const runForm = (
    action: (formData: FormData) => Promise<{ success: boolean; error?: string; errorCode?: string }>,
    formData: FormData,
  ) => {
    setError(null);
    startTransition(async () => {
      const res = await savedAction.run(action, formData);
      if (!res.success) {
        setError(localizeActionError(tErr, (res as { error: string }).error));
      }
    });
  };

  const checkDns = (host: string) => {
    setDnsPending(host);
    startTransition(async () => {
      const res = await checkDomainDnsAction(host);
      setDnsPending(null);
      if (res.success) {
        const empty = !res.a.length && !res.aaaa.length && !res.cname.length;
        setDnsResults((prev) => ({ ...prev, [host]: empty ? "none" : { a: res.a, aaaa: res.aaaa, cname: res.cname } }));
      }
    });
  };

  const pagesById = React.useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);

  const pageLabel = (pageId: number) => {
    const p = pagesById.get(pageId);
    return p ? p.title || p.slug : `#${pageId}`;
  };

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* ── Bindings ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("dnsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {domains.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}

          {domains.map((d) => (
            <div
              key={d.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{d.host}</span>
                <Badge variant="outline">{d.kind === "primary" ? t("kindPrimary") : t("kindAlias")}</Badge>
                {d.status === "active" ? (
                  <Badge className="gap-1">
                    <CheckCircle2 className="size-3" aria-hidden />
                    {t("statusActive")}
                  </Badge>
                ) : (
                  <Badge variant="outline">{t("statusPending")}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {pageLabel(d.pageId)}
                </span>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    runForm(updateDomainAction, fd);
                  }}
                  className="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="domainId" value={d.id} />
                  <FormField label={t("kindLabel")} htmlFor={`kind-${d.id}`}>
                    <select
                      id={`kind-${d.id}`}
                      name="kind"
                      defaultValue={d.kind}
                      className={SELECT_CLASSES}
                    >
                      <option value="primary">{t("kindPrimary")}</option>
                      <option value="alias">{t("kindAlias")}</option>
                    </select>
                  </FormField>
                  <FormField label={t("behaviorLabel")} htmlFor={`behavior-${d.id}`}>
                    <select
                      id={`behavior-${d.id}`}
                      name="behavior"
                      defaultValue={d.behavior}
                      className={SELECT_CLASSES}
                    >
                      <option value="serve">{t("behaviorServe")}</option>
                      <option value="redirect_canonical">{t("behaviorRedirectCanonical")}</option>
                      <option value="redirect_slug">{t("behaviorRedirectSlug")}</option>
                    </select>
                  </FormField>
                  <Button type="submit" variant="outline" size="sm" disabled={pending}>
                    {t("save")}
                  </Button>
                </form>

                <div className="ml-auto flex items-center gap-2">
                  {d.status === "pending" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        runForm(activateDomainAction, fd);
                      }}
                      title={t("activateHint")}
                    >
                      <input type="hidden" name="domainId" value={d.id} />
                      <Button type="submit" variant="outline" size="sm" disabled={pending}>
                        {t("activate")}
                      </Button>
                    </form>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={dnsPending !== null}
                    onClick={() => checkDns(d.host)}
                  >
                    {dnsPending === d.host ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        {t("dnsChecking")}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-3.5" aria-hidden />
                        {t("dnsCheck")}
                      </>
                    )}
                  </Button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!window.confirm(t("deleteConfirm"))) return;
                      const fd = new FormData(e.currentTarget);
                      runForm(deleteDomainAction, fd);
                    }}
                  >
                    <input type="hidden" name="domainId" value={d.id} />
                    <Button type="submit" variant="outline" size="sm" aria-label={t("deleteConfirm")} disabled={pending}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </form>
                </div>
              </div>

              {dnsResults[d.host] === "none" && (
                <p className="text-xs text-muted-foreground">{t("dnsNone")}</p>
              )}
              {dnsResults[d.host] && dnsResults[d.host] !== "none" && (
                <div className="text-xs text-muted-foreground">
                  <p>{t("dnsFound")}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-mono">
                    {JSON.stringify(dnsResults[d.host], null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {/* Add form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              runForm(addDomainAction, fd);
              form.reset();
            }}
            className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
          >
            <FormField label={t("hostLabel")} htmlFor="new-host">
              <Input
                id="new-host"
                name="host"
                placeholder={t("hostPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                required
                className="w-56 font-mono"
              />
            </FormField>
            <FormField label={t("pageLabel")} htmlFor="new-page">
              <select id="new-page" name="pageId" className={SELECT_CLASSES} required>
                {pages.map((p) => (
                  <option key={p.id} value={p.id} className="bg-background text-foreground">
                    {p.title || p.slug}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("kindLabel")} htmlFor="new-kind">
              <select id="new-kind" name="kind" defaultValue="primary" className={SELECT_CLASSES}>
                <option value="primary">{t("kindPrimary")}</option>
                <option value="alias">{t("kindAlias")}</option>
              </select>
            </FormField>
            <FormField label={t("behaviorLabel")} htmlFor="new-behavior">
              <select id="new-behavior" name="behavior" defaultValue="serve" className={SELECT_CLASSES}>
                <option value="serve">{t("behaviorServe")}</option>
                <option value="redirect_canonical">{t("behaviorRedirectCanonical")}</option>
                <option value="redirect_slug">{t("behaviorRedirectSlug")}</option>
              </select>
            </FormField>
            <Button type="submit" size="sm" disabled={pending}>
              <Plus className="size-4" aria-hidden />
              {t("addTitle")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Per-page scope ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("scopeTitle")}</CardTitle>
          <CardDescription>{t("scopeDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pages.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-40 text-sm font-medium">{p.title || p.slug}</span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  runForm(setPageDomainScopeAction, fd);
                }}
                className="flex items-end gap-3"
              >
                <input type="hidden" name="pageId" value={p.id} />
                <FormField label={t("scope")} htmlFor={`scope-${p.id}`}>
                  <select
                    id={`scope-${p.id}`}
                    name="scope"
                    defaultValue={p.scope}
                    className={SELECT_CLASSES}
                  >
                    <option value="exclusive">{t("scopeExclusive")}</option>
                    <option value="hub">{t("scopeHub")}</option>
                  </select>
                </FormField>
                <Button type="submit" variant="outline" size="sm" disabled={pending}>
                  {t("save")}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                {p.scope === "hub" ? t("scopeHubHint") : t("scopeExclusiveHint")}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Routing policy ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("policyTitle")}</CardTitle>
          <CardDescription>{t("policyDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              runForm(saveDomainPolicyAction, fd);
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <FormField
              label={t("primaryHostLabel")}
              htmlFor="policy-primary-host"
              hint={t("primaryHostHint")}
              className="sm:col-span-2"
            >
              <Input
                id="policy-primary-host"
                name="primaryHost"
                defaultValue={policy.primaryHost ?? ""}
                placeholder="links.example.com"
                autoComplete="off"
                spellCheck={false}
                className="max-w-xs font-mono"
              />
            </FormField>

            <FormField label={t("adminLockLabel")} htmlFor="policy-lock">
              <select
                id="policy-lock"
                name="adminLock"
                defaultValue={policy.adminLock}
                className={SELECT_CLASSES}
              >
                <option value="strict">{t("adminLockStrict")}</option>
                <option value="off">{t("adminLockOff")}</option>
              </select>
            </FormField>

            <FormField label={t("fallbackLabel")} htmlFor="policy-fallback">
              <select
                id="policy-fallback"
                name="unknownFallback"
                defaultValue={policy.unknownFallback}
                className={SELECT_CLASSES}
              >
                <option value="path">{t("fallbackPath")}</option>
                <option value="404">{t("fallback404")}</option>
                <option value="redirect_primary">{t("fallbackRedirectPrimary")}</option>
              </select>
            </FormField>

            <FormField label={t("wwwLabel")} htmlFor="policy-www">
              <select
                id="policy-www"
                name="wwwPolicy"
                defaultValue={policy.wwwPolicy}
                className={SELECT_CLASSES}
              >
                <option value="redirect">{t("wwwRedirect")}</option>
                <option value="serve">{t("wwwServe")}</option>
                <option value="off">{t("wwwOff")}</option>
              </select>
            </FormField>

            <FormField label={t("canonicalLabel")} htmlFor="policy-canonical">
              <select
                id="policy-canonical"
                name="canonical"
                defaultValue={policy.canonical}
                className={SELECT_CLASSES}
              >
                <option value="301">{t("canonical301")}</option>
                <option value="tag">{t("canonicalTag")}</option>
                <option value="off">{t("canonicalOff")}</option>
              </select>
            </FormField>

            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {t("save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
