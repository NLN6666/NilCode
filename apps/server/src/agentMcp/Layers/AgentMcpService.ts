import type {
  AgentMcpProvider,
  AgentMcpServerDescriptor,
  AgentMcpSourceView,
} from "@synara/contracts";
import { Effect, FileSystem, Layer } from "effect";

import { writeFileStringAtomically } from "../../atomicWrite";
import { PRIVATE_FILE_MODE } from "../../privatePathPermissions";
import { applyClaudeMcpDisabled } from "../claudeJsonDocument";
import {
  CLAUDE_AGENT_MCP_PROVIDER,
  parseClaudeMcpServers,
  resolveClaudeMcpConfigPath,
} from "../claudeSource";
import { applyCodexMcpEnabled } from "../codexTomlDocument";
import {
  CODEX_AGENT_MCP_PROVIDER,
  parseCodexMcpServers,
  resolveCodexMcpConfigPath,
} from "../codexSource";
import {
  AgentMcpError,
  AgentMcpService,
  type AgentMcpServiceShape,
} from "../Services/AgentMcpService";

/** Attempts of the write-then-read-back cycle before giving up on a competing writer. */
const WRITE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;

interface AgentMcpSourceAdapter {
  readonly provider: AgentMcpProvider;
  readonly configPath: string;
  readonly parse: (text: string) => ReadonlyArray<AgentMcpServerDescriptor>;
  readonly apply: (text: string, name: string, enabled: boolean) => string;
}

