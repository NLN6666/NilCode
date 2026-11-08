// FILE: fileSystemAgentCatalog.ts
// Purpose: Effect wrapper around `discoverAgentCatalog` for the providers whose
//          subagents come only from disk, so each adapter's `listAgents` is one call
//          instead of its own copy of the same try/log/fallback dance.
// Layer: Server provider discovery helper
// Exports: fileSystemAgentCatalog, listAgentsFromFileSystem

import type { ProviderAgentDescriptor, ProviderListAgentsResult } from "@synara/contracts";
import { Effect } from "effect";

import { type AgentCatalogProvider, discoverAgentCatalog } from "./agentCatalog.ts";
import { buildProviderProcessEnv } from "./providerProcessEnv.ts";

export interface FileSystemAgentCatalogInput {
  readonly provider: AgentCatalogProvider;
  readonly homeDir: string;
  readonly configDir?: string | undefined;
  readonly cwd?: string | undefined;
  readonly environment?: Readonly<Record<string, string>> | undefined;
  readonly instanceId?: string | undefined;
  readonly isolationRootDir?: string | undefined;
}

/**
 * Scans the provider's agent directories. A failing scan degrades to an empty list
 * rather than failing the call: the composer's `@` menu losing its subagent section is
 * recoverable, an error toast on every keystroke is not.
 */
export const fileSystemAgentCatalog = (
  input: FileSystemAgentCatalogInput,
): Effect.Effect<ProviderAgentDescriptor[]> =>
  Effect.tryPromise(() => {
    let homeDir = input.homeDir;
    if (
      (input.provider === "cursor" || input.provider === "grok" || input.provider === "omp") &&
      (input.environment !== undefined ||
        (input.instanceId !== undefined && input.instanceId !== input.provider))
    ) {
      const env = buildProviderProcessEnv({
        driver: input.provider,
        homeDir: input.homeDir,
        isolationRootDir: input.isolationRootDir,
        environment: input.environment,
        instanceId: input.instanceId,
      });
      homeDir = env.HOME || env.USERPROFILE || input.homeDir;
    } else if (input.environment) {
      homeDir = input.environment.HOME || input.environment.USERPROFILE || input.homeDir;
    }
    return discoverAgentCatalog({
      provider: input.provider,
      homeDir,
      ...(input.configDir ? { configDir: input.configDir } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("subagent catalog discovery failed", {
        provider: input.provider,
        cause,
      }).pipe(Effect.as([] as ProviderAgentDescriptor[])),
    ),
  );

/** `listAgents` for an adapter with no runtime agent list of its own. */
export const listAgentsFromFileSystem = (
  input: FileSystemAgentCatalogInput,
): Effect.Effect<ProviderListAgentsResult> =>
  fileSystemAgentCatalog(input).pipe(
    Effect.map(
      (agents) =>
        ({
          agents,
          source: "filesystem",
          cached: false,
        }) satisfies ProviderListAgentsResult,
    ),
  );
