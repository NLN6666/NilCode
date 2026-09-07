// FILE: mcpConfigParser.ts
// Purpose: Parse every managed agent's MCP configuration into connection records that keep
//          everything needed to actually reach a server, plus the redaction step that projects
//          one into the browser-facing descriptor. The agents differ in file format (TOML, JSON,
//          JSONC), in where the server table lives, and in the polarity of the on/off flag, so
//          those differences are declared as dialects over one shared reader.
// Layer: Agent MCP config reading
// Exports: <PROVIDER>_AGENT_MCP_PROVIDER constants, GROK_DISABLED_LIST_KEY, McpServerConnection,
//          parse{Codex,Claude,Droid,Antigravity,Grok,OpenCode}McpServerConnections,
//          redactMcpServerConnection, mcpConnectionStringRecord, hashMcpServerConnection

import type { AgentMcpProvider, AgentMcpServerDescriptor } from "@synara/contracts";
import { redactMcpUrl, redactedMcpKeys } from "@synara/shared/mcp/redact";
import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";

export const CODEX_AGENT_MCP_PROVIDER = "codex" as const;
export const CLAUDE_AGENT_MCP_PROVIDER = "claudeAgent" as const;
export const DROID_AGENT_MCP_PROVIDER = "droid" as const;
export const ANTIGRAVITY_AGENT_MCP_PROVIDER = "antigravity" as const;
export const GROK_AGENT_MCP_PROVIDER = "grok" as const;
export const OPENCODE_AGENT_MCP_PROVIDER = "opencode" as const;

/** Top-level Grok array listing servers switched off by `grok mcp disable`. */
export const GROK_DISABLED_LIST_KEY = "disabled_mcp_servers";

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
  /** Key of the HTTP header table — Codex writes `http_headers`, the rest write `headers`. */
  readonly headersKey: string;
  /** Key of the environment table — OpenCode-style configs write `environment`. */
  readonly envKey: string;
  /**
   * Keys that may carry the endpoint of a remote server, tried in order. Antigravity accepts
   * both `url` and its own older `serverUrl`, and files written by different versions of the
   * IDE mix the two, so reading only one would classify a live HTTP server as broken stdio.
   */
  readonly urlKeys: ReadonlyArray<string>;
  /**
   * How the launch command is stored. OpenCode puts the whole argv in `command`
   * (`["npx", "-y", "pkg"]`); everyone else splits it into `command` plus `args`.
   */
  readonly commandStyle: "argv" | "split";
  /** `document` is passed because Grok's switch also lives outside the entry. */
  readonly isEnabled: (
    entry: Record<string, unknown>,
    document: Record<string, unknown>,
    name: string,
  ) => boolean;
}

/** Codex, Grok: a missing `enabled` means on. */
const enabledUnlessFalse = (entry: Record<string, unknown>) => entry["enabled"] !== false;
/** Claude, Droid, Antigravity: `"disabled": true` switches off; a missing key means on. */
const enabledUnlessDisabled = (entry: Record<string, unknown>) => entry["disabled"] !== true;

const CODEX_DIALECT: McpConfigDialect = {
  provider: CODEX_AGENT_MCP_PROVIDER,
  serversKey: "mcp_servers",
  headersKey: "http_headers",
  envKey: "env",
  urlKeys: ["url"],
  commandStyle: "split",
  isEnabled: enabledUnlessFalse,
};

const CLAUDE_DIALECT: McpConfigDialect = {
  provider: CLAUDE_AGENT_MCP_PROVIDER,
  serversKey: "mcpServers",
  headersKey: "headers",
  envKey: "env",
  urlKeys: ["url"],
  commandStyle: "split",
  isEnabled: enabledUnlessDisabled,
};

const DROID_DIALECT: McpConfigDialect = {
  ...CLAUDE_DIALECT,
  provider: DROID_AGENT_MCP_PROVIDER,
};

const ANTIGRAVITY_DIALECT: McpConfigDialect = {
  ...CLAUDE_DIALECT,
  provider: ANTIGRAVITY_AGENT_MCP_PROVIDER,
  urlKeys: ["url", "serverUrl"],
};

/**
 * Grok has two switches and both must be honoured: `[mcp_servers.<name>].enabled` and the
 * top-level `disabled_mcp_servers` list. `grok mcp disable` writes the list, so reading only
 * the table field would show a server the user switched off as running.
 */
