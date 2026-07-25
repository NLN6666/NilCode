// FILE: codexTomlDocument.ts
// Purpose: Surgically add, replace or delete the `enabled` key of one `[mcp_servers.<name>]`
//          table inside a Codex `config.toml`, leaving every other byte untouched.
// Layer: Agent MCP config editing (pure string in, string out)
// Exports: applyCodexMcpEnabled

import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";

const MCP_SERVERS_TABLE = "mcp_servers";
const ENABLED_KEY = "enabled";

/** `enabled = <bool>` with the value isolated so a trailing comment survives a rewrite. */
const ENABLED_ASSIGNMENT = /^(\s*(?:enabled|"enabled"|'enabled')\s*=\s*)(true|false)(\s*(?:#.*)?)$/;
/** Looser probe used to find (and delete) an `enabled` line whose value is not a bare bool. */
const ENABLED_LINE = /^\s*(?:enabled|"enabled"|'enabled')\s*=/;

type MultilineDelimiter = '"""' | "'''";

interface DocumentLine {
  readonly content: string;
  /** "\r\n", "\n" or "" for a final line with no terminator. Preserved verbatim. */
  readonly ending: string;
  /**
   * True when the line begins inside an unterminated multi-line string. Such a line is string
   * data, not syntax: it must never be read as a table header or a key assignment, however much
   * it looks like one.
   */
  readonly insideMultilineString: boolean;
}

/**
 * TOML only recognizes LF and CRLF as newlines, so a two-way split on "\n" that remembers a
 * preceding "\r" round-trips any valid document byte for byte.
 */
function splitLines(text: string): ReadonlyArray<{ content: string; ending: string }> {
  const lines: Array<{ content: string; ending: string }> = [];
  let index = 0;
  while (index < text.length) {
    const breakIndex = text.indexOf("\n", index);
    if (breakIndex === -1) {
      lines.push({ content: text.slice(index), ending: "" });
      return lines;
    }
    const hasCarriageReturn = breakIndex > index && text[breakIndex - 1] === "\r";
    lines.push({
      content: text.slice(index, hasCarriageReturn ? breakIndex - 1 : breakIndex),
      ending: hasCarriageReturn ? "\r\n" : "\n",
    });
    index = breakIndex + 1;
  }
  return lines;
}

function joinLines(lines: ReadonlyArray<DocumentLine>): string {
  return lines.map((line) => `${line.content}${line.ending}`).join("");
}

/** Index just past a single-line string literal that starts at `start`. */
function skipStringLiteral(content: string, start: number, quote: '"' | "'"): number {
  let index = start + 1;
  while (index < content.length) {
    if (quote === '"' && content[index] === "\\") {
      index += 2;
      continue;
    }
    if (content[index] === quote) return index + 1;
    index += 1;
  }
  return content.length;
}

/**
 * Multi-line string state after consuming one line, given the state before it. Comments and
 * single-line strings are skipped so a `"""` inside either cannot open a phantom block.
 */
function advanceMultilineState(
  content: string,
  state: MultilineDelimiter | undefined,
): MultilineDelimiter | undefined {
  let index = 0;
  let current = state;
  while (index < content.length) {
    if (current) {
      const close = content.indexOf(current, index);
      if (close === -1) return current;
      index = close + 3;
      current = undefined;
      continue;
    }
    if (content[index] === "#") return undefined;
    if (content.startsWith('"""', index)) {
      current = '"""';
      index += 3;
      continue;
    }
    if (content.startsWith("'''", index)) {
      current = "'''";
      index += 3;
      continue;
    }
    if (content[index] === '"' || content[index] === "'") {
      index = skipStringLiteral(content, index, content[index] as '"' | "'");
      continue;
    }
    index += 1;
  }
  return current;
}

function scanLines(text: string): ReadonlyArray<DocumentLine> {
  let state: MultilineDelimiter | undefined;
  return splitLines(text).map((line) => {
    const insideMultilineString = state !== undefined;
    state = advanceMultilineState(line.content, state);
    return { content: line.content, ending: line.ending, insideMultilineString };
  });
}

interface QuotedKey {
  readonly value: string;
  readonly nextIndex: number;
}

function decodeUnicodeEscape(text: string, start: number, digits: number): string | undefined {
  const hex = text.slice(start, start + digits);
  if (hex.length !== digits || !/^[0-9A-Fa-f]+$/.test(hex)) return undefined;
  const codePoint = Number.parseInt(hex, 16);
  return codePoint > 0x10ffff ? undefined : String.fromCodePoint(codePoint);
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  e: "",
  '"': '"',
  "\\": "\\",
};

/**
 * Reads a quoted key part, decoding the full TOML basic-string escape set. Decoding matters
 * because `codexSource` lists servers through a real TOML parser: if this scanner resolved
 * `[mcp_servers."café"]` to a different name, the panel would show a server whose switch
 * always answered "not defined in the config".
 */
function readQuotedKey(text: string, start: number, quote: string): QuotedKey | undefined {
  let index = start + 1;
  let value = "";
  while (index < text.length) {
    const char = text[index]!;
    if (quote === '"' && char === "\\") {
      const escaped = text[index + 1];
      if (escaped === undefined) return undefined;
      const simple = SIMPLE_ESCAPES[escaped];
      if (simple !== undefined) {
        value += simple;
        index += 2;
        continue;
      }
      const digits = escaped === "u" ? 4 : escaped === "U" ? 8 : 0;
      if (digits === 0) return undefined;
      const decoded = decodeUnicodeEscape(text, index + 2, digits);
      if (decoded === undefined) return undefined;
      value += decoded;
      index += 2 + digits;
      continue;
    }
    if (char === quote) return { value, nextIndex: index + 1 };
    value += char;
    index += 1;
  }
  return undefined;
}

/**
 * Decoded key path of a standard table header, or undefined when the line is not one. Array-of-
 * tables headers (`[[…]]`) return undefined but are still reported as boundaries by
 * {@link isTableHeaderLine}, since `mcp_servers` entries are never arrays of tables.
 */
function parseTableHeaderKeys(rawLine: string): ReadonlyArray<string> | undefined {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith("[") || trimmed.startsWith("[[")) return undefined;

  const keys: Array<string> = [];
  let index = 1;
  let expectKey = true;

  while (index < trimmed.length) {
    const char = trimmed[index]!;
    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }
    if (char === "]") {
      if (expectKey) return undefined;
      const rest = trimmed.slice(index + 1).trim();
      return rest.length === 0 || rest.startsWith("#") ? keys : undefined;
    }
    if (!expectKey) {
      if (char !== ".") return undefined;
      expectKey = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quoted = readQuotedKey(trimmed, index, char);
      if (!quoted) return undefined;
      keys.push(quoted.value);
      index = quoted.nextIndex;
      expectKey = false;
      continue;
    }
    const bare = /^[A-Za-z0-9_-]+/.exec(trimmed.slice(index));
    if (!bare) return undefined;
    keys.push(bare[0]);
    index += bare[0].length;
    expectKey = false;
  }
  return undefined;
}

