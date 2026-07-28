import { describe, expect, it } from "vitest";
import type { BrowserTabState, ThreadBrowserState, ThreadId } from "@synara/contracts";

import { BrowserCdpTargetRegistry, createCdpId } from "./browserCdpTargetRegistry";

const THREAD_A = "thread-a" as ThreadId;
const THREAD_B = "thread-b" as ThreadId;

function tab(overrides: Partial<BrowserTabState> & { id: string }): BrowserTabState {
  return {
    url: "https://example.com/",
    title: "Example",
    status: "live",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
    ...overrides,
  };
}

function state(
  threadId: ThreadId,
  tabs: BrowserTabState[],
  overrides: Partial<ThreadBrowserState> = {},
): ThreadBrowserState {
  return {
    threadId,
    version: 1,
    open: true,
    activeTabId: tabs[0]?.id ?? null,
    tabs,
    lastError: null,
    ...overrides,
  };
}

describe("createCdpId", () => {
  it("produces 32 uppercase hex chars", () => {
    const id = createCdpId();
    expect(id).toMatch(/^[0-9A-F]{32}$/);
  });
});

describe("BrowserCdpTargetRegistry", () => {
  it("emits targetCreated for every tab of the first snapshot", () => {
    const registry = new BrowserCdpTargetRegistry();
    const events = registry.applySnapshot({
      threadId: THREAD_A,
      state: state(THREAD_A, [tab({ id: "tab-1" }), tab({ id: "tab-2", title: "Second" })]),
    });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.method === "Target.targetCreated")).toBe(true);
    expect(registry.listTargets()).toHaveLength(2);
  });

  it("does not leak the thread id through target ids or target infos", () => {
    const registry = new BrowserCdpTargetRegistry();
    const events = registry.applySnapshot({
      threadId: THREAD_A,
      state: state(THREAD_A, [tab({ id: "tab-1" })]),
    });

    const serialized = JSON.stringify(events) + JSON.stringify(registry.listTargets());
    expect(serialized).not.toContain(THREAD_A);
    expect(serialized).not.toContain("tab-1");
    expect(registry.listTargets()[0]?.targetId).toMatch(/^[0-9A-F]{32}$/);
  });

  it("keeps target ids stable for the same (threadId, tabId) across destroy and recreate", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });
    const firstId = registry.listTargets()[0]?.targetId;

    registry.applySnapshot(null);
    expect(registry.listTargets()).toHaveLength(0);

    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });
    expect(registry.listTargets()[0]?.targetId).toBe(firstId);
  });

  it("emits targetInfoChanged when a tab's url or title changes", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });

    const events = registry.applySnapshot({
      threadId: THREAD_A,
      state: state(THREAD_A, [
        tab({ id: "tab-1", title: "Changed", lastCommittedUrl: "https://example.com/next" }),
      ]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.method).toBe("Target.targetInfoChanged");
    expect(
      events[0]?.method === "Target.targetInfoChanged" && events[0].params.targetInfo.url,
    ).toBe("https://example.com/next");
  });

  it("emits nothing for an identical snapshot", () => {
    const registry = new BrowserCdpTargetRegistry();
    const snapshot = { threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) };
    registry.applySnapshot(snapshot);
    expect(registry.applySnapshot(snapshot)).toHaveLength(0);
  });

  it("switching threads destroys the old targets and creates the new thread's targets", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });
    const oldTargetId = registry.listTargets()[0]?.targetId;

    const events = registry.applySnapshot({
      threadId: THREAD_B,
      state: state(THREAD_B, [tab({ id: "tab-9" })]),
    });

    expect(events.map((event) => event.method)).toEqual([
      "Target.targetDestroyed",
      "Target.targetCreated",
    ]);
    expect(events[0]?.method === "Target.targetDestroyed" && events[0].params.targetId).toBe(
      oldTargetId,
    );
    expect(registry.resolveTarget(oldTargetId ?? "")).toBeNull();
  });

  it("a closed browser state destroys every target", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({
      threadId: THREAD_A,
      state: state(THREAD_A, [tab({ id: "tab-1" }), tab({ id: "tab-2" })]),
    });

    const events = registry.applySnapshot({
      threadId: THREAD_A,
      state: state(THREAD_A, [], { open: false, activeTabId: null }),
    });

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.method === "Target.targetDestroyed")).toBe(true);
    expect(registry.listTargets()).toHaveLength(0);
  });

  it("resolves exposed targets back to their tab and rejects unexposed ids", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });
    const targetId = registry.findTargetIdForTab(THREAD_A, "tab-1");

    expect(targetId).not.toBeNull();
    expect(registry.resolveTarget(targetId ?? "")).toEqual({ threadId: THREAD_A, tabId: "tab-1" });
    expect(registry.resolveTarget(createCdpId())).toBeNull();
    expect(registry.findTargetIdForTab(THREAD_A, "missing-tab")).toBeNull();
  });

  it("setAttached flips the attached flag and reports the change once", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });
    const targetId = registry.listTargets()[0]?.targetId ?? "";

    const changed = registry.setAttached(targetId, true);
    expect(changed?.method).toBe("Target.targetInfoChanged");
    expect(registry.getTargetInfo(targetId)?.attached).toBe(true);
    expect(registry.setAttached(targetId, true)).toBeNull();

    const cleared = registry.setAttached(targetId, false);
    expect(cleared?.method).toBe("Target.targetInfoChanged");
    expect(registry.getTargetInfo(targetId)?.attached).toBe(false);
  });

  it("clears the attached flag when the target is destroyed", () => {
    const registry = new BrowserCdpTargetRegistry();
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });
    const targetId = registry.listTargets()[0]?.targetId ?? "";
    registry.setAttached(targetId, true);

    registry.applySnapshot(null);
    registry.applySnapshot({ threadId: THREAD_A, state: state(THREAD_A, [tab({ id: "tab-1" })]) });

    expect(registry.getTargetInfo(targetId)?.attached).toBe(false);
  });
});
