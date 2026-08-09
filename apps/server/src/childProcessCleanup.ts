// FILE: childProcessCleanup.ts
// Purpose: Scope-exit cleanup for spawned child processes that stays cheap on the happy path.
// Layer: Server process utilities.
// Exports: killChildIfRunning.
import { Effect } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

/**
 * Kill a spawned child at scope exit, but only when it is still running.
 *
 * A short-lived command (`git write-tree`, `codex --version`) has already
 * exited by the time its scope closes, and killing an exited handle is far from
 * free. The spawner's `killProcessGroup` shells out to
 * `taskkill /pid <pid> /T /F` on Windows, so an unconditional finalizer spawns
 * a whole extra process per command: measured, `git --version` costs ~50ms with
 * this guard and ~830ms without it. A pre-turn checkpoint runs half a dozen Git
 * commands, so that tax alone accounted for seconds of delay before every
 * provider turn.
 *
 * Skipping the call for an exited child loses nothing: `taskkill` against a
 * dead pid exits 128 ("process not found") and provably reaps no descendants,
 * and on Windows the job object created for the child already tears its subtree
 * down when it exits. The liveness check therefore keeps the cancellation
 * guarantee — an interrupted or timed-out command still gets killed — while
 * charging nothing for commands that completed normally.
 */
export const killChildIfRunning = (
  child: Pick<ChildProcessSpawner.ChildProcessHandle, "isRunning" | "kill">,
): Effect.Effect<void> =>
  child.isRunning.pipe(
    Effect.flatMap((running) => (running ? child.kill() : Effect.void)),
    Effect.ignore,
  );
