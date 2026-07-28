// FILE: browserCdpTargetRegistry.ts
// Purpose: Pure mapping from the active thread's browser state to browser-level CDP page
//          targets, diffing snapshots into targetCreated/targetInfoChanged/targetDestroyed.
// Layer: Desktop browser CDP proxy (pure logic, no Electron)
// Depends on: shared browser IPC contracts and node:crypto only

import * as Crypto from "node:crypto";

import type { ThreadBrowserState, ThreadId } from "@synara/contracts";

// CDP identifiers are 32 uppercase hex chars in Chrome; matching the shape keeps
// clients that validate id formats (or log them) on the happy path.
export function createCdpId(): string {
  return Crypto.randomBytes(16).toString("hex").toUpperCase();
}

export interface CdpTargetInfo {
  targetId: string;
  type: "page";
  title: string;
  url: string;
  attached: boolean;
  canAccessOpener: false;
  browserContextId: string;
}

export interface CdpTargetRef {
  threadId: ThreadId;
  tabId: string;
}

export type CdpTargetEvent =
  | { method: "Target.targetCreated"; params: { targetInfo: CdpTargetInfo } }
  | { method: "Target.targetInfoChanged"; params: { targetInfo: CdpTargetInfo } }
  | { method: "Target.targetDestroyed"; params: { targetId: string } };

export interface BrowserCdpTargetSnapshot {
  threadId: ThreadId;
  state: ThreadBrowserState;
}

function targetInfoEquals(left: CdpTargetInfo, right: CdpTargetInfo): boolean {
  return left.title === right.title && left.url === right.url && left.attached === right.attached;
}

/**
 * Tracks which in-app browser tabs are currently exposed as CDP page targets.
 *
 * Only the active thread's open browser state is ever exposed: Synara's own renderer
 * never enters this registry, so it is unaddressable at the protocol level rather than
 * merely filtered out. Target ids are stable random 32-hex per (threadId, tabId) and
 * never leak the thread id itself.
 */
export class BrowserCdpTargetRegistry {
  // Stable across destroy/recreate so switching back to a thread re-lists the same ids.
  private readonly targetIdByRuntimeKey = new Map<string, string>();
  private readonly refByTargetId = new Map<string, CdpTargetRef>();
  private readonly exposedByTargetId = new Map<string, CdpTargetInfo>();
  private readonly attachedTargetIds = new Set<string>();
  readonly browserContextId = createCdpId();

  private targetIdFor(threadId: ThreadId, tabId: string): string {
    const runtimeKey = `${threadId}:${tabId}`;
    const existing = this.targetIdByRuntimeKey.get(runtimeKey);
    if (existing) {
      return existing;
    }
    const targetId = createCdpId();
    this.targetIdByRuntimeKey.set(runtimeKey, targetId);
    this.refByTargetId.set(targetId, { threadId, tabId });
    return targetId;
  }

  /**
   * Replaces the exposed target set with the given snapshot and returns the CDP
   * events describing the transition. A null snapshot (no open browser) destroys
   * every exposed target.
   */
  applySnapshot(snapshot: BrowserCdpTargetSnapshot | null): CdpTargetEvent[] {
    const desired = new Map<string, CdpTargetInfo>();
    if (snapshot?.state.open) {
      for (const tab of snapshot.state.tabs) {
        const targetId = this.targetIdFor(snapshot.threadId, tab.id);
        desired.set(targetId, {
          targetId,
          type: "page",
          title: tab.title,
          url: tab.lastCommittedUrl ?? tab.url,
          attached: this.attachedTargetIds.has(targetId),
          canAccessOpener: false,
          browserContextId: this.browserContextId,
        });
      }
    }

    const events: CdpTargetEvent[] = [];
    // Snapshot the keys: the loop body deletes from the map it iterates.
    for (const targetId of [...this.exposedByTargetId.keys()]) {
      if (desired.has(targetId)) {
        continue;
      }
      this.exposedByTargetId.delete(targetId);
      this.attachedTargetIds.delete(targetId);
      events.push({ method: "Target.targetDestroyed", params: { targetId } });
    }
    for (const [targetId, targetInfo] of desired) {
      const previous = this.exposedByTargetId.get(targetId);
      this.exposedByTargetId.set(targetId, targetInfo);
      if (!previous) {
        events.push({ method: "Target.targetCreated", params: { targetInfo } });
      } else if (!targetInfoEquals(previous, targetInfo)) {
        events.push({ method: "Target.targetInfoChanged", params: { targetInfo } });
      }
    }
    return events;
  }

  listTargets(): CdpTargetInfo[] {
    return [...this.exposedByTargetId.values()];
  }

  getTargetInfo(targetId: string): CdpTargetInfo | null {
    return this.exposedByTargetId.get(targetId) ?? null;
  }

  /** Resolves a currently exposed target back to its tab. Unexposed ids resolve to null. */
  resolveTarget(targetId: string): CdpTargetRef | null {
    if (!this.exposedByTargetId.has(targetId)) {
      return null;
    }
    return this.refByTargetId.get(targetId) ?? null;
  }

  /** Target id for a tab if that tab is currently exposed. */
  findTargetIdForTab(threadId: ThreadId, tabId: string): string | null {
    const targetId = this.targetIdByRuntimeKey.get(`${threadId}:${tabId}`);
    if (!targetId || !this.exposedByTargetId.has(targetId)) {
      return null;
    }
    return targetId;
  }

  /** Flips the exposed target's attached flag, returning the resulting event if it changed. */
  setAttached(targetId: string, attached: boolean): CdpTargetEvent | null {
    if (attached === this.attachedTargetIds.has(targetId)) {
      return null;
    }
    if (attached) {
      this.attachedTargetIds.add(targetId);
    } else {
      this.attachedTargetIds.delete(targetId);
    }
    const exposed = this.exposedByTargetId.get(targetId);
    if (!exposed) {
      return null;
    }
    const targetInfo: CdpTargetInfo = { ...exposed, attached };
    this.exposedByTargetId.set(targetId, targetInfo);
    return { method: "Target.targetInfoChanged", params: { targetInfo } };
  }
}
