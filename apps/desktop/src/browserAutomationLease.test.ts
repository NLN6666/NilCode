import { describe, expect, it, vi } from "vitest";
import type { BrowserTabInput, ThreadId } from "@synara/contracts";

import { BrowserAutomationLease, type BrowserAutomationLeaseHost } from "./browserAutomationLease";

const THREAD_ID = "thread-1" as ThreadId;
const OTHER_THREAD_ID = "thread-2" as ThreadId;
const TAB: BrowserTabInput = { threadId: THREAD_ID, tabId: "tab-1" };

function createHost() {
  const attachedKeys = new Set<string>();
  const keyOf = (input: BrowserTabInput) => `${input.threadId}:${input.tabId}`;
  const markerByThread = new Map<ThreadId, boolean>();

  const host: BrowserAutomationLeaseHost = {
    wakeTab: vi.fn(async () => {}),
    isDebuggerAttached: (input) => attachedKeys.has(keyOf(input)),
    attachDebugger: vi.fn((input: BrowserTabInput) => {
      attachedKeys.add(keyOf(input));
    }),
    detachDebugger: vi.fn((input: BrowserTabInput) => {
      attachedKeys.delete(keyOf(input));
    }),
    setAgentControlMarker: vi.fn((threadId: ThreadId, active: boolean) => {
      markerByThread.set(threadId, active);
    }),
    onAllReleased: vi.fn(),
  };

  return { host, attachedKeys, markerByThread };
}

describe("BrowserAutomationLease", () => {
  it("attaches the debugger once and wakes the tab per acquire", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);

    await lease.acquire(TAB, { markAgentControl: true });
    await lease.acquire(TAB, { markAgentControl: false });

    expect(fake.host.wakeTab).toHaveBeenCalledTimes(2);
    expect(fake.host.attachDebugger).toHaveBeenCalledTimes(1);
    expect(lease.isHeld(TAB)).toBe(true);
  });

  it("only really detaches when the last holder releases", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);

    const first = await lease.acquire(TAB, { markAgentControl: true });
    const second = await lease.acquire(TAB, { markAgentControl: false });

    first.release();
    expect(fake.host.detachDebugger).not.toHaveBeenCalled();
    expect(lease.isHeld(TAB)).toBe(true);

    second.release();
    expect(fake.host.detachDebugger).toHaveBeenCalledTimes(1);
    expect(fake.host.onAllReleased).toHaveBeenCalledWith(TAB);
    expect(lease.isHeld(TAB)).toBe(false);
  });

  it("ignores duplicate releases from the same holder", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);

    const first = await lease.acquire(TAB, { markAgentControl: false });
    await lease.acquire(TAB, { markAgentControl: false });

    first.release();
    first.release();

    expect(lease.isHeld(TAB)).toBe(true);
    expect(fake.host.detachDebugger).not.toHaveBeenCalled();
  });

  it("keeps the agent-control marker while any marking holder remains", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);

    const picker = await lease.acquire(TAB, { markAgentControl: false });
    expect(fake.markerByThread.get(THREAD_ID)).toBe(false);

    const agent = await lease.acquire(TAB, { markAgentControl: true });
    expect(fake.markerByThread.get(THREAD_ID)).toBe(true);

    picker.release();
    expect(fake.markerByThread.get(THREAD_ID)).toBe(true);

    agent.release();
    expect(fake.markerByThread.get(THREAD_ID)).toBe(false);
    expect(fake.markerByThread.get(OTHER_THREAD_ID)).toBeUndefined();
  });

  it("forces every holder out and detaches when DevTools opens on the page", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);
    const onForcedDetach = vi.fn();

    await lease.acquire(TAB, { markAgentControl: true, onForcedDetach });
    await lease.acquire(TAB, { markAgentControl: false, onForcedDetach });

    lease.handleDevToolsOpened(TAB);

    expect(onForcedDetach).toHaveBeenCalledTimes(2);
    expect(onForcedDetach).toHaveBeenCalledWith("devtools");
    expect(fake.host.detachDebugger).toHaveBeenCalledTimes(1);
    expect(lease.isHeld(TAB)).toBe(false);
    expect(fake.markerByThread.get(THREAD_ID)).toBe(false);
  });

  it("notifies holders without detaching when the runtime is destroyed", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);
    const onForcedDetach = vi.fn();

    await lease.acquire(TAB, { markAgentControl: true, onForcedDetach });
    lease.handleRuntimeDestroyed(TAB);

    expect(onForcedDetach).toHaveBeenCalledWith("runtime-destroyed");
    expect(fake.host.detachDebugger).not.toHaveBeenCalled();
    expect(lease.isHeld(TAB)).toBe(false);
  });

  it("a release after a forced detach is a no-op", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);

    const handle = await lease.acquire(TAB, { markAgentControl: true });
    lease.handleRuntimeDestroyed(TAB);
    handle.release();

    expect(fake.host.detachDebugger).not.toHaveBeenCalled();
    expect(fake.host.onAllReleased).not.toHaveBeenCalled();
  });

  it("holders on other tabs are untouched by a forced detach", async () => {
    const fake = createHost();
    const lease = new BrowserAutomationLease(fake.host);
    const otherTab: BrowserTabInput = { threadId: THREAD_ID, tabId: "tab-2" };
    const onForcedDetach = vi.fn();

    await lease.acquire(TAB, { markAgentControl: true });
    await lease.acquire(otherTab, { markAgentControl: true, onForcedDetach });

    lease.handleDevToolsOpened(TAB);

    expect(onForcedDetach).not.toHaveBeenCalled();
    expect(lease.isHeld(otherTab)).toBe(true);
    expect(fake.markerByThread.get(THREAD_ID)).toBe(true);
  });
});
