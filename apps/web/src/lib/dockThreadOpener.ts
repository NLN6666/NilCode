// FILE: dockThreadOpener.ts
// Purpose: Single definition of "show this child thread as a right-dock tab".
// Layer: Web UI action helper
// Why: The sidebar tree and the composer subagent strip both open subagents the
//      same way — as an embedded-thread tab on the parent's dock. Keeping the
//      rule (host = parent thread) in one place stops the two entry points from
//      drifting into different navigation models.

import type { ThreadId } from "@synara/contracts";

import { useRightDockStore } from "../rightDockStore";

/**
 * Opens `threadId` as an embedded-thread tab on `hostThreadId`'s dock. Reopening
 * the same thread focuses its existing tab; a different thread opens alongside
 * it as a new tab.
 */
export function openThreadInHostDock(input: { hostThreadId: ThreadId; threadId: ThreadId }): void {
  useRightDockStore.getState().openPane(input.hostThreadId, {
    kind: "sidechat",
    threadId: input.threadId,
  });
}

/**
 * The thread whose dock hosts `thread`'s sibling subagents: a subagent's
 * siblings live on its parent's dock, and a top-level thread hosts its own.
 */
export function resolveSubagentDockHostThreadId(thread: {
  id: ThreadId;
  parentThreadId?: ThreadId | null | undefined;
}): ThreadId {
  return thread.parentThreadId ?? thread.id;
}