const GROK_DIALECT: McpConfigDialect = {
  provider: GROK_AGENT_MCP_PROVIDER,
  serversKey: "mcp_servers",
  headersKey: "headers",
  envKey: "env",
  urlKeys: ["url"],
  commandStyle: "split",
  isEnabled: (entry, document, name) =>
    enabledUnlessFalse(entry) && !readStringArray(document[GROK_DISABLED_LIST_KEY]).includes(name),
};

const OPENCODE_DIALECT: McpConfigDialect = {
  provider: OPENCODE_AGENT_MCP_PROVIDER,
  serversKey: "mcp",
  headersKey: "headers",
  envKey: "environment",
  urlKeys: ["url"],
  commandStyle: "argv",
  isEnabled: enabledUnlessFalse,
};

function readTransport(
  entry: Record<string, unknown>,
  dialect: McpConfigDialect,
): McpConnectionTransport {
  const url = dialect.urlKeys
    .map((key) => entry[key])
    .find((value): value is string => typeof value === "string");
  if (url !== undefined) {
    return { _tag: "http", url, headers: readRecord(entry[dialect.headersKey]) };
  }

  const env = readRecord(entry[dialect.envKey]);
  if (dialect.commandStyle === "argv") {
    const [command = "", ...args] = readStringArray(entry["command"]);
    return { _tag: "stdio", command, args, env };
  }
  return {
    _tag: "stdio",
    command: typeof entry["command"] === "string" ? entry["command"] : "",
    args: readStringArray(entry["args"]),
    env,
  };
}

function readConnections(
  document: Record<string, unknown>,
  dialect: McpConfigDialect,
): ReadonlyArray<McpServerConnection> {
  const servers = document[dialect.serversKey];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];

  return Object.entries(servers as Record<string, unknown>).flatMap(([name, value]) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    return [
      {
        provider: dialect.provider,
        name,
        enabled: dialect.isEnabled(entry, document, name),
        transport: readTransport(entry, dialect),
      } satisfies McpServerConnection,
    ];
  });
}

/**
 * Antigravity writes `mcp_config.json` with a UTF-8 BOM, which `JSON.parse` rejects outright.
 * Stripping it costs nothing on the files that lack one and is the difference between reading
 * that config and reporting it as corrupt.
 */
function parseJsonDocument(text: string): Record<string, unknown> {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<
    string,
    unknown
  >;
}

/**
 * OpenCode's config tolerates JSONC relaxations, so it goes through
 * `jsonc-parser` — the parser their own editors use, and the one the write path already edits
 * with, so a file that reads here is a file that can be written back.
 *
 * `parseJsonc` reports rather than throws, which would turn a truncated config into a silent
 * "no servers configured"; the first reported error is re-thrown so the caller degrades the
 * source to read-only instead. `offset` is translated to a line so the existing failure
 * formatter can name one without ever quoting the file's contents.
 */
function parseJsoncDocument(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const document = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as Record<string, unknown> | undefined;

  const failure = errors[0];
  if (failure) {
    const line = text.slice(0, failure.offset).split("\n").length;
    throw new SyntaxError(`${printParseErrorCode(failure.error)} (line ${line} column 1)`);
  }
  return document && typeof document === "object" && !Array.isArray(document) ? document : {};
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
  return readConnections(parseJsonDocument(text), CLAUDE_DIALECT);
}

/** Reads `~/.factory/mcp.json`. Same document shape as Claude's, down to the `disabled` flag. */
export function parseDroidMcpServerConnections(text: string): ReadonlyArray<McpServerConnection> {
  return readConnections(parseJsonDocument(text), DROID_DIALECT);
}

/** Reads Antigravity's `mcp_config.json` (BOM-prefixed, and `serverUrl` alongside `url`). */
export function parseAntigravityMcpServerConnections(
  text: string,
): ReadonlyArray<McpServerConnection> {
  return readConnections(parseJsonDocument(text), ANTIGRAVITY_DIALECT);
}

/** Reads `~/.grok/config.toml`, honouring both the table field and `disabled_mcp_servers`. */
export function parseGrokMcpServerConnections(text: string): ReadonlyArray<McpServerConnection> {
  return readConnections(parseToml(text) as Record<string, unknown>, GROK_DIALECT);
}

/** Reads the `mcp` object of an OpenCode `opencode.json`. */
export function parseOpenCodeMcpServerConnections(
  text: string,
): ReadonlyArray<McpServerConnection> {
  return readConnections(parseJsoncDocument(text), OPENCODE_DIALECT);
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
