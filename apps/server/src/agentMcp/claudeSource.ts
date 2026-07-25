// FILE: claudeSource.ts
// Purpose: Project the top-level `mcpServers` object of `~/.claude.json` into redacted
//          MCP server descriptors.
// Layer: Agent MCP config reading
// Exports: CLAUDE_AGENT_MCP_PROVIDER, resolveClaudeMcpConfigPath, parseClaudeMcpServers

import type { AgentMcpServerDescriptor } from "@synara/contracts";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CLAUDE_AGENT_MCP_PROVIDER,
  parseClaudeMcpServerConnections,
  redactMcpServerConnection,
} from "./mcpConfigParser";

export { CLAUDE_AGENT_MCP_PROVIDER };

export function resolveClaudeMcpConfigPath(homeDirectory: string = homedir()): string {
  return join(homeDirectory, ".claude.json");
}

/**
 * Reads the globally configured Claude MCP servers. The per-project mechanisms in the same file
 * (`projects[…].disabledMcpServers`, `disabledMcpjsonServers`) are deliberately out of scope, so
 * a server shown as enabled here can still be suppressed inside one project.
 *
 * Claude Code writes `"disabled": true`; a missing key means enabled. Throws `SyntaxError` on
 * malformed input; callers surface it as `parseError` and refuse to write.
 */
export function parseClaudeMcpServers(text: string): ReadonlyArray<AgentMcpServerDescriptor> {
  return parseClaudeMcpServerConnections(text).map(redactMcpServerConnection);
}
