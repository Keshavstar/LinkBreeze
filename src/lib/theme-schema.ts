import { z } from "zod";

/**
 * Theme validation schema — the single source of truth for what the
 * customizeActiveTheme server action accepts.
 *
 * Extracted from src/server/actions/theme.ts so the schema can be imported
 * by tests without dragging in the "use server" / next/cache runtime.
 * The server action re-exports this as `customSchema`.
 */

const colorRegex = /^#[0-9a-fA-F]{3,8}$/;

/** Accept CSS color strings: hex, rgba(), rgb(), transparent */
export const cssColor = z
  .string()
  .max(60)
  .refine(
    (v) =>
      colorRegex.test(v) ||
      v.startsWith("rgba(") ||
      v.startsWith("rgb(") ||
      v === "transparent" ||
      v === "none",
    "Invalid color",
  );

/**
 * Media URL validation for background image/video URLs. Only https://,
 * http://, and site-relative "/…" paths are accepted — the URL lands in a
 * CSS `url('…')` and a <video src>, and scheme allowlisting here is the
 * single choke point that keeps "javascript:" / "data:" URIs out.
 */
export const safeMediaUrl = z
  .string()
  .max(2000)
  .refine(
    (v) => /^\/[^/]/.test(v) || /^https:\/\//i.test(v) || /^http:\/\//i.test(v),
    "URL must be https://, http://, or a site-relative path",
  );

export const customSchema = z.object({
  // Background
  backgroundType: z
    .enum([
      "solid",
      "gradient",
      "pattern",
      "aurora",
      "radial",
      "mesh",
      "image",
      "animatedGradient",
      "video",
      "gif",
    ])
    .optional(),
  backgroundValue: z.string().max(500).optional(),
  backgroundAngle: z.string().max(20).optional(),
  backgroundImageUrl: safeMediaUrl.optional(),
  backgroundFit: z.enum(["cover", "contain", "tile"]).optional(),
  backgroundPosition: z
    .string()
    .max(20)
    .regex(/^\s*-?\d+(\.\d+)?%\s+-?\d+(\.\d+)?%\s*$/, "Invalid position")
    .optional(),
  overlayColor: cssColor.optional(),
  overlayOpacity: z.string().max(10).optional(),
  // Colors
  primaryColor: cssColor.optional(),
  secondaryColor: cssColor.optional(),
  cardBackground: z.string().max(60).optional(),
  cardBorderColor: z.string().max(60).optional(),
  textColor: cssColor.optional(),
  mutedTextColor: cssColor.optional(),
  mode: z.enum(["light", "dark"]).optional(),
  // Typography
  // fontFamily accepts a bundled id ("inter"), an uploaded font ref
  // ("custom:<id>", validated in the action), or legacy raw CSS from old rows.
  fontFamily: z.string().max(100).optional(),
  // Second font for link cards only; "" (default) = inherit the site font.
  // Same identifier space as fontFamily.
  cardFontFamily: z.string().max(100).optional(),
  fontScale: z.string().max(10).optional(),
  fontWeight: z.string().max(10).optional(),
  letterSpacing: z.string().max(10).optional(),
  // Card
  linkStyle: z
    .enum(["pill", "rounded", "sharp", "glass", "outline", "neon", "pixel", "gel"])
    .optional(),
  animationType: z.enum(["lift", "scale", "none", "fade-up", "slide-in", "zoom-in", "blur-in"]).optional(),
  radius: z.string().max(20).optional(),
  buttonSize: z.enum(["sm", "md", "lg"]).optional(),
  borderWidth: z.string().max(20).optional(),
  shadowStrength: z
    .enum(["none", "subtle", "soft", "medium", "strong"])
    .optional(),
  hoverEffect: z.enum(["lift", "scale", "glow", "none"]).optional(),
  // Layout
  containerWidth: z.string().max(20).optional(),
  alignment: z.enum(["left", "center", "right"]).optional(),
  density: z.enum(["compact", "normal", "relaxed"]).optional(),
  // Effects
  glow: z.enum(["true", "false"]).optional(),
  glowColor: cssColor.optional(),
  blur: z.string().max(20).optional(),
  noise: z.enum(["true", "false"]).optional(),
  // Profile styling (1.3)
  avatarShape: z.enum(["circle", "squircle", "rounded", "square"]).optional(),
  avatarBorder: z.enum(["solid", "gradient", "glow", "ring", "none"]).optional(),
  avatarFloat: z.enum(["true", "false"]).optional(),
  // Avatar diameter in px ("72"–"160") or "auto" (shape-aware default).
  avatarSize: z
    .string()
    .max(10)
    .regex(/^auto$|^\d+$/, "Invalid avatar size")
    .refine((v) => v === "auto" || (Number(v) >= 48 && Number(v) <= 180), "Avatar size out of range")
    .optional(),
  // #87 divider element styling
  dividerStyle: z.enum(["solid", "dashed", "dotted", "gradient"]).optional(),
  /** CSS color, or "" (= inherit the card border color). */
  dividerColor: z
    .string()
    .max(60)
    .refine((v) => v === "" || colorRegex.test(v) || v.startsWith("rgba(") || v.startsWith("rgb("), "Invalid color")
    .optional(),
  /** Line thickness in px as a string, 1–8. */
  dividerThickness: z
    .string()
    .max(4)
    .regex(/^\d+$/, "Invalid thickness")
    .refine((v) => Number(v) >= 1 && Number(v) <= 8, "Thickness out of range")
    .optional(),
  /** Width percentage as a string, 20–100. */
  dividerWidth: z
    .string()
    .max(4)
    .regex(/^\d+$/, "Invalid width")
    .refine((v) => Number(v) >= 20 && Number(v) <= 100, "Width out of range")
    .optional(),
  profileLayout: z.enum(["classic", "hero", "banner"]).optional(),
  textAnimation: z.enum(["none", "typewriter", "gradient-flow"]).optional(),
});


/**
 * Import/restore sanitizer for theme rows (theme-file import + backup
 * restore). The customizeActiveTheme action validates through customSchema,
 * but the import paths historically accepted raw strings — and every one
 * of these fields is interpolated into the public page's CSS (url('…'),
 * linear-gradient(…), --lb-* custom properties, font-family). A crafted
 * community theme or backup could therefore inject arbitrary CSS.
 *
 * Each field present on the row is checked against its customSchema field
 * schema; invalid values are DROPPED (the DB default applies) instead of
 * rejecting the whole payload, so older exports keep importing. Free-form
 * CSS-adjacent strings (backgroundValue, angles, font families, spacing)
 * additionally must not contain context-breaking characters ({ } ; @ < >).
 */
const cssContextUnsafe = /[{};@<>]/;

export function sanitizeThemeFields<T extends Record<string, unknown>>(
  row: T,
): { clean: Record<string, unknown>; dropped: string[] } {
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, schema] of Object.entries(customSchema.shape)) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    const result = (schema as z.ZodTypeAny).safeParse(value);
    if (!result.success) {
      dropped.push(key);
      continue;
    }
    if (
      (key === "backgroundValue" ||
        key === "backgroundAngle" ||
        key === "fontFamily" ||
        key === "cardFontFamily" ||
        key === "letterSpacing" ||
        key === "blur" ||
        key === "radius" ||
        key === "containerWidth") &&
      typeof result.data === "string" &&
      cssContextUnsafe.test(result.data)
    ) {
      dropped.push(key);
      continue;
    }
    clean[key] = result.data;
  }
  return { clean, dropped };
}
