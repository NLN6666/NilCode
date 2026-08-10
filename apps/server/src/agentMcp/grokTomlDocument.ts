// FILE: grokTomlDocument.ts
// Purpose: Flip one Grok MCP server on or off in `~/.grok/config.toml`. Grok has two switches
//          and both decide the outcome, so both are written.
// Layer: Agent MCP config editing (pure string in, string out)
// Exports: applyGrokMcpEnabled

import { parse as parseToml } from "smol-toml";

import { applyCodexMcpEnabled } from "./codexTomlDocument";
import { GROK_DISABLED_LIST_KEY } from "./mcpConfigParser";

/**
 * Grok restricts server names to letters, digits, hyphens and underscores. The rewrite below
 * re-serializes the list with plain double quotes, which is only safe inside that charset; a
 * name outside it aborts the edit rather than risking a corrupted config.
 */
const SAFE_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** Start of the top-level assignment, matched only before the first table header. */
const DISABLED_LIST_ASSIGNMENT = new RegExp(
  `(^|\\n)([ \\t]*)${GROK_DISABLED_LIST_KEY}[ \\t]*=[ \\t]*\\[`,
);

function readDisabledList(text: string): ReadonlyArray<string> {
  const parsed = parseToml(text) as Record<string, unknown>;
  const value = parsed[GROK_DISABLED_LIST_KEY];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Index just past the `]` that closes the array opened at `openIndex`, skipping string bodies. */
function findArrayEnd(text: string, openIndex: number): number {
  let depth = 0;
  for (let cursor = openIndex; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '"' || char === "'") {
      const quote = char;
      cursor += 1;
      while (cursor < text.length && text[cursor] !== quote) {
        // Basic strings take escapes; literal strings do not, but skipping one extra
        // character inside a literal string can never cross its closing quote.
        if (quote === '"' && text[cursor] === "\\") cursor += 1;
        cursor += 1;
      }
      continue;
    }
    if (char === "#") {
      const lineEnd = text.indexOf("\n", cursor);
      if (lineEnd === -1) return -1;
      cursor = lineEnd;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return -1;
}

/**
 * Rewrites `disabled_mcp_servers` to `next`. The whole assignment is re-serialized rather than
 * edited element by element: this list is written by `grok mcp disable` rather than by hand, so
 * normalizing its formatting costs nothing, while element-level surgery across an array that may
 * be inline, multi-line, trailing-comma'd or commented is where corruption would come from.
 * Every other byte of the file is untouched.
 */
function replaceDisabledList(text: string, next: ReadonlyArray<string>): string {
  const match = DISABLED_LIST_ASSIGNMENT.exec(text);
  if (!match) return text;

  const openIndex = match.index + match[0].length - 1;
  const endIndex = findArrayEnd(text, openIndex);
  if (endIndex === -1) return text;

  const leadingBreak = match[1] ?? "";
  const indent = match[2] ?? "";
  const assignmentStart = match.index + leadingBreak.length;

  if (next.length === 0) {
    // Drop the assignment entirely; an absent list reads the same as an empty one, and
    // leaving `= []` behind would be noise the user never wrote.
    const trailingBreak = text.startsWith("\n", endIndex) ? 1 : 0;
    return `${text.slice(0, assignmentStart)}${text.slice(endIndex + trailingBreak)}`;
  }

  const serialized = next.map((name) => `"${name}"`).join(", ");
  return `${text.slice(0, assignmentStart)}${indent}${GROK_DISABLED_LIST_KEY} = [${serialized}]${text.slice(endIndex)}`;
}

/**
 * Switches `name` on or off, honouring both of Grok's mechanisms.
 *
 * Disabling writes `[mcp_servers.<name>].enabled = false`, which is sufficient on its own.
 * Enabling must additionally drop the name from `disabled_mcp_servers`: that list wins over the
 * table field, so setting `enabled = true` alone would leave the server off and the toggle would
 * appear to do nothing.
 */
export function applyGrokMcpEnabled(text: string, name: string, enabled: boolean): string {
  const withTableFlag = applyCodexMcpEnabled(text, name, enabled);
  if (!enabled) return withTableFlag;

  const disabled = readDisabledList(withTableFlag);
  if (!disabled.includes(name)) return withTableFlag;

  const next = disabled.filter((entry) => entry !== name);
  const unsafe = next.find((entry) => !SAFE_SERVER_NAME.test(entry));
  if (unsafe !== undefined) {
    throw new Error(
      `Cannot rewrite ${GROK_DISABLED_LIST_KEY}: "${unsafe}" is not a name Grok can produce. Edit the file by hand.`,
    );
  }

  const result = replaceDisabledList(withTableFlag, next);
  if (readDisabledList(result).includes(name)) {
    throw new Error(
      `Enabling "${name}" did not take effect as expected; the file was left unchanged.`,
    );
  }
  return result;
}
