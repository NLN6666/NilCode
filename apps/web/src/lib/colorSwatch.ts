// FILE: colorSwatch.ts
// Purpose: Pure hex-color matching for inline color swatches. Position-aware on
//          purpose: prose only accepts 6/8-digit hex (3/4-digit tokens like
//          `#123` are almost always issue refs or anchors there), while inline
//          code accepts 3/4/6/8 because the backticks already signal "a value".
// Layer: Web chat markdown helper (pure functions — no React)
// Exports: findHexColorMatches, extractHexColorsFromSource, type HexColorMatch

/** Where the candidate text sits; decides which hex lengths are accepted. */
export type HexMatchContext = "prose" | "inlineCode";

export interface HexColorMatch {
  /** Index of the `#` in the source string. */
  readonly start: number;
  /** Exclusive end index of the hex literal. */
  readonly end: number;
  /** The literal as written, including the `#`. */
  readonly hex: string;
}

// Longest alternative first so an 8-digit literal is never read as 6 + junk.
const PROSE_HEX_REGEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})/g;
const INLINE_CODE_HEX_REGEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})/g;

// Word chars (or another `#`) touching the literal disqualify it, so prefixes
// of longer runs like `#deadbeef00` and fragments like `x#ffffff` never match.
const BOUNDARY_BREAKER_REGEX = /[\w#]/;

export function findHexColorMatches(text: string, context: HexMatchContext): HexColorMatch[] {
  // Hot path: transcripts re-parse every streamed frame, so text without a `#`
  // must return before any regex work.
  if (!text.includes("#")) {
    return [];
  }
  const regex = context === "prose" ? PROSE_HEX_REGEX : INLINE_CODE_HEX_REGEX;
  const matches: HexColorMatch[] = [];
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = start > 0 ? (text[start - 1] ?? "") : "";
    const after = end < text.length ? (text[end] ?? "") : "";
    if (before.length > 0 && BOUNDARY_BREAKER_REGEX.test(before)) {
      continue;
    }
    if (after.length > 0 && BOUNDARY_BREAKER_REGEX.test(after)) {
      continue;
    }
    matches.push({ start, end, hex: match[0] });
  }
  return matches;
}

/**
 * Every hex literal in a source text (all lengths), deduplicated
 * case-insensitively in order of first appearance and normalized to lowercase.
 * Used by the HTML theme-fence "adopt" action, which has no token names and
 * falls back to the raw colors of the markup.
 */
export function extractHexColorsFromSource(source: string): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const match of findHexColorMatches(source, "inlineCode")) {
    const normalized = match.hex.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    colors.push(normalized);
  }
  return colors;
}
