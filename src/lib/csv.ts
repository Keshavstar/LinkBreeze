/**
 * Shared CSV cell serialization. Pure (no server-only imports) so both
 * export routes and tests can use it.
 *
 * Two defenses in one place:
 *   1. RFC 4180 quoting — cells containing quotes, commas or newlines are
 *      wrapped and inner quotes doubled.
 *   2. Formula-injection guard — a leading = + - @ or tab/CR would make
 *      Excel/LibreOffice evaluate the cell as a formula when the admin
 *      opens an export. Exports include attacker-controlled fields
 *      (analytics referrers come from the Referer header), so such cells
 *      get a leading apostrophe, which spreadsheets treat as text.
 */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /["\n,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
