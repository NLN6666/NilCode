// FILE: shutdownExit.ts
// Purpose: Bound the gap between "the server finished tearing down" and "the process is gone".

/**
 * How long the process may keep draining its event loop after teardown before
 * the exit is forced. Long enough that a well-behaved loop empties on its own,
 * short enough to stay imperceptible when it does not.
 */
export const SHUTDOWN_DRAIN_GRACE_MS = 500;

/**
 * Names a handle well enough to act on it: which child is still running, and
 * whether a socket is a real peer connection or a child's stdio pipe (both
 * report as `Socket`, but only one of them implies a live subprocess).
 */
function describeHandle(value: unknown): string {
  const handle = value as {
    constructor?: { name?: string };
    pid?: number;
    spawnfile?: string;
    remoteAddress?: string;
    remotePort?: number;
    localPort?: number;
  };
  const name = handle?.constructor?.name ?? "unknown";
  if (typeof handle?.pid === "number") {
    return `${name}(pid=${handle.pid} cmd=${handle.spawnfile ?? "?"})`;
  }
  if (handle?.remotePort !== undefined) {
    return `${name}(peer=${handle.remoteAddress}:${handle.remotePort})`;
  }
  if (handle?.localPort !== undefined) {
    return `${name}(local=${handle.localPort})`;
  }
  return name;
}

function describeLingeringWork(): string {
  const internals = process as unknown as {
    _getActiveHandles?: () => ReadonlyArray<unknown>;
    _getActiveRequests?: () => ReadonlyArray<unknown>;
  };
  const handles = (internals._getActiveHandles?.() ?? []).map(describeHandle);
  const requests = (internals._getActiveRequests?.() ?? []).map(describeHandle);
  return `handles=${JSON.stringify(handles)} requests=${JSON.stringify(requests)}`;
}

/**
 * Leaves on our own terms once the program's fiber has completed.
 *
 * Effect's `runMain` deliberately skips `process.exit` on a clean exit and lets
 * the event loop drain instead, so nothing in flight is cut short. That is the
 * right default for a CLI, but it makes a server's shutdown hostage to any
 * best-effort I/O still open — a version check, a usage poll — and the desktop
 * supervisor then kills the backend on its own timeout, which is both slower
 * and less orderly than exiting deliberately.
 *
 * By the time the fiber completes every finalizer has run and every durable
 * resource is flushed, so whatever still holds the loop cannot affect
 * correctness. The timer is `unref`'d: a process that would have exited
 * cleanly still does, never waits on this, and never reports anything.
 */
export function exitOnceDrained(code: number, graceMs = SHUTDOWN_DRAIN_GRACE_MS): void {
  const forced = setTimeout(() => {
    // Logged rather than exited silently: each entry here is a subsystem that
    // outlived its own teardown, which is worth fixing at the source even
    // though it no longer delays the user.
    process.stderr.write(`[shutdown] forcing exit, still open: ${describeLingeringWork()}\n`);
    process.exit(code);
  }, graceMs);
  forced.unref();
}
