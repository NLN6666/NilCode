// FILE: daemonTools.ts
// Purpose: The eight `synara_*_daemon` tools an agent uses to run and drive long-lived
//          background servers.
// Layer: Agent gateway tool surface
// Depends on: DaemonBroker, daemon key/signal whitelists, gateway tool runtime.
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md. That project exposes
// one `hub` tool with an `op` discriminator; this repo's convention is one tool per
// operation, so the same surface is split eight ways.

import {
  DAEMON_LOGS_DEFAULT_LINES,
  DAEMON_LOGS_MAX_LINES,
  DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS,
  DAEMON_WAIT_DEFAULT_TIMEOUT_SECONDS,
  DaemonSpec,
  SYNARA_GATEWAY_MAX_WAIT_MS,
} from "@synara/contracts";
import {
  ALLOWED_SIGNAL_NAMES,
  isAllowedSignal,
  resolveTerminalKey,
  TERMINAL_KEY_NAMES,
  type AllowedSignal,
} from "@synara/shared/daemonKeys";
import { Effect, Schema } from "effect";

import type { DaemonBrokerShape } from "../daemon/Services/Broker.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import {
  errorText,
  readBooleanArg,
  readNumberArg,
  readRecordArg,
  readStringArg,
  readStringArrayArg,
  ToolInputError,
} from "./toolInput.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolEntry,
} from "./toolRuntime.ts";

const DAEMON_CAPABILITY = "daemon:control" as const;

const decodeSpec = Schema.decodeUnknownSync(DaemonSpec);

/**
 * Blocking tools annotate as non-read-only.
 *
 * `follow` and `wait` occupy a gateway request for up to a minute. A client that
 * treated them as read-only would be free to retry them concurrently, and the same
 * daemon would end up with a pile of parked waiters.
 */
const BLOCKING_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const NAME_PROPERTY = {
  name: { type: "string", description: "Daemon name, unique within this Synara installation." },
} as const;

/**
 * Convert a seconds argument to a bounded millisecond timeout.
 *
 * Clamped rather than rejected: a model asking to wait five minutes wants the longest
 * wait available, and failing the call outright would just cost it a round trip to
 * discover the ceiling.
 */
function timeoutMs(seconds: number | undefined, fallbackSeconds: number): number {
  const requested = (seconds ?? fallbackSeconds) * 1_000;
  return Math.max(0, Math.min(requested, SYNARA_GATEWAY_MAX_WAIT_MS));
}

function readLines(args: Record<string, unknown>): number {
  const requested = readNumberArg(args, "lines") ?? DAEMON_LOGS_DEFAULT_LINES;
  return Math.max(1, Math.min(Math.floor(requested), DAEMON_LOGS_MAX_LINES));
}

/** Validate key names up front so an unknown one is a clear error, not silent bytes. */
function readKeys(args: Record<string, unknown>): readonly string[] {
  const keys = readStringArrayArg(args, "keys") ?? [];
  for (const key of keys) {
    if (resolveTerminalKey(key) === null) {
      throw new ToolInputError(
        `Unknown key "${key}". Supported keys: ${TERMINAL_KEY_NAMES.join(", ")}.`,
      );
    }
  }
  return keys;
}

function readSignal(args: Record<string, unknown>): AllowedSignal | null {
  const signal = readStringArg(args, "signal");
  if (signal === undefined) return null;
  if (!isAllowedSignal(signal)) {
    throw new ToolInputError(
      `Signal "${signal}" is not permitted. Allowed: ${ALLOWED_SIGNAL_NAMES.join(", ")}.`,
    );
  }
  return signal.trim().toUpperCase() as AllowedSignal;
}

function readEnv(args: Record<string, unknown>): Record<string, string> | undefined {
  const env = readRecordArg(args, "env");
  if (env === undefined) return undefined;
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      throw new ToolInputError(`Environment variable "${key}" must be a string.`);
    }
    entries[key] = value;
  }
  return entries;
}

export interface DaemonToolsInput {
  readonly broker: DaemonBrokerShape;
}

