// FILE: brokerCore.ts
// Purpose: Daemon supervision state machine — records, lifecycle transitions, readiness,
//          restart backoff, and blocking waits. Free of Effect so it can be driven
//          directly from tests with a fake launcher and fake timers.
// Layer: Daemon infrastructure
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md. The ManagedDaemon
// record, the generation counter, the settle/backoff logic, and the state names all
// follow that project's DaemonBroker.

import path from "node:path";
import { mkdir } from "node:fs/promises";

import type { DaemonSnapshot, DaemonSpec, DaemonState } from "@synara/contracts";
import type { AllowedSignal } from "@synara/shared/daemonKeys";
import { resolveTerminalKey } from "@synara/shared/daemonKeys";
import { restartDelayMs } from "@synara/shared/daemonRestart";

import { DaemonLog } from "./DaemonLog";
import { createReadinessTracker, type ReadinessTracker } from "./readiness";
import {
  resolveIdentityLiveness,
  type ProcessIdentity,
  type ProcessIdentityMap,
} from "./processIdentity";
import {
  daemonDirectory,
  listPersistedDaemons,
  removeDaemonMetadata,
  writeDaemonMetadata,
} from "./persistence";

export interface DaemonExitResult {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface DaemonProcessHandle {
  readonly pid: number;
  /**
   * True when the child writes the log file itself through an inherited fd.
   *
   * Detached daemons do exactly that, and their output reaches the broker only as a
   * replay from that same file. Appending it again would double every line.
   */
  readonly writesOwnLog?: boolean;
  /** Bytes of log already replayed, persisted so a later reclaim resumes from here. */
  readonly consumedBytes?: number;
  write(data: string): void;
  signalSelf(signal: string): void;
  killTree(signal: string): void;
  onOutput(listener: (chunk: string) => void): void;
  onExit(listener: (result: DaemonExitResult) => void): void;
}

export interface DaemonLauncher {
  launch(input: {
    spec: DaemonSpec;
    dir: string;
    log: DaemonLog;
  }): Promise<DaemonProcessHandle>;

