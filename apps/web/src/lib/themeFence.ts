// FILE: themeFence.ts
// Purpose: Pure parsing/degradation logic for ```theme fences plus the
//          closed-fence check the HTML preview needs. Streaming renders every
//          frame with a partially received fence, so failures always degrade to
//          a plain code block — the parse result only distinguishes the reasons
//          so the caller can dev-warn on genuinely malformed (but complete) JSON.
// Layer: Web chat markdown helper (pure functions — no React)
// Exports: parseThemeFence, isThemeFenceClosed, buildThemeFenceSrcdoc,
//          buildStructuredThemeAdoptionMessage, buildHtmlThemeAdoptionMessage,
//          type ThemeFenceParseResult, type ThemeAdoptionMessageCopy

import { Schema } from "effect";
import { ThemeFencePayload } from "@synara/contracts";
import { extractHexColorsFromSource } from "./colorSwatch";

export type ThemeFenceParseResult =
  | { readonly kind: "theme"; readonly payload: ThemeFencePayload }
  /**
   * "invalid-json" is the normal streaming state (truncated JSON on every
   * frame) and must stay silent; "invalid-shape" means the JSON parsed but the
   * payload misses required fields — a real contract violation worth a dev warn.
   */
  | { readonly kind: "degrade"; readonly reason: "invalid-json" | "invalid-shape" };

const decodeThemeFencePayload = Schema.decodeUnknownSync(ThemeFencePayload);

export function parseThemeFence(source: string): ThemeFenceParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { kind: "degrade", reason: "invalid-json" };
  }
  try {
    return { kind: "theme", payload: decodeThemeFencePayload(parsed) };
  } catch {
    return { kind: "degrade", reason: "invalid-shape" };
  }
}

const CLOSING_FENCE_LINE_REGEX = /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/;

/**
 * Whether the fenced block ending at `nodeEndOffset` is closed in `source`.
 * micromark auto-closes an unterminated fence at EOF, so while a message is
 * still streaming the only reliable signal is whether the node's source range
 * actually ends with a closing fence line. Completed messages always count as
 * closed — even an agent that forgot the closing fence gets the preview then.
 */
export function isThemeFenceClosed(input: {
  readonly source: string;
  readonly nodeEndOffset: number | undefined;
  readonly isStreaming: boolean;
}): boolean {
  if (!input.isStreaming) {
    return true;
  }
  if (input.nodeEndOffset === undefined) {
    return false;
  }
  const slice = input.source.slice(0, input.nodeEndOffset).trimEnd();
  const lastLineStart = slice.lastIndexOf("\n") + 1;
  return CLOSING_FENCE_LINE_REGEX.test(slice.slice(lastLineStart));
}

/**
 * CSP for the sandboxed HTML preview. `sandbox=""` already blocks scripts and
 * navigation, but not passive fetches — an `<img src="https://tracker...">` or
 * an external font would still leak. `default-src 'none'` closes that channel;
 * inline styles and data: images are the only capabilities the preview needs.
 * The policy must ride a `<meta>` inside the srcdoc because a srcdoc document
 * has no HTTP response headers of its own.
 */
const THEME_FENCE_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** Wraps agent HTML in a srcdoc document whose first head element is the CSP meta. */
export function buildThemeFenceSrcdoc(html: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${THEME_FENCE_PREVIEW_CSP}">` +
    `</head><body>${html}</body></html>`
  );
}

/**
 * Localized sentences framing an adoption message. The message is sent to the
 * agent as a user turn and shows up verbatim in the transcript, so it follows
 * the UI language instead of being hardcoded. The three-line shape (heading /
 * colors / request) is fixed by the design spec (section 5); only the wording
 * is localized.
 */
export interface ThemeAdoptionMessageCopy {
  /** Heading for the structured path, which knows the palette's name. */
  readonly namedHeading: (name: string) => string;
  /** Heading for the HTML path, which has no palette name. */
  readonly heading: string;
  /** Closing request line. */
  readonly request: string;
}

/**
 * Message sent back through the composer chain when the user adopts a
 * structured theme: heading, one `token hex` line per color, closing request.
 */
export function buildStructuredThemeAdoptionMessage(
  payload: ThemeFencePayload,
  copy: ThemeAdoptionMessageCopy,
): string {
  const lines = payload.colors.map((color) => `${color.token} ${color.hex}`);
  return `${copy.namedHeading(payload.name)}\n${lines.join("\n")}\n${copy.request}`;
}

/**
 * Adoption message for the HTML path: no token names exist, so the message
 * degrades to the source's hex colors, deduplicated in order of appearance.
 * Returns null when the markup contains no hex colors (nothing to adopt).
 */
export function buildHtmlThemeAdoptionMessage(
  htmlSource: string,
  copy: ThemeAdoptionMessageCopy,
): string | null {
  const colors = extractHexColorsFromSource(htmlSource);
  if (colors.length === 0) {
    return null;
  }
  return `${copy.heading}\n${colors.join(" ")}\n${copy.request}`;
}