export interface AgentMcpServiceOptions {
  readonly codexConfigPath?: string;
  readonly claudeConfigPath?: string;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Position of a parse failure, when the parser reports one. `smol-toml` exposes `line` on its
 * `TomlError`; V8 appends "(line N column M)" to multi-line `JSON.parse` failures. The message
 * itself is only ever scanned for digits — it is never returned.
 */
function readParseFailureLine(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const reported = (cause as { line?: unknown }).line;
  if (typeof reported === "number" && Number.isFinite(reported)) return reported;
  const message = (cause as { message?: unknown }).message;
  const located = typeof message === "string" ? /\(line (\d+) column \d+\)/.exec(message) : null;
  return located ? Number(located[1]) : undefined;
}

/**
 * Parser messages must never reach the browser: `smol-toml` embeds three raw lines of the
 * document in `TomlError.message`, and V8's `JSON.parse` embeds a ~16 character snippet around
 * the offending token. Both reproduce plaintext credentials verbatim, and both files routinely
 * hold API keys. Only the file name and the reported line are forwarded.
 */
function describeParseFailure(cause: unknown, configPath: string): string {
  const fileName = configPath.split(/[\\/]/).pop() ?? configPath;
  const line = readParseFailureLine(cause);
  return line === undefined
    ? `Could not parse ${fileName}.`
    : `Could not parse ${fileName} near line ${line}.`;
}

export const makeAgentMcpService = (options: AgentMcpServiceOptions = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    // Keyed by provider so the map is total over `AgentMcpProvider`: a lookup can never miss,
    // and adding a third agent is a single entry rather than a new failure path.
    const adapters: Record<AgentMcpProvider, AgentMcpSourceAdapter> = {
      [CODEX_AGENT_MCP_PROVIDER]: {
        provider: CODEX_AGENT_MCP_PROVIDER,
        configPath: options.codexConfigPath ?? resolveCodexMcpConfigPath(),
        parse: parseCodexMcpServers,
        apply: applyCodexMcpEnabled,
      },
      [CLAUDE_AGENT_MCP_PROVIDER]: {
        provider: CLAUDE_AGENT_MCP_PROVIDER,
        configPath: options.claudeConfigPath ?? resolveClaudeMcpConfigPath(),
        parse: parseClaudeMcpServers,
        apply: applyClaudeMcpDisabled,
      },
    };

    /** Current file contents, or undefined when the provider is simply not configured here. */
    const readText = (adapter: AgentMcpSourceAdapter) =>
      Effect.gen(function* () {
        const exists = yield* fileSystem
          .exists(adapter.configPath)
          .pipe(Effect.orElseSucceed(() => false));
        if (!exists) return undefined;
        return yield* fileSystem.readFileString(adapter.configPath);
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AgentMcpError({
              code: "io-failed",
              message: `Failed to read ${adapter.configPath}: ${describeCause(cause)}`,
              cause,
            }),
        ),
      );

    /** A parse failure degrades one source to read-only; it never fails the whole catalog. */
    const buildView = (
      adapter: AgentMcpSourceAdapter,
      text: string | undefined,
    ): AgentMcpSourceView => {
      if (text === undefined) {
        return {
          provider: adapter.provider,
          configPath: adapter.configPath,
          available: false,
          servers: [],
        };
      }
      try {
        return {
          provider: adapter.provider,
          configPath: adapter.configPath,
          available: true,
          servers: adapter.parse(text),
        };
      } catch (cause) {
        return {
          provider: adapter.provider,
          configPath: adapter.configPath,
          available: true,
          parseError: describeParseFailure(cause, adapter.configPath),
          servers: [],
        };
      }
    };

    const readView = (adapter: AgentMcpSourceAdapter) =>
      readText(adapter).pipe(Effect.map((text) => buildView(adapter, text)));

    const requireServers = (adapter: AgentMcpSourceAdapter, text: string) =>
      Effect.try({
        try: () => adapter.parse(text),
        catch: (cause) =>
          new AgentMcpError({
            code: "parse-failed",
            message: describeParseFailure(cause, adapter.configPath),
            cause,
          }),
      });

    const requireText = (adapter: AgentMcpSourceAdapter) =>
      readText(adapter).pipe(
        Effect.flatMap((text) =>
          text === undefined
            ? Effect.fail(
                new AgentMcpError({
                  code: "unavailable",
                  message: `${adapter.configPath} does not exist.`,
                }),
              )
            : Effect.succeed(text),
        ),
      );

    /**
     * Reuses the existing permission bits so an edit never silently tightens or loosens the
     * user's own config file; falls back to Synara's private mode for a file we cannot stat.
     */
    const writeConfig = (adapter: AgentMcpSourceAdapter, contents: string) =>
      fileSystem.stat(adapter.configPath).pipe(
        Effect.map((info) => info.mode & 0o777),
        Effect.orElseSucceed(() => PRIVATE_FILE_MODE),
        Effect.flatMap((mode) =>
          writeFileStringAtomically({ filePath: adapter.configPath, contents, mode }),
        ),
        Effect.mapError(
          (cause) =>
            new AgentMcpError({
              code: "io-failed",
              message: `Failed to write ${adapter.configPath}: ${describeCause(cause)}`,
              cause,
            }),
        ),
      );

    const listServers: AgentMcpServiceShape["listServers"] = () =>
      Effect.all(Object.values(adapters).map(readView), { concurrency: "unbounded" }).pipe(
        Effect.map((sources) => ({ sources })),
      );

    /**
     * Neither Claude Code nor the Codex CLI takes a file lock, so a competing write cannot be
     * ruled out. The atomic replace keeps the file from ever being half-written, and reading it
     * back turns "someone clobbered us" from a silent no-op into a retryable failure — leaving a
     * window on the order of a millisecond rather than none at all.
     */
    const setServerEnabled: AgentMcpServiceShape["setServerEnabled"] = (input) =>
      Effect.gen(function* () {
        const adapter = adapters[input.provider];

        for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
          const text = yield* requireText(adapter);
          const servers = yield* requireServers(adapter, text);
          if (!servers.some((server) => server.name === input.name)) {
            return yield* Effect.fail(
              new AgentMcpError({
                code: "not-found",
                message: `"${input.name}" is no longer declared in ${adapter.configPath}.`,
              }),
            );
          }

          const next = yield* Effect.try({
            try: () => adapter.apply(text, input.name, input.enabled),
            catch: (cause) =>
              new AgentMcpError({
                code: "io-failed",
                message: describeCause(cause),
                cause,
              }),
          });
          if (next !== text) yield* writeConfig(adapter, next);

          const verifiedText = yield* requireText(adapter);
          const verified = yield* requireServers(adapter, verifiedText);
          const target = verified.find((server) => server.name === input.name);
          if (target?.enabled === input.enabled) {
            return {
              provider: adapter.provider,
              configPath: adapter.configPath,
              available: true,
              servers: verified,
            } satisfies AgentMcpSourceView;
          }

          yield* Effect.sleep(RETRY_BACKOFF_MS * attempt);
        }

        return yield* Effect.fail(
          new AgentMcpError({
            code: "conflict",
            message: `${adapter.configPath} is being modified by another program. Please try again.`,
          }),
        );
      });

    return { listServers, setServerEnabled } satisfies AgentMcpServiceShape;
  });

export const AgentMcpServiceLive = Layer.effect(AgentMcpService, makeAgentMcpService());
