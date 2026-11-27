import type { LocalServerActionTerminal, ThreadId } from "@synara/contracts";

/** A process root owned by a conversation, a managed action terminal, or both. */
export interface LocalProcessOwner {
  readonly pid: number;
  readonly threadId?: ThreadId;
  readonly actionTerminal?: LocalServerActionTerminal;
}

interface OwnerLease {
  readonly owner: LocalProcessOwner;
  count: number;
}

const ownersByPid = new Map<number, Map<string, OwnerLease>>();

/**
 * Register a locally managed process root with its exact owner. The returned
 * lease is idempotent and should be released when that process exits or teardown
 * proves it gone. Duplicate leases collapse; conflicting owners for a reused or
 * shared PID remain ambiguous to attribution callers.
 */
export function registerLocalProcessOwner(
  pid: number,
  threadId: ThreadId | undefined,
  actionTerminal?: LocalServerActionTerminal,
): () => void {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !(threadId?.trim() || actionTerminal)) {
    return () => undefined;
  }

  let owners = ownersByPid.get(pid);
  if (!owners) {
    owners = new Map();
    ownersByPid.set(pid, owners);
  }
  const key = JSON.stringify([threadId, actionTerminal?.threadId, actionTerminal?.terminalId]);
  const existing = owners.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    owners.set(key, {
      owner: {
        pid,
        ...(threadId ? { threadId } : {}),
        ...(actionTerminal ? { actionTerminal } : {}),
      },
      count: 1,
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const currentOwners = ownersByPid.get(pid);
    const lease = currentOwners?.get(key);
    if (currentOwners === undefined || lease === undefined) return;
    lease.count -= 1;
    if (lease.count === 0) {
      currentOwners.delete(key);
      if (currentOwners.size === 0) ownersByPid.delete(pid);
    }
  };
}

/** Snapshot the currently leased roots without probing the operating system. */
export function snapshotLocalProcessOwners(): ReadonlyArray<LocalProcessOwner> {
  const owners: LocalProcessOwner[] = [];
  for (const leases of ownersByPid.values()) {
    for (const lease of leases.values()) {
      owners.push(lease.owner);
    }
  }
  return owners;
}
