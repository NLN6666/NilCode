// FILE: probe/McpProbeClient.ts
// Purpose: Minimal MCP client that asks one configured server what tools it exposes.
// Layer: Agent MCP tool discovery
// Exports: McpProbeToolDescriptor, McpProbeError, MCP_PROBE_TIMEOUT_MS, probeMcpServerTools,
//          runMcpProbeSession, resolveMcpProbeSpawnTarget, McpProbeKillProcessTree
//
// Only `initialize`, `notifications/initialized` and `tools/list` are ever sent. `tools/call` is
// deliberately absent: typing `&` in the composer must never be able to execute anything.

import { redactMcpUrl } from "@synara/shared/mcp/redact";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

import { defaultProcessTreeKiller } from "../../terminal/processTreeKiller";
import {
  mcpConnectionStringRecord,
  type McpHttpConnection,
  type McpServerConnection,
  type McpStdioConnection,
} from "../mcpConfigParser";

/** Hard ceiling for one server's probe. A hung server must not stall the whole menu. */
export const MCP_PROBE_TIMEOUT_MS = 10_000;

/** Advertised during `initialize`; servers negotiate down when they speak an older revision. */
const MCP_PROBE_PROTOCOL_VERSION = "2025-06-18";
const MCP_PROBE_CLIENT_INFO = { name: "synara-mcp-probe", version: "1.0.0" } as const;

/** Guards against a server paginating `tools/list` forever. */
const MCP_PROBE_MAX_TOOL_PAGES = 20;

export interface McpProbeToolDescriptor {
  readonly name: string;
  readonly description: string | null;
}

export type McpProbeFailureReason = "timeout" | "transport" | "protocol";

export class McpProbeError extends Error {
  readonly reason: McpProbeFailureReason;

  constructor(reason: McpProbeFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpProbeError";
    this.reason = reason;
  }
}

/** One JSON-RPC conversation with a server, independent of how the bytes travel. */
export interface McpProbeSession {
  readonly request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly notify: (method: string, params?: Record<string, unknown>) => Promise<void>;
  /** Must be safe to call twice, and must leave no child process behind. */
  readonly dispose: () => void;
}

// ── Child process seam ────────────────────────────────────────────────
// Structural rather than `ChildProcess` so tests can drive a fake without spawning anything.

interface McpProbeReadable {
  setEncoding(encoding: "utf8"): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  /** A pipe failure is delivered here; an unlistened `error` event is fatal to the whole process. */
  on(event: "error", listener: (error: Error) => void): unknown;
}

interface McpProbeWritable {
  write(chunk: string): unknown;
  end(): unknown;
  /** EPIPE is reported asynchronously, so `try`/`catch` around `write` never sees it. */
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface McpProbeChildProcess {
  readonly stdin: McpProbeWritable | null;
  readonly stdout: McpProbeReadable | null;
  readonly pid?: number | undefined;
  /**
   * Set by the spawn seam when the direct child is a cmd.exe wrapper rather than the server
   * itself. Windows has no process groups, so `kill()` would reap the wrapper and orphan the
   * server it forked; `dispose` terminates the whole tree by pid instead.
   */
  readonly shellWrapped?: boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(): unknown;
  unref(): unknown;
}

export type McpProbeSpawn = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string>;
}) => McpProbeChildProcess;

/**
 * Terminates a process and everything it forked. `fallback` kills the direct child only, and is
 * for the case where the tree kill itself could not run.
 */
export type McpProbeKillProcessTree = (pid: number, fallback: () => void) => void;

export type McpProbeFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

// ── JSON-RPC helpers ──────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeJsonRpcError(value: unknown): string {
  if (isRecord(value) && typeof value["message"] === "string" && value["message"].length > 0) {
    return value["message"];
  }
  return "The MCP server returned an error.";
}

/**
 * Streamable HTTP servers answer either with a JSON body or with a one-shot SSE stream, and the
 * spec lets a client be handed both for the same request shape. Accept either framing.
 */
export function readJsonRpcMessages(text: string): ReadonlyArray<unknown> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const messages: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload.length === 0 || payload === "[DONE]") continue;
    try {
      messages.push(JSON.parse(payload));
    } catch {
      // Keepalive or a non-JSON comment frame: not our response, not an error either.
    }
  }
  return messages;
}

function readJsonRpcResult(messages: ReadonlyArray<unknown>, id: number): unknown {
  for (const message of messages) {
    if (!isRecord(message) || message["id"] !== id) continue;
    if ("error" in message) {
      throw new McpProbeError("protocol", describeJsonRpcError(message["error"]));
    }
    return message["result"];
  }
  throw new McpProbeError("protocol", "The MCP server did not answer the request.");
}

