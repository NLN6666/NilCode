// FILE: browserCdpSessionRouter.ts
// Purpose: Per-connection routing table between client-facing CDP sessionIds and
//          (tab runtime, Electron upstream sessionId) pairs, including nested-session
//          bookkeeping for OOPIF/worker sessions Chromium spawns under a page.
// Layer: Desktop browser CDP proxy (pure logic, no Electron)
// Depends on: browserCdpTargetRegistry (id generation) and shared contracts

import type { ThreadId } from "@synara/contracts";

import { createCdpId } from "./browserCdpTargetRegistry";

export interface CdpRoutedSession {
  /** Client-facing synthetic sessionId for the top-level page session. */
  sessionId: string;
  targetId: string;
  threadId: ThreadId;
  tabId: string;
}

export type CdpResolvedRoute =
  | { kind: "top"; session: CdpRoutedSession }
  // Child sessions keep Chromium's own id: commands pass it to Electron unchanged.
  | { kind: "child"; session: CdpRoutedSession; upstreamSessionId: string };

export interface CdpUpstreamEvent {
  method: string;
  params?: unknown;
  /** Electron's upstream sessionId; empty/undefined means the top-level page session. */
  sessionId?: string;
}

export interface CdpRoutedEvent {
  method: string;
  params?: unknown;
  sessionId: string;
}

function readEventSessionId(params: unknown): string | null {
  if (typeof params !== "object" || params === null) {
    return null;
  }
  const sessionId = (params as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

/**
 * One router per proxy connection. Only top-level page sessions get synthetic ids
 * (Electron addresses them with an empty sessionId); nested sessions created by
 * Chromium (OOPIFs, workers) are passed through verbatim and tracked via the
 * Target.attachedToTarget / Target.detachedFromTarget events flowing upstream.
 */
export class BrowserCdpSessionRouter {
  private readonly topBySessionId = new Map<string, CdpRoutedSession>();
  private readonly topSessionIdsByTargetId = new Map<string, Set<string>>();
  private readonly childOwnerByUpstreamSessionId = new Map<string, CdpRoutedSession>();

  attach(targetId: string, threadId: ThreadId, tabId: string): CdpRoutedSession {
    const session: CdpRoutedSession = {
      sessionId: createCdpId(),
      targetId,
      threadId,
      tabId,
    };
    this.topBySessionId.set(session.sessionId, session);
    const existing = this.topSessionIdsByTargetId.get(targetId);
    if (existing) {
      existing.add(session.sessionId);
    } else {
      this.topSessionIdsByTargetId.set(targetId, new Set([session.sessionId]));
    }
    return session;
  }

  detach(sessionId: string): CdpRoutedSession | null {
    const session = this.topBySessionId.get(sessionId);
    if (!session) {
      return null;
    }
    this.topBySessionId.delete(sessionId);
    const ids = this.topSessionIdsByTargetId.get(session.targetId);
    ids?.delete(sessionId);
    if (ids && ids.size === 0) {
      this.topSessionIdsByTargetId.delete(session.targetId);
    }
    for (const [upstreamSessionId, owner] of this.childOwnerByUpstreamSessionId) {
      if (owner.sessionId === sessionId) {
        this.childOwnerByUpstreamSessionId.delete(upstreamSessionId);
      }
    }
    return session;
  }

  detachByTarget(targetId: string): CdpRoutedSession[] {
    const ids = this.topSessionIdsByTargetId.get(targetId);
    if (!ids) {
      return [];
    }
    const detached: CdpRoutedSession[] = [];
    // Snapshot: detach() mutates (and may drop) the very set being iterated.
    for (const sessionId of [...ids]) {
      const session = this.detach(sessionId);
      if (session) {
        detached.push(session);
      }
    }
    return detached;
  }

  detachAll(): CdpRoutedSession[] {
    return [...this.topBySessionId.keys()]
      .map((sessionId) => this.detach(sessionId))
      .filter((session): session is CdpRoutedSession => session !== null);
  }

  sessionsForTarget(targetId: string): CdpRoutedSession[] {
    const ids = this.topSessionIdsByTargetId.get(targetId);
    if (!ids) {
      return [];
    }
    return [...ids]
      .map((sessionId) => this.topBySessionId.get(sessionId))
      .filter((session): session is CdpRoutedSession => session !== undefined);
  }

  hasSessions(): boolean {
    return this.topBySessionId.size > 0;
  }

  /** Resolves a client-supplied sessionId to the runtime and upstream session to use. */
  resolve(sessionId: string): CdpResolvedRoute | null {
    const top = this.topBySessionId.get(sessionId);
    if (top) {
      return { kind: "top", session: top };
    }
    const owner = this.childOwnerByUpstreamSessionId.get(sessionId);
    if (owner) {
      return { kind: "child", session: owner, upstreamSessionId: sessionId };
    }
    return null;
  }

  /**
   * Maps one upstream Electron debugger event (scoped to the given top session's
   * runtime) to the client-facing event, maintaining the child-session routing table
   * as Target.attachedToTarget / Target.detachedFromTarget flow past.
   */
  routeUpstreamEvent(topSession: CdpRoutedSession, event: CdpUpstreamEvent): CdpRoutedEvent {
    const upstreamSessionId = event.sessionId;
    if (!upstreamSessionId) {
      if (event.method === "Target.attachedToTarget") {
        const childSessionId = readEventSessionId(event.params);
        if (childSessionId) {
          this.childOwnerByUpstreamSessionId.set(childSessionId, topSession);
        }
      } else if (event.method === "Target.detachedFromTarget") {
        const childSessionId = readEventSessionId(event.params);
        if (childSessionId) {
          this.childOwnerByUpstreamSessionId.delete(childSessionId);
        }
      }
      return {
        method: event.method,
        ...(event.params !== undefined ? { params: event.params } : {}),
        sessionId: topSession.sessionId,
      };
    }

    // Nested-session event: Chromium already stamped its own child sessionId; pass it
    // through unchanged so replies and events stay consistent for the client.
    return {
      method: event.method,
      ...(event.params !== undefined ? { params: event.params } : {}),
      sessionId: upstreamSessionId,
    };
  }
}