function isArrayTableHeaderLine(rawLine: string): boolean {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith("[[")) return false;
  const closing = trimmed.indexOf("]]");
  if (closing === -1) return false;
  const rest = trimmed.slice(closing + 2).trim();
  return rest.length === 0 || rest.startsWith("#");
}

/**
 * True when a line opens a new table. Matching the full header grammar rather than a leading `[`
 * keeps elements of a multi-line array (`  ["a"],`) from being mistaken for a table boundary,
 * and lines inside a multi-line string are excluded outright.
 */
function isTableHeaderLine(line: DocumentLine): boolean {
  if (line.insideMultilineString) return false;
  return parseTableHeaderKeys(line.content) !== undefined || isArrayTableHeaderLine(line.content);
}

function keysMatchServer(keys: ReadonlyArray<string>, name: string): boolean {
  return keys.length === 2 && keys[0] === MCP_SERVERS_TABLE && keys[1] === name;
}

interface ServerSection {
  readonly headerIndex: number;
  /** Exclusive end of the table body: the first following table header (including sub-tables). */
  readonly bodyEnd: number;
}

/**
 * Locates `[mcp_servers.<name>]` exactly. Prefix collisions (`[mcp_servers.foobar]`) and
 * sub-tables (`[mcp_servers.foo.env]`) are excluded by comparing decoded key paths, so both
 * `[mcp_servers."ida-pro-mcp"]` and `[mcp_servers.ida-pro-mcp]` resolve to the same server.
 */
