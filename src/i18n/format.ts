/**
 * Locale tag helpers shared by server components and client components.
 * Plain module — no "use client"/"use server" directive, safe to import anywhere.
 */
import type { Locale } from "./config";

/** BCP-47 tag mapped from a LinkBreeze locale. */
export function localeTag(locale: string | undefined): string {
  switch (locale) {
    case "en": return "en";
    case "fr": return "fr-FR";
    case "es": return "es-ES";
    case "de": return "de-DE";
    case "zh": return "zh-CN";
    case "hi": return "hi-IN";
    case "it": return "it-IT";
    case "ja": return "ja-JP";
    case "pt-BR": return "pt-BR";
    case "ru": return "ru-RU";
    case "tr": return "tr-TR";
    case "ar": return "ar-MA";
    default: return "en";
  }
}

/**
 * BCP-47 tag with Latin digits forced (per i18n policy: Latin digits in every
 * locale, including ar/hi). Use for Intl.NumberFormat / DateTimeFormat.
 */
export function latnTag(locale: string | undefined): string {
  return localeTag(locale) + "-u-nu-latn";
}

/** Format a number with locale-aware grouping and Latin digits. */
export function formatNumber(n: number, locale: string | undefined): string {
  return new Intl.NumberFormat(latnTag(locale)).format(n);
}

/** Effective locale for a server component (header/cookie aware). */
export type { Locale };
