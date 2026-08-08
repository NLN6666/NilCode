// FILE: launcher.ts
// Purpose: Turn a DaemonSpec into a live process handle — PTY, piped child, or
//          detached child writing straight into the log file.
// Layer: Daemon infrastructure
// Depends on: node-pty, node:child_process, DaemonLog, processTreeKiller.
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.
//
// Three launch modes, because a daemon's stdio wiring is what decides which of the
// broker's features it can have:
//
//   pty       interactive stdin, output streamed to the broker. The default: a
//             Minecraft server only accepts `stop` on a real terminal.
//   piped     no terminal, still supervised. For processes that misbehave under a PTY.
//   detached  stdout/stderr point at the log fd and the process outlives the server.
//             No stdin exists, so output can only be read back by tailing the file.

import { spawn as spawnChildProcess, type ChildProcess } from "node:child_process";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

import type { DaemonSpec } from "@synara/contracts";

import {
  defaultProcessTreeKiller,
  type ProcessTreeKiller,
  type TerminalKillSignal,
} from "../terminal/processTreeKiller.ts";
import { ptyPlatformSpawnOptions } from "../terminal/ptySpawnOptions.ts";
import type { DaemonLog } from "./DaemonLog.ts";
import type { DaemonExitResult, DaemonLauncher, DaemonProcessHandle } from "./brokerCore.ts";
import {
  readProcessIdentities,
  resolveIdentityLiveness,
  type ProcessIdentity,
  type ProcessIdentityMap,
} from "./processIdentity.ts";
import { resolveExecutable } from "../executableLookup.ts";
import { daemonSpawnOptions } from "./spawnOptions.ts";

/** How often a detached daemon's log file is polled for new output. */
export const DETACHED_TAIL_INTERVAL_MS = 250;
/**
 * How often a reclaimed daemon's pid is re-checked.
 *
 * Deliberately far slower than the log tail: each check shells out to `ps` or
 * PowerShell, and a reclaimed daemon's death is not urgent enough to pay that
 * every quarter second.
 */
export const RECLAIM_LIVENESS_INTERVAL_MS = 5_000;

type NodePtyModule = typeof import("node-pty");

export interface DaemonLauncherDependencies {
  readonly platform: NodeJS.Platform;
  readonly spawnChild: typeof spawnChildProcess;
  readonly loadPty: () => Promise<NodePtyModule>;
  readonly killer: ProcessTreeKiller;
  readonly tailIntervalMs: number;
  readonly livenessIntervalMs: number;
  readonly readIdentities: (pids: readonly number[]) => ProcessIdentityMap | null;
  readonly resolveApplication: (command: string, env: NodeJS.ProcessEnv) => string | null;
}

/**
 * Emitter shared by every handle: one output listener, one exit listener.
 *
 * Both are buffered until they are attached. The broker registers its listeners only
 * after `launch()` resolves, and a process that prints its banner — or dies outright —
 * inside that window would otherwise be lost: the daemon would sit in `starting`
 * forever, waiting on an exit that already happened.
 */
abstract class BaseHandle implements DaemonProcessHandle {
  private outputListenerInternal: ((chunk: string) => void) | null = null;
  private exitListener: ((result: DaemonExitResult) => void) | null = null;
  private pendingOutput: string[] = [];
  private pendingExit: DaemonExitResult | null = null;
  private settled = false;

  /** Emit a chunk, holding it back until a listener exists. */
  protected emitOutput(chunk: string): void {
    if (this.outputListenerInternal === null) this.pendingOutput.push(chunk);
    else this.outputListenerInternal(chunk);
  }

  abstract readonly pid: number;
  abstract write(data: string): void;
  abstract signalSelf(signal: string): void;

  constructor(protected readonly killer: ProcessTreeKiller) {}

  killTree(signal: string): void {
    // The tree killer speaks only SIGTERM/SIGKILL; anything gentler than SIGKILL is
    // delivered as SIGTERM rather than silently dropped.
    const mapped: TerminalKillSignal = signal === "SIGKILL" ? "SIGKILL" : "SIGTERM";
    const tree = this.killer.capture(this.pid);
    this.killer.signal({
      rootPid: this.pid,
      signal: mapped,
      tree,
      onError: () => {
        // A pid that vanished between capture and signal is the expected outcome of a
        // force-kill, not a fault worth surfacing.
      },
    });
  }

  onOutput(listener: (chunk: string) => void): void {
    this.outputListenerInternal = listener;
    for (const chunk of this.pendingOutput.splice(0)) listener(chunk);
  }

  onExit(listener: (result: DaemonExitResult) => void): void {
    this.exitListener = listener;
    if (this.pendingExit !== null) {
      const result = this.pendingExit;
      this.pendingExit = null;
      listener(result);
    }
  }

