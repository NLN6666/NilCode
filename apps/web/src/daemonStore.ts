// FILE: daemonStore.ts
// Purpose: Client-side projection of the server-owned daemon registry and its logs.
// Layer: Web UI state
// Exports: useDaemonStore, applyDaemonEvent, plus the selection helper.
//
// Deliberately NOT keyed by thread. A daemon belongs to the server, not to the
// conversation that happened to start it: closing that chat, or deleting the thread,
// leaves a Minecraft server running, and the panel has to keep showing it. Keying this
// by threadId would quietly re-introduce the coupling the daemon broker avoids.

import type { DaemonEvent, DaemonSnapshot } from "@synara/contracts";
import { create } from "zustand";

import {
  appendDaemonLogChunk,
  applyDaemonLogBacklog,
  beginDaemonLogHydration,
  emptyDaemonLogBuffer,
  type DaemonLogBuffer,
} from "./daemonLogBuffer";

export interface DaemonStoreState {
  readonly daemonsByName: Record<string, DaemonSnapshot>;
  readonly logsByName: Record<string, DaemonLogBuffer>;
  /** Which daemon the panel is showing, or null when the roster is empty. */
  readonly selectedName: string | null;
  /** True once a subscription has delivered its opening roster. */
  readonly hydrated: boolean;

  readonly replaceRoster: (daemons: readonly DaemonSnapshot[]) => void;
  readonly upsertDaemon: (snapshot: DaemonSnapshot) => void;
  readonly appendOutput: (name: string, chunk: string, cursor: number) => void;
  readonly markLogHydrating: (name: string) => void;
  readonly applyLogBacklog: (
    name: string,
    backlog: {
      readonly content: string;
      readonly nextCursor: number;
      readonly droppedBytes: number;
      readonly truncated: boolean;
    },
  ) => void;
  readonly select: (name: string | null) => void;
  readonly reset: () => void;
}

function logFor(state: DaemonStoreState, name: string): DaemonLogBuffer {
  return state.logsByName[name] ?? emptyDaemonLogBuffer();
}

/**
 * Keep a selection pointing at something real.
 *
 * A daemon is never removed from the roster once it exists — it settles as `exited` —
 * so the only cases are "nothing selected yet" and "the selected name is gone after a
 * resync". Both resolve to the first entry rather than to null, because an empty detail
 * pane next to a populated list reads as a bug.
 */
function resolveSelection(
  selected: string | null,
  daemonsByName: Record<string, DaemonSnapshot>,
): string | null {
  if (selected !== null && daemonsByName[selected] !== undefined) return selected;
  return Object.keys(daemonsByName)[0] ?? null;
}

export const useDaemonStore = create<DaemonStoreState>((set) => ({
  daemonsByName: {},
  logsByName: {},
  selectedName: null,
  hydrated: false,

  replaceRoster: (daemons) =>
    set((state) => {
      const daemonsByName: Record<string, DaemonSnapshot> = {};
      for (const daemon of daemons) daemonsByName[daemon.name] = daemon;

      // Log buffers for daemons still in the roster survive a resync: the roster is
      // resent on reconnect, and throwing away scrollback the user is reading because
      // the socket blinked would be the wrong trade.
      const logsByName: Record<string, DaemonLogBuffer> = {};
      for (const name of Object.keys(daemonsByName)) {
        const existing = state.logsByName[name];
        if (existing !== undefined) logsByName[name] = existing;
      }

      return {
        daemonsByName,
        logsByName,
        selectedName: resolveSelection(state.selectedName, daemonsByName),
        hydrated: true,
      };
    }),

  upsertDaemon: (snapshot) =>
    set((state) => {
      const daemonsByName = { ...state.daemonsByName, [snapshot.name]: snapshot };
      return {
        daemonsByName,
        selectedName: resolveSelection(state.selectedName, daemonsByName),
      };
    }),

  appendOutput: (name, chunk, cursor) =>
    set((state) => ({
      logsByName: {
        ...state.logsByName,
        [name]: appendDaemonLogChunk(logFor(state, name), { chunk, cursor }),
      },
    })),

  markLogHydrating: (name) =>
    set((state) => ({
      logsByName: { ...state.logsByName, [name]: beginDaemonLogHydration(logFor(state, name)) },
    })),

  applyLogBacklog: (name, backlog) =>
    set((state) => ({
      logsByName: {
        ...state.logsByName,
        [name]: applyDaemonLogBacklog(logFor(state, name), backlog),
      },
    })),

  select: (name) => set(() => ({ selectedName: name })),

  reset: () =>
    set(() => ({ daemonsByName: {}, logsByName: {}, selectedName: null, hydrated: false })),
}));

/**
 * Fold one server event into the store.
 *
 * Split out from the subscription wiring so the projection can be tested without a
 * transport, and so the three event shapes stay handled in one place.
 */
export function applyDaemonEvent(
  store: Pick<DaemonStoreState, "replaceRoster" | "upsertDaemon" | "appendOutput">,
  event: DaemonEvent,
): void {
  switch (event.type) {
    case "snapshot":
      store.replaceRoster(event.daemons);
      return;
    case "state":
      store.upsertDaemon(event.snapshot);
      return;
    case "output":
      store.appendOutput(event.name, event.chunk, event.cursor);
      return;
  }
}
