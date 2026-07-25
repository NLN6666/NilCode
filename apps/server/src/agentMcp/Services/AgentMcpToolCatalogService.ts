// FILE: Services/AgentMcpToolCatalogService.ts
// Purpose: Effect service interface for the cached MCP tool catalog behind the composer's `&`.
// Layer: Agent MCP tool discovery
// Exports: AgentMcpToolCatalogService, AgentMcpToolCatalogServiceShape

import type { AgentMcpToolCatalog } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { AgentMcpError } from "./AgentMcpService";

export interface AgentMcpToolCatalogServiceShape {
  /**
   * Tools of every *enabled* Codex and Claude MCP server, served from a persistent cache and
   * revalidated in the background.
   *
   * Fails only when the catalog as a whole cannot be produced; an individual server that times
   * out or crashes is reported in `errors` and never removes the other servers' tools.
   */
  readonly listTools: () => Effect.Effect<AgentMcpToolCatalog, AgentMcpError>;
}

export class AgentMcpToolCatalogService extends ServiceMap.Service<
  AgentMcpToolCatalogService,
  AgentMcpToolCatalogServiceShape
>()("synara/agentMcp/Services/AgentMcpToolCatalogService") {}
