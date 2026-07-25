import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

/**
 * The coding agents whose own MCP server configuration Synara manages. A subset of
 * `ProviderKind`: only Codex (`CODEX_HOME/config.toml`) and Claude (`~/.claude.json`)
 * expose a single global on/off field we can edit surgically.
 */
export const AgentMcpProvider = Schema.Literals(["codex", "claudeAgent"]);
export type AgentMcpProvider = typeof AgentMcpProvider.Type;

/**
 * `envKeys` / `headerKeys` carry key names only — the values are credentials and are dropped
 * server-side (see `@synara/shared/mcp/redact`). `url` arrives already stripped of query,
 * fragment and userinfo. `command` / `args` are diagnostic, not secret, and stay verbatim.
 */
export const AgentMcpStdioTransport = Schema.Struct({
  _tag: Schema.tag("stdio"),
  command: Schema.String,
  args: Schema.Array(Schema.String),
  envKeys: Schema.Array(Schema.String),
});
export type AgentMcpStdioTransport = typeof AgentMcpStdioTransport.Type;

export const AgentMcpHttpTransport = Schema.Struct({
  _tag: Schema.tag("http"),
  url: Schema.String,
  headerKeys: Schema.Array(Schema.String),
});
export type AgentMcpHttpTransport = typeof AgentMcpHttpTransport.Type;

export const AgentMcpTransport = Schema.Union([AgentMcpStdioTransport, AgentMcpHttpTransport]);
export type AgentMcpTransport = typeof AgentMcpTransport.Type;

/**
 * `enabled` is normalized to positive semantics for both providers, even though Codex stores
 * `enabled = false` and Claude stores `"disabled": true`.
 */
export const AgentMcpServerDescriptor = Schema.Struct({
  provider: AgentMcpProvider,
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  transport: AgentMcpTransport,
});
export type AgentMcpServerDescriptor = typeof AgentMcpServerDescriptor.Type;

export const AgentMcpSourceView = Schema.Struct({
  provider: AgentMcpProvider,
  /** Absolute path of the backing config file, shown so users know which file a toggle edits. */
  configPath: TrimmedNonEmptyString,
  /** False when the config file does not exist. Not an error — the agent is simply unconfigured. */
  available: Schema.Boolean,
  /** Present when the file exists but could not be parsed; the source is then read-only. */
  parseError: Schema.optional(Schema.String),
  servers: Schema.Array(AgentMcpServerDescriptor),
});
export type AgentMcpSourceView = typeof AgentMcpSourceView.Type;

export const AgentMcpCatalog = Schema.Struct({
  sources: Schema.Array(AgentMcpSourceView),
});
export type AgentMcpCatalog = typeof AgentMcpCatalog.Type;

export const AgentMcpSetEnabledInput = Schema.Struct({
  provider: AgentMcpProvider,
  name: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type AgentMcpSetEnabledInput = typeof AgentMcpSetEnabledInput.Type;
