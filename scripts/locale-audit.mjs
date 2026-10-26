#!/usr/bin/env node
/**
 * Locale audit: deeper than the hash gate — key parity vs en, placeholder
 * ({x}/ICU) mismatches, untranslated-value suspects, duplicate values.
 * Covers EVERY locale in src/locales/ (not just fr/es) so a forgotten key,
 * a broken placeholder, or an untranslated string in ANY language is caught.
 *
 * Run alongside the gates when touching locale files: npm run i18n:audit
 * Exit code: 1 when a CI-failing defect is found (key parity / placeholder
 * parity), 0 otherwise. Untranslated suspects are reported as warnings only —
 * legitimately-identical values (brand names, technical terms) make them too
 * noisy to gate on.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// ── flatten locale files into dotted key paths + values ─────────────────
// also collect nested-object keys (e.g. errors.errorBoundary.title)
function flattenDeep(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out = {};
  function visit(node, prefix) {
    if (ts.isObjectLiteralExpression(node)) {
      node.properties.forEach((p) => {
        if (ts.isPropertyAssignment(p)) {
          const name = p.name.getText(sf).replace(/^['"]|['"]$/g, "");
          const key = prefix ? `${prefix}.${name}` : name;
          if (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) {
            out[key] = p.initializer.text;
          } else {
            visit(p.initializer, key);
          }
        }
      });
    }
  }
  const decl = sf.statements.find(ts.isVariableStatement)?.declarationList?.declarations?.[0]?.initializer;
  visit(decl, "");
  return out;
}

const localesDir = path.join(root, "src/locales");
const en = flattenDeep(path.join(localesDir, "en.ts"));

// Discover every non-English locale file dynamically (fr, es, de, zh, ar,
// pt-BR, it, ja, ru, tr, …) so a new locale is audited the day it lands.
const localeDicts = fs
  .readdirSync(localesDir)
  .filter((f) => f.endsWith(".ts") && f !== "en.ts")
  .sort()
  .map((f) => ({ name: f.replace(/\.ts$/, ""), dict: flattenDeep(path.join(localesDir, f)) }));

if (localeDicts.length === 0) {
  console.error("No locale files found next to en.ts");
  process.exit(1);
}

const enKeys = new Set(Object.keys(en));

// CI-failing defects vs warnings.
const errors = [];
const warnings = [];

// ── 1. key parity en↔<each locale> ──────────────────────────────────────
console.log(`== key parity (en vs ${localeDicts.length} locales) ==`);
for (const { name, dict } of localeDicts) {
  const keys = new Set(Object.keys(dict));
  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));
  if (missing.length || extra.length) {
    console.log(`  ${name}: missing=${missing.length} extra=${extra.length}`);
    if (missing.length) {
      console.log(`    missing: ${missing.join(", ")}`);
      errors.push(`${name}: ${missing.length} missing key(s)`);
    }
    if (extra.length) {
      console.log(`    extra:   ${extra.join(", ")}`);
      warnings.push(`${name}: ${extra.length} extra (not in en)`);
    }
  } else {
    console.log(`  ${name}: ok (${keys.size} keys)`);
  }
}

// ── 2. placeholder parity ({x} / {count} / ICU) per locale ──────────────
function ph(v) {
  const s = new Set();
  // Capture placeholder NAMES from both simple {name} and ICU {name, plural,
  // ...} forms. The ICU construct's name is what the caller passes, so it must
  // be PRESERVED (the old code stripped the whole ICU block to a literal and
  // lost the name, making en look placeholder-less vs ja/zh which drop ICU
  // plurals and keep a plain {name} — a false mismatch on correct translations).
  // Requires { immediately followed by word chars then , or } so internal ICU
  // branch labels (`one {`, `=1 {`) and `#` are never captured.
  for (const m of v.matchAll(/\{(\w+)(?:,|\})/g)) s.add(m[1]);
  return s;
}
console.log("\n== placeholder mismatches en vs each locale ==");
let phTotal = 0;
for (const { name, dict } of localeDicts) {
  let phCount = 0;
  for (const k of Object.keys(en)) {
    if (!(k in dict)) continue;
    const a = ph(en[k]);
    const b = ph(dict[k]);
    if (a.size !== b.size || [...a].some((x) => !b.has(x))) {
      phCount++;
      console.log(`  ${name} ${k}: en=${[...a]} ${name}=${[...b]}`);
    }
  }
  if (phCount) errors.push(`${name}: ${phCount} placeholder mismatch(es)`);
  phTotal += phCount;
}
if (!phTotal) console.log("  none");

// ── 3. untranslated / suspicious values per locale (WARNING only) ───────
// Single-word technical terms / brand names that legitimately stay identical
// across languages. Multi-word identical values are reported but not fatal.
const IDENTICAL_OK = /^(URL|SVG|PNG|KB|SMS|Bio|Star|Auto|Center|Tile|Contain|Cover|Gel|Mesh|Pixel|Néon|Radial|Glass|Regular|Semibold|Profil|Terminal|Design|links|Setup)$/i;
console.log("\n== values identical to en (possible untranslated — warning only) ==");
for (const { name, dict } of localeDicts) {
  let idCount = 0;
  const samples = [];
  for (const k of Object.keys(en)) {
    if (!(k in dict)) continue;
    if (en[k] === dict[k] && /[a-z]{3,}/i.test(en[k])) {
      // ignore single-word technical terms that legitimately stay the same
      if (en[k].split(/\s+/).length === 1 && IDENTICAL_OK.test(en[k])) continue;
      idCount++;
      if (samples.length < 5) samples.push(`${k}: "${en[k].slice(0, 48)}"`);
    }
  }
  if (idCount) {
    console.log(`  ${name}: ${idCount} suspect(s)`);
    for (const s of samples) console.log(`    ${s}`);
    if (idCount > 5) console.log(`    … and ${idCount - 5} more`);
    warnings.push(`${name}: ${idCount} possibly-untranslated value(s)`);
  } else {
    console.log(`  ${name}: none`);
  }
}

// ── 4. duplicate values within en ────────────────────────────────────────
console.log("\n== duplicate values within en.ts (info only) ==");
const byVal = {};
for (const [k, v] of Object.entries(en)) {
  if (!/[a-z]{3,}/i.test(v)) continue;
  (byVal[v] ??= []).push(k);
}
const dups = Object.entries(byVal).filter(([, ks]) => ks.length > 1);
for (const [v, ks] of dups) {
  console.log(`  "${v.slice(0, 50)}" → ${ks.join(", ")}`);
}
console.log(`  (${dups.length} duplicate groups)`);

// ── 5. unused keys: scan src for t("key") / t.rich usage ─────────────────
console.log("\n== unused-key scan (en.ts keys never referenced in src) ==");
const srcFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p);
    } else if (/\.(tsx?|mjs)$/.test(e.name)) {
      srcFiles.push(p);
    }
  }
})(path.join(root, "src"));

const referenced = new Set(); // dotted full paths like "common.save"
const dynamicRefs = new Set(); // refs built from constants (label: "bgSolid")

for (const f of srcFiles) {
  if (f.includes("src/locales/")) continue;
  const src = fs.readFileSync(f, "utf8");
  // namespaces bound in this file (per-file set: over-approximates scope,
  // safer for unused-detection than last-wins per-var)
  const nsSet = new Set();
  for (const m of src.matchAll(/(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g)) {
    nsSet.add(m[1]);
  }
  for (const m of src.matchAll(/\b(\w+)\s*(?:\.\s*(rich|raw|markup|has)\s*)?\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const callee = m[1];
    if (!/^t[A-Z]?/.test(callee)) continue;
    const key = m[3];
    for (const ns of nsSet) referenced.add(`${ns}.${key}`);
    referenced.add(`(bare).${key}`);
  }
  // constants arrays (theme-constants label keys, action-error map)
  for (const m of src.matchAll(/label:\s*"([A-Za-z0-9_]+)"/g)) dynamicRefs.add(m[1]);
}

// error map: MESSAGE_KEYS values are errors-namespace keys
for (const m of fs.readFileSync(path.join(root, "src/lib/action-error-i18n.ts"), "utf8").matchAll(/:\s*"([A-Za-z0-9_]+)",/g)) {
  dynamicRefs.add(m[1]);
}

const leaves = Object.keys(en).filter((k) => typeof en[k] === "string");
const unused = leaves.filter((k) => {
  if (referenced.has(k)) return false;
  const leaf = k.split(".").pop();
  if (dynamicRefs.has(leaf)) return false;
  // bare t("key") where the var has no known namespace — can't resolve
  const bareHits = [...referenced].filter((r) => r.startsWith("(bare).") && r.endsWith("." + leaf));
  if (bareHits.length) return false;
  return true;
});
console.log(`  ${unused.length} possibly-unused keys:`);
for (const k of unused) console.log(`    ${k}`);
if (unused.length) warnings.push(`${unused.length} possibly-unused key(s) in en.ts`);

// ── summary + exit code ─────────────────────────────────────────────────
console.log("\n== summary ==");
if (warnings.length) {
  console.log(`  warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`    ! ${w}`);
}
if (errors.length) {
  console.log(`  ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`    ✗ ${e}`);
  console.log("\nLocale audit FAILED — fix the errors above.");
  process.exit(1);
}
console.log("  no CI-failing errors.");
console.log("\nDone.");