  /** Deliver exit exactly once: a PTY and a child can both report the same death. */
  protected settle(result: DaemonExitResult): void {
    if (this.settled) return;
    this.settled = true;
    if (this.exitListener === null) this.pendingExit = result;
    else this.exitListener(result);
  }
}

class PtyHandle extends BaseHandle {
  constructor(
    private readonly pty: import("node-pty").IPty,
    killer: ProcessTreeKiller,
  ) {
    super(killer);
    pty.onData((chunk) => this.emitOutput(chunk));
    pty.onExit((event) =>
      this.settle({ code: event.exitCode, signal: signalName(event.signal ?? null) }),
    );
  }

  get pid(): number {
    return this.pty.pid;
  }

  write(data: string): void {
    this.pty.write(data);
  }

  signalSelf(signal: string): void {
    this.pty.kill(signal);
  }
}

class PipedHandle extends BaseHandle {
  constructor(
    private readonly child: ChildProcess,
    killer: ProcessTreeKiller,
  ) {
    super(killer);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.emitOutput(chunk));
    child.stderr?.on("data", (chunk: string) => this.emitOutput(chunk));
    child.on("exit", (code, signal) => this.settle({ code, signal }));
    // A spawn that never produced a process still has to settle, or the daemon would
    // sit in `starting` forever waiting on a child that does not exist.
    child.on("error", (error) => {
      this.emitOutput(`${error.message}\n`);
      this.settle({ code: -1, signal: null });
    });
  }

  get pid(): number {
    return this.child.pid ?? -1;
  }

  write(data: string): void {
    this.child.stdin?.write(data);
  }

  signalSelf(signal: string): void {
    this.child.kill(signal as NodeJS.Signals);
  }
}

/**
 * Replays whatever a self-logging child appended to its log file since the last pass.
 *
 * Byte-oriented on purpose: a read boundary can fall inside a multi-byte character, and
 * StringDecoder carries the partial sequence into the next pass rather than emitting a
 * replacement character into the middle of a readiness pattern.
 */
class LogTailer {
  private readonly decoder = new StringDecoder("utf8");
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly log: DaemonLog,
    private offset: number,
  ) {}

  /** Bytes consumed so far — persisted so a later reclaim resumes instead of replaying. */
  get consumedBytes(): number {
    return this.offset;
  }

  start(intervalMs: number, emit: (chunk: string) => void): void {
    this.timer = setInterval(() => void this.drain(emit), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async drain(emit: (chunk: string) => void): Promise<void> {
    let handle;
    try {
      handle = await open(this.log.filePath, "r");
    } catch {
      return;
    }
    try {
      await this.log.refreshFromDisk();
      const size = (await handle.stat()).size;
      while (this.offset < size) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1_024, size - this.offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        const text = this.decoder.write(buffer.subarray(0, bytesRead));
        if (text.length > 0) emit(text);
      }
    } catch {
      // A truncated or rotated file resolves itself on the next pass.
    } finally {
      await handle.close();
    }
  }
}

/** Signal a pid we hold no handle for. Failure means it is already gone. */
function signalPidDirectly(pid: number, signal: string): void {
  if (pid <= 0) return;
  try {
    globalThis.process.kill(pid, signal as NodeJS.Signals);
  } catch {
    // Already gone: the exit path has the authoritative answer.
  }
}

class DetachedHandle extends BaseHandle {
  /** The child owns the log fd; the broker must not append what it replays. */
  readonly writesOwnLog = true;

  constructor(
    private readonly child: ChildProcess,
    private readonly tail: LogTailer,
    killer: ProcessTreeKiller,
    tailIntervalMs: number,
  ) {
    super(killer);
    child.on("exit", (code, signal) => {
      // One last drain before settling: the child's final lines exist only in the file,
      // and a `wait` on an output pattern would otherwise never see them.
      void this.tail
        .drain((chunk) => this.emitOutput(chunk))
        .finally(() => {
          this.tail.stop();
          this.settle({ code, signal });
        });
    });
    child.on("error", (error) => {
      this.tail.stop();
      this.emitOutput(`${error.message}\n`);
      this.settle({ code: -1, signal: null });
    });
    this.tail.start(tailIntervalMs, (chunk) => this.emitOutput(chunk));
  }

  get pid(): number {
    return this.child.pid ?? -1;
  }

  get consumedBytes(): number {
    return this.tail.consumedBytes;
  }

  write(): void {
    throw new Error("a detached daemon has no stdin channel");
  }

  signalSelf(signal: string): void {
    signalPidDirectly(this.pid, signal);
  }
}

/**
 * A detached daemon re-adopted after a server restart.
 *
 * There is no ChildProcess left to listen to, so exit is discovered by re-querying the
 * process table. A query that fails leaves the daemon alone: reporting a live Minecraft
 * server as exited would have the agent relaunch it onto the same world save.
 */
