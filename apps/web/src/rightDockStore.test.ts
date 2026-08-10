import { ProjectId, ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
    },
  });
});

import { selectSharedBrowserVisibility, useRightDockStore } from "./rightDockStore";

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const OTHER_PROJECT_ID = ProjectId.makeUnsafe("project-2");
const THREAD_ID = ThreadId.makeUnsafe("thread-1");
const SIBLING_THREAD_ID = ThreadId.makeUnsafe("thread-2");

describe("project-shared browser visibility", () => {
  beforeEach(() => {
    useRightDockStore.setState({
      dockStateByThreadId: {},
      sharedBrowserVisibleByProjectId: {},
    });
  });

  it("survives thread dock mutations until the project visibility changes", () => {
    const store = useRightDockStore.getState();
    store.setSharedBrowserVisible(PROJECT_ID, true);
    store.openPane(THREAD_ID, { kind: "diff", paneId: "diff-a" });

    expect(selectSharedBrowserVisibility(PROJECT_ID)(useRightDockStore.getState())).toBe(true);

    useRightDockStore.getState().setSharedBrowserVisible(PROJECT_ID, false);
    expect(selectSharedBrowserVisibility(PROJECT_ID)(useRightDockStore.getState())).toBe(false);
  });

  it("distinguishes an unseen project from an explicitly hidden browser", () => {
    expect(selectSharedBrowserVisibility(PROJECT_ID)(useRightDockStore.getState())).toBeUndefined();

    useRightDockStore.getState().setSharedBrowserVisible(PROJECT_ID, false);
    expect(selectSharedBrowserVisibility(PROJECT_ID)(useRightDockStore.getState())).toBe(false);
  });

  it("reconciles the project browser into whichever thread is currently mounted", () => {
    const store = useRightDockStore.getState();
    store.setSharedBrowserVisible(PROJECT_ID, true);
    store.reconcileSharedBrowser(THREAD_ID, true);
    store.reconcileSharedBrowser(SIBLING_THREAD_ID, true);

    const state = useRightDockStore.getState();
    expect(state.dockStateByThreadId[THREAD_ID]).toMatchObject({
      open: true,
      panes: [{ kind: "browser" }],
    });
    expect(state.dockStateByThreadId[SIBLING_THREAD_ID]).toMatchObject({
      open: true,
      panes: [{ kind: "browser" }],
    });
    expect(selectSharedBrowserVisibility(OTHER_PROJECT_ID)(state)).toBeUndefined();
  });
});
