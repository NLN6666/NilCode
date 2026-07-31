import { ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useBrowserSurfaceClaimStore } from "./browserSurfaceClaimStore";

const SURFACE = ThreadId.makeUnsafe("project-browser:project-1");
const OTHER_SURFACE = ThreadId.makeUnsafe("thread-b");
const PANE_A = "pane-a";
const PANE_B = "pane-b";

function owner(surfaceId: ThreadId): string | null {
  return useBrowserSurfaceClaimStore.getState().ownerBySurfaceId[surfaceId] ?? null;
}

describe("browserSurfaceClaimStore", () => {
  beforeEach(() => {
    useBrowserSurfaceClaimStore.setState({ ownerBySurfaceId: {} });
  });

  it("gives the surface to the first pane that asks", () => {
    useBrowserSurfaceClaimStore.getState().claimIfUnowned(SURFACE, PANE_A);
    expect(owner(SURFACE)).toBe(PANE_A);
  });

  // Two panes on one shared surface would otherwise both drive the single native view.
  it("does not let a second pane displace the owner by mounting", () => {
    const store = useBrowserSurfaceClaimStore.getState();
    store.claimIfUnowned(SURFACE, PANE_A);
    store.claimIfUnowned(SURFACE, PANE_B);
    expect(owner(SURFACE)).toBe(PANE_A);
  });

  it("transfers on an explicit take-over", () => {
    const store = useBrowserSurfaceClaimStore.getState();
    store.claimIfUnowned(SURFACE, PANE_A);
    store.takeOver(SURFACE, PANE_B);
    expect(owner(SURFACE)).toBe(PANE_B);
  });

  it("frees the surface when the owner unmounts", () => {
    const store = useBrowserSurfaceClaimStore.getState();
    store.claimIfUnowned(SURFACE, PANE_A);
    store.release(SURFACE, PANE_A);
    expect(owner(SURFACE)).toBeNull();

    store.claimIfUnowned(SURFACE, PANE_B);
    expect(owner(SURFACE)).toBe(PANE_B);
  });

  // React can unmount the loser after the winner has already taken over.
  it("ignores a release from a pane that no longer owns the surface", () => {
    const store = useBrowserSurfaceClaimStore.getState();
    store.claimIfUnowned(SURFACE, PANE_A);
    store.takeOver(SURFACE, PANE_B);
    store.release(SURFACE, PANE_A);
    expect(owner(SURFACE)).toBe(PANE_B);
  });

  it("tracks surfaces independently", () => {
    const store = useBrowserSurfaceClaimStore.getState();
    store.claimIfUnowned(SURFACE, PANE_A);
    store.claimIfUnowned(OTHER_SURFACE, PANE_B);
    expect(owner(SURFACE)).toBe(PANE_A);
    expect(owner(OTHER_SURFACE)).toBe(PANE_B);
  });
});
