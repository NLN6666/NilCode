// FILE: Layers/AgentMcpToolCatalog.ts
// Purpose: Serve the tool list of every enabled Codex/Claude MCP server from a persistent,
//          per-server cache, refreshing stale entries in the background.
// Layer: Agent MCP tool discovery
// Exports: makeAgentMcpToolCatalog, AgentMcpToolCatalogOptions, AgentMcpToolCatalogLive

import type {
  AgentMcpProvider,
  AgentMcpToolCatalog,
  AgentMcpToolDescriptor,
  AgentMcpToolSourceError,
} from "@synara/contracts";
import { Effect, FileSystem, Layer } from "effect";
import { join } from "node:path";

import { writeFileStringAtomically } from "../../atomicWrite";
import { ServerConfig } from "../../config";
import { resolveClaudeMcpConfigPath } from "../claudeSource";
import { resolveCodexMcpConfigPath } from "../codexSource";
import {
  CLAUDE_AGENT_MCP_PROVIDER,
  CODEX_AGENT_MCP_PROVIDER,
  hashMcpServerConnection,
  parseClaudeMcpServerConnections,
  parseCodexMcpServerConnections,
  type McpServerConnection,
} from "../mcpConfigParser";
import {
  MCP_PROBE_TIMEOUT_MS,
  probeMcpServerTools,
  type McpProbeToolDescriptor,
} from "../probe/McpProbeClient";
import { AgentMcpError } from "../Services/AgentMcpService";
import {
  AgentMcpToolCatalogService,
  type AgentMcpToolCatalogServiceShape,
} from "../Services/AgentMcpToolCatalogService";

/**
 * Tool lists change only when a server is upgraded — a config edit is already caught by the
 * per-entry hash — so the TTL only has to bound how long an upgrade stays invisible.
 */
const TOOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Probing spawns processes; a config with a dozen stdio servers must not fork all of them. */
const PROBE_CONCURRENCY_LIMIT = 4;

const CACHE_FILE_NAME = "agent-mcp-tools.json";
// Bumped when the entry key scheme changes: a file written under an older scheme is ignored
// wholesale rather than kept around as entries nothing can ever look up again.
const CACHE_FORMAT_VERSION = 2;

export interface AgentMcpToolCatalogOptions {
  readonly codexConfigPath?: string;
  readonly claudeConfigPath?: string;
  readonly cacheFilePath?: string;
  readonly ttlMs?: number;
  readonly probeTimeoutMs?: number;
  readonly now?: () => number;
  readonly probe?: (
    connection: McpServerConnection,
  ) => Promise<ReadonlyArray<McpProbeToolDescriptor>>;
}

interface CachedToolEntry {
  readonly fetchedAt: number;
  readonly tools: ReadonlyArray<McpProbeToolDescriptor>;
}

interface ConfigSource {
  readonly provider: AgentMcpProvider;
  readonly configPath: string;
  readonly connections: ReadonlyArray<McpServerConnection>;
  readonly parseError?: string;
}

/**
 * Runs at most `limit` tasks at a time. Foreground probes and background revalidations share one
 * gate, so a burst of stale entries cannot bypass the limit by arriving through the other path.
 */
