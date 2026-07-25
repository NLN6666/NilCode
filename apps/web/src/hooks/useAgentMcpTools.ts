// FILE: useAgentMcpTools.ts
// Purpose: Load the tools of the locally configured MCP servers for the composer's `&` picker.
// Layer: Web data hooks
// Exports: AGENT_MCP_TOOLS_QUERY_KEY, agentMcpProviderForProviderKind,
//          agentMcpToolsQueryOptions, shouldProbeAgentMcpTools, useAgentMcpTools

import type {
  AgentMcpProvider,
  AgentMcpToolCatalog,
  AgentMcpToolDescriptor,
  AgentMcpToolSourceError,
  ProviderKind,
} from "@synara/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ComposerTriggerKind } from "~/composer-logic";
import { ensureNativeApi } from "~/nativeApi";

export const AGENT_MCP_TOOLS_QUERY_KEY = ["server", "agentMcpTools"] as const;

const EMPTY_TOOLS: ReadonlyArray<AgentMcpToolDescriptor> = [];
const EMPTY_ERRORS: ReadonlyArray<AgentMcpToolSourceError> = [];

/** Poll interval used only while the server says it is revalidating a stale cache entry. */
const STALE_REVALIDATION_POLL_MS = 1_500;

/**
 * Synara manages MCP servers only for the two agents whose config exposes a single global switch,
 * so `&` has nothing to offer on the other seven providers.
 */
export function agentMcpProviderForProviderKind(provider: ProviderKind): AgentMcpProvider | null {
  return provider === "codex" || provider === "claudeAgent" ? provider : null;
}

export function agentMcpToolsQueryOptions(input?: { enabled?: boolean }) {
  return queryOptions({
    queryKey: AGENT_MCP_TOOLS_QUERY_KEY,
    queryFn: (): Promise<AgentMcpToolCatalog> => ensureNativeApi().server.listAgentMcpTools(),
    enabled: input?.enabled ?? true,
    // Probing spawns processes and opens sockets; within one composing session the answer is
    // effectively constant, and the server keeps its own 24h cache underneath.
    staleTime: 5 * 60_000,
    // `staleAt` means the server handed back cached tools and is refreshing them right now, so
    // ask again shortly instead of leaving the menu on last week's list.
    refetchInterval: (query) =>
      query.state.data?.staleAt === undefined ? false : STALE_REVALIDATION_POLL_MS,
    placeholderData: (previous) => previous,
  });
}

/**
 * Whether the composer may ask the server to probe. Probing spawns the user's configured MCP
 * servers, so it is strictly user-initiated: only an open `&` picker starts one. Text that merely
 * looks like a reference — a restored draft, a paste, a coincidental `run task-a &task-b` — reads
 * whatever is already cached and probes nothing.
 */
export function shouldProbeAgentMcpTools(input: {
  provider: ProviderKind;
  composerTriggerKind: ComposerTriggerKind | null;
}): boolean {
  return (
    input.composerTriggerKind === "mcp-tool" &&
    agentMcpProviderForProviderKind(input.provider) !== null
  );
}

export interface AgentMcpToolsResult {
  readonly tools: ReadonlyArray<AgentMcpToolDescriptor>;
  readonly errors: ReadonlyArray<AgentMcpToolSourceError>;
  /** True only before the very first answer, so the picker can show a skeleton once. */
  readonly isLoading: boolean;
  /**
   * True once a catalog for this provider is in hand. Until then "this tool is missing" is not a
   * fact anyone may act on — a cold cache must not make written references look dead.
   */
  readonly hasCatalog: boolean;
}

/**
 * Tools of the MCP servers configured for `provider`. The catalog covers both managed agents at
 * once, so it is filtered here rather than per request — the probe cost is shared.
 *
 * The query stays mounted while the picker is closed, which keeps the entry in the cache: send-time
 * expansion and the chips read that cache, and neither of them ever triggers a probe.
 */
export function useAgentMcpTools(input: {
  provider: ProviderKind;
  composerTriggerKind: ComposerTriggerKind | null;
}): AgentMcpToolsResult {
  const agentProvider = agentMcpProviderForProviderKind(input.provider);
  const query = useQuery(agentMcpToolsQueryOptions({ enabled: shouldProbeAgentMcpTools(input) }));
  const catalog = query.data;

  return useMemo(() => {
    if (agentProvider === null || catalog === undefined) {
      return {
        tools: EMPTY_TOOLS,
        errors: EMPTY_ERRORS,
        isLoading: agentProvider !== null && query.isLoading,
        hasCatalog: false,
      } satisfies AgentMcpToolsResult;
    }
    return {
      tools: catalog.tools.filter((tool) => tool.provider === agentProvider),
      errors: catalog.errors.filter((error) => error.provider === agentProvider),
      isLoading: query.isLoading,
      hasCatalog: true,
    } satisfies AgentMcpToolsResult;
  }, [agentProvider, catalog, query.isLoading]);
}
