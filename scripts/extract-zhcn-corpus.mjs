#!/usr/bin/env node
// FILE: extract-zhcn-corpus.mjs
// Purpose: Turn the community zh-CN bundle-patch script into a plain English -> Chinese map
//          that the i18n migration can consult phrase by phrase.
//
// Source: https://github.com/tttnny/synara-chinese-localization (credited in README.md)
//
// That script replaces literals inside a minified bundle, so both sides carry their original
// delimiters, e.g.  'label:`General`': 'label:`常规`'  or  '"Quit"': '"退出"'. This strips the
// delimiters and any property prefix to recover the bare phrases.
//
// Usage: node scripts/extract-zhcn-corpus.mjs <localize-patch.js> [output.json]

import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath = "zhcn-corpus.json"] = process.argv;

if (!inputPath) {
  console.error("Usage: node scripts/extract-zhcn-corpus.mjs <localize-patch.js> [output.json]");
  process.exit(1);
}

/** Matches a single `'from': 'to',` dictionary entry, honoring backslash escapes on both sides. */
const ENTRY_PATTERN = /^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/;

/** Strip JS escaping, an optional `prop:` prefix, and the surrounding backtick or double quote. */
function toBarePhrase(raw) {
  const unescaped = raw.replace(/\\(.)/g, "$1");
  const withoutPrefix = unescaped.replace(/^[A-Za-z_$][\w$]*:/, "");

  const first = withoutPrefix.at(0);
  const last = withoutPrefix.at(-1);
  const isWrapped = withoutPrefix.length >= 2 && first === last && (first === "`" || first === '"');

  return isWrapped ? withoutPrefix.slice(1, -1) : withoutPrefix;
}

const corpus = {};
const conflicts = [];
let entryCount = 0;

for (const line of readFileSync(inputPath, "utf-8").split(/\r?\n/)) {
  const match = ENTRY_PATTERN.exec(line);
  if (!match) continue;

  const english = toBarePhrase(match[1]);
  const chinese = toBarePhrase(match[2]);
  if (english.length === 0 || chinese.length === 0) continue;

  entryCount += 1;

  const existing = corpus[english];
  if (existing !== undefined && existing !== chinese) {
    conflicts.push({ english, existing, incoming: chinese });
    continue;
  }

  corpus[english] = chinese;
}

const sorted = Object.fromEntries(
  Object.entries(corpus).toSorted(([left], [right]) => left.localeCompare(right)),
);

writeFileSync(outputPath, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");

console.log(`Parsed ${entryCount} entries -> ${Object.keys(sorted).length} unique phrases`);
console.log(`Written to ${outputPath}`);

if (conflicts.length > 0) {
  console.log(`\n${conflicts.length} phrases have conflicting translations; resolve by hand:`);
  for (const { english, existing, incoming } of conflicts) {
    console.log(`  "${english}": "${existing}" vs "${incoming}"`);
  }
}
