// FILE: claudeJsonDocument.ts
// Purpose: Surgically add or remove the `disabled` flag of one entry in the top-level
//          `mcpServers` object of `~/.claude.json`, leaving every other byte untouched.
// Layer: Agent MCP config editing (pure string in, string out)
// Exports: applyClaudeMcpDisabled

import { applyEdits, modify } from "jsonc-parser";

const MCP_SERVERS_KEY = "mcpServers";
const DISABLED_KEY = "disabled";

function readServerEntry(text: string, name: string): Record<string, unknown> {
  const document = JSON.parse(text) as Record<string, unknown>;
  const servers = document[MCP_SERVERS_KEY];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    throw new Error(`Claude config has no top-level "${MCP_SERVERS_KEY}" object.`);
  }
  const server = (servers as Record<string, unknown>)[name];
  if (typeof server !== "object" || server === null || Array.isArray(server)) {
    throw new Error(`Claude MCP server "${name}" is not defined in the config.`);
  }
  return server as Record<string, unknown>;
}

/**
 * Returns `text` with `mcpServers.<name>.disabled` set to `true` to switch the server off, or
 * with the key removed entirely when switching it on — Claude Code treats a missing `disabled`
 * as enabled, so deleting it restores the file to the shape the user originally had.
 *
 * The rewrite goes through `jsonc-parser`, which emits a minimal edit range: indentation, key
 * order and every unrelated line (`numStartups`, `toolUsage`, `tipsHistory`, …) survive verbatim.
 *
 * Throws when `mcpServers[name]` does not exist; a missing target is never created.
 */
export function applyClaudeMcpDisabled(text: string, name: string, enabled: boolean): string {
  readServerEntry(text, name);

  const edits = modify(text, [MCP_SERVERS_KEY, name, DISABLED_KEY], enabled ? undefined : true, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    },
  });
  if (edits.length === 0) return text;

  const result = applyEdits(text, edits);

  let server: Record<string, unknown>;
  try {
    server = readServerEntry(result, name);
  } catch (cause) {
    throw new Error(
      `Editing "${name}" would have produced an invalid Claude config; the file was left unchanged.`,
      { cause },
    );
  }
  const value = server[DISABLED_KEY];
  if (enabled ? value !== undefined : value !== true) {
    throw new Error(
      `Editing "${name}" did not take effect as expected; the file was left unchanged.`,
    );
  }
  return result;
}
