// FILE: AcpClientCapabilities.ts
// Purpose: Implements the standard ACP client-side filesystem and terminal capabilities.
// Layer: Provider ACP protocol support

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import nodePath from "node:path";

import type * as Acp from "@agentclientprotocol/sdk";
import { Effect, Scope } from "effect";

import { buildProviderChildEnvironment } from "../../providerChildEnvironment.ts";
import { teardownChildProcessTree } from "../supervisedProcessTeardown.ts";
import * as AcpErrors from "./AcpErrors.ts";
import type { AcpSessionRuntimeShape } from "./AcpSessionRuntime.ts";

const DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT = 1024 * 1024;
const MAX_TERMINAL_OUTPUT_BYTE_LIMIT = 16 * 1024 * 1024;

interface TerminalState {
  readonly child: ChildProcessWithoutNullStreams;
  readonly outputByteLimit: number;
  output: string;
  truncated: boolean;
  exitStatus: Acp.TerminalExitStatus | undefined;
  readonly exit: Promise<Acp.TerminalExitStatus>;
  teardown: Promise<void> | undefined;
}

export interface StandardAcpClientHandlers {
  readonly readTextFile: Parameters<AcpSessionRuntimeShape["handleReadTextFile"]>[0];
  readonly writeTextFile: Parameters<AcpSessionRuntimeShape["handleWriteTextFile"]>[0];
  readonly createTerminal: Parameters<AcpSessionRuntimeShape["handleCreateTerminal"]>[0];
  readonly terminalOutput: Parameters<AcpSessionRuntimeShape["handleTerminalOutput"]>[0];
  readonly terminalWaitForExit: Parameters<AcpSessionRuntimeShape["handleTerminalWaitForExit"]>[0];
  readonly terminalKill: Parameters<AcpSessionRuntimeShape["handleTerminalKill"]>[0];
  readonly terminalRelease: Parameters<AcpSessionRuntimeShape["handleTerminalRelease"]>[0];
}

function requestError(method: string, cause: unknown): AcpErrors.AcpRequestError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new AcpErrors.AcpRequestError({
    code: -32000,
    errorMessage: `${method} failed: ${detail}`,
    data: { method },
  });
}

function requireAbsolutePath(method: string, filePath: string): Effect.Effect<string, AcpErrors.AcpError> {
  return nodePath.isAbsolute(filePath)
    ? Effect.succeed(filePath)
    : Effect.fail(requestError(method, "ACP requires an absolute file path."));
}

function retainTerminalOutput(state: TerminalState, chunk: Buffer): void {
  state.output += chunk.toString("utf8");
  let bytes = Buffer.byteLength(state.output, "utf8");
  if (bytes <= state.outputByteLimit) return;
  state.truncated = true;
  while (state.output.length > 0 && bytes > state.outputByteLimit) {
    const first = state.output.codePointAt(0);
    const width = first !== undefined && first > 0xffff ? 2 : 1;
    state.output = state.output.slice(width);
    bytes = Buffer.byteLength(state.output, "utf8");
  }
}

function normalizedOutputByteLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value === null || value <= 0) {
    return DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT;
  }
  return Math.min(Math.floor(value), MAX_TERMINAL_OUTPUT_BYTE_LIMIT);
}

function stopTerminal(state: TerminalState): Promise<void> {
  if (state.teardown) return state.teardown;
  if (state.exitStatus !== undefined) return Promise.resolve();
  state.teardown = teardownChildProcessTree(state.child).then(() => undefined);
  return state.teardown;
}

