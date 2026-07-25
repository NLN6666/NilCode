// FILE: codexSource.ts
// Purpose: Project `CODEX_HOME/config.toml` into redacted MCP server descriptors.
// Layer: Agent MCP config reading
// Exports: CODEX_AGENT_MCP_PROVIDER, resolveCodexMcpConfigPath, parseCodexMcpServers

import type { AgentMcpServerDescriptor } from "@synara/contracts";
import { resolveCodexHome } from "@synara/shared/codexConfig";
import { redactMcpUrl, redactedMcpKeys } from "@synara/shared/mcp/redact";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

export const CODEX_AGENT_MCP_PROVIDER = "codex" as const;

export function resolveCodexMcpConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveCodexHome(env), "config.toml");
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
      headerKeys: redactedMcpKeys(entry["http_headers"]),
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
 * Reads the `[mcp_servers.*]` tables of a Codex config. Entry order follows the file so the
 * panel maps 1:1 onto what the user would see when opening `config.toml`.
 *
 * Codex treats a missing `enabled` as on, which is why the field is normalized here rather than
 * defaulted at the UI layer. Throws `TomlError` on malformed input; callers surface it as
 * `parseError` and refuse to write.
 */
export function parseCodexMcpServers(text: string): ReadonlyArray<AgentMcpServerDescriptor> {
  const document = parseToml(text) as Record<string, unknown>;
  const servers = document["mcp_servers"];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];

  return Object.entries(servers as Record<string, unknown>).flatMap(([name, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    return [
      {
        provider: CODEX_AGENT_MCP_PROVIDER,
        name,
        enabled: entry["enabled"] !== false,
        transport: describeTransport(entry),
      } satisfies AgentMcpServerDescriptor,
    ];
  });
}
