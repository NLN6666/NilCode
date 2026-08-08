// FILE: Broker.ts
// Purpose: DaemonBroker service interface and tag — supervision of long-running
//          background processes on behalf of agents.
// Layer: Daemon service contract
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.

import type { DaemonSnapshot, DaemonSpec } from "@synara/contracts";
import type { AllowedSignal } from "@synara/shared/daemonKeys";
import { Effect, Schema, ServiceMap } from "effect";

import type { DaemonBrokerEvent } from "../brokerCore";
import type { DaemonLogRead } from "../DaemonLog";

export class DaemonError extends Schema.TaggedErrorClass<DaemonError>()("DaemonError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export interface DaemonLogsInput {
  readonly name: string;
  readonly lines: number;
  readonly head: boolean;
  readonly grep: string | null;
  readonly follow: boolean;
  readonly cursor: number;
  readonly timeoutMs: number;
}

export interface DaemonSendInput {
  readonly name: string;
  readonly text: string | null;
  readonly enter: boolean;
  readonly keys: readonly string[];
  readonly signal: AllowedSignal | null;
}

export interface DaemonWaitInput {
  readonly name: string;
  /** Lifecycle condition to wait for. Ignored when `pattern` is supplied. */
  readonly for: "ready" | "exit";
  /** Output regex. Takes precedence over `for` when present. */
  readonly pattern: string | null;
  readonly timeoutMs: number;
}

export interface DaemonWaitResult {
  readonly snapshot: DaemonSnapshot;
  readonly matched: boolean;
  readonly timedOut: boolean;
}

export interface DaemonLogsResult extends DaemonLogRead {
  readonly snapshot: DaemonSnapshot;
}

export interface DaemonBrokerShape {
  /**
   * Launch a daemon, or return the existing one when `name` is already running.
   *
   * Starting an already-running daemon is idempotent rather than an error: agents
   * retry, and answering with a failure would push them toward stop-then-start, which
   * is exactly the destructive path a stateful server must not take.
   */
  readonly start: (spec: DaemonSpec) => Effect.Effect<DaemonSnapshot, DaemonError>;

  readonly list: Effect.Effect<readonly DaemonSnapshot[], never>;

  readonly describe: (name: string) => Effect.Effect<DaemonSnapshot, DaemonError>;

  /** Read log output from a byte cursor, optionally blocking for new bytes. */
  readonly logs: (input: DaemonLogsInput) => Effect.Effect<DaemonLogsResult, DaemonError>;

  /** Write stdin text, terminal keys, or a process signal. */
  readonly send: (input: DaemonSendInput) => Effect.Effect<DaemonSnapshot, DaemonError>;

  /** Block until a lifecycle condition or output pattern is met, or the timeout lapses. */
  readonly wait: (input: DaemonWaitInput) => Effect.Effect<DaemonWaitResult, DaemonError>;

  /**
   * Terminate a daemon: graceful signal first, force-kill the tree after the grace
   * period. Callers driving a stateful server should send its own shutdown command
   * before reaching for this.
   */
  readonly stop: (input: {
    name: string;
    timeoutMs: number;
  }) => Effect.Effect<DaemonSnapshot, DaemonError>;

  readonly restart: (name: string) => Effect.Effect<DaemonSnapshot, DaemonError>;

  /** Re-adopt detached daemons recorded on disk. Runs once at broker startup. */
  readonly reclaimDetached: Effect.Effect<readonly DaemonSnapshot[], never>;

  /**
   * Listen to lifecycle transitions and output; returns the unsubscribe function.
   *
   * Deliberately synchronous rather than a `Stream`: the caller is a per-connection RPC
   * stream that has to attach its listener and read the current roster without a gap in
   * between, and a Stream would put a scope boundary right where that gap must not be.
   */
  readonly subscribe: (listener: (event: DaemonBrokerEvent) => void) => () => void;

  readonly dispose: Effect.Effect<void>;
}

export class DaemonBroker extends ServiceMap.Service<DaemonBroker, DaemonBrokerShape>()(
  "synara/daemon/Services/Broker/DaemonBroker",
) {}
