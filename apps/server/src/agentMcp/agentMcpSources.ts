// FILE: agentMcpSources.ts
// Purpose: One table naming, for every managed agent, where its MCP config lives, how to read it
//          and how to flip a server in it. Both the settings service and the tool catalog build
//          their per-provider maps from here, so adding an agent is a single entry rather than
//          matching edits in two files that can drift apart.
// Layer: Agent MCP config reading/editing
// Exports: AgentMcpSourceSpec, AGENT_MCP_SOURCE_SPECS, AGENT_MCP_PROVIDERS,
//          resolveAgentMcpConfigPath

import type { AgentMcpProvider } from "@synara/contracts";
import { resolveCodexHome } from "@synara/shared/codexConfig";
import { homedir } from "node:os";
import { join } from "node:path";

import { applyCodexMcpEnabled } from "./codexTomlDocument";
import { applyGrokMcpEnabled } from "./grokTomlDocument";
import {
  ANTIGRAVITY_JSON_MCP_DIALECT,
  applyJsonMcpEnabled,
  CLAUDE_JSON_MCP_DIALECT,
  DROID_JSON_MCP_DIALECT,
  type JsonMcpDialect,
  KILO_JSON_MCP_DIALECT,
  OPENCODE_JSON_MCP_DIALECT,
} from "./jsonMcpDocument";
import {
  type McpServerConnection,
  parseAntigravityMcpServerConnections,
  parseClaudeMcpServerConnections,
  parseCodexMcpServerConnections,
  parseDroidMcpServerConnections,
  parseGrokMcpServerConnections,
  parseKiloMcpServerConnections,
  parseOpenCodeMcpServerConnections,
} from "./mcpConfigParser";

export interface AgentMcpConfigPathInput {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface AgentMcpSourceSpec {
  readonly provider: AgentMcpProvider;
  readonly resolveConfigPath: (input: AgentMcpConfigPathInput) => string;
  readonly parse: (text: string) => ReadonlyArray<McpServerConnection>;
  readonly apply: (text: string, name: string, enabled: boolean) => string;
}

/** `$XDG_CONFIG_HOME`, or `~/.config` — where OpenCode and Kilo both keep their config. */
function xdgConfigHome(input: AgentMcpConfigPathInput): string {
  const configured = (input.env ?? process.env)["XDG_CONFIG_HOME"]?.trim();
  return configured && configured.length > 0 ? configured : join(home(input), ".config");
}

function home(input: AgentMcpConfigPathInput): string {
  return input.homeDir ?? homedir();
}

const jsonApply = (dialect: JsonMcpDialect) => (text: string, name: string, enabled: boolean) =>
  applyJsonMcpEnabled(text, name, enabled, dialect);

export const AGENT_MCP_SOURCE_SPECS: Record<AgentMcpProvider, AgentMcpSourceSpec> = {
  codex: {
    provider: "codex",
    resolveConfigPath: (input) => join(resolveCodexHome(input.env ?? process.env), "config.toml"),
    parse: parseCodexMcpServerConnections,
    apply: applyCodexMcpEnabled,
  },
  claudeAgent: {
    provider: "claudeAgent",
    resolveConfigPath: (input) => join(home(input), ".claude.json"),
    parse: parseClaudeMcpServerConnections,
    apply: jsonApply(CLAUDE_JSON_MCP_DIALECT),
  },
  droid: {
    provider: "droid",
    resolveConfigPath: (input) => join(home(input), ".factory", "mcp.json"),
    parse: parseDroidMcpServerConnections,
    apply: jsonApply(DROID_JSON_MCP_DIALECT),
  },
  antigravity: {
    provider: "antigravity",
    // Antigravity keeps its MCP config beside the rest of its `~/.gemini` state rather than
    // in a directory of its own.
    resolveConfigPath: (input) => join(home(input), ".gemini", "antigravity", "mcp_config.json"),
    parse: parseAntigravityMcpServerConnections,
    apply: jsonApply(ANTIGRAVITY_JSON_MCP_DIALECT),
  },
  grok: {
    provider: "grok",
    resolveConfigPath: (input) => join(home(input), ".grok", "config.toml"),
    parse: parseGrokMcpServerConnections,
    apply: applyGrokMcpEnabled,
  },
  opencode: {
    provider: "opencode",
    resolveConfigPath: (input) => join(xdgConfigHome(input), "opencode", "opencode.json"),
    parse: parseOpenCodeMcpServerConnections,
    apply: jsonApply(OPENCODE_JSON_MCP_DIALECT),
  },
  kilo: {
    provider: "kilo",
    resolveConfigPath: (input) => join(xdgConfigHome(input), "kilo", "kilo.jsonc"),
    parse: parseKiloMcpServerConnections,
    apply: jsonApply(KILO_JSON_MCP_DIALECT),
  },
};

export const AGENT_MCP_PROVIDERS = Object.keys(
  AGENT_MCP_SOURCE_SPECS,
) as ReadonlyArray<AgentMcpProvider>;

export function resolveAgentMcpConfigPath(
  provider: AgentMcpProvider,
  input: AgentMcpConfigPathInput = {},
): string {
  return AGENT_MCP_SOURCE_SPECS[provider].resolveConfigPath(input);
}
