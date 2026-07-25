// FILE: claudeSource.ts
// Purpose: Project the top-level `mcpServers` object of `~/.claude.json` into redacted
//          MCP server descriptors.
// Layer: Agent MCP config reading
// Exports: CLAUDE_AGENT_MCP_PROVIDER, resolveClaudeMcpConfigPath, parseClaudeMcpServers

import type { AgentMcpServerDescriptor } from "@synara/contracts";
import { redactMcpUrl, redactedMcpKeys } from "@synara/shared/mcp/redact";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_AGENT_MCP_PROVIDER = "claudeAgent" as const;

export function resolveClaudeMcpConfigPath(homeDirectory: string = homedir()): string {
  return join(homeDirectory, ".claude.json");
}

function readStringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function describeTransport(entry: Record<string, unknown>): AgentMcpServerDescriptor["transport"] {
  if (typeof entry["url"] === "string") {
    return {
      _tag: "http",
      url: redactMcpUrl(entry["url"]),
      headerKeys: redactedMcpKeys(entry["headers"]),
    };
  }
  return {
    _tag: "stdio",
    command: typeof entry["command"] === "string" ? entry["command"] : "",
    args: readStringArray(entry["args"]),
    envKeys: redactedMcpKeys(entry["env"]),
  };
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
  const document = JSON.parse(text) as Record<string, unknown>;
  const servers = document["mcpServers"];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];

  return Object.entries(servers as Record<string, unknown>).flatMap(([name, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    return [
      {
        provider: CLAUDE_AGENT_MCP_PROVIDER,
        name,
        enabled: entry["disabled"] !== true,
        transport: describeTransport(entry),
      } satisfies AgentMcpServerDescriptor,
    ];
  });
}
