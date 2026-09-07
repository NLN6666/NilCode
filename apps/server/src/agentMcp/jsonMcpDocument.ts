// FILE: jsonMcpDocument.ts
// Purpose: Surgically flip the on/off flag of one entry in a JSON(C) MCP config, leaving every
//          other byte untouched. Shared by every agent whose config is JSON: Claude, Factory
//          Droid, Antigravity and OpenCode.
// Layer: Agent MCP config editing (pure string in, string out)
// Exports: JsonMcpDialect, CLAUDE_JSON_MCP_DIALECT, DROID_JSON_MCP_DIALECT,
//          ANTIGRAVITY_JSON_MCP_DIALECT, OPENCODE_JSON_MCP_DIALECT,
//          applyJsonMcpEnabled

import { applyEdits, modify } from "jsonc-parser";

export interface JsonMcpDialect {
  /** Name shown in the error a failed edit throws. */
  readonly label: string;
  /** Top-level key holding one entry per server. */
  readonly serversKey: string;
  /** Per-entry flag this agent reads. */
  readonly flagKey: string;
  /**
   * Value of `flagKey` that means "off". Switching a server *on* always deletes the key
   * instead of writing the opposite value: every dialect here treats a missing flag as on,
   * so deleting restores the file to the shape the user originally had.
   */
  readonly offValue: boolean;
}

export const CLAUDE_JSON_MCP_DIALECT: JsonMcpDialect = {
  label: "Claude",
  serversKey: "mcpServers",
  flagKey: "disabled",
  offValue: true,
};

export const DROID_JSON_MCP_DIALECT: JsonMcpDialect = {
  ...CLAUDE_JSON_MCP_DIALECT,
  label: "Factory Droid",
};

export const ANTIGRAVITY_JSON_MCP_DIALECT: JsonMcpDialect = {
  ...CLAUDE_JSON_MCP_DIALECT,
  label: "Antigravity",
};

export const OPENCODE_JSON_MCP_DIALECT: JsonMcpDialect = {
  label: "OpenCode",
  serversKey: "mcp",
  flagKey: "enabled",
  offValue: false,
};

/**
 * Places an inserted property on its own line, indented like the sibling above it.
 *
 * `modify` is deliberately called without `formattingOptions`, because supplying them makes
 * `jsonc-parser` reformat the *whole containing object* — an inline `"command": ["npx", "-y"]`
 * comes back exploded across four lines. OpenCode writes every server's argv that way,
 * so the default would rewrite parts of the file the user never touched. Without them the edit
 * is byte-minimal but arrives as `…],"enabled": false`, so the one inserted fragment is spaced
 * here instead.
 */
function indentInsertedProperty(text: string, offset: number, content: string): string {
  const separator = content.startsWith(",") ? "," : "";
  const property = content.slice(separator.length).trimStart();
  const lineStart = text.lastIndexOf("\n", Math.max(offset - 1, 0)) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return `${separator}${eol}${indent}${property}`;
}

/** Antigravity writes its config with a UTF-8 BOM, which every JSON parser here rejects. */
function splitByteOrderMark(text: string): { readonly mark: string; readonly body: string } {
  return text.charCodeAt(0) === 0xfeff
    ? { mark: text.slice(0, 1), body: text.slice(1) }
    : { mark: "", body: text };
}

function readServerEntry(
  text: string,
  name: string,
  dialect: JsonMcpDialect,
): Record<string, unknown> {
  const document = JSON.parse(text) as Record<string, unknown>;
  const servers = document[dialect.serversKey];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    throw new Error(`${dialect.label} config has no top-level "${dialect.serversKey}" object.`);
  }
  const server = (servers as Record<string, unknown>)[name];
  if (typeof server !== "object" || server === null || Array.isArray(server)) {
    throw new Error(`${dialect.label} MCP server "${name}" is not defined in the config.`);
  }
  return server as Record<string, unknown>;
}

/**
 * Returns `text` with `<serversKey>.<name>.<flagKey>` set to the dialect's "off" value to switch
 * the server off, or with the key removed entirely when switching it on.
 *
 * The rewrite goes through `jsonc-parser`, which emits a minimal edit range: indentation, key
 * order, comments and every unrelated line survive verbatim. The result is re-read and asserted
 * before it is returned, so an edit that landed somewhere unexpected fails loudly rather than
 * writing a config the agent would then misread.
 *
 * Throws when `<serversKey>[name]` does not exist; a missing target is never created.
 */
export function applyJsonMcpEnabled(
  text: string,
  name: string,
  enabled: boolean,
  dialect: JsonMcpDialect,
): string {
  const { mark, body } = splitByteOrderMark(text);
  readServerEntry(body, name, dialect);

  const edits = modify(
    body,
    [dialect.serversKey, name, dialect.flagKey],
    enabled ? undefined : dialect.offValue,
    {},
  ).map((edit) => ({
    offset: edit.offset,
    length: edit.length,
    // A zero-length edit with content is an insertion; a deletion needs no respacing because
    // `modify` also removes the separator and leaves the surrounding lines as they were.
    content:
      edit.length === 0 && edit.content.length > 0
        ? indentInsertedProperty(body, edit.offset, edit.content)
        : edit.content,
  }));
  if (edits.length === 0) return text;

  const result = applyEdits(body, edits);

  let server: Record<string, unknown>;
  try {
    server = readServerEntry(result, name, dialect);
  } catch (cause) {
    throw new Error(
      `Editing "${name}" would have produced an invalid ${dialect.label} config; the file was left unchanged.`,
      { cause },
    );
  }
  const value = server[dialect.flagKey];
  if (enabled ? value !== undefined : value !== dialect.offValue) {
    throw new Error(
      `Editing "${name}" did not take effect as expected; the file was left unchanged.`,
    );
  }
  return `${mark}${result}`;
}