export function makeDaemonTools(input: DaemonToolsInput): ReadonlyArray<ToolEntry> {
  const { broker } = input;

  /**
   * Every handler funnels its input errors and daemon errors into one text result.
   *
   * Argument parsing runs inside `Effect.try` rather than in the effect body: a
   * `ToolInputError` thrown while decoding arguments is a *defect* anywhere else, and a
   * defect sails past `Effect.catch` and fails the whole JSON-RPC request — so the agent
   * would learn that something broke, but never that its arguments were wrong.
   */
  function tool(
    definition: ToolEntry["definition"],
    annotations: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Effect.Effect<unknown, unknown>,
  ): ToolEntry {
    return {
      requiredCapability: DAEMON_CAPABILITY,
      definition: { ...definition, annotations: { ...definition.annotations, ...annotations } },
      handler: (args) =>
        Effect.try({ try: () => handler(args), catch: (error) => error }).pipe(
          Effect.flatMap((effect) => effect),
          Effect.map(mcpToolResultJson),
          Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
        ),
    };
  }

  const startDaemon = tool(
    {
      name: "synara_start_daemon",
      description:
        "Start a long-running background process (game server, dev server, database) under Synara supervision. Returns immediately with a snapshot; use synara_wait_daemon or a `ready` condition to block until it is up. Starting a name that is already running returns the existing daemon rather than a second copy.",
      inputSchema: {
        type: "object",
        properties: {
          ...NAME_PROPERTY,
          application: { type: "string", description: "Executable to run." },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string", description: "Working directory." },
          env: { type: "object", additionalProperties: { type: "string" } },
          pty: {
            type: "boolean",
            description:
              "Run under a pseudo-terminal so the process accepts console commands. Default true. Ignored when `detached` is set.",
          },
          ready: {
            type: "object",
            description:
              "Conditions that must all hold before the daemon reports ready. Declaring them here avoids a separate wait call.",
            properties: {
              log: { type: "string", description: "Regular expression matched against output." },
              port: { type: "integer", description: "TCP port that must accept a connection." },
              host: { type: "string" },
              timeout: { type: "integer", description: "Seconds before readiness is abandoned." },
            },
            additionalProperties: false,
          },
          restart: { type: "string", enum: ["no", "on-failure", "always"] },
          detached: {
            type: "boolean",
            description:
              "Survive the Synara server exiting. Redirects stdio to the log file, so the daemon has no stdin: it can be signalled but not sent console commands.",
          },
        },
        required: ["name", "application"],
        additionalProperties: false,
      },
      annotations: { title: "Start daemon" },
    },
    WRITE_TOOL_ANNOTATIONS,
    (args) =>
      broker.start(
        decodeSpec({
          name: readStringArg(args, "name", { required: true }),
          application: readStringArg(args, "application", { required: true }),
          args: readStringArrayArg(args, "args"),
          cwd: readStringArg(args, "cwd"),
          env: readEnv(args),
          pty: readBooleanArg(args, "pty"),
          ready: readRecordArg(args, "ready"),
          restart: readStringArg(args, "restart"),
          detached: readBooleanArg(args, "detached"),
        }),
      ),
  );

  const listDaemons = tool(
    {
      name: "synara_list_daemons",
      description:
        "List every daemon Synara is supervising, with its lifecycle state, pid, and log cursor.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "List daemons" },
    },
    READ_ONLY_TOOL_ANNOTATIONS,
    () => broker.list.pipe(Effect.map((daemons) => ({ daemons }))),
  );

  const describeDaemon = tool(
    {
      name: "synara_describe_daemon",
      description: "Inspect one daemon's current lifecycle state, pid, exit code, and log cursor.",
      inputSchema: {
        type: "object",
        properties: NAME_PROPERTY,
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { title: "Describe daemon" },
    },
    READ_ONLY_TOOL_ANNOTATIONS,
    (args) => broker.describe(readStringArg(args, "name", { required: true })!),
  );

  const readDaemonLogs = tool(
    {
      name: "synara_read_daemon_logs",
      description:
        "Read a daemon's output. Pass the `nextCursor` from a previous read to get only what arrived since; `follow` blocks until new output appears or the timeout lapses. `droppedBytes` reports output lost to log rotation rather than pretending the stream was continuous.",
      inputSchema: {
        type: "object",
        properties: {
          ...NAME_PROPERTY,
          lines: {
            type: "integer",
            description: `Maximum lines to return (default ${DAEMON_LOGS_DEFAULT_LINES}, capped at ${DAEMON_LOGS_MAX_LINES}).`,
          },
          head: { type: "boolean", description: "Return the first lines instead of the last." },
          grep: {
            type: "string",
            description: "Regular expression; only matching lines returned.",
          },
          cursor: { type: "integer", description: "Byte offset from a previous read." },
          follow: { type: "boolean", description: "Block until new output arrives." },
          timeout: { type: "integer", description: "Seconds to block when following." },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { title: "Read daemon logs" },
    },
    BLOCKING_TOOL_ANNOTATIONS,
    (args) =>
      broker.logs({
        name: readStringArg(args, "name", { required: true })!,
        lines: readLines(args),
        head: readBooleanArg(args, "head") ?? false,
        grep: readStringArg(args, "grep") ?? null,
        follow: readBooleanArg(args, "follow") ?? false,
        cursor: Math.max(0, Math.floor(readNumberArg(args, "cursor") ?? 0)),
        timeoutMs: timeoutMs(readNumberArg(args, "timeout"), DAEMON_WAIT_DEFAULT_TIMEOUT_SECONDS),
      }),
  );

  const sendDaemonInput = tool(
    {
      name: "synara_send_daemon_input",
      description:
        "Send a console command, terminal keys, or a signal to a running daemon. This is how a stateful server is shut down cleanly — e.g. `stop` for Minecraft — before any use of synara_stop_daemon. Detached daemons have no stdin and accept `signal` only.",
      inputSchema: {
        type: "object",
        properties: {
          ...NAME_PROPERTY,
          text: { type: "string", description: "Text written to the daemon's stdin." },
          enter: {
            type: "boolean",
            description: "Append a carriage return so the text is submitted. Default true.",
          },
          keys: {
            type: "array",
            items: { type: "string", enum: [...TERMINAL_KEY_NAMES] },
            description: "Terminal keys sent after the text.",
          },
          signal: { type: "string", enum: [...ALLOWED_SIGNAL_NAMES] },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { title: "Send daemon input" },
    },
    WRITE_TOOL_ANNOTATIONS,
    (args) =>
      broker.send({
        name: readStringArg(args, "name", { required: true })!,
        text: readStringArg(args, "text") ?? null,
        enter: readBooleanArg(args, "enter") ?? true,
        keys: readKeys(args),
        signal: readSignal(args),
      }),
  );

  const waitDaemon = tool(
    {
      name: "synara_wait_daemon",
      description:
        "Block until a daemon becomes ready, exits, or prints output matching `pattern`. A timeout is reported as `timedOut: true` rather than as an error, so the caller can decide whether to keep waiting.",
      inputSchema: {
        type: "object",
        properties: {
          ...NAME_PROPERTY,
          for: { type: "string", enum: ["ready", "exit"], description: "Lifecycle condition." },
          pattern: {
            type: "string",
            description: "Output regular expression. Takes precedence over `for`.",
          },
          timeout: {
            type: "integer",
            description: `Seconds to wait (default ${DAEMON_WAIT_DEFAULT_TIMEOUT_SECONDS}, capped at ${SYNARA_GATEWAY_MAX_WAIT_MS / 1_000}).`,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { title: "Wait for daemon" },
    },
    BLOCKING_TOOL_ANNOTATIONS,
    (args) => {
      const condition = readStringArg(args, "for") ?? "ready";
      if (condition !== "ready" && condition !== "exit") {
        throw new ToolInputError(`Argument "for" must be "ready" or "exit".`);
      }
      return broker.wait({
        name: readStringArg(args, "name", { required: true })!,
        for: condition,
        pattern: readStringArg(args, "pattern") ?? null,
        timeoutMs: timeoutMs(readNumberArg(args, "timeout"), DAEMON_WAIT_DEFAULT_TIMEOUT_SECONDS),
      });
    },
  );

  const stopDaemon = tool(
    {
      name: "synara_stop_daemon",
      description:
        "Stop a daemon: SIGTERM first, then force-terminate the process tree after the grace period. For stateful servers (e.g. Minecraft), send a graceful shutdown command via `synara_send_daemon_input` first — force-killing can corrupt saved state.",
      inputSchema: {
        type: "object",
        properties: {
          ...NAME_PROPERTY,
          timeout: {
            type: "integer",
            description: `Seconds to wait before force-killing (default ${DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS}).`,
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { title: "Stop daemon" },
    },
    WRITE_TOOL_ANNOTATIONS,
    (args) =>
      broker.stop({
        name: readStringArg(args, "name", { required: true })!,
        timeoutMs: timeoutMs(readNumberArg(args, "timeout"), DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS),
      }),
  );

  const restartDaemon = tool(
    {
      name: "synara_restart_daemon",
      description:
        "Stop a daemon and launch it again with the same spec. Carries the same force-kill risk as synara_stop_daemon: shut a stateful server down cleanly first.",
      inputSchema: {
        type: "object",
        properties: NAME_PROPERTY,
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { title: "Restart daemon" },
    },
    WRITE_TOOL_ANNOTATIONS,
    (args) => broker.restart(readStringArg(args, "name", { required: true })!),
  );

  return [
    startDaemon,
    listDaemons,
    describeDaemon,
    readDaemonLogs,
    sendDaemonInput,
    waitDaemon,
    stopDaemon,
    restartDaemon,
  ];
}