function createConcurrencyGate(limit: number) {
  const waiting: Array<() => void> = [];
  let active = 0;

  const release = (): void => {
    const next = waiting.shift();
    if (next) {
      next();
      return;
    }
    active -= 1;
  };

  return async <A>(task: () => Promise<A>): Promise<A> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function decodeCacheFile(text: string): Map<string, CachedToolEntry> {
  const entries = new Map<string, CachedToolEntry>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return entries;
  }
  if (typeof parsed !== "object" || parsed === null) return entries;
  const document = parsed as { version?: unknown; entries?: unknown };
  if (document.version !== CACHE_FORMAT_VERSION) return entries;
  if (typeof document.entries !== "object" || document.entries === null) return entries;

  for (const [key, value] of Object.entries(document.entries as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as { fetchedAt?: unknown; tools?: unknown };
    const fetchedAt =
      typeof entry.fetchedAt === "string" ? Date.parse(entry.fetchedAt) : Number.NaN;
    if (!Number.isFinite(fetchedAt) || !Array.isArray(entry.tools)) continue;
    entries.set(key, {
      fetchedAt,
      tools: entry.tools.flatMap((tool): McpProbeToolDescriptor[] => {
        if (typeof tool !== "object" || tool === null) return [];
        const candidate = tool as { name?: unknown; description?: unknown };
        if (typeof candidate.name !== "string" || candidate.name.length === 0) return [];
        return [
          {
            name: candidate.name,
            description: typeof candidate.description === "string" ? candidate.description : null,
          },
        ];
      }),
    });
  }
  return entries;
}

function encodeCacheFile(entries: ReadonlyMap<string, CachedToolEntry>): string {
  return `${JSON.stringify(
    {
      version: CACHE_FORMAT_VERSION,
      entries: Object.fromEntries(
        [...entries].map(([key, entry]) => [
          key,
          { fetchedAt: new Date(entry.fetchedAt).toISOString(), tools: entry.tools },
        ]),
      ),
    },
    null,
    2,
  )}\n`;
}

export const makeAgentMcpToolCatalog = (options: AgentMcpToolCatalogOptions = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const ttlMs = options.ttlMs ?? TOOL_CACHE_TTL_MS;
    const now = options.now ?? Date.now;
    const cacheFilePath = options.cacheFilePath ?? null;
    const probeTools =
      options.probe ??
      ((connection: McpServerConnection) =>
        probeMcpServerTools({
          connection,
          timeoutMs: options.probeTimeoutMs ?? MCP_PROBE_TIMEOUT_MS,
        }));

    const sourcesByProvider: Record<
      AgentMcpProvider,
      { readonly configPath: string; readonly parse: typeof parseCodexMcpServerConnections }
    > = {
      [CODEX_AGENT_MCP_PROVIDER]: {
        configPath: options.codexConfigPath ?? resolveCodexMcpConfigPath(),
        parse: parseCodexMcpServerConnections,
      },
      [CLAUDE_AGENT_MCP_PROVIDER]: {
        configPath: options.claudeConfigPath ?? resolveClaudeMcpConfigPath(),
        parse: parseClaudeMcpServerConnections,
      },
    };

    // Owned by the single service instance and only ever touched from the JS event loop, so a
    // plain Map is enough — no lock is needed around these.
    const entries = new Map<string, CachedToolEntry>();
    const inFlight = new Map<string, Promise<CachedToolEntry>>();
    const failures = new Map<string, string>();
    const withProbeSlot = createConcurrencyGate(PROBE_CONCURRENCY_LIMIT);
    let loadedFromDisk = cacheFilePath === null;
    let persistQueue: Promise<void> = Promise.resolve();

    const loadFromDisk = async (): Promise<void> => {
      if (loadedFromDisk || cacheFilePath === null) return;
      loadedFromDisk = true;
      try {
        const text = await Effect.runPromise(
          fileSystem.readFileString(cacheFilePath).pipe(Effect.orElseSucceed(() => "")),
        );
        for (const [key, entry] of decodeCacheFile(text)) entries.set(key, entry);
      } catch {
        // A corrupt or unreadable cache is not a failure: probing simply repopulates it.
      }
    };

    // Serialized so two refreshes finishing together cannot interleave their writes.
    const persist = (): void => {
      if (cacheFilePath === null) return;
      const snapshot = encodeCacheFile(entries);
      persistQueue = persistQueue
        .then(() =>
          Effect.runPromise(
            writeFileStringAtomically({ filePath: cacheFilePath, contents: snapshot }),
          ),
        )
        .then(
          () => undefined,
          () => undefined,
        );
    };

    /** One probe per key at a time; concurrent callers await the same promise. */
    const refresh = (key: string, connection: McpServerConnection): Promise<CachedToolEntry> => {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const pending = withProbeSlot(async () => {
        const tools = await probeTools(connection);
        return { fetchedAt: now(), tools } satisfies CachedToolEntry;
      })
        .then((entry) => {
          entries.set(key, entry);
          failures.delete(key);
          persist();
          return entry;
        })
        .catch((error: unknown) => {
          failures.set(key, describeCause(error));
          throw error;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, pending);
      return pending;
    };

    const resolveCatalog = async (
      sources: ReadonlyArray<ConfigSource>,
    ): Promise<AgentMcpToolCatalog> => {
      await loadFromDisk();

      const enabled = sources.flatMap((source) =>
        source.connections
          .filter((connection) => connection.enabled)
          .map((connection) => ({ connection, key: hashMcpServerConnection(connection) })),
      );

      // A config edit changes the key, so anything not currently configured is dead weight.
      const liveKeys = new Set(enabled.map(({ key }) => key));
      for (const key of entries.keys()) {
        if (!liveKeys.has(key) && !inFlight.has(key)) entries.delete(key);
      }
      for (const key of failures.keys()) {
        if (!liveKeys.has(key)) failures.delete(key);
      }

      let oldestStaleAt: number | null = null;
      const blocking: Array<Promise<unknown>> = [];

      for (const { connection, key } of enabled) {
        const entry = entries.get(key);
        if (entry === undefined) {
          // Nothing to show yet, so this one has to be waited on.
          blocking.push(refresh(key, connection).catch(() => undefined));
          continue;
        }
        if (now() - entry.fetchedAt < ttlMs) continue;
        // Stale-while-revalidate: the cached tools are returned now and quietly replaced later.
        oldestStaleAt =
          oldestStaleAt === null ? entry.fetchedAt : Math.min(oldestStaleAt, entry.fetchedAt);
        void refresh(key, connection).catch(() => undefined);
      }

      await Promise.all(blocking);

      const tools: AgentMcpToolDescriptor[] = [];
      const errors: AgentMcpToolSourceError[] = [];
      for (const source of sources) {
        if (source.parseError !== undefined) {
          errors.push({ provider: source.provider, message: source.parseError });
        }
      }
      for (const { connection, key } of enabled) {
        const entry = entries.get(key);
        if (entry !== undefined) {
          for (const tool of entry.tools) {
            tools.push({
              provider: connection.provider,
              serverName: connection.name,
              toolName: tool.name,
              ...(tool.description === null ? {} : { description: tool.description }),
            });
          }
        }
        const failure = failures.get(key);
        // A server can be both cached and currently failing; surfacing the failure alongside the
        // stale tools is more useful than hiding either one.
        if (failure !== undefined) {
          errors.push({
            provider: connection.provider,
            serverName: connection.name,
            message: failure,
          });
        }
      }

      return {
        tools,
        errors,
        ...(oldestStaleAt === null ? {} : { staleAt: new Date(oldestStaleAt).toISOString() }),
      } satisfies AgentMcpToolCatalog;
    };

    const readSource = (provider: AgentMcpProvider) =>
      Effect.gen(function* () {
        const { configPath, parse } = sourcesByProvider[provider];
        const exists = yield* fileSystem.exists(configPath).pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return { provider, configPath, connections: [] } satisfies ConfigSource;
        }
        const text = yield* fileSystem.readFileString(configPath).pipe(
          Effect.mapError(
            (cause) =>
              new AgentMcpError({
                code: "io-failed",
                message: `Failed to read ${configPath}: ${describeCause(cause)}`,
                cause,
              }),
          ),
        );
        try {
          return { provider, configPath, connections: parse(text) } satisfies ConfigSource;
        } catch {
          // Parser messages embed raw document lines, which routinely hold API keys.
          const fileName = configPath.split(/[\\/]/).pop() ?? configPath;
          return {
            provider,
            configPath,
            connections: [],
            parseError: `Could not parse ${fileName}.`,
          } satisfies ConfigSource;
        }
      });

    const listTools: AgentMcpToolCatalogServiceShape["listTools"] = () =>
      Effect.gen(function* () {
        const sources = yield* Effect.forEach(
          [CODEX_AGENT_MCP_PROVIDER, CLAUDE_AGENT_MCP_PROVIDER] as const,
          readSource,
          { concurrency: "unbounded" },
        );
        return yield* Effect.tryPromise({
          try: () => resolveCatalog(sources),
          catch: (cause) =>
            new AgentMcpError({
              code: "io-failed",
              message: `Failed to list agent MCP tools: ${describeCause(cause)}`,
              cause,
            }),
        });
      });

    return { listTools } satisfies AgentMcpToolCatalogServiceShape;
  });

export const AgentMcpToolCatalogLive = Layer.effect(
  AgentMcpToolCatalogService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* makeAgentMcpToolCatalog({
      cacheFilePath: join(config.stateDir, CACHE_FILE_NAME),
    });
  }),
);
