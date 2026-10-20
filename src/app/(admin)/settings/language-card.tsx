"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageDropdown } from "@/components/language-dropdown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Language picker — top of the General tab, always visible (never
 * hover-only, per UI rules). Switching (in the shared LanguageDropdown)
 * calls the server action (cookie + settings row) then refreshes so the
 * whole admin re-renders translated.
 */
export function LanguageCard() {
  const t = useTranslations("settings.language");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <LanguageDropdown />
      </CardContent>
    </Card>
  );
}
