// FILE: mcpToolReferences.ts
// Purpose: Single source of truth for the composer's `&server[:tool]` MCP references — the token
//          shape, how a reference resolves against a tool catalog, and how a prompt is expanded
//          into an `<available-mcp-tools>` block on send.
// Layer: Web lib
// Exports: MCP_TOOL_REFERENCE_PREFIX, MCP_TOOL_TOKEN_SOURCE, parseMcpToolReference,
//          formatMcpToolReference, collectMcpToolReferences, buildMcpToolReferenceKeys,
//          isMcpToolReferenceUnavailable, buildAvailableMcpToolLines, appendAvailableMcpToolsBlock

/** Sigil that opens an MCP reference, mirroring `@` for mentions and `$` for skills. */
export const MCP_TOOL_REFERENCE_PREFIX = "&";

/** Selects every tool of a server, the explicit spelling of a bare `&server`. */
export const MCP_TOOL_WILDCARD = "*";

/**
 * `&server`, `&server:tool` or `&server:*`, anchored to a line start or whitespace.
 *
 * The leading boundary is what keeps a URL query (`?a=1&b=2`) from reading as a reference: the
 * `&` inside a URL is always preceded by a non-space character. Callers append their own
 * trailing lookahead — `(?=\s)` while typing, `(?=\s|$)` for read-only display — exactly like
 * the link and skill tokens do.
 */
export const MCP_TOOL_TOKEN_SOURCE = "(^|\\s)&([a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.*-]+))?";

export interface McpToolReference {
  readonly serverName: string;
  /** `null` selects the whole server (`&server` and `&server:*` are the same reference). */
  readonly toolName: string | null;
}

/** The two fields the composer needs from a catalog entry, so tests need no contract types. */
export interface McpToolCandidate {
  readonly serverName: string;
  readonly toolName: string;
  readonly description?: string | undefined;
}

/** Parses the text after the `&`. Returns null for anything that is not a valid reference. */
export function parseMcpToolReference(value: string): McpToolReference | null {
  const raw = value.startsWith(MCP_TOOL_REFERENCE_PREFIX) ? value.slice(1) : value;
  const match = new RegExp(`^([a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.*-]+))?$`).exec(raw);
  if (!match) return null;
  const serverName = match[1] ?? "";
  const toolName = match[2];
  if (serverName.length === 0) return null;
  return {
    serverName,
    toolName: toolName === undefined || toolName === MCP_TOOL_WILDCARD ? null : toolName,
  };
}

/** The token body (no `&`) for a reference, as written back into the prompt. */
export function formatMcpToolReference(reference: McpToolReference): string {
  return reference.toolName === null
    ? reference.serverName
    : `${reference.serverName}:${reference.toolName}`;
}

const MCP_TOOL_DISPLAY_TOKEN_REGEX = new RegExp(`${MCP_TOOL_TOKEN_SOURCE}(?=\\s|$)`, "g");

/**
 * Every `&` reference written in a prompt, in the order it appears. A reference repeated in the
 * same message is reported once — the appended block lists each tool a single time.
 */
export function collectMcpToolReferences(text: string): ReadonlyArray<McpToolReference> {
  const seen = new Set<string>();
  const references: McpToolReference[] = [];
  for (const match of text.matchAll(MCP_TOOL_DISPLAY_TOKEN_REGEX)) {
    const serverName = match[2] ?? "";
    const toolName = match[3];
    const reference: McpToolReference = {
      serverName,
      toolName: toolName === undefined || toolName === MCP_TOOL_WILDCARD ? null : toolName,
    };
    const key = formatMcpToolReference(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
  }
  return references;
}

/** The one rule for "does this reference cover this tool?", shared by the chip and the expansion. */
function mcpToolMatchesReference(tool: McpToolCandidate, reference: McpToolReference): boolean {
  if (tool.serverName !== reference.serverName) return false;
  return reference.toolName === null || tool.toolName === reference.toolName;
}

/**
 * Index of everything a catalog can satisfy: the bare server name for `&server` / `&server:*`, and
 * `server:tool` per individual tool — exactly the strings `formatMcpToolReference` produces, so a
 * chip lookup and a send-time expansion can never disagree about what resolves.
 */
export function buildMcpToolReferenceKeys(
  tools: ReadonlyArray<McpToolCandidate>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const tool of tools) {
    keys.add(tool.serverName);
    keys.add(`${tool.serverName}:${tool.toolName}`);
  }
  return keys;
}

/**
 * Whether a written reference should read as dead — the catalog is loaded and does not have it.
 *
 * `keys === null` means no catalog is in hand: the `&` picker was never opened this session, or
 * this provider has no managed MCP servers. Unverified is not the same as missing, so the chip
 * keeps its normal look instead of greying out every reference on a cold cache.
 */
export function isMcpToolReferenceUnavailable(
  reference: string,
  keys: ReadonlySet<string> | null,
): boolean {
  if (keys === null) return false;
  const parsed = parseMcpToolReference(reference);
  return parsed === null || !keys.has(formatMcpToolReference(parsed));
}

export const AVAILABLE_MCP_TOOLS_OPEN_TAG = "<available-mcp-tools>";
export const AVAILABLE_MCP_TOOLS_CLOSE_TAG = "</available-mcp-tools>";
export const AVAILABLE_MCP_TOOLS_INSTRUCTION = "Please use the MCP tools listed above.";

interface AvailableMcpToolLine {
  readonly label: string;
  readonly description: string | null;
}

/**
 * Resolves the references in `text` against `tools` and renders one line per tool.
 *
 * A single-tool reference carries its description; a whole-server reference never does, no matter
 * how few tools the server has — `ida-pro-mcp` alone exposes 40+, and their descriptions would
 * cost thousands of tokens for a list the model only needs the names of. A reference that matches
 * nothing contributes no line: the message still sends, with the token intact in the body.
 */
export function buildAvailableMcpToolLines(
  text: string,
  tools: ReadonlyArray<McpToolCandidate>,
): ReadonlyArray<string> {
  const resolved = new Map<string, AvailableMcpToolLine>();

  for (const reference of collectMcpToolReferences(text)) {
    for (const tool of tools) {
      if (!mcpToolMatchesReference(tool, reference)) continue;

      const label = `${tool.serverName}:${tool.toolName}`;
      const description =
        reference.toolName === null ? null : (tool.description?.trim() ?? "") || null;
      const existing = resolved.get(label);
      if (existing === undefined) {
        resolved.set(label, { label, description });
        continue;
      }
      // Referenced both ways (`&server` and `&server:tool`): keep the more informative line
      // without moving it, so ordering still follows first appearance.
      if (existing.description === null && description !== null) {
        resolved.set(label, { label, description });
      }
    }
  }

  return [...resolved.values()].map((line) =>
    line.description === null ? line.label : `${line.label} — ${line.description}`,
  );
}

/**
 * Appends the merged tool block to an outgoing prompt. The `&` tokens stay in the body verbatim
 * so several references never scatter the sentence they were written into; the block is emitted
 * once, at the end, or not at all when nothing resolved.
 */
export function appendAvailableMcpToolsBlock(
  text: string,
  tools: ReadonlyArray<McpToolCandidate>,
): string {
  const lines = buildAvailableMcpToolLines(text, tools);
  if (lines.length === 0) return text;
  return [
    text.trimEnd(),
    "",
    AVAILABLE_MCP_TOOLS_OPEN_TAG,
    ...lines,
    AVAILABLE_MCP_TOOLS_CLOSE_TAG,
    AVAILABLE_MCP_TOOLS_INSTRUCTION,
  ].join("\n");
}