/** `tools/list` payload → the two fields the composer menu needs. Unnamed entries are dropped. */
export function readToolDescriptors(result: unknown): ReadonlyArray<McpProbeToolDescriptor> {
  if (!isRecord(result) || !Array.isArray(result["tools"])) {
    throw new McpProbeError("protocol", "The MCP server returned an invalid tool list.");
  }
  return result["tools"].flatMap((value): McpProbeToolDescriptor[] => {
    if (!isRecord(value) || typeof value["name"] !== "string" || value["name"].length === 0) {
      return [];
    }
    const description = value["description"];
    return [
      {
        name: value["name"],
        description: typeof description === "string" && description.length > 0 ? description : null,
      },
    ];
  });
}

/**
 * The whole probe conversation. Kept transport-agnostic so a fake session can assert the exact
 * method sequence without any I/O.
 */
export async function runMcpProbeSession(
  session: McpProbeSession,
): Promise<ReadonlyArray<McpProbeToolDescriptor>> {
  await session.request("initialize", {
    protocolVersion: MCP_PROBE_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: MCP_PROBE_CLIENT_INFO,
  });
  await session.notify("notifications/initialized");

  const tools: McpProbeToolDescriptor[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MCP_PROBE_MAX_TOOL_PAGES; page += 1) {
    const result = await session.request(
      "tools/list",
      cursor === undefined ? {} : { cursor: cursor },
    );
    tools.push(...readToolDescriptors(result));
    const nextCursor = isRecord(result) ? result["nextCursor"] : undefined;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) break;
    cursor = nextCursor;
  }
  return tools;
}

// ── stdio transport ───────────────────────────────────────────────────

const WINDOWS_SHELL_EXTENSIONS = new Set([".CMD", ".BAT"]);
const WINDOWS_DEFAULT_PATH_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

function readWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const parsed = (env.PATHEXT ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`).toUpperCase());
  return parsed.length > 0 ? [...new Set(parsed)] : WINDOWS_DEFAULT_PATH_EXTENSIONS;
}

// cmd.exe has no escape character: a literal quote is written by doubling it.
function quoteWindowsShellArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export interface McpProbeSpawnTarget {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell: boolean;
}

/**
 * Resolves how a configured `command` must actually be launched.
 *
 * On POSIX this is the identity. On Windows a bare `npx` names `npx.cmd`, which `spawn` neither
 * finds (it ignores PATHEXT) nor is allowed to execute directly (Node refuses `.cmd`/`.bat`
 * without a shell since the 2024 argument-injection fix), so the command is resolved against
 * PATH and, when it turns out to be a batch wrapper, routed through cmd.exe with every argument
 * quoted. An unresolvable command is passed through untouched so the spawn failure — not a
 * guess — is what the user sees.
 */
export function resolveMcpProbeSpawnTarget(input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}): McpProbeSpawnTarget {
  if (input.platform !== "win32") {
    return { command: input.command, args: input.args, shell: false };
  }

  const extensions = readWindowsPathExtensions(input.env);
  const hasKnownExtension = WINDOWS_SHELL_EXTENSIONS.has(extname(input.command).toUpperCase());
  const candidates =
    extname(input.command).length > 0
      ? [input.command]
      : [input.command, ...extensions.map((extension) => `${input.command}${extension}`)];
  const directories =
    input.command.includes("/") || input.command.includes("\\")
      ? [""]
      : (input.env.PATH ?? input.env.Path ?? "")
          .split(";")
          .map((entry) => entry.trim().replace(/^"|"$/g, ""))
          .filter((entry) => entry.length > 0);

  const resolved =
    directories
      .flatMap((directory) =>
        candidates.map((candidate) => (directory ? join(directory, candidate) : candidate)),
      )
      .find((candidate) => existsSync(candidate)) ?? (hasKnownExtension ? input.command : null);

  if (resolved === null) {
    return { command: input.command, args: input.args, shell: false };
  }
  if (!WINDOWS_SHELL_EXTENSIONS.has(extname(resolved).toUpperCase())) {
    return { command: resolved, args: input.args, shell: false };
  }
  return {
    command: quoteWindowsShellArgument(resolved),
    args: input.args.map(quoteWindowsShellArgument),
    shell: true,
  };
}

const defaultSpawn: McpProbeSpawn = ({ command, args, env }) => {
  const target = resolveMcpProbeSpawnTarget({
    command,
    args,
    platform: process.platform,
    env: process.env,
  });
  const child = spawn(target.command, [...target.args], {
    // stderr is discarded rather than piped: nothing reads it, and an unread pipe would
    // eventually block a chatty server mid-handshake.
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, ...env },
    shell: target.shell,
    windowsHide: true,
  });
  // Only the spawn seam knows a shell was interposed, and `dispose` has to know to take the tree.
  return target.shell ? Object.assign(child, { shellWrapped: true as const }) : child;
};

/**
 * Reuses the terminal layer's tree killer, which delegates to `taskkill /T` on Windows. Fire and
 * forget, because `dispose` is synchronous and every caller has already given up on the server.
 */
const defaultKillProcessTree: McpProbeKillProcessTree = (pid, fallback) => {
  try {
    defaultProcessTreeKiller.signal({
      rootPid: pid,
      signal: "SIGKILL",
      tree: defaultProcessTreeKiller.capture(pid),
      onError: fallback,
    });
  } catch {
    fallback();
  }
};

function createStdioProbeSession(
  transport: McpStdioConnection,
  spawnProcess: McpProbeSpawn,
  killProcessTree: McpProbeKillProcessTree,
): McpProbeSession {
  if (transport.command.length === 0) {
    throw new McpProbeError("transport", "This MCP server declares no command to run.");
  }

  const child = spawnProcess({
    command: transport.command,
    args: transport.args,
    env: mcpConnectionStringRecord(transport.env),
  });

  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: Error) => void }
  >();
  let terminalError: Error | null = null;
  let nextId = 1;
  let buffer = "";

  const fail = (error: Error): void => {
    terminalError ??= error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const handleLine = (line: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Servers routinely print banners on stdout before speaking JSON-RPC.
      return;
    }
    if (!isRecord(parsed)) return;
    const id = parsed["id"];
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if ("error" in parsed) {
      entry.reject(new McpProbeError("protocol", describeJsonRpcError(parsed["error"])));
      return;
    }
    entry.resolve(parsed["result"]);
  };

  const failFromError = (error: Error): void => {
    fail(new McpProbeError("transport", error.message, { cause: error }));
  };

  child.stdout?.setEncoding("utf8");
  // Newline-delimited JSON framing, matching the agent gateway's stdio proxy.
  child.stdout?.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) handleLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  // Both pipes need a listener of their own: a stream reports its failures on itself, and Node
  // turns an unlistened `error` event into an uncaught exception — one dead MCP server would
  // otherwise take the whole Synara process, and every connected session, down with it.
  child.stdout?.on("error", failFromError);
  child.stdin?.on("error", failFromError);
  child.on("error", failFromError);
  child.on("exit", () => {
    fail(new McpProbeError("transport", "The MCP server exited before listing its tools."));
  });

  const write = (payload: Record<string, unknown>): void => {
    const stdin = child.stdin;
    if (!stdin) throw new McpProbeError("transport", "The MCP server has no stdin to write to.");
    stdin.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    request: (method, params) =>
      new Promise<unknown>((resolve, reject) => {
        if (terminalError) {
          reject(terminalError);
          return;
        }
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        try {
          write({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          pending.delete(id);
          reject(
            error instanceof Error
              ? error
              : new McpProbeError("transport", "Could not write to the MCP server."),
          );
        }
      }),
    notify: async (method, params) => {
      if (terminalError) throw terminalError;
      write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    },
    dispose: () => {
      fail(new McpProbeError("transport", "The MCP probe session was closed."));
      // Every exit path lands here, so a probe can never leave a child running.
      try {
        child.stdin?.end();
      } catch {
        // The pipe may already be gone; killing below is what actually matters.
      }
      const pid = child.pid;
      try {
        if (child.shellWrapped === true && pid !== undefined) {
          // The wrapper is not killed first: taskkill walks down from a live parent.
          killProcessTree(pid, () => child.kill());
        } else {
          child.kill();
        }
      } catch {
        // Already reaped.
      }
      try {
        child.unref();
      } catch {
        // Not all process handles are unref-able; the kill above still applies.
      }
    },
  };
}

// ── http transport ────────────────────────────────────────────────────

function createHttpProbeSession(
  transport: McpHttpConnection,
  fetchImpl: McpProbeFetch,
  signal: AbortSignal,
): McpProbeSession {
  const configuredHeaders = mcpConnectionStringRecord(transport.headers);
  let sessionId: string | null = null;
  let nextId = 1;

  const post = async (payload: Record<string, unknown>): Promise<ReadonlyArray<unknown>> => {
    const response = await fetchImpl(transport.url, {
      method: "POST",
      headers: {
        ...configuredHeaders,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessionId === null ? {} : { "Mcp-Session-Id": sessionId }),
      },
      body: JSON.stringify(payload),
      signal,
    });
    // Streamable HTTP hands out the session id on the initialize response and expects it back
    // on every later request; without it a server answers 404 for `tools/list`.
    const issuedSessionId = response.headers.get("mcp-session-id");
    if (issuedSessionId !== null && issuedSessionId.length > 0) sessionId = issuedSessionId;
    if (!response.ok) {
      throw new McpProbeError("transport", `The MCP server answered HTTP ${response.status}.`);
    }
    if (response.status === 202) return [];
    return readJsonRpcMessages(await response.text());
  };

  return {
    request: async (method, params) => {
      const id = nextId;
      nextId += 1;
      const messages = await post({ jsonrpc: "2.0", id, method, params });
      return readJsonRpcResult(messages, id);
    },
    notify: async (method, params) => {
      await post({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    },
    dispose: () => {
      // Nothing to release: every request is a self-contained fetch.
    },
  };
}

// ── entry point ───────────────────────────────────────────────────────

/** `API_KEY`, `X-Api-Key`, `token`, … — names whose value is a credential by definition. */
const CREDENTIAL_KEY_PATTERN = /(?:^|[_-])(?:key|token|secret|password)$/i;

/** Below this, an arbitrary value is more likely an ordinary word than a credential. */
const MIN_SCRUBBED_VALUE_LENGTH = 4;

/**
 * Removes anything the connection marked as a credential from a message that is about to be
 * shown in the UI. The URL is replaced by its already-redacted form so the endpoint stays
 * recognizable, while env/header values become an opaque marker.
 */
function scrubConnectionSecrets(message: string, connection: McpServerConnection): string {
  let scrubbed = message;
  const entries =
    connection.transport._tag === "http"
      ? Object.entries(mcpConnectionStringRecord(connection.transport.headers))
      : Object.entries(mcpConnectionStringRecord(connection.transport.env));
  if (connection.transport._tag === "http") {
    scrubbed = scrubbed
      .split(connection.transport.url)
      .join(redactMcpUrl(connection.transport.url));
  }
  for (const [key, value] of entries) {
    // Splitting on the empty string would shred the message, and an empty value leaks nothing.
    if (value.length === 0) continue;
    // A credential-named value goes regardless of length — a three-digit PIN is still a secret.
    // Everything else has to clear the floor first, so a `DEBUG = "on"` cannot blank out every
    // "on" in the message. Known tradeoff: a short value under a neutral name stays visible.
    if (value.length < MIN_SCRUBBED_VALUE_LENGTH && !CREDENTIAL_KEY_PATTERN.test(key)) continue;
    scrubbed = scrubbed.split(value).join("<redacted>");
  }
  return scrubbed;
}

/**
 * Connects to one configured MCP server and returns its tools.
 *
 * Never throws anything but `McpProbeError`, and never leaves a child process behind: the caller
 * marks the single server as failed and keeps every other server's result.
 */
export async function probeMcpServerTools(input: {
  readonly connection: McpServerConnection;
  readonly timeoutMs?: number;
  readonly spawnProcess?: McpProbeSpawn;
  readonly killProcessTree?: McpProbeKillProcessTree;
  readonly fetch?: McpProbeFetch;
}): Promise<ReadonlyArray<McpProbeToolDescriptor>> {
  const timeoutMs = input.timeoutMs ?? MCP_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let session: McpProbeSession | undefined;

  try {
    session =
      input.connection.transport._tag === "stdio"
        ? createStdioProbeSession(
            input.connection.transport,
            input.spawnProcess ?? defaultSpawn,
            input.killProcessTree ?? defaultKillProcessTree,
          )
        : createHttpProbeSession(
            input.connection.transport,
            input.fetch ?? (globalThis.fetch as unknown as McpProbeFetch),
            controller.signal,
          );

    const activeSession = session;
    return await Promise.race([
      runMcpProbeSession(activeSession),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new McpProbeError("timeout", `The MCP server did not respond within ${timeoutMs}ms.`),
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof McpProbeError ? error.reason : "transport";
    throw new McpProbeError(reason, scrubConnectionSecrets(message, input.connection), {
      cause: error,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    session?.dispose();
  }
}
