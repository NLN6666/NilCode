// FILE: scan-hardcoded-copy.mjs
// Purpose: Find user-facing English copy still hard-coded in apps/web, so the i18n migration has
//          a progress meter and an acceptance check instead of a guess.
// Usage:   node scripts/scan-hardcoded-copy.mjs [--dir <sub-path>] [--list] [--json]
//
// Reports JSX text nodes and copy-bearing JSX attributes holding English literals. Everything on
// the never-translate list (plan 012 §4) is filtered out: product and provider names, code and
// terminal content, model slugs, and anything that is plainly an identifier rather than prose.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = join(REPO_ROOT, "apps", "web", "src");

/** JSX attributes that carry prose a user reads. `title` doubles as a DOM tooltip. */
const COPY_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "alt",
  "confirmLabel",
  "cancelLabel",
  "description",
  "emptyMessage",
  "heading",
  "helperText",
  "label",
  "message",
  "placeholder",
  "subtitle",
  "title",
  "tooltip",
]);

/** Files that legitimately hold English: catalogs, tests, and the copy-free style modules. */
const IGNORED_PATH_PARTS = ["/i18n/locales/", "__snapshots__"];
const IGNORED_SUFFIXES = [".test.ts", ".test.tsx", ".browser.tsx", ".d.ts"];

/**
 * Never-translate (plan 012 §4). Product, provider, and vendor names stay in English so the UI
 * keeps matching the docs; code-shaped tokens are not prose at all.
 */
const NEVER_TRANSLATE = new Set(
  [
    "AppSnap",
    "Synara",
    "Studio",
    "Codex",
    "Claude",
    "Cursor",
    "Antigravity",
    "Grok",
    "Droid",
    "Factory Droid",
    "Kilo",
    "OpenCode",
    "Pi",
    "MCP",
    "GitHub",
    "Git",
    "CLI",
    "API",
    "URL",
    "JSON",
    "PR",
    "CI",
    "SSH",
    "HTTPS",
    "UUID",
    "OAuth",
    "npm",
    "Bun",
    "Node",
  ].map((name) => name.toLowerCase()),
);

/** Prose needs a run of letters; `setting-foo`, `px`, `1.2.3` and lone symbols do not qualify. */
function isLikelyProse(raw) {
  const text = raw.trim();
  if (text.length < 3) return false;
  // At least two letter-runs, or one run of 4+ letters: filters slugs, units, and enum values.
  const words = text.match(/[A-Za-z][a-z]+/g) ?? [];
  if (words.length === 0) return false;
  if (words.length === 1 && words[0].length < 4) return false;
  if (/^[a-z0-9-]+$/.test(text) && !text.includes(" ")) return false; // kebab / lowercase token
  if (/^[A-Z0-9_]+$/.test(text)) return false; // SCREAMING_CASE constant
  if (/^(https?:\/\/|\/|\.\/|~\/)/.test(text)) return false; // URLs and paths
  if (/^[{}()[\]<>|,.;:!?%$#@*+=/\\'"`\s-]+$/.test(text)) return false; // punctuation only
  if (NEVER_TRANSLATE.has(text.toLowerCase())) return false;
  return true;
}

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const posix = full.split(sep).join("/");
    if (IGNORED_PATH_PARTS.some((part) => posix.includes(part))) continue;
    if (IGNORED_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    out.push(full);
  }
  return out;
}

/** The literal text of an attribute value, or null when it is not a plain string. */
function attributeLiteral(initializer) {
  if (initializer === undefined) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) {
    const inner = initializer.expression;
    if (ts.isStringLiteral(inner)) return inner.text;
    if (ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
  }
  return null;
}

function scanFile(filePath) {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];

  const record = (node, kind, text) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ line: line + 1, kind, text: text.trim().replace(/\s+/g, " ") });
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      if (isLikelyProse(node.text)) record(node, "text", node.text);
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      if (COPY_ATTRIBUTES.has(node.name.text)) {
        const literal = attributeLiteral(node.initializer);
        if (literal !== null && isLikelyProse(literal)) {
          record(node, node.name.text, literal);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
}

const args = process.argv.slice(2);
const dirArg = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "";
const root = dirArg ? join(WEB_SRC, dirArg) : WEB_SRC;

const results = collectSourceFiles(root)
  .map((file) => ({
    file: relative(REPO_ROOT, file).split(sep).join("/"),
    findings: scanFile(file),
  }))
  .filter((entry) => entry.findings.length > 0)
  .toSorted((a, b) => b.findings.length - a.findings.length);

const total = results.reduce((sum, entry) => sum + entry.findings.length, 0);

if (args.includes("--json")) {
  console.log(JSON.stringify({ total, files: results }, null, 2));
} else if (args.includes("--list")) {
  for (const { file, findings } of results) {
    console.log(`\n${file}  (${findings.length})`);
    for (const finding of findings) {
      console.log(`  ${String(finding.line).padStart(4)}  [${finding.kind}] ${finding.text}`);
    }
  }
  console.log(`\n${total} hard-coded strings in ${results.length} files`);
} else {
  for (const { file, findings } of results) {
    console.log(`${String(findings.length).padStart(4)}  ${file}`);
  }
  console.log(`\n${total} hard-coded strings in ${results.length} files`);
}

process.exitCode = 0;
