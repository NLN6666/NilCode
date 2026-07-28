// FILE: browserAutomationLease.ts
// Purpose: Reference-counted debugger attach/detach shared by every automation consumer of
//          a browser tab (element picker, Codex browser-use pipe, CDP proxy), with the
//          one-time wake and the "agent controlled" UI marker.
// Layer: Desktop browser automation coordination
// Depends on: a narrow host interface supplied by DesktopBrowserManager
//
// Electron's webContents.debugger can only be attached once per webContents, and a single
// detach() kills every consumer's session. Three independent consumers now share that
// attachment, so the only correct model is a counted lease: the debugger really detaches
// only when the last holder releases (plan 013 §7.1).

import type { BrowserTabInput, ThreadId } from "@synara/contracts";

export type BrowserAutomationForcedDetachReason = "devtools" | "runtime-destroyed";

export interface BrowserAutomationLeaseHost {
  /**
   * One-time wake for the tab: cancel pending suspend timers, ensure a live runtime,
   * and load the page if it was suspended. Never activates the tab or steals focus —
   * Target.activateTarget is the only UI-switching entry point.
   */
  wakeTab: (input: BrowserTabInput) => Promise<void>;
  isDebuggerAttached: (input: BrowserTabInput) => boolean;
  attachDebugger: (input: BrowserTabInput) => void;
  detachDebugger: (input: BrowserTabInput) => void;
  /** Reflects "an agent controls this thread's browser" into the thread's UI state. */
  setAgentControlMarker: (threadId: ThreadId, active: boolean) => void;
  /** Called when a runtime's last holder released, so normal suspend policy resumes. */
  onAllReleased?: (input: BrowserTabInput) => void;
}

export interface BrowserAutomationAcquireOptions {
  /** Whether this holder should surface the "agent controlled" marker in the UI. */
  markAgentControl: boolean;
  /**
   * Invoked when the lease is torn down from under the holder (user opened DevTools on
   * the page, or the runtime was destroyed). The holder must not call release() after
   * this fires; the lease has already dropped it.
   */
  onForcedDetach?: (reason: BrowserAutomationForcedDetachReason) => void;
}

export interface BrowserAutomationLeaseHandle {
  readonly threadId: ThreadId;
  readonly tabId: string;
  release: () => void;
}

interface HolderRecord {
  markAgentControl: boolean;
  onForcedDetach: ((reason: BrowserAutomationForcedDetachReason) => void) | undefined;
}

interface RuntimeLeaseState {
  threadId: ThreadId;
  tabId: string;
  holders: Set<HolderRecord>;
}

function buildKey(input: BrowserTabInput): string {
  return `${input.threadId}:${input.tabId}`;
}

export class BrowserAutomationLease {
  private readonly runtimeStates = new Map<string, RuntimeLeaseState>();

  constructor(private readonly host: BrowserAutomationLeaseHost) {}

  async acquire(
    input: BrowserTabInput,
    options: BrowserAutomationAcquireOptions,
  ): Promise<BrowserAutomationLeaseHandle> {
    await this.host.wakeTab(input);
    if (!this.host.isDebuggerAttached(input)) {
      this.host.attachDebugger(input);
    }

    const key = buildKey(input);
    const runtimeState = this.runtimeStates.get(key) ?? {
      threadId: input.threadId,
      tabId: input.tabId,
      holders: new Set<HolderRecord>(),
    };
    this.runtimeStates.set(key, runtimeState);
    const holder: HolderRecord = {
      markAgentControl: options.markAgentControl,
      onForcedDetach: options.onForcedDetach,
    };
    runtimeState.holders.add(holder);
    this.syncAgentControlMarker(input.threadId);

    return {
      threadId: input.threadId,
      tabId: input.tabId,
      release: () => {
        this.releaseHolder(key, holder);
      },
    };
  }

  isHeld(input: BrowserTabInput): boolean {
    return (this.runtimeStates.get(buildKey(input))?.holders.size ?? 0) > 0;
  }

  /**
   * The user opened DevTools on this page: DevTools and the debugger attachment are
   * mutually exclusive, so every holder is forced out and the debugger detaches.
   */
  handleDevToolsOpened(input: BrowserTabInput): void {
    const runtimeState = this.forceReleaseAll(buildKey(input), "devtools");
    if (!runtimeState) {
      return;
    }
    if (this.host.isDebuggerAttached(input)) {
      try {
        this.host.detachDebugger(input);
      } catch {
        // DevTools may already own the attachment; it wins either way.
      }
    }
  }

  /**
   * The runtime is being destroyed. Holders are notified so they can signal their own
   * detach downstream; the actual debugger detach belongs to the runtime teardown.
   */
  handleRuntimeDestroyed(input: BrowserTabInput): void {
    this.forceReleaseAll(buildKey(input), "runtime-destroyed");
  }

  disposeAll(): void {
    // Snapshot the keys: forceReleaseAll deletes from the map it iterates.
    for (const key of [...this.runtimeStates.keys()]) {
      this.forceReleaseAll(key, "runtime-destroyed");
    }
  }

  private releaseHolder(key: string, holder: HolderRecord): void {
    const runtimeState = this.runtimeStates.get(key);
    if (!runtimeState || !runtimeState.holders.delete(holder)) {
      return;
    }
    const input: BrowserTabInput = {
      threadId: runtimeState.threadId,
      tabId: runtimeState.tabId,
    };
    if (runtimeState.holders.size === 0) {
      this.runtimeStates.delete(key);
      if (this.host.isDebuggerAttached(input)) {
        try {
          this.host.detachDebugger(input);
        } catch {
          // The runtime may already be tearing down; nothing left to detach from.
        }
      }
      this.host.onAllReleased?.(input);
    }
    this.syncAgentControlMarker(runtimeState.threadId);
  }

  private forceReleaseAll(
    key: string,
    reason: BrowserAutomationForcedDetachReason,
  ): RuntimeLeaseState | null {
    const runtimeState = this.runtimeStates.get(key);
    if (!runtimeState) {
      return null;
    }
    this.runtimeStates.delete(key);
    for (const holder of runtimeState.holders) {
      try {
        holder.onForcedDetach?.(reason);
      } catch {
        // A holder's cleanup failure must not block the remaining holders.
      }
    }
    runtimeState.holders.clear();
    this.syncAgentControlMarker(runtimeState.threadId);
    return runtimeState;
  }

  private syncAgentControlMarker(threadId: ThreadId): void {
    let active = false;
    for (const runtimeState of this.runtimeStates.values()) {
      if (runtimeState.threadId !== threadId) {
        continue;
      }
      for (const holder of runtimeState.holders) {
        if (holder.markAgentControl) {
          active = true;
          break;
        }
      }
      if (active) {
        break;
      }
    }
    this.host.setAgentControlMarker(threadId, active);
  }
}
