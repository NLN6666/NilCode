// FILE: browserTerminalHostStore.ts
// Purpose: Publish the DOM slot under the browser dock pane that the thread's terminal drawer
//          should render into, so the terminal has exactly one mount at any moment.
// Layer: UI state store (transient — never persisted)
// Exports: store hook and a per-thread host selector.
//
// Why a store rather than props: the browser pane lives under RightDock while the terminal
// drawer is owned by ChatView, and the two are sibling subtrees. The pane publishes its slot
// here and ChatView portals its existing drawer into it — one xterm runtime, one set of
// callbacks, no duplicated state. `terminalRuntimeRegistry` can only attach a runtime to one
// container, so a second mount would steal the terminal rather than mirror it.

import type { ThreadId } from "@synara/contracts";
import { create } from "zustand";

interface BrowserTerminalHostStore {
  hostByThreadId: Record<string, HTMLElement | undefined>;
  /** Pass `null` on unmount so the drawer falls back to the chat column. */
  setHost: (threadId: ThreadId, host: HTMLElement | null) => void;
}

export const useBrowserTerminalHostStore = create<BrowserTerminalHostStore>((set) => ({
  hostByThreadId: {},
  setHost: (threadId, host) =>
    set((state) => {
      const current = state.hostByThreadId[threadId];
      const next = host ?? undefined;
      if (current === next) return state;
      const hostByThreadId = { ...state.hostByThreadId };
      if (next) {
        hostByThreadId[threadId] = next;
      } else {
        delete hostByThreadId[threadId];
      }
      return { hostByThreadId };
    }),
}));

export function selectBrowserTerminalHost(threadId: ThreadId | null | undefined) {
  return (state: BrowserTerminalHostStore): HTMLElement | null =>
    threadId ? (state.hostByThreadId[threadId] ?? null) : null;
}
