// FILE: browserSurfaceClaimStore.ts
// Purpose: Grant exactly one mounted browser pane the right to drive a given browser surface.
// Layer: UI state store (transient — never persisted)
// Exports: store hook, per-surface owner selector, and the pane-side claim hook.
//
// Why a claim: a browser surface is backed by ONE native WebContentsView. The desktop manager
// binds that guest to a single host element, so two panes pointed at the same surface would
// fight over `attachWebview`/`setPanelBounds` and the page would teleport between them or go
// blank. A project that shares its browser makes that the common case (two threads of the same
// project, both with the browser pane open), so ownership is arbitrated here instead.
//
// The loser is not dead weight: it reads the same cached surface state, so it renders the live
// page's title and URL through the existing `preview` runtime mode, and any interaction calls
// `takeOver` to become the live pane. That reuses the sleeping-pane affordance rather than
// inventing a second "someone else has the browser" vocabulary.

import type { ThreadId } from "@synara/contracts";
import { useCallback, useEffect } from "react";
import { create } from "zustand";

interface BrowserSurfaceClaimStore {
  ownerBySurfaceId: Record<string, string | undefined>;
  /** Takes the surface only when it is unowned, so a fresh mount never steals a live pane. */
  claimIfUnowned: (surfaceId: ThreadId, ownerKey: string) => void;
  /** Unconditional transfer, driven by an explicit user interaction with the losing pane. */
  takeOver: (surfaceId: ThreadId, ownerKey: string) => void;
  /** Ignored unless `ownerKey` still holds the surface, so a late unmount cannot evict its successor. */
  release: (surfaceId: ThreadId, ownerKey: string) => void;
}

export const useBrowserSurfaceClaimStore = create<BrowserSurfaceClaimStore>((set) => ({
  ownerBySurfaceId: {},
  claimIfUnowned: (surfaceId, ownerKey) =>
    set((state) => {
      const current = state.ownerBySurfaceId[surfaceId];
      if (current !== undefined) return state;
      return { ownerBySurfaceId: { ...state.ownerBySurfaceId, [surfaceId]: ownerKey } };
    }),
  takeOver: (surfaceId, ownerKey) =>
    set((state) => {
      if (state.ownerBySurfaceId[surfaceId] === ownerKey) return state;
      return { ownerBySurfaceId: { ...state.ownerBySurfaceId, [surfaceId]: ownerKey } };
    }),
  release: (surfaceId, ownerKey) =>
    set((state) => {
      if (state.ownerBySurfaceId[surfaceId] !== ownerKey) return state;
      const ownerBySurfaceId = { ...state.ownerBySurfaceId };
      delete ownerBySurfaceId[surfaceId];
      return { ownerBySurfaceId };
    }),
}));

export function selectBrowserSurfaceOwner(surfaceId: ThreadId) {
  return (state: BrowserSurfaceClaimStore): string | null =>
    state.ownerBySurfaceId[surfaceId] ?? null;
}

export interface BrowserSurfaceClaim {
  /** False while another mounted pane drives this surface; the pane must stay in preview mode. */
  readonly isOwner: boolean;
  readonly takeOver: () => void;
}

/**
 * Claim `surfaceId` for one mounted pane.
 *
 * `ownerKey` must be stable for the pane's lifetime and unique across panes; the surface plus
 * the pane's own id is the natural choice. Changing surface (the project switched sharing mode)
 * releases the old surface before claiming the new one.
 */
export function useBrowserSurfaceClaim(input: {
  surfaceId: ThreadId;
  ownerKey: string;
}): BrowserSurfaceClaim {
  const { surfaceId, ownerKey } = input;
  const owner = useBrowserSurfaceClaimStore(selectBrowserSurfaceOwner(surfaceId));

  useEffect(() => {
    const store = useBrowserSurfaceClaimStore.getState();
    store.claimIfUnowned(surfaceId, ownerKey);
    return () => {
      useBrowserSurfaceClaimStore.getState().release(surfaceId, ownerKey);
    };
  }, [ownerKey, surfaceId]);

  const takeOver = useCallback(() => {
    useBrowserSurfaceClaimStore.getState().takeOver(surfaceId, ownerKey);
  }, [ownerKey, surfaceId]);

  // An unowned surface reads as owned by the only pane asking: the claim effect runs after
  // paint, and reporting "not yours" for one frame would flash the preview placeholder.
  return { isOwner: owner === null || owner === ownerKey, takeOver };
}
