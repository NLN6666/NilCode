// FILE: mcpConfigParser.ts
// Purpose: Parse Codex and Claude MCP configuration into connection records that keep everything
//          needed to actually reach a server, plus the redaction step that projects one into the
//          browser-facing descriptor.
// Layer: Agent MCP config reading
// Exports: CODEX_AGENT_MCP_PROVIDER, CLAUDE_AGENT_MCP_PROVIDER, McpServerConnection,
//          parseCodexMcpServerConnections, parseClaudeMcpServerConnections,
//          redactMcpServerConnection, mcpConnectionStringRecord, hashMcpServerConnection

import type { AgentMcpProvider, AgentMcpServerDescriptor } from "@synara/contracts";
import { redactMcpUrl, redactedMcpKeys } from "@synara/shared/mcp/redact";
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";

export const CODEX_AGENT_MCP_PROVIDER = "codex" as const;
export const CLAUDE_AGENT_MCP_PROVIDER = "claudeAgent" as const;

/**
 * A launchable MCP server. Unlike `AgentMcpServerDescriptor` this keeps `env` values, the full
 * URL (query + userinfo included) and header values — all of which are credentials.
 *
 * This type deliberately lives outside `@synara/contracts`: nothing that cannot be named in a
 * contract can be encoded into a WebSocket frame, so the type system itself rules out leaking
 * these fields to the browser. Redact with `redactMcpServerConnection` before sending anything.
 */
export interface McpStdioConnection {
  readonly _tag: "stdio";
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Raw `env` table, values included. Server-side only. */
  readonly env: Readonly<Record<string, unknown>>;
}

export interface McpHttpConnection {
  readonly _tag: "http";
  /** Full endpoint, query string and `user:pass@` userinfo intact. Server-side only. */
  readonly url: string;
  /** Raw headers table, values included. Server-side only. */
  readonly headers: Readonly<Record<string, unknown>>;
}

export type McpConnectionTransport = McpStdioConnection | McpHttpConnection;

export interface McpServerConnection {
  readonly provider: AgentMcpProvider;
  readonly name: string;
  readonly enabled: boolean;
  readonly transport: McpConnectionTransport;
}

function readStringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Plain object or `{}`. Non-records collapse to an empty table, which is exactly what
 * `redactedMcpKeys` already reported for them, so redaction output is unchanged.
 */
function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface McpConfigDialect {
  readonly provider: AgentMcpProvider;
  /** Key of the table holding one entry per server. */
  readonly serversKey: string;
  /** Key of the HTTP header table — Codex writes `http_headers`, Claude writes `headers`. */
  readonly headersKey: string;
  readonly isEnabled: (entry: Record<string, unknown>) => boolean;
}

const CODEX_DIALECT: McpConfigDialect = {
  provider: CODEX_AGENT_MCP_PROVIDER,
  serversKey: "mcp_servers",
  headersKey: "http_headers",
  // Codex treats a missing `enabled` as on.
  isEnabled: (entry) => entry["enabled"] !== false,
};

const CLAUDE_DIALECT: McpConfigDialect = {
  provider: CLAUDE_AGENT_MCP_PROVIDER,
  serversKey: "mcpServers",
  headersKey: "headers",
  // Claude Code writes `"disabled": true`; a missing key means enabled.
  isEnabled: (entry) => entry["disabled"] !== true,
};

function readConnections(
  document: Record<string, unknown>,
  dialect: McpConfigDialect,
): ReadonlyArray<McpServerConnection> {
  const servers = document[dialect.serversKey];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];

  return Object.entries(servers as Record<string, unknown>).flatMap(([name, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    const url = entry["url"];
    return [
      {
        provider: dialect.provider,
        name,
        enabled: dialect.isEnabled(entry),
        transport:
          typeof url === "string"
            ? { _tag: "http", url, headers: readRecord(entry[dialect.headersKey]) }
            : {
                _tag: "stdio",
                command: typeof entry["command"] === "string" ? entry["command"] : "",
                args: readStringArray(entry["args"]),
                env: readRecord(entry["env"]),
              },
      } satisfies McpServerConnection,
    ];
  });
}

/**
 * Reads the `[mcp_servers.*]` tables of a Codex config. Entry order follows the file.
 * Throws `TomlError` on malformed input; callers surface it as `parseError` and refuse to write.
 */
export function parseCodexMcpServerConnections(text: string): ReadonlyArray<McpServerConnection> {
  return readConnections(parseToml(text) as Record<string, unknown>, CODEX_DIALECT);
}

/**
 * Reads the globally configured Claude MCP servers from `~/.claude.json`.
 * Throws `SyntaxError` on malformed input; callers surface it as `parseError`.
 */
export function parseClaudeMcpServerConnections(text: string): ReadonlyArray<McpServerConnection> {
  return readConnections(JSON.parse(text) as Record<string, unknown>, CLAUDE_DIALECT);
}

/**
 * The browser-facing projection: key names only for `env` / `headers`, and a URL stripped of
 * query, fragment and userinfo. `command` / `args` are diagnostic, not secret, and stay verbatim.
 */
export function redactMcpServerConnection(
  connection: McpServerConnection,
): AgentMcpServerDescriptor {
  return {
    provider: connection.provider,
    name: connection.name,
    enabled: connection.enabled,
    transport:
      connection.transport._tag === "http"
        ? {
            _tag: "http",
            url: redactMcpUrl(connection.transport.url),
            headerKeys: redactedMcpKeys(connection.transport.headers),
          }
        : {
            _tag: "stdio",
            command: connection.transport.command,
            args: connection.transport.args,
            envKeys: redactedMcpKeys(connection.transport.env),
          },
  };
}

/**
 * Flattens a raw `env` / `headers` table into the string map a spawn or a fetch needs. TOML and
 * JSON both allow numbers and booleans there, so those are stringified rather than dropped;
 * anything structural (a nested table, an array) has no meaning as a value and is skipped.
 */
export function mcpConnectionStringRecord(
  record: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      result[key] = value;
      continue;
    }
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      result[key] = String(value);
    }
  }
  return result;
}

function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .toSorted()
        .map((key) => [key, canonicalizeForHash(source[key])]),
    );
  }
  return value;
}

/**
 * Fingerprint of one server — provider, name and configuration entry — used as the tool cache key.
 *
 * Deliberately scoped to the single entry rather than the whole config file: hashing the file
 * would invalidate every server's cached tools whenever any one of them is edited. Key order is
 * normalized so a reordered `env` table is not mistaken for a changed one.
 *
 * The three identity parts are folded into one digest instead of being concatenated with a
 * separator: a server name is a user-chosen table key that may contain any character at all, so
 * there is no separator a caller could safely assume is absent from it.
 */
export function hashMcpServerConnection(connection: McpServerConnection): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        connection.provider,
        connection.name,
        canonicalizeForHash(connection.transport),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}