function findServerSection(
  lines: ReadonlyArray<DocumentLine>,
  name: string,
): ServerSection | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.insideMultilineString) continue;
    const keys = parseTableHeaderKeys(line.content);
    if (!keys || !keysMatchServer(keys, name)) continue;

    let bodyEnd = index + 1;
    while (bodyEnd < lines.length && !isTableHeaderLine(lines[bodyEnd]!)) {
      bodyEnd += 1;
    }
    return { headerIndex: index, bodyEnd };
  }
  return undefined;
}

function findEnabledLineIndex(
  lines: ReadonlyArray<DocumentLine>,
  section: ServerSection,
): number | undefined {
  for (let index = section.headerIndex + 1; index < section.bodyEnd; index += 1) {
    const line = lines[index]!;
    if (line.insideMultilineString) continue;
    if (ENABLED_LINE.test(line.content)) return index;
  }
  return undefined;
}

/**
 * Whether a line carries no assignment the new key should be placed after. Lines inside a
 * multi-line string are string data and always count as content, so an insertion can never be
 * anchored in the middle of a multi-line value.
 */
function isBlankOrComment(line: DocumentLine): boolean {
  if (line.insideMultilineString) return false;
  const trimmed = line.content.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

/**
 * Index the new `enabled` line is spliced in front of: right after the table's last real
 * assignment. Trailing blank lines and the comment block that usually introduces the next
 * sub-table stay where the author put them, and the key can never slide past
 * `[mcp_servers.<name>.env]` (where TOML would silently reinterpret it as `env.enabled`).
 */
function resolveInsertIndex(lines: ReadonlyArray<DocumentLine>, section: ServerSection): number {
  let insertIndex = section.headerIndex + 1;
  for (let index = section.headerIndex + 1; index < section.bodyEnd; index += 1) {
    if (!isBlankOrComment(lines[index]!)) insertIndex = index + 1;
  }
  return insertIndex;
}

/** Line ending to give a freshly inserted line: the neighbour's, else the document's, else LF. */
function resolveEnding(lines: ReadonlyArray<DocumentLine>, neighbourIndex: number): string {
  const neighbour = lines[neighbourIndex]?.ending;
  if (neighbour) return neighbour;
  return lines.find((line) => line.ending.length > 0)?.ending ?? "\n";
}

function replaceEnabledLine(line: DocumentLine, enabled: boolean): DocumentLine {
  const assignment = ENABLED_ASSIGNMENT.exec(line.content);
  if (assignment) {
    // Keep the author's spacing, quoting of the key and any trailing comment; swap only the value.
    return { ...line, content: `${assignment[1]}${String(enabled)}${assignment[3]}` };
  }
  const indent = /^\s*/.exec(line.content)?.[0] ?? "";
  return { ...line, content: `${indent}${ENABLED_KEY} = ${String(enabled)}` };
}

function readServerTable(text: string, name: string): Record<string, unknown> {
  const document = parseToml(text) as Record<string, unknown>;
  const servers = document[MCP_SERVERS_TABLE];
  if (typeof servers !== "object" || servers === null) {
    throw new Error(`Codex config has no [${MCP_SERVERS_TABLE}] table.`);
  }
  const server = (servers as Record<string, unknown>)[name];
  if (typeof server !== "object" || server === null) {
    throw new Error(`Codex MCP server "${name}" is not defined in the config.`);
  }
  return server as Record<string, unknown>;
}

/** The parsed document with the target server's `enabled` key removed — the one key we may change. */
function parseWithoutEnabled(text: string, name: string): unknown {
  const document = parseToml(text) as Record<string, unknown>;
  const servers = document[MCP_SERVERS_TABLE];
  if (typeof servers !== "object" || servers === null) return document;
  const server = (servers as Record<string, unknown>)[name];
  if (typeof server !== "object" || server === null) return document;
  const { [ENABLED_KEY]: _ignored, ...remainingServerKeys } = server as Record<string, unknown>;
  return {
    ...document,
    [MCP_SERVERS_TABLE]: { ...(servers as Record<string, unknown>), [name]: remainingServerKeys },
  };
}

/**
 * Re-parses the edited document to prove three things: it is still valid TOML, `enabled` resolves
 * the way the caller asked, and *nothing else in the document changed*. The last check is what
 * makes a line-based editor safe — an insertion that lands somewhere unintended (inside a
 * multi-line string, say) alters some other value, and is rejected instead of written to disk.
 *
 * `smol-toml` is used for these checks only — never to serialize, since it would drop comments,
 * reorder keys and normalize quoting.
 */
function assertEditApplied(before: string, after: string, name: string, enabled: boolean): void {
  let server: Record<string, unknown>;
  try {
    server = readServerTable(after, name);
  } catch (cause) {
    throw new Error(
      `Editing "${name}" would have produced an invalid Codex config; the file was left unchanged.`,
      { cause },
    );
  }
  const value = server[ENABLED_KEY];
  const effective = value === undefined ? true : value === true;
  if (effective !== enabled || (enabled && value !== undefined)) {
    throw new Error(
      `Editing "${name}" did not take effect as expected; the file was left unchanged.`,
    );
  }
  let unchanged: boolean;
  try {
    unchanged = isDeepStrictEqual(
      parseWithoutEnabled(before, name),
      parseWithoutEnabled(after, name),
    );
  } catch (cause) {
    // Never let a parser error escape: `smol-toml` quotes three raw lines of the document.
    throw new Error(`Editing "${name}" could not be verified; the file was left unchanged.`, {
      cause,
    });
  }
  if (!unchanged) {
    throw new Error(
      `Editing "${name}" would have changed unrelated configuration; the file was left unchanged.`,
    );
  }
}

/**
 * Returns `text` with `[mcp_servers.<name>].enabled` set to disable the server, or with the key
 * removed entirely when enabling it — Codex treats a missing `enabled` as on, so deleting the
 * key restores the file to the shape the user originally wrote.
 *
 * Throws when the server has no `[mcp_servers.<name>]` table; a missing target is never created.
 */
export function applyCodexMcpEnabled(text: string, name: string, enabled: boolean): string {
  const lines = scanLines(text);
  const section = findServerSection(lines, name);
  if (!section) {
    throw new Error(
      `Codex MCP server "${name}" has no [${MCP_SERVERS_TABLE}.${name}] section in the config.`,
    );
  }

  const enabledIndex = findEnabledLineIndex(lines, section);
  const next: Array<DocumentLine> = [...lines];

  if (enabled) {
    if (enabledIndex === undefined) {
      // Already enabled as far as the section goes — still re-check the parsed value, so a
      // `mcp_servers.<name>.enabled` dotted key written elsewhere cannot be reported as applied.
      assertEditApplied(text, text, name, true);
      return text;
    }
    // Dropping the line with its terminator leaves no blank residue behind.
    next.splice(enabledIndex, 1);
  } else if (enabledIndex !== undefined) {
    next[enabledIndex] = replaceEnabledLine(lines[enabledIndex]!, false);
  } else {
    const insertIndex = resolveInsertIndex(lines, section);
    const ending = resolveEnding(lines, insertIndex - 1);
    const inserted: DocumentLine = {
      content: `${ENABLED_KEY} = false`,
      ending,
      insideMultilineString: false,
    };
    if (insertIndex > 0 && lines[insertIndex - 1]!.ending.length === 0) {
      // The anchor is the final line of a file with no trailing newline; give it one.
      next[insertIndex - 1] = { ...next[insertIndex - 1]!, ending };
      next.splice(insertIndex, 0, { ...inserted, ending: "" });
    } else {
      next.splice(insertIndex, 0, inserted);
    }
  }

  const result = joinLines(next);
  assertEditApplied(text, result, name, enabled);
  return result;
}
