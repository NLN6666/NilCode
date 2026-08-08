// FILE: daemon.ts
// Purpose: Schemas for supervised background daemons — launch spec, lifecycle
//          snapshot, readiness conditions, restart policy, and the client-facing
//          feed and control inputs behind the background services panel.
// Layer: Shared contracts (schema-only)
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md. The spec/snapshot
// split, the state names, and the readiness/restart vocabulary follow that project.

import { Schema } from "effect";

import { LocalServerPort, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const DAEMON_NAME_MAX_LENGTH = 48;
export const DAEMON_LOGS_DEFAULT_LINES = 100;
export const DAEMON_LOGS_MAX_LINES = 1_000;
export const DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS = 5;
export const DAEMON_WAIT_DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * A daemon name is also its on-disk directory name under `<runtimeDir>/daemons/`,
 * so anything that could escape that directory is rejected here rather than being
 * sanitized later — one rule, at the boundary, with no second guess downstream.
 */
export const DaemonName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DAEMON_NAME_MAX_LENGTH),
).check(Schema.makeFilter((value: string) => !/[\\/]/u.test(value) && !value.includes("..")));
export type DaemonName = typeof DaemonName.Type;

export const DaemonState = Schema.Literals([
  /** Launched; readiness conditions still unmet. */
  "starting",
  /** Every declared readiness condition is satisfied. */
  "ready",
  /** Running normally. */
  "running",
  /** Exited with code 0 and no restart policy took over. */
  "exited",
  /** Exited non-zero (or failed to launch) and no restart policy took over. */
  "failed",
  /** Child exited and a relaunch timer is armed. */
  "restarting",
]);
export type DaemonState = typeof DaemonState.Type;

export const DaemonRestartPolicy = Schema.Literals(["no", "on-failure", "always"]);
export type DaemonRestartPolicy = typeof DaemonRestartPolicy.Type;

export const DaemonReadyCondition = Schema.Literals(["log", "port"]);
export type DaemonReadyCondition = typeof DaemonReadyCondition.Type;

/**
 * Conditions that must all hold before a daemon counts as ready. Declaring them at
 * launch collapses the usual two-call sequence (start, then wait for a banner) into
 * one call.
 */
export const DaemonReadySpec = Schema.Struct({
  /** Regular expression matched against a bounded window of recent output. */
  log: Schema.optional(TrimmedNonEmptyString),
  port: Schema.optional(LocalServerPort),
  host: Schema.optional(TrimmedNonEmptyString),
  /** Seconds to wait before reporting the readiness check timed out. */
  timeout: Schema.optional(NonNegativeInt),
});
export type DaemonReadySpec = typeof DaemonReadySpec.Type;

/** Immutable launch configuration for one daemon. */
export const DaemonSpec = Schema.Struct({
  name: DaemonName,
  application: TrimmedNonEmptyString,
  args: Schema.optional(Schema.Array(Schema.String)).pipe(Schema.withDecodingDefault(() => [])),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Working directory; defaults to the session directory when omitted. */
  cwd: Schema.optional(TrimmedNonEmptyString),
  pty: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => true)),
  ready: Schema.optional(DaemonReadySpec),
  restart: Schema.optional(DaemonRestartPolicy).pipe(Schema.withDecodingDefault(() => "no")),
  /**
   * Survive the Synara server exiting. Disables PTY input: stdio is redirected to
   * the log file, so there is no stdin channel left.
   */
  detached: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
});
export type DaemonSpec = typeof DaemonSpec.Type;

/** Serializable lifecycle state of a daemon, as seen by clients and agents. */
export const DaemonSnapshot = Schema.Struct({
  name: DaemonName,
  id: TrimmedNonEmptyString,
  state: DaemonState,
  pid: Schema.optional(Schema.NullOr(Schema.Int)).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: Schema.optional(Schema.String).pipe(Schema.withDecodingDefault(() => "")),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  readyAt: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  exitedAt: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  exitCode: Schema.optional(Schema.NullOr(Schema.Int)).pipe(Schema.withDecodingDefault(() => null)),
  exitReason: Schema.optional(Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  restartCount: Schema.optional(NonNegativeInt).pipe(Schema.withDecodingDefault(() => 0)),
  /** Total bytes ever written to this daemon's log. Doubles as the read cursor. */
  outputBytes: Schema.optional(NonNegativeInt).pipe(Schema.withDecodingDefault(() => 0)),
  /** Readiness conditions still unmet while `state` is "starting". */
  readyPending: Schema.optional(Schema.Array(DaemonReadyCondition)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  /**
   * Mirrors `DaemonSpec.detached`. The client needs it to explain why a daemon has no
   * input channel; without it the UI would have to guess from the absence of output.
   */
  detached: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
});
export type DaemonSnapshot = typeof DaemonSnapshot.Type;

// ── Client-facing surface ────────────────────────────────────────────
//
// Agents drive daemons through the `synara_*_daemon` tools; the sections below are the
// separate, deliberately narrower surface the UI uses. Blocking reads, terminal keys and
// raw signals stay agent-only: a human has a live stream and two buttons instead.

/**
 * Live daemon feed.
 *
 * `state` carries the whole snapshot rather than a delta so the client never runs a
 * second copy of the lifecycle state machine — the two would drift.
 */
export const DaemonEvent = Schema.Union([
  /** Full roster, emitted once when a subscription opens and again after a resync. */
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    daemons: Schema.Array(DaemonSnapshot),
  }),
  Schema.Struct({
    type: Schema.Literal("state"),
    snapshot: DaemonSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("output"),
    name: DaemonName,
    chunk: Schema.String,
    /** `outputBytes` *after* this chunk, so a client can tell it missed something. */
    cursor: NonNegativeInt,
  }),
]);
export type DaemonEvent = typeof DaemonEvent.Type;

export const DaemonReadLogsInput = Schema.Struct({
  name: DaemonName,
  lines: Schema.optional(NonNegativeInt).pipe(
    Schema.withDecodingDefault(() => DAEMON_LOGS_DEFAULT_LINES),
  ),
});
export type DaemonReadLogsInput = typeof DaemonReadLogsInput.Type;

export const DaemonReadLogsResult = Schema.Struct({
  snapshot: DaemonSnapshot,
  content: Schema.String,
  nextCursor: NonNegativeInt,
  /** Bytes rotated out before this read. Surfaced verbatim; never papered over. */
  droppedBytes: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type DaemonReadLogsResult = typeof DaemonReadLogsResult.Type;

export const DaemonSendTextInput = Schema.Struct({
  name: DaemonName,
  text: Schema.String,
});
export type DaemonSendTextInput = typeof DaemonSendTextInput.Type;

export const DaemonStopInput = Schema.Struct({
  name: DaemonName,
  timeoutSeconds: Schema.optional(NonNegativeInt).pipe(
    Schema.withDecodingDefault(() => DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS),
  ),
});
export type DaemonStopInput = typeof DaemonStopInput.Type;

export const DaemonRestartInput = Schema.Struct({
  name: DaemonName,
});
export type DaemonRestartInput = typeof DaemonRestartInput.Type;
