// FILE: browserElementSelectionBuilder.ts
// Purpose: Normalize the untrusted payload a picked page element returns into a
//          BrowserElementSelection that is safe to send over IPC and into prompts.
// Layer: Desktop pure helper (no Electron imports so it stays unit-testable)
// Exports: buildBrowserElementSelection, browserElementScreenshotName, limits + style allowlist

import type { BrowserElementRect, BrowserElementSelection } from "@synara/contracts";

export const BROWSER_ELEMENT_TEXT_MAX_CHARS = 200;
export const BROWSER_ELEMENT_HTML_MAX_CHARS = 1_200;
export const BROWSER_ELEMENT_SELECTOR_MAX_CHARS = 300;
export const BROWSER_ELEMENT_MAX_CLASS_NAMES = 12;
export const BROWSER_ELEMENT_CLASS_NAME_MAX_CHARS = 80;
export const BROWSER_ELEMENT_TAG_NAME_MAX_CHARS = 40;
export const BROWSER_ELEMENT_ID_MAX_CHARS = 120;
export const BROWSER_ELEMENT_STYLE_VALUE_MAX_CHARS = 120;

// Enough for an agent to reason about layout and visual defects without flooding the
// prompt with the couple hundred properties getComputedStyle actually exposes.
export const BROWSER_ELEMENT_STYLE_ALLOWLIST = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "border",
  "border-radius",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "z-index",
  "overflow",
] as const;

// Unicode "Cc" (C0/C1 control) via a property escape so no literal control byte has to
// live in this source file.
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/gu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Page-authored text can carry NULs, ANSI escapes, and arbitrary newlines. Collapse it
// all to a single-line snippet before it can reach a prompt block or a chip label.
function normalizeSnippet(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const collapsed = value.replace(CONTROL_CHARACTER_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeRect(value: unknown): BrowserElementRect {
  const source = isRecord(value) ? value : {};
  return {
    x: normalizeFiniteNumber(source.x),
    y: normalizeFiniteNumber(source.y),
    width: Math.max(0, normalizeFiniteNumber(source.width)),
    height: Math.max(0, normalizeFiniteNumber(source.height)),
  };
}

function normalizeClassNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const classNames: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (classNames.length >= BROWSER_ELEMENT_MAX_CLASS_NAMES) {
      break;
    }
    const className = normalizeSnippet(entry, BROWSER_ELEMENT_CLASS_NAME_MAX_CHARS).replace(
      /\s+/g,
      "",
    );
    if (className.length === 0 || seen.has(className)) {
      continue;
    }
    seen.add(className);
    classNames.push(className);
  }
  return classNames;
}

function normalizeComputedStyles(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const styles: Record<string, string> = {};
  for (const property of BROWSER_ELEMENT_STYLE_ALLOWLIST) {
    const normalized = normalizeSnippet(value[property], BROWSER_ELEMENT_STYLE_VALUE_MAX_CHARS);
    if (normalized.length === 0) {
      continue;
    }
    styles[property] = normalized;
  }
  return styles;
}

/**
 * Builds a normalized selection from the raw `Runtime.callFunctionOn` result.
 *
 * Returns `null` when the payload is not a usable element description (missing or
 * non-string `selector`/`tagName`). Callers treat that as "cancel this pick" rather
 * than throwing, so a hostile or broken page can't take the pick session down.
 */
export function buildBrowserElementSelection(input: {
  tabId: string;
  pageUrl: string;
  raw: unknown;
}): BrowserElementSelection | null {
  if (!isRecord(input.raw)) {
    return null;
  }

  const selector = normalizeSnippet(input.raw.selector, BROWSER_ELEMENT_SELECTOR_MAX_CHARS);
  const tagName = normalizeSnippet(input.raw.tagName, BROWSER_ELEMENT_TAG_NAME_MAX_CHARS)
    .replace(/\s+/g, "")
    .toLowerCase();
  if (selector.length === 0 || tagName.length === 0) {
    return null;
  }

  const elementId = normalizeSnippet(input.raw.elementId, BROWSER_ELEMENT_ID_MAX_CHARS).replace(
    /\s+/g,
    "",
  );
  const textSnippet = normalizeSnippet(input.raw.textSnippet, BROWSER_ELEMENT_TEXT_MAX_CHARS);

  return {
    tabId: input.tabId,
    pageUrl: input.pageUrl,
    selector,
    tagName,
    elementId: elementId.length > 0 ? elementId : null,
    classNames: normalizeClassNames(input.raw.classNames),
    textSnippet: textSnippet.length > 0 ? textSnippet : null,
    outerHtmlSnippet: normalizeSnippet(input.raw.outerHtmlSnippet, BROWSER_ELEMENT_HTML_MAX_CHARS),
    rect: normalizeRect(input.raw.rect),
    computedStyles: normalizeComputedStyles(input.raw.computedStyles),
  };
}

// Mirrors the plain screenshot naming scheme (`<host>-<timestamp>.png`) so element crops
// read as browser captures in the composer attachment list.
export function browserElementScreenshotName(pageUrl: string, tagName: string): string {
  const safeTag = tagName.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "element";
  let host = "browser";
  try {
    const hostname = new URL(pageUrl).hostname.trim().toLowerCase();
    host = hostname.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "browser";
  } catch {
    host = "browser";
  }
  return `${host}-${safeTag}-${Date.now()}.png`;
}
