import { Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getAllPages } from "@/server/queries";
import { getDomainPolicy, listAdminDomains } from "@/server/domains";
import { DomainsManager } from "./domains-manager";

export const dynamic = "force-dynamic";

/**
 * Admin — custom domains (#85): host→page bindings, per-page scope, and the
 * instance routing policy. Purely a server page: data loads here, the
 * manager client component handles forms via server actions.
 */
export default async function DomainsPage() {
  const [domains, pages, policy, t] = await Promise.all([
    listAdminDomains(),
    getAllPages(),
    getDomainPolicy(),
    getTranslations("domains"),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-24 pt-6 md:pb-8">
      <div className="flex items-center gap-2">
        <Globe className="size-5 shrink-0" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      <DomainsManager
        domains={domains}
        pages={pages.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          isPublished: p.isPublished,
          scope: p.domainScope === "hub" ? "hub" : "exclusive",
        }))}
        policy={policy}
      />
    </main>
  );
}
