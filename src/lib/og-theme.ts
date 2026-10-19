/**
 * OG image theming — pure resolver that turns a theme row into the visual
 * parameters the opengraph-image route renders. No @/db import: safe for
 * client components, tests, and the route handler alike.
 *
 * Goal: the generated OG card matches the public page's look for EVERY
 * background type, not just the two-color gradient the old route assumed:
 *   solid            → flat color
 *   gradient         → multi-stop linear gradient at the theme's angle
 *   radial           → radial gradient at the same 50% 30% focal point
 *   mesh             → approximated as layered radial stops (satori supports
 *                      linear + radial only; the closest static rendering)
 *   image / gif      → the theme's background IMAGE as the card backdrop
 *                      (with the theme's overlay color/opacity applied)
 *   animatedGradient → same gradient, looped first stop (static snapshot)
 *   aurora           → static approximation: base color + accent/secondary
 *                      radial glows where the animated blobs sit
 *   video            → the theme's fallback gradient (what the page shows
 *                      while/if the video is loading — satori cannot render
 *                      video frames)
 */

import { normalizeOpacity } from "@/lib/theme-tokens";

export interface OgThemeBackground {
  /** Fully resolved CSS background for the 1200x630 card. */
  background: string;
  /**
   * When the theme's background is a media file (image/gif), the URL to
   * draw as the card backdrop; the route <img>-covers it.
   */
  imageUrl: string | null;
  /** Overlay color + 0-1 fraction to layer above imageUrl (theme's overlay). */
  overlay: { color: string; opacity: number } | null;
}

const NIGHT_BASE = "#0a0820";

function bgParts(backgroundValue: string | null | undefined): string[] {
  return (backgroundValue || NIGHT_BASE)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveOgThemeBackground(
  theme:
    | {
        backgroundType?: string | null;
        backgroundValue?: string | null;
        backgroundAngle?: string | null;
        backgroundImageUrl?: string | null;
        backgroundFit?: string | null;
        backgroundPosition?: string | null;
        overlayColor?: string | null;
        overlayOpacity?: string | null;
        primaryColor?: string | null;
        secondaryColor?: string | null;
      }
    | null
    | undefined,
): OgThemeBackground {
  const bgType = theme?.backgroundType || "gradient";
  const parts = bgParts(theme?.backgroundValue);
  const angle = theme?.backgroundAngle?.trim() || "160deg";
  const first = parts[0] || NIGHT_BASE;

  // Media backdrop shared by image / gif (plus the theme overlay on top).
  if ((bgType === "image" || bgType === "gif") && theme?.backgroundImageUrl) {
    const fraction = normalizeOpacity(theme.overlayOpacity);
    return {
      background: first,
      imageUrl: theme.backgroundImageUrl,
      overlay:
        fraction > 0 && theme.overlayColor
          ? { color: theme.overlayColor, opacity: fraction }
          : null,
    };
  }

  switch (bgType) {
    case "solid":
      return { background: first, imageUrl: null, overlay: null };

    case "gradient":
      return {
        background:
          parts.length > 1
            ? `linear-gradient(${angle}, ${parts.join(", ")})`
            : first,
        imageUrl: null,
        overlay: null,
      };

    case "radial":
      return {
        background:
          parts.length > 1
            ? `radial-gradient(circle at 50% 30%, ${parts.join(", ")})`
            : first,
        imageUrl: null,
        overlay: null,
      };

    case "mesh": {
      if (parts.length >= 2) {
        const layers = parts
          .map(
            (color, i) =>
              `radial-gradient(at ${20 + i * 25}% ${15 + (i % 3) * 30}%, ${color} 0px, transparent 50%)`,
          )
          .join(", ");
        return { background: `${layers}, ${first}`, imageUrl: null, overlay: null };
      }
      return { background: first, imageUrl: null, overlay: null };
    }

    case "image":
    case "gif":
      // No media URL (or not requested): resolveBackground falls back to the
      // first color — mirror that.
      return { background: first, imageUrl: null, overlay: null };

    case "animatedGradient":
      // Static snapshot of the shifting gradient (loop = first color repeats).
      return {
        background: `linear-gradient(${angle}, ${parts.join(", ")}, ${first})`,
        imageUrl: null,
        overlay: null,
      };

    case "aurora": {
      // AuroraBackground (public): base color wash + two large blurred blobs
      // (blob1 = accent at top-left, opacity .20; blob2 = secondary at
      // bottom-right, opacity .18 — globals.css). Static approximation with
      // layered radial glows at those corners; satori has no blur filter.
      const accent = theme?.primaryColor?.trim() || "#533fd6";
      const secondary = theme?.secondaryColor?.trim() || "#a78bfa";
      return {
        background: [
          `radial-gradient(circle at 22% 20%, ${hexAlpha(accent, 0.2)} 0%, transparent 55%)`,
          `radial-gradient(circle at 80% 82%, ${hexAlpha(secondary, 0.18)} 0%, transparent 55%)`,
          first,
        ].join(", "),
        imageUrl: null,
        overlay: null,
      };
    }

    case "video":
      // satori can't render video frames; the page itself falls back to this
      // gradient while the video loads — mirror exactly that.
      return {
        background:
          parts.length > 1
            ? `linear-gradient(${angle}, ${parts.join(", ")})`
            : first,
        imageUrl: null,
        overlay: null,
      };

    case "pattern":
    default:
      return { background: first, imageUrl: null, overlay: null };
  }
}

/**
 * Append a 2-digit alpha to a hex color (#rgb/#rrggbb). Non-hex colors
 * (rgba(), names) pass through untouched — gradients then just use the raw
 * color at full strength, same as CSS would.
 */
export function hexAlpha(color: string, alpha: number): string {
  const c = color.trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
  if (!m) return c;
  // Expand 3-digit shorthand first: appending alpha to "#fff" would
  // produce the invalid 5-digit "#fffff".
  const hex =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : m[1];
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${hex}${a}`;
}

/**
 * Satori-safe translucent color for ANY css color the theme may carry:
 * hex (3/6) and rgb()/rgba() become rgba(r,g,b,a); anything else (named
 * colors like "white") returns null so the caller can fall back to a
 * theme-derived color instead of guessing. Unlike hexAlpha this works on
 * non-hex input rather than passing it through at the wrong alpha.
 */
export function withAlpha(color: string, alpha: number): string | null {
  const c = color.trim();
  const clamped = Math.min(1, Math.max(0, alpha));
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
  if (hex) {
    const full =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex[1];
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamped})`;
  }
  const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  if (fn) {
    return `rgba(${fn[1]}, ${fn[2]}, ${fn[3]}, ${clamped})`;
  }
  return null;
}

/** Shape the route needs from a link row to draw a pill. */
export interface OgLinkInput {
  title: string;
  type?: string | null;
}

export interface OgLinkPills {
  /** Up to `max` display titles, in page order. */
  shown: string[];
  /** How many more active links exist beyond the shown ones. */
  extra: number;
}

/** Pick the link titles the OG poster showcases: dividers carry no content
 *  and empty titles render as blank chips, so both are dropped; the rest
 *  keep page order up to `max`, with the remainder as a "+N more" count. */
export function selectOgLinks(
  links: OgLinkInput[],
  max = 4,
): OgLinkPills {
  const usable = links
    .filter((l) => l.type !== "divider" && typeof l.title === "string" && l.title.trim().length > 0)
    .map((l) => l.title.trim());
  return {
    shown: usable.slice(0, max),
    extra: Math.max(0, usable.length - max),
  };
}
