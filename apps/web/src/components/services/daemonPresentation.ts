// FILE: daemonPresentation.ts
// Purpose: Turn a DaemonSnapshot into the strings and tone the services panel renders.
// Layer: Background services UI helpers
// Exports: daemon status tone, the meta line parts, and the console-input availability rule.
//
// Pure on purpose: these are the judgements a reader of the panel acts on — is it up,
// why can't I type, what killed it — and they are far easier to get right, and to keep
// right, as values under test than as conditionals scattered through JSX.

import type { DaemonSnapshot, DaemonState } from "@synara/contracts";

export type DaemonTone = "pending" | "healthy" | "neutral" | "danger";

const TONE_BY_STATE: Record<DaemonState, DaemonTone> = {
  starting: "pending",
  ready: "healthy",
  running: "healthy",
  restarting: "pending",
  exited: "neutral",
  failed: "danger",
};

/**
 * `exited` is neutral rather than danger: it covers both a clean shutdown and one the
 * user asked for, and painting a service the user just stopped in red reads as an error
 * report for their own action.
 */
export function daemonTone(snapshot: DaemonSnapshot): DaemonTone {
  return TONE_BY_STATE[snapshot.state] ?? "neutral";
}

export function isDaemonAlive(snapshot: DaemonSnapshot): boolean {
  return (
    snapshot.state === "starting" || snapshot.state === "ready" || snapshot.state === "running"
  );
}

export interface DaemonMetaCopy {
  readonly pid: (pid: number) => string;
  readonly restarts: (count: number) => string;
  readonly exitedWithCode: (code: number) => string;
  readonly waitingFor: (conditions: string) => string;
}

/**
 * The secondary line under a daemon's name: whichever facts are actually true.
 *
 * Ordered by what a reader needs first — why it isn't ready yet, then how to find the
 * process, then how it died, then whether it has been flapping.
 */
export function daemonMetaParts(snapshot: DaemonSnapshot, copy: DaemonMetaCopy): string[] {
  const parts: string[] = [];

  const pending = snapshot.readyPending ?? [];
  if (snapshot.state === "starting" && pending.length > 0) {
    parts.push(copy.waitingFor(pending.join(", ")));
  }
  if (snapshot.pid !== null && snapshot.pid !== undefined && isDaemonAlive(snapshot)) {
    parts.push(copy.pid(snapshot.pid));
  }
  if (!isDaemonAlive(snapshot) && snapshot.exitCode !== null && snapshot.exitCode !== undefined) {
    parts.push(copy.exitedWithCode(snapshot.exitCode));
  }
  if ((snapshot.restartCount ?? 0) > 0) {
    parts.push(copy.restarts(snapshot.restartCount ?? 0));
  }

  return parts;
}

export type DaemonInputAvailability =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: "detached" | "notRunning" };

/**
 * Whether the console box accepts input, and why not when it doesn't.
 *
 * A detached daemon has its stdio redirected into the log file, so there is no stdin
 * left to write to — that is a property of how it was launched, not a transient state,
 * and it outranks liveness because it can never resolve on its own.
 */
export function daemonInputAvailability(snapshot: DaemonSnapshot): DaemonInputAvailability {
  if (snapshot.detached === true) return { enabled: false, reason: "detached" };
  if (!isDaemonAlive(snapshot)) return { enabled: false, reason: "notRunning" };
  return { enabled: true };
}

/** Roster order: live services first, then by name, so what matters sits at the top. */
export function sortDaemons(daemons: readonly DaemonSnapshot[]): DaemonSnapshot[] {
  return daemons.toSorted((left, right) => {
    const liveness = Number(isDaemonAlive(right)) - Number(isDaemonAlive(left));
    return liveness !== 0 ? liveness : left.name.localeCompare(right.name);
  });
}