class ReclaimedHandle extends BaseHandle {
  readonly writesOwnLog = true;

  private liveness: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly identity: ProcessIdentity,
    private readonly tail: LogTailer,
    killer: ProcessTreeKiller,
    tailIntervalMs: number,
    livenessIntervalMs: number,
    private readonly readIdentities: (pids: readonly number[]) => ProcessIdentityMap | null,
  ) {
    super(killer);
    this.tail.start(tailIntervalMs, (chunk) => this.emitOutput(chunk));
    this.liveness = setInterval(() => this.checkLiveness(), livenessIntervalMs);
    this.liveness.unref?.();
  }

  get pid(): number {
    return this.identity.pid;
  }

  get consumedBytes(): number {
    return this.tail.consumedBytes;
  }

  write(): void {
    throw new Error("a detached daemon has no stdin channel");
  }

  signalSelf(signal: string): void {
    signalPidDirectly(this.pid, signal);
  }

  private checkLiveness(): void {
    const liveness = resolveIdentityLiveness(
      this.identity,
      this.readIdentities([this.identity.pid]),
    );
    if (liveness !== "exited") return;
    void this.tail
      .drain((chunk) => this.emitOutput(chunk))
      .finally(() => {
        this.stopWatching();
        // Nobody observed the exit itself, so there is no code to report — only the fact.
        this.settle({ code: null, signal: null });
      });
  }

  private stopWatching(): void {
    this.tail.stop();
    if (this.liveness === null) return;
    clearInterval(this.liveness);
    this.liveness = null;
  }
}

function signalName(signal: number | null): string | null {
  return signal === null || signal === 0 ? null : `SIG${signal}`;
}

function resolveEnv(spec: DaemonSpec): NodeJS.ProcessEnv {
  return spec.env === undefined
    ? globalThis.process.env
    : { ...globalThis.process.env, ...spec.env };
}

export function createDaemonLauncher(
  overrides: Partial<DaemonLauncherDependencies> = {},
): DaemonLauncher {
  const deps: DaemonLauncherDependencies = {
    platform: globalThis.process.platform,
    spawnChild: spawnChildProcess,
    loadPty: () => import("node-pty"),
    killer: defaultProcessTreeKiller,
    tailIntervalMs: DETACHED_TAIL_INTERVAL_MS,
    livenessIntervalMs: RECLAIM_LIVENESS_INTERVAL_MS,
    readIdentities: readProcessIdentities,
    resolveApplication: (command, env) => resolveExecutable(command, { env }),
    ...overrides,
  };

  return {
    async launch({ spec, log }): Promise<DaemonProcessHandle> {
      const cwd = spec.cwd ?? globalThis.process.cwd();
      const env = resolveEnv(spec);

      if (spec.detached) {
        // Start the tailer from the current end of file so a relaunch does not replay
        // the previous run's output into this run's readiness probe.
        await log.refreshFromDisk();
        const tail = new LogTailer(log, await currentFileSize(log));
        const child = deps.spawnChild(spec.application, [...(spec.args ?? [])], {
          cwd,
          env,
          ...daemonSpawnOptions({ detached: true, platform: deps.platform, logFd: log.fd }),
        });
        child.unref();
        return new DetachedHandle(child, tail, deps.killer, deps.tailIntervalMs);
      }

      if (spec.pty) {
        const pty = await deps.loadPty();
        // node-pty does not search PATH the way child_process does, so a bare `java`
        // dies with "File not found" — which is exactly what an agent will write.
        // Resolving here keeps the spec's vocabulary the same across all three modes.
        const application = deps.resolveApplication(spec.application, env) ?? spec.application;
        const ptyProcess = pty.spawn(application, [...(spec.args ?? [])], {
          cwd,
          env: env as Record<string, string>,
          cols: 120,
          rows: 30,
          name: deps.platform === "win32" ? "xterm-color" : "xterm-256color",
          ...ptyPlatformSpawnOptions(deps.platform),
        });
        return new PtyHandle(ptyProcess, deps.killer);
      }

      const child = deps.spawnChild(spec.application, [...(spec.args ?? [])], {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: deps.platform === "win32",
      });
      return new PipedHandle(child, deps.killer);
    },

    reclaim({ identity, log, outputOffset }): DaemonProcessHandle {
      return new ReclaimedHandle(
        identity,
        new LogTailer(log, outputOffset),
        deps.killer,
        deps.tailIntervalMs,
        deps.livenessIntervalMs,
        deps.readIdentities,
      );
    },
  };
}

async function currentFileSize(log: DaemonLog): Promise<number> {
  try {
    const handle = await open(log.filePath, "r");
    try {
      return (await handle.stat()).size;
    } finally {
      await handle.close();
    }
  } catch {
    return 0;
  }
}