  /** Re-adopt a detached process recorded by a previous server run. */
  reclaim(input: {
    identity: ProcessIdentity;
    log: DaemonLog;
    outputOffset: number;
  }): DaemonProcessHandle;
}

export interface BrokerCoreOptions {
  readonly rootDir: string;
  readonly launcher: DaemonLauncher;
  readonly readIdentities: (pids: readonly number[]) => ProcessIdentityMap | null;
}

interface Waiter {
  readonly condition: "ready" | "exit";
  readonly pattern: RegExp | null;
  patternBuffer: string;
  readonly settle: (result: { matched: boolean; timedOut: boolean }) => void;
}

interface ManagedDaemon {
  spec: DaemonSpec;
  snapshot: MutableSnapshot;
  readonly dir: string;
  log: DaemonLog;
  process: DaemonProcessHandle | null;
  readiness: ReadinessTracker;
  /** Bumped on every launch; stale callbacks compare against it and bail. */
  generation: number;
  consecutiveFailures: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** Set while an explicit stop is in flight, so restart policy stays out of the way. */
  stopRequested: boolean;
  /** Wall clock of the current launch, used to judge whether a run held long enough. */
  launchedAtMs: number;
  waiters: Waiter[];
}

type MutableSnapshot = {
  -readonly [K in keyof DaemonSnapshot]: DaemonSnapshot[K];
};

const TERMINAL_STATES: ReadonlySet<DaemonState> = new Set(["exited", "failed"]);

/**
 * How long a run must last before it counts as healthy and clears the failure streak.
 *
 * Clearing the streak on launch instead would defeat the backoff entirely: a process
 * that dies on startup relaunches, resets, dies again, and waits the base delay
 * forever. The streak has to survive the relaunch and only die with a run that held.
 */
const HEALTHY_UPTIME_MS = 10_000;

/** Child exited and nothing is running: includes `restarting`, where a timer is armed. */
function isSettled(state: DaemonState): boolean {
  return TERMINAL_STATES.has(state) || state === "restarting";
}

export interface BrokerCore {
  start(spec: DaemonSpec): Promise<DaemonSnapshot>;
  list(): DaemonSnapshot[];
  describe(name: string): DaemonSnapshot;
  logs(input: {
    name: string;
    lines: number;
    head: boolean;
    grep: string | null;
    follow: boolean;
    cursor: number;
    timeoutMs: number;
  }): Promise<{ snapshot: DaemonSnapshot; content: string; nextCursor: number; droppedBytes: number; truncated: boolean }>;
  send(input: {
    name: string;
    text: string | null;
    enter: boolean;
    keys: readonly string[];
    signal: AllowedSignal | null;
  }): Promise<DaemonSnapshot>;
  wait(input: {
    name: string;
    for: "ready" | "exit";
    pattern: string | null;
    timeoutMs: number;
  }): Promise<{ snapshot: DaemonSnapshot; matched: boolean; timedOut: boolean }>;
  stop(input: { name: string; timeoutMs: number }): Promise<DaemonSnapshot>;
  restart(name: string): Promise<DaemonSnapshot>;
  reclaimDetached(): Promise<DaemonSnapshot[]>;
  dispose(): Promise<void>;
}

export class DaemonNotFoundError extends Error {
  constructor(name: string) {
    super(`no daemon named ${name}`);
    this.name = "DaemonNotFoundError";
  }
}

export function createBrokerCore(options: BrokerCoreOptions): BrokerCore {
  const records = new Map<string, ManagedDaemon>();
  let idCounter = 0;

  function require(name: string): ManagedDaemon {
    const record = records.get(name);
    if (record === undefined) throw new DaemonNotFoundError(name);
    return record;
  }

  function publish(record: ManagedDaemon): DaemonSnapshot {
    record.snapshot.outputBytes = record.log.outputBytes;
    record.snapshot.readyPending =
      record.snapshot.state === "starting" ? [...record.readiness.pending] : [];
    return { ...record.snapshot };
  }

  function settleWaiters(
    record: ManagedDaemon,
    predicate: (waiter: Waiter) => boolean,
    outcome: { matched: boolean; timedOut: boolean },
  ): void {
    const remaining: Waiter[] = [];
    for (const waiter of record.waiters) {
      if (predicate(waiter)) waiter.settle(outcome);
      else remaining.push(waiter);
    }
    record.waiters = remaining;
  }

  function handleOutput(
    record: ManagedDaemon,
    generation: number,
    chunk: string,
    writesOwnLog: boolean,
  ): void {
    if (generation !== record.generation) return;

    // Captured at launch rather than read off `record.process`, which settle() nulls:
    // a tailer flushing its last chunk after exit must still not double-write.
    if (!writesOwnLog) void record.log.append(chunk);

    if (record.snapshot.state === "starting") {
      record.readiness.feedOutput(chunk);
      if (record.readiness.isReady) markReady(record);
    }

    if (record.waiters.length === 0) return;
    for (const waiter of [...record.waiters]) {
      if (waiter.pattern === null) continue;
      waiter.patternBuffer = (waiter.patternBuffer + chunk).slice(-8_192);
      if (waiter.pattern.test(waiter.patternBuffer)) {
        record.waiters = record.waiters.filter((candidate) => candidate !== waiter);
        waiter.settle({ matched: true, timedOut: false });
      }
    }
  }

  function markReady(record: ManagedDaemon): void {
    record.snapshot.state = "ready";
    record.snapshot.readyAt = new Date().toISOString();
    record.snapshot.readyPending = [];
    settleWaiters(record, (waiter) => waiter.condition === "ready" && waiter.pattern === null, {
      matched: true,
      timedOut: false,
    });
  }

  function settle(record: ManagedDaemon, generation: number, result: DaemonExitResult): void {
    // A superseded generation's exit must not touch the live one: without this guard a
    // relaunch races its predecessor's callback and the fresh process is marked dead.
    if (generation !== record.generation) return;

    // A dead daemon must not be reclaimed on the next boot: its pid is free to be
    // handed to something else the moment it exits.
    if (record.spec.detached) void removeDaemonMetadata(record.dir).catch(() => undefined);

    record.process = null;
    record.snapshot.exitCode = result.code;
    record.snapshot.exitReason = result.signal;
    record.snapshot.exitedAt = new Date().toISOString();
    record.snapshot.pid = null;

    const failed = result.code !== 0;
    const policy = record.spec.restart;
    const shouldRestart =
      !record.stopRequested && (policy === "always" || (policy === "on-failure" && failed));

    if (shouldRestart) {
      // A run that held past the healthy threshold starts the streak over; anything
      // shorter is part of the same crash loop and keeps escalating the delay.
      const heldLongEnough = Date.now() - record.launchedAtMs >= HEALTHY_UPTIME_MS;
      record.consecutiveFailures = heldLongEnough ? 1 : record.consecutiveFailures + 1;
      record.snapshot.state = "restarting";
      const delay = restartDelayMs(record.consecutiveFailures);
      record.restartTimer = setTimeout(() => {
        record.restartTimer = null;
        void launch(record).catch(() => {
          record.snapshot.state = "failed";
        });
      }, delay);
    } else {
      // A daemon the caller asked to stop settles as `exited` whatever its exit code:
      // SIGTERM leaves 143 behind, and reporting that as `failed` would tell the agent
      // something broke when it was the one that pulled the plug.
      record.snapshot.state = record.stopRequested || !failed ? "exited" : "failed";
    }

    // Everything waiting is woken regardless of what it asked for: a pattern waiter on a
    // dead process would otherwise sit until its full timeout for output that can never
    // arrive.
    settleWaiters(record, () => true, { matched: false, timedOut: false });
  }

  async function launch(record: ManagedDaemon): Promise<void> {
    record.generation += 1;
    const generation = record.generation;

    record.readiness = createReadinessTracker(record.spec.ready ?? null);
    record.snapshot.state = record.spec.ready === undefined ? "running" : "starting";
    record.snapshot.startedAt = new Date().toISOString();
    record.snapshot.exitedAt = null;
    record.snapshot.exitCode = null;
    record.snapshot.exitReason = null;
    record.snapshot.readyAt = null;

    const handle = await options.launcher.launch({
      spec: record.spec,
      dir: record.dir,
      log: record.log,
    });

    if (generation !== record.generation) return;

    record.process = handle;
    record.snapshot.pid = handle.pid;
    record.launchedAtMs = Date.now();
    if (record.snapshot.restartCount > 0 || generation > 1) {
      record.snapshot.restartCount = generation - 1;
    }

    const writesOwnLog = handle.writesOwnLog === true;
    handle.onOutput((chunk) => handleOutput(record, generation, chunk, writesOwnLog));
    handle.onExit((result) => settle(record, generation, result));

    if (record.snapshot.state === "starting" && record.readiness.isReady) markReady(record);

    if (record.spec.detached) await persist(record);
  }

  /**
   * Record a detached daemon so the next server boot can find it.
   *
   * The identity — not just the pid — is what gets written: pids are recycled, and a
   * reclaim that trusted the number alone would eventually adopt, and later kill, some
   * unrelated process the user is running.
   */
  async function persist(record: ManagedDaemon): Promise<void> {
    const pid = record.snapshot.pid;
    if (pid === null) return;
    const identity = options.readIdentities([pid])?.get(pid);
    await writeDaemonMetadata(record.dir, {
      spec: record.spec,
      id: record.snapshot.id,
      identity: identity ?? { pid, startedAt: null, commandLine: "" },
      createdAt: record.snapshot.createdAt,
      startedAt: record.snapshot.startedAt,
      outputOffset: record.process?.consumedBytes ?? 0,
    }).catch(() => {
      // Losing the record costs a reclaim, not the daemon. Failing the launch over it
      // would be the worse trade.
    });
  }

  return {
    async start(spec: DaemonSpec): Promise<DaemonSnapshot> {
      const existing = records.get(spec.name);
      if (existing !== undefined && !TERMINAL_STATES.has(existing.snapshot.state)) {
        return publish(existing);
      }

      if (existing !== undefined) {
        existing.spec = spec;
        existing.stopRequested = false;
        await launch(existing);
        return publish(existing);
      }

      const dir = daemonDirectory(options.rootDir, spec.name);
      await mkdir(dir, { recursive: true });
      idCounter += 1;

      const record: ManagedDaemon = {
        spec,
        dir,
        log: await DaemonLog.open(dir),
        process: null,
        readiness: createReadinessTracker(spec.ready ?? null),
        generation: 0,
        consecutiveFailures: 0,
        restartTimer: null,
        stopRequested: false,
        launchedAtMs: Date.now(),
        waiters: [],
        snapshot: {
          name: spec.name,
          id: `d${idCounter}`,
          state: "starting",
          pid: null,
          createdAt: new Date().toISOString(),
          startedAt: null,
          readyAt: null,
          exitedAt: null,
          exitCode: null,
          exitReason: null,
          restartCount: 0,
          outputBytes: 0,
          readyPending: [],
        },
      };

      records.set(spec.name, record);
      await launch(record);
      return publish(record);
    },

    list(): DaemonSnapshot[] {
      return [...records.values()].map(publish);
    },

    describe(name: string): DaemonSnapshot {
      return publish(require(name));
    },

    async logs(input) {
      const record = require(input.name);

      if (input.follow && record.log.outputBytes <= input.cursor && record.process !== null) {
        await new Promise<void>((resolve) => {
          const waiter: Waiter = {
            condition: "exit",
            pattern: null,
            patternBuffer: "",
            settle: () => resolve(),
          };
          record.waiters.push(waiter);
          const timer = setTimeout(() => {
            record.waiters = record.waiters.filter((candidate) => candidate !== waiter);
            resolve();
          }, input.timeoutMs);
          const original = waiter.settle;
          Object.assign(waiter, {
            settle: (result: { matched: boolean; timedOut: boolean }) => {
              clearTimeout(timer);
              original(result);
            },
          });
        });
      }

      const read = await record.log.read({
        cursor: input.cursor,
        lines: input.lines,
        head: input.head,
        grep: input.grep,
      });
      return { snapshot: publish(record), ...read };
    },

    async send(input) {
      const record = require(input.name);

      if (record.process === null) {
        throw new Error(
          `daemon ${input.name} has exited (code ${record.snapshot.exitCode ?? "unknown"})`,
        );
      }

      if (input.signal !== null) {
        record.process.signalSelf(input.signal);
        return publish(record);
      }

      if (record.spec.detached) {
        throw new Error(
          `daemon ${input.name} is detached: its stdio is redirected to the log file, so it has no stdin channel. Use signal instead.`,
        );
      }

      if (input.text !== null && input.text.length > 0) {
        record.process.write(input.enter ? `${input.text}\r` : input.text);
      }
      for (const key of input.keys) {
        const bytes = resolveTerminalKey(key);
        if (bytes === null) throw new Error(`unknown terminal key ${key}`);
        record.process.write(bytes);
      }

      return publish(record);
    },

    async wait(input) {
      const record = require(input.name);

      if (input.pattern === null) {
        if (input.for === "exit" && isSettled(record.snapshot.state)) {
          return { snapshot: publish(record), matched: true, timedOut: false };
        }
        if (input.for === "ready" && record.readiness.isReady) {
          return { snapshot: publish(record), matched: true, timedOut: false };
        }
      }

      const outcome = await new Promise<{ matched: boolean; timedOut: boolean }>((resolve) => {
        const waiter: Waiter = {
          condition: input.for,
          pattern: compilePattern(input.pattern),
          patternBuffer: "",
          settle: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
        };
        const timer = setTimeout(() => {
          record.waiters = record.waiters.filter((candidate) => candidate !== waiter);
          resolve({ matched: false, timedOut: true });
        }, input.timeoutMs);
        record.waiters.push(waiter);
      });

      return { snapshot: publish(record), ...outcome };
    },

    async stop(input) {
      const record = require(input.name);
      record.stopRequested = true;
      if (record.restartTimer !== null) {
        clearTimeout(record.restartTimer);
        record.restartTimer = null;
      }

      const handle = record.process;
      if (handle === null) return publish(record);

      const exited = new Promise<void>((resolve) => {
        const waiter: Waiter = {
          condition: "exit",
          pattern: null,
          patternBuffer: "",
          settle: () => resolve(),
        };
        record.waiters.push(waiter);
      });

      handle.signalSelf("SIGTERM");
      const forceTimer = setTimeout(() => handle.killTree("SIGKILL"), input.timeoutMs);
      await exited;
      clearTimeout(forceTimer);

      return publish(record);
    },

    async restart(name: string): Promise<DaemonSnapshot> {
      const record = require(name);
      if (record.process !== null) {
        await this.stop({ name, timeoutMs: 5_000 });
      }
      record.stopRequested = false;
      await launch(record);
      return publish(record);
    },

    /**
     * Re-adopt every detached daemon a previous server run recorded.
     *
     * The three outcomes of the identity check are deliberately asymmetric. A pid whose
     * identity matches is adopted live; a pid that is gone, or now belongs to something
     * else, is recorded as exited and its metadata dropped. A query that *failed* leaves
     * the daemon adopted as running: claiming a live Minecraft server had exited would
     * lead the agent to relaunch it, and two processes on one world save is a far worse
     * outcome than a status that is merely stale.
     */
    async reclaimDetached(): Promise<DaemonSnapshot[]> {
      const discovered = await listPersistedDaemons(options.rootDir);
      const fresh = discovered.filter((entry) => !records.has(entry.record.spec.name));
      if (fresh.length === 0) return [];

      // One batched query for every pid: each platform call costs hundreds of
      // milliseconds, so per-daemon queries would scale badly on a busy machine.
      const identities = options.readIdentities(fresh.map((entry) => entry.record.identity.pid));
      const reclaimed: DaemonSnapshot[] = [];

      for (const { dir, record: persisted } of fresh) {
        const liveness = resolveIdentityLiveness(persisted.identity, identities);
        if (liveness === "exited") {
          await removeDaemonMetadata(dir).catch(() => undefined);
          continue;
        }

        const log = await DaemonLog.open(dir, { reuseExisting: true });
        await log.refreshFromDisk();
        idCounter += 1;

        const record: ManagedDaemon = {
          spec: persisted.spec,
          dir,
          log,
          process: null,
          // A reclaimed daemon is long past its startup banner; re-running the readiness
          // probe would strand it in `starting` waiting for a line already scrolled by.
          readiness: createReadinessTracker(null),
          generation: 1,
          consecutiveFailures: 0,
          restartTimer: null,
          stopRequested: false,
          launchedAtMs: Date.now(),
          waiters: [],
          snapshot: {
            name: persisted.spec.name,
            id: persisted.id,
            state: "running",
            pid: persisted.identity.pid,
            createdAt: persisted.createdAt,
            startedAt: persisted.startedAt,
            readyAt: null,
            exitedAt: null,
            exitCode: null,
            exitReason: null,
            restartCount: 0,
            outputBytes: log.outputBytes,
            readyPending: [],
          },
        };

        const handle = options.launcher.reclaim({
          identity: persisted.identity,
          log,
          outputOffset: persisted.outputOffset,
        });
        record.process = handle;
        handle.onOutput((chunk) => handleOutput(record, record.generation, chunk, true));
        handle.onExit((result) => settle(record, record.generation, result));

        records.set(persisted.spec.name, record);
        reclaimed.push(publish(record));
      }

      return reclaimed;
    },

    async dispose(): Promise<void> {
      for (const record of records.values()) {
        if (record.restartTimer !== null) clearTimeout(record.restartTimer);
        settleWaiters(record, () => true, { matched: false, timedOut: false });
        // Checkpoint how much log a live detached daemon has already replayed, so the
        // next boot resumes from there instead of re-reading the whole file.
        if (record.spec.detached && record.process !== null) await persist(record);
        await record.log.close();
      }
      records.clear();
    },
  };
}

function compilePattern(source: string | null): RegExp | null {
  if (source === null || source.length === 0) return null;
  try {
    return new RegExp(source, "u");
  } catch {
    return null;
  }
}
