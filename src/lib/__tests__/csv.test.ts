import { describe, expect, it } from "vitest";
import { csvCell } from "../csv";

describe("csvCell", () => {
  it("passes plain values through", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes cells with separators and doubles inner quotes", () => {
    expect(csvCell('has "quotes"')).toBe('"has ""quotes"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("neutralizes formula injection prefixes", () => {
    for (const payload of [
      '=HYPERLINK("http://evil","click")',
      "=cmd|'/c calc'!A1",
      "+1+1",
      "-2+3",
      "@SUM(1)",
      "\t=tab",
      "\r=cr",
    ]) {
      const out = csvCell(payload);
      // A leading apostrophe must sit between any quote wrapping and the
      // dangerous character — that is what makes spreadsheets treat the
      // cell as text.
      expect(out.replace(/^"/, ""), payload).toMatch(/^'/);
    }
  });

  it("does not mangle normal values that merely contain = later", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("2026-10-20T03:00:00Z")).toBe("2026-10-20T03:00:00Z");
  });
});
