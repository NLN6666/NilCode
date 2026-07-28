// FILE: codeFence.ts
// Purpose: Parse markdown code-fence info strings into a highlighter language plus
//          optional file-reference metadata (Cursor-style `startLine:endLine:path`).
// Layer: web chat markdown helper
// Exports: parseCodeFenceInfo, type CodeFenceInfo
// Depends on: @pierre/diffs filename→language map (shared with the diff renderer)
//             and the shared path basename helper (file-icons).

import { getFiletypeFromFileName } from "@pierre/diffs";
import { THEME_FENCE_HTML_MODIFIER, THEME_FENCE_LANGUAGE } from "@synara/contracts";
import { basenameOfPath } from "../file-icons";

/**
 * Which color-theme preview a fence opts into: "structured" for ```theme
 * (JSON payload), "html" for ```html theme (sandboxed markup preview), null
 * for every ordinary fence. A bare ```html fence stays null on purpose — the
 * trailing keyword is the rendering switch.
 */
export type ThemePreviewFenceKind = "structured" | "html" | null;

export interface CodeFenceInfo {
  /** Highlighter language id (a valid Shiki language/alias, falling back to "text"). */
  readonly language: string;
  /** True when the fence info encodes a file reference rather than a bare language. */
  readonly isFileReference: boolean;
  /** Full file path when this fence references a file, else null. */
  readonly filePath: string | null;
  /** Basename of the referenced file for display, else null. */
  readonly fileName: string | null;
  /** Directory portion of the referenced path (no trailing slash), else null. */
  readonly directory: string | null;
  /** Line range label like "173-186" (or a single line), else null. */
  readonly lineRange: string | null;
  /** Theme-preview opt-in derived from the fence info, else null. */
  readonly themePreview: ThemePreviewFenceKind;
}

function directoryFromPath(filePath: string, fileName: string): string | null {
  const dir = filePath.slice(0, Math.max(0, filePath.length - fileName.length));
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function fileReferenceInfo(filePath: string, lineRange: string | null): CodeFenceInfo {
  const fileName = basenameOfPath(filePath);
  return {
    // Reuse the diff renderer's filename→language map so chat code references and
    // diff views resolve languages identically; unknown extensions yield "text".
    language: getFiletypeFromFileName(fileName),
    isFileReference: true,
    filePath,
    fileName,
    directory: directoryFromPath(filePath, fileName),
    lineRange,
    themePreview: null,
  };
}

const LEADING_WHITESPACE_REGEX = /^[ \t]*/;

// Removes the indentation common to every non-empty line so snippets pulled from
// deeply nested code don't render pushed far to the right. Lines keep their
// relative indentation, so it is a no-op for blocks that are already flush-left.
export function dedentCode(code: string): string {
  const lines = code.split("\n");
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = LEADING_WHITESPACE_REGEX.exec(line)?.[0].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return code;
  }
  return lines.map((line) => line.slice(minIndent)).join("\n");
}

const CODE_REFERENCE_REGEX = /^(\d+):(\d+):(.+)$/;

// Parses a fence info string (language token plus any trailing meta words).
// Recognizes Cursor-style file references (`startLine:endLine:path`) and bare
// file paths, deriving the highlighter language from the file extension, plus
// the theme-preview fences (```theme and ```html theme). Everything else is
// treated as a plain language token (preserving the legacy `gitignore` → `ini`
// alias). Trailing meta words other than the theme modifier are ignored.
export function parseCodeFenceInfo(rawInfo: string): CodeFenceInfo {
  const info = rawInfo.trim();
  const tokens = info.split(/\s+/).filter((token) => token.length > 0);
  const primary = tokens[0] ?? "";

  // Structured theme fence: the JSON degrades gracefully to a highlighted json
  // code block whenever the payload does not parse.
  if (primary === THEME_FENCE_LANGUAGE) {
    return {
      language: "json",
      isFileReference: false,
      filePath: null,
      fileName: null,
      directory: null,
      lineRange: null,
      themePreview: "structured",
    };
  }

  const referenceMatch = primary.match(CODE_REFERENCE_REGEX);
  if (referenceMatch) {
    const [, start, end, filePath] = referenceMatch;
    if (start != null && end != null && filePath != null) {
      const lineRange = start === end ? start : `${start}-${end}`;
      return fileReferenceInfo(filePath, lineRange);
    }
  }

  // A bare path (contains a separator) is treated as an un-ranged file reference.
  if (primary.includes("/") || primary.includes("\\")) {
    return fileReferenceInfo(primary, null);
  }

  // HTML theme fence: the language stays "html" so the block still highlights
  // normally wherever the preview is not (yet) shown.
  const themePreview: ThemePreviewFenceKind =
    primary === "html" && tokens.slice(1).includes(THEME_FENCE_HTML_MODIFIER) ? "html" : null;

  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685).
  const language = primary === "gitignore" ? "ini" : primary.length > 0 ? primary : "text";
  return {
    language,
    isFileReference: false,
    filePath: null,
    fileName: null,
    directory: null,
    lineRange: null,
    themePreview,
  };
}