export const makeStandardAcpClientHandlers = Effect.fnUntraced(function* (
  scope: Scope.Scope,
): Effect.fn.Return<StandardAcpClientHandlers> {
  const terminals = new Map<string, TerminalState>();

  const requireTerminal = (method: string, terminalId: string) => {
    const terminal = terminals.get(terminalId);
    return terminal
      ? Effect.succeed(terminal)
      : Effect.fail(requestError(method, `Unknown terminal id: ${terminalId}`));
  };

  yield* Scope.addFinalizer(
    scope,
    Effect.suspend(() =>
      Effect.forEach(Array.from(terminals.values()), (terminal) =>
        Effect.tryPromise({
          try: () => stopTerminal(terminal),
          catch: (cause) => requestError("terminal/release", cause),
        }).pipe(Effect.orDie),
      ),
    ),
  );

  return {
    readTextFile: (params) =>
      Effect.gen(function* () {
        const filePath = yield* requireAbsolutePath("fs/read_text_file", params.path);
        if (params.line !== undefined && params.line !== null && params.line < 1) {
          return yield* requestError("fs/read_text_file", "line must be >= 1.");
        }
        if (params.limit !== undefined && params.limit !== null && params.limit < 0) {
          return yield* requestError("fs/read_text_file", "limit must be >= 0.");
        }
        const content = yield* Effect.tryPromise({
          try: () => fs.readFile(filePath, "utf8"),
          catch: (cause) => requestError("fs/read_text_file", cause),
        });
        if (params.line === undefined && params.limit === undefined) return { content };
        const lines = content.split(/(?<=\n)/u);
        const start = Math.max(0, (params.line ?? 1) - 1);
        return { content: lines.slice(start, params.limit === null ? undefined : start + (params.limit ?? lines.length)).join("") };
      }),
    writeTextFile: (params) =>
      Effect.gen(function* () {
        const filePath = yield* requireAbsolutePath("fs/write_text_file", params.path);
        yield* Effect.tryPromise({
          try: () => fs.writeFile(filePath, params.content, "utf8"),
          catch: (cause) => requestError("fs/write_text_file", cause),
        });
        return {};
      }),
    createTerminal: (params) =>
      Effect.gen(function* () {
        if (params.cwd !== undefined && params.cwd !== null && !nodePath.isAbsolute(params.cwd)) {
          return yield* requestError("terminal/create", "cwd must be an absolute path.");
        }
        const terminalId = crypto.randomUUID();
        const child = yield* Effect.try({
          try: () =>
            spawn(params.command, params.args ?? [], {
              ...(params.cwd ? { cwd: params.cwd } : {}),
              env: buildProviderChildEnvironment({
                provider: "acp",
                baseEnv: {
                  ...process.env,
                  ...Object.fromEntries((params.env ?? []).map(({ name, value }) => [name, value])),
                },
              }),
              detached: process.platform !== "win32",
              shell: false,
              stdio: "pipe",
              windowsHide: true,
            }),
          catch: (cause) => requestError("terminal/create", cause),
        });
        let resolveExit!: (status: Acp.TerminalExitStatus) => void;
        const exit = new Promise<Acp.TerminalExitStatus>((resolve) => {
          resolveExit = resolve;
        });
        const state: TerminalState = {
          child,
          outputByteLimit: normalizedOutputByteLimit(params.outputByteLimit),
          output: "",
          truncated: false,
          exitStatus: undefined,
          exit,
          teardown: undefined,
        };
        terminals.set(terminalId, state);
        child.stdout.on("data", (chunk: Buffer) => retainTerminalOutput(state, chunk));
        child.stderr.on("data", (chunk: Buffer) => retainTerminalOutput(state, chunk));
        child.once("error", (error) => retainTerminalOutput(state, Buffer.from(error.message, "utf8")));
        child.once("exit", (exitCode, signal) => {
          const status = { exitCode, signal } satisfies Acp.TerminalExitStatus;
          state.exitStatus = status;
          resolveExit(status);
        });
        return { terminalId };
      }),
    terminalOutput: (params) =>
      Effect.map(requireTerminal("terminal/output", params.terminalId), (terminal) => ({
        output: terminal.output,
        truncated: terminal.truncated,
        ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}),
      })),
    terminalWaitForExit: (params) =>
      Effect.flatMap(requireTerminal("terminal/wait_for_exit", params.terminalId), (terminal) =>
        Effect.promise(() => terminal.exit),
      ),
    terminalKill: (params) =>
      Effect.flatMap(requireTerminal("terminal/kill", params.terminalId), (terminal) =>
        Effect.tryPromise({
          try: () => stopTerminal(terminal),
          catch: (cause) => requestError("terminal/kill", cause),
        }).pipe(Effect.as({})),
      ),
    terminalRelease: (params) =>
      Effect.flatMap(requireTerminal("terminal/release", params.terminalId), (terminal) =>
        Effect.tryPromise({
          try: () => stopTerminal(terminal),
          catch: (cause) => requestError("terminal/release", cause),
        }).pipe(
          Effect.tap(() => Effect.sync(() => terminals.delete(params.terminalId))),
          Effect.as({}),
        ),
      ),
  };
});

export const registerStandardAcpClientHandlers = Effect.fnUntraced(function* (
  runtime: AcpSessionRuntimeShape,
  scope: Scope.Scope,
) {
  const handlers = yield* makeStandardAcpClientHandlers(scope);
  yield* runtime.handleReadTextFile(handlers.readTextFile);
  yield* runtime.handleWriteTextFile(handlers.writeTextFile);
  yield* runtime.handleCreateTerminal(handlers.createTerminal);
  yield* runtime.handleTerminalOutput(handlers.terminalOutput);
  yield* runtime.handleTerminalWaitForExit(handlers.terminalWaitForExit);
  yield* runtime.handleTerminalKill(handlers.terminalKill);
  yield* runtime.handleTerminalRelease(handlers.terminalRelease);
});
