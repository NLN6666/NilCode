import type { ThreadId } from "@synara/contracts";

/** A process root whose lifecycle is owned by one conversation. */
export interface LocalProcessOwner {
  readonly pid: number;
  readonly threadId: ThreadId;
}

const ownersByPid = new Map<number, Map<ThreadId, number>>();

/**
 * Register a locally managed process root to its owning conversation. The returned
 * lease is idempotent and should be released when that process exits or teardown
 * proves it gone. Multiple leases for one PID/thread collapse to one owner; distinct
 * thread owners for a reused/shared PID remain ambiguous to attribution callers.
 */
export function registerLocalProcessOwner(pid: number, threadId: ThreadId): () => void {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    typeof threadId !== "string" ||
    threadId.trim().length === 0
  ) {
    return () => undefined;
  }

  let owners = ownersByPid.get(pid);
  if (!owners) {
    owners = new Map();
    ownersByPid.set(pid, owners);
  }
  owners.set(threadId, (owners.get(threadId) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const currentOwners = ownersByPid.get(pid);
    const leases = currentOwners?.get(threadId);
    if (currentOwners === undefined || leases === undefined) return;
    if (leases > 1) {
      currentOwners.set(threadId, leases - 1);
    } else {
      currentOwners.delete(threadId);
      if (currentOwners.size === 0) ownersByPid.delete(pid);
    }
  };
}

/** Snapshot the currently leased roots without probing the operating system. */
export function snapshotLocalProcessOwners(): ReadonlyArray<LocalProcessOwner> {
  const owners: LocalProcessOwner[] = [];
  for (const [pid, threadIds] of ownersByPid) {
    for (const threadId of threadIds.keys()) {
      owners.push({ pid, threadId });
    }
  }
  return owners;
}
