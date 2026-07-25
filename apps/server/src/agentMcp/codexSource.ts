// FILE: codexSource.ts
// Purpose: Project `CODEX_HOME/config.toml` into redacted MCP server descriptors.
// Layer: Agent MCP config reading
// Exports: CODEX_AGENT_MCP_PROVIDER, resolveCodexMcpConfigPath, parseCodexMcpServers

import type { AgentMcpServerDescriptor } from "@synara/contracts";
import { resolveCodexHome } from "@synara/shared/codexConfig";
import { join } from "node:path";

import {
  CODEX_AGENT_MCP_PROVIDER,
  parseCodexMcpServerConnections,
  redactMcpServerConnection,
} from "./mcpConfigParser";

export { CODEX_AGENT_MCP_PROVIDER };

export function resolveCodexMcpConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveCodexHome(env), "config.toml");
}

/**
 * Reads the `[mcp_servers.*]` tables of a Codex config. Entry order follows the file so the
 * panel maps 1:1 onto what the user would see when opening `config.toml`.
 *
 * Codex treats a missing `enabled` as on, which is why the field is normalized in the shared
 * parser rather than defaulted at the UI layer. Throws `TomlError` on malformed input; callers
 * surface it as `parseError` and refuse to write.
 */
export function parseCodexMcpServers(text: string): ReadonlyArray<AgentMcpServerDescriptor> {
  return parseCodexMcpServerConnections(text).map(redactMcpServerConnection);
}
