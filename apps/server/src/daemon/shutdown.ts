// FILE: shutdown.ts
// Purpose: Wind down supervised daemons when the server exits — stop the ones that
//          cannot outlive it, leave the ones designed to.
// Layer: Daemon service adapter
// Depends on: DaemonBroker.
// Exports: DAEMON_SHUTDOWN_* budgets, shutdownDaemons.

import { Effect } from "effect";

import type { DaemonBrokerShape } from "./Services/Broker";

/**
 * Grace a daemon gets to exit on its own before its tree is killed.
 *
 * Longer than the agent-facing default because this is a server exit, not a targeted
 * stop: a Minecraft server saving its world on SIGTERM is doing exactly what we want,
 * and cutting it off at five seconds is how a world gets corrupted.
 */
export const DAEMON_SHUTDOWN_GRACE_MS = 10_000;

/**
 * Ceiling on the whole wind-down.
 *
 * `stop` waits for an exit callback that a wedged process may never deliver, and the
 * finalizer it runs in has no timeout of its own. Without this, one stuck daemon holds
 * the process open indefinitely and the desktop supervisor kills the backend instead.
 */
export const DAEMON_SHUTDOWN_BUDGET_MS = 30_000;

/**
 * Stop every daemon that would otherwise be orphaned, then release the broker.
 *
 * Detached daemons are deliberately left running: outliving the server is the whole
 * point of that flag, their pids are on disk, and `reclaimDetached` re-adopts them on
 * the next boot. Everything else is a child of this process — leaving those behind
 * would strand a Java server in the user's task manager with nothing left to manage it.
 *
 * `dispose` runs regardless of how the stops went. It is the only thing that checkpoints
 * detached log offsets and closes file handles, so skipping it after a failure would
 * make a bad exit worse.
 */
export function shutdownDaemons(
  broker: Pick<DaemonBrokerShape, "list" | "stop" | "dispose">,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const daemons = yield* broker.list;
    const supervised = daemons.filter((daemon) => !daemon.detached);

    if (supervised.length > 0) {
      yield* Effect.forEach(
        supervised,
        (daemon) =>
          broker
            .stop({ name: daemon.name, timeoutMs: DAEMON_SHUTDOWN_GRACE_MS })
            .pipe(Effect.ignore),
        // Independent processes: stopping them one after another would add up to
        // minutes on a machine running several.
        { concurrency: "unbounded", discard: true },
      );
    }
  }).pipe(
    Effect.timeoutOption(DAEMON_SHUTDOWN_BUDGET_MS),
    Effect.andThen(broker.dispose),
    Effect.ignore,
  );
}
