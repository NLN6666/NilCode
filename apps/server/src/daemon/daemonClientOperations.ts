// FILE: daemonClientOperations.ts
// Purpose: The daemon operations a human drives from the background services panel,
//          expressed against the broker and free of WebSocket plumbing.
// Layer: Daemon service adapter
// Depends on: DaemonBroker.
// Exports: readDaemonLogs, sendDaemonText, stopDaemon, restartDaemon, daemonRosterEvent.
//
// The agent tool surface (`synara_*_daemon`) and this one both sit on the same broker,
// but they are not the same surface and must not be merged. An agent gets blocking
// waits, terminal key sequences and raw signals because it has no eyes; a person gets a
// live stream and two buttons. Keeping the narrower surface narrow is what stops the UI
// from growing an accidental "send SIGKILL" affordance.

import type {
  DaemonEvent,
  DaemonReadLogsInput,
  DaemonReadLogsResult,
  DaemonRestartInput,
  DaemonSendTextInput,
  DaemonSnapshot,
  DaemonStopInput,
} from "@synara/contracts";
import {
  DAEMON_LOGS_DEFAULT_LINES,
  DAEMON_LOGS_MAX_LINES,
  DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS,
} from "@synara/contracts";
import { Effect } from "effect";

import type { DaemonBrokerShape, DaemonError } from "./Services/Broker";

const SECOND_MS = 1_000;

/**
 * Read the backlog a panel needs when it first shows a daemon.
 *
 * Always non-blocking: the live subscription is what carries new output, so a follow
 * read here would hold a request open for output the client is already being pushed.
 */
export function readDaemonLogs(
  broker: DaemonBrokerShape,
  input: DaemonReadLogsInput,
): Effect.Effect<DaemonReadLogsResult, DaemonError> {
  return broker
    .logs({
      name: input.name,
      // The schema default only lands when the field is absent from the wire payload;
      // re-applying it here keeps the operation correct for direct callers too.
      lines: Math.min(input.lines ?? DAEMON_LOGS_DEFAULT_LINES, DAEMON_LOGS_MAX_LINES),
      head: false,
      grep: null,
      follow: false,
      cursor: 0,
      timeoutMs: 0,
    })
    .pipe(
      Effect.map((result) => ({
        snapshot: result.snapshot,
        content: result.content,
        nextCursor: result.nextCursor,
        droppedBytes: result.droppedBytes,
        truncated: result.truncated,
      })),
    );
}

/**
 * Write one console line, exactly as if it had been typed at the daemon's terminal.
 *
 * `enter` is fixed rather than exposed: the panel's input is a line editor, and a
 * half-submitted line would leave a stateful server parsing the next one wrong.
 */
export function sendDaemonText(
  broker: DaemonBrokerShape,
  input: DaemonSendTextInput,
): Effect.Effect<DaemonSnapshot, DaemonError> {
  return broker.send({ name: input.name, text: input.text, enter: true, keys: [], signal: null });
}

export function stopDaemon(
  broker: DaemonBrokerShape,
  input: DaemonStopInput,
): Effect.Effect<DaemonSnapshot, DaemonError> {
  const timeoutSeconds = input.timeoutSeconds ?? DAEMON_STOP_DEFAULT_TIMEOUT_SECONDS;
  return broker.stop({ name: input.name, timeoutMs: timeoutSeconds * SECOND_MS });
}

export function restartDaemon(
  broker: DaemonBrokerShape,
  input: DaemonRestartInput,
): Effect.Effect<DaemonSnapshot, DaemonError> {
  return broker.restart(input.name);
}

/** The roster a fresh subscription opens with, and what a resync replays. */
export function daemonRosterEvent(
  broker: DaemonBrokerShape,
): Effect.Effect<Extract<DaemonEvent, { type: "snapshot" }>, never> {
  return broker.list.pipe(Effect.map((daemons) => ({ type: "snapshot" as const, daemons })));
}
