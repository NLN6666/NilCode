import { describe, expect, it, vi } from "vitest";
import type {
  BrowserElementPickCancelledEvent,
  BrowserElementPickedEvent,
  BrowserTabInput,
  ThreadId,
} from "@synara/contracts";

import { BrowserElementPicker, type BrowserElementPickHost } from "./browserElementPicker";

const THREAD_ID = "thread-1" as ThreadId;
const TAB_ID = "tab-1";
const PAGE_URL = "http://localhost:5173/dashboard";
const BACKEND_NODE_ID = 42;

type CdpListener = (event: { method: string; params?: unknown }) => void;

interface CdpCall {
  tabId: string;
  method: string;
  params?: Record<string, unknown> | undefined;
}

interface DeferredControl {
  resolve: () => void;
}

function validElementPayload() {
  return {
    selector: "button.btn",
    tagName: "BUTTON",
    elementId: "submit",
    classNames: ["btn"],
    textSnippet: "Save",
    outerHtmlSnippet: "<button>Save</button>",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    computedStyles: { display: "block" },
  };
}

function createHost(options: { gateOn?: string } = {}) {
  const calls: CdpCall[] = [];
  const listeners: Array<{ listener: CdpListener; unsubscribed: boolean }> = [];
  const picked: BrowserElementPickedEvent[] = [];
  const cancelled: BrowserElementPickCancelledEvent[] = [];
  const gates: DeferredControl[] = [];

  const sendCommand = vi.fn(
    async (
      input: BrowserTabInput,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<unknown> => {
      calls.push({ tabId: input.tabId, method, params });
      // Blink runs HighlightConfigFromInspectorObject before it stores the mode, and that
      // helper rejects a missing highlightConfig — even for mode "none". A disarm sent
      // without one therefore never takes effect and leaves the page swallowing clicks.
      if (method === "Overlay.setInspectMode" && params?.highlightConfig === undefined) {
        throw new Error("Internal error: highlight configuration parameter is missing");
      }
      if (options.gateOn === method) {
        // Lets a test hold this command open and drive a concurrent call into the window.
        await new Promise<void>((resolve) => {
          gates.push({ resolve });
        });
      }
      switch (method) {
        case "DOM.resolveNode":
          return { object: { objectId: "obj-1" } };
        case "Runtime.callFunctionOn":
          return { result: { value: validElementPayload() } };
        case "Page.captureScreenshot":
          return { data: Buffer.from("png-bytes").toString("base64") };
        default:
          return {};
      }
    },
  );

  const host: BrowserElementPickHost = {
    attachTab: vi.fn(async () => {}),
    releaseTab: vi.fn(),
    sendCommand,
    subscribeToCdpEvents: vi.fn((_input, listener) => {
      const entry = { listener, unsubscribed: false };
      listeners.push(entry);
      return () => {
        entry.unsubscribed = true;
      };
    }),
    getTabUrl: vi.fn(() => PAGE_URL),
    emitPicked: vi.fn((event) => picked.push(event)),
    emitCancelled: vi.fn((event) => cancelled.push(event)),
  };

  return {
    host,
    calls,
    listeners,
    picked,
    cancelled,
    gates,
    methodsFor: (tabId: string) =>
      calls.filter((call) => call.tabId === tabId).map((c) => c.method),
    inspectModeCalls: () =>
      calls
        .filter((call) => call.method === "Overlay.setInspectMode")
        .map((call) => call.params?.mode),
    inspectModeParams: () =>
      calls.filter((call) => call.method === "Overlay.setInspectMode").map((call) => call.params),
    inspectModeCallsFor: (tabId: string) =>
      calls
        .filter((call) => call.tabId === tabId && call.method === "Overlay.setInspectMode")
        .map((call) => call.params?.mode),
    openGates: () => {
      for (const gate of gates.splice(0)) {
        gate.resolve();
      }
    },
    emit: (index: number, event: { method: string; params?: unknown }) => {
      listeners[index]?.listener(event);
    },
  };
}

// Lets gated promises settle so the picker's post-await checkpoints run.
async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

describe("BrowserElementPicker.start", () => {
  it("arms inspect mode and registers a session", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });

    expect(fake.methodsFor(TAB_ID)).toEqual([
      "DOM.enable",
      "CSS.enable",
      "Overlay.enable",
      "DOM.getDocument",
      "Overlay.setInspectMode",
    ]);
    expect(fake.inspectModeCalls()).toEqual(["searchForNode"]);
    expect(picker.isPicking(THREAD_ID)).toBe(true);
    expect(fake.cancelled).toEqual([]);
  });

  it("is a no-op when the same tab is already being picked", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    const callCount = fake.calls.length;
    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });

    expect(fake.calls.length).toBe(callCount);
    expect(fake.listeners).toHaveLength(1);
  });

  it("keeps one active session and unsubscribes the superseded listener", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    await picker.start({ threadId: THREAD_ID, tabId: "tab-2" });

    expect(picker.isPicking(THREAD_ID)).toBe(true);
    expect(fake.listeners).toHaveLength(2);
    expect(fake.listeners[0]?.unsubscribed).toBe(true);
    expect(fake.listeners[1]?.unsubscribed).toBe(false);
  });

  it("retires the listener of a start that loses a concurrent race", async () => {
    const fake = createHost({ gateOn: "DOM.getDocument" });
    const picker = new BrowserElementPicker(fake.host);

    const first = picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    await flush();
    const second = picker.start({ threadId: THREAD_ID, tabId: "tab-2" });
    await flush();
    fake.openGates();
    await Promise.all([first, second]);
    await flush();
    fake.openGates();
    await flush();

    // Whichever listeners were attached, at most one may still be live.
    const live = fake.listeners.filter((entry) => !entry.unsubscribed);
    expect(live.length).toBeLessThanOrEqual(1);
  });
});

describe("BrowserElementPicker.cancel", () => {
  it("disarms inspect mode and reports the user reason", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    await picker.cancel({ threadId: THREAD_ID });

    expect(picker.isPicking(THREAD_ID)).toBe(false);
    expect(fake.inspectModeCalls()).toEqual(["searchForNode", "none"]);
    expect(fake.cancelled).toEqual([{ threadId: THREAD_ID, reason: "user", message: null }]);
    expect(fake.listeners[0]?.unsubscribed).toBe(true);
  });

  // Toggling the toolbar button off flips the UI back to browse immediately, so a disarm that
  // Blink rejects is invisible: the icon goes grey while the page stays in inspect mode.
  it("sends a highlightConfig with the disarm so Blink accepts it", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    await picker.cancel({ threadId: THREAD_ID });

    for (const params of fake.inspectModeParams()) {
      expect(params?.highlightConfig).toBeDefined();
    }
  });

  // The regression this file exists for: cancelling inside the CDP setup window used to find
  // no session, no-op silently, and leave the page armed with the UI already back in browse.
  it("cancels a session that is still in its setup window", async () => {
    const fake = createHost({ gateOn: "DOM.enable" });
    const picker = new BrowserElementPicker(fake.host);

    const starting = picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    await flush();

    expect(picker.isPicking(THREAD_ID)).toBe(true);

    await picker.cancel({ threadId: THREAD_ID });
    expect(fake.cancelled).toEqual([{ threadId: THREAD_ID, reason: "user", message: null }]);

    fake.openGates();
    await starting;
    await flush();

    expect(picker.isPicking(THREAD_ID)).toBe(false);
    // The aborted start never arms the page, and the teardown disarms it defensively.
    expect(fake.inspectModeCalls()).not.toContain("searchForNode");
    expect(fake.inspectModeCalls()).toContain("none");
    expect(fake.listeners.every((entry) => entry.unsubscribed)).toBe(true);
  });

  it("does nothing when no session is active", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.cancel({ threadId: THREAD_ID });

    expect(fake.cancelled).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

describe("BrowserElementPicker cleanup paths", () => {
  it("cancels on navigation", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    picker.handleNavigation(THREAD_ID, TAB_ID);
    await flush();

    expect(picker.isPicking(THREAD_ID)).toBe(false);
    expect(fake.cancelled).toEqual([{ threadId: THREAD_ID, reason: "navigation", message: null }]);
  });

  it("ignores navigation on a different tab", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    picker.handleNavigation(THREAD_ID, "tab-other");
    await flush();

    expect(picker.isPicking(THREAD_ID)).toBe(true);
    expect(fake.cancelled).toEqual([]);
  });

  it("cancels on tab close without issuing further CDP commands", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    const callCount = fake.calls.length;
    picker.handleTabClosed(THREAD_ID, TAB_ID);

    expect(picker.isPicking(THREAD_ID)).toBe(false);
    // The runtime is gone, so talking to the debugger would only throw.
    expect(fake.calls.length).toBe(callCount);
    expect(fake.cancelled).toEqual([{ threadId: THREAD_ID, reason: "tab-closed", message: null }]);
    expect(fake.listeners[0]?.unsubscribed).toBe(true);
  });

  it("drops every session on disposeAll without emitting into a dead renderer", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    picker.disposeAll();

    expect(picker.isPicking(THREAD_ID)).toBe(false);
    expect(fake.cancelled).toEqual([]);
    expect(fake.listeners[0]?.unsubscribed).toBe(true);
  });

  it("reports a failed setup as an error cancellation", async () => {
    const fake = createHost();
    (fake.host.attachTab as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("debugger busy"),
    );
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });

    expect(picker.isPicking(THREAD_ID)).toBe(false);
    expect(fake.cancelled).toEqual([
      { threadId: THREAD_ID, reason: "error", message: "debugger busy" },
    ]);
  });
});

describe("BrowserElementPicker pick completion", () => {
  it("emits the selection with a cropped screenshot and clears the session", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();

    expect(fake.picked).toHaveLength(1);
    expect(fake.picked[0]?.selection.selector).toBe("button.btn");
    expect(fake.picked[0]?.selection.tagName).toBe("button");
    expect(fake.picked[0]?.selection.pageUrl).toBe(PAGE_URL);
    expect(fake.picked[0]?.screenshot?.mimeType).toBe("image/png");
    // Inspect mode is disarmed before the extraction round trip.
    expect(fake.inspectModeCalls()).toEqual(["searchForNode", "none"]);
    expect(picker.isPicking(THREAD_ID)).toBe(false);
    expect(fake.listeners[0]?.unsubscribed).toBe(true);
    expect(fake.cancelled).toEqual([]);
  });

  it("still delivers the element when the crop fails", async () => {
    const fake = createHost();
    (fake.host.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: BrowserTabInput, method: string, params?: Record<string, unknown>) => {
        fake.calls.push({ tabId: input.tabId, method, params });
        if (method === "Page.captureScreenshot") {
          throw new Error("capture failed");
        }
        if (method === "DOM.resolveNode") {
          return { object: { objectId: "obj-1" } };
        }
        if (method === "Runtime.callFunctionOn") {
          return { result: { value: validElementPayload() } };
        }
        return {};
      },
    );
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();

    expect(fake.picked).toHaveLength(1);
    expect(fake.picked[0]?.screenshot).toBeNull();
    expect(fake.cancelled).toEqual([]);
  });

  it("cancels with an error when the page returns an unusable payload", async () => {
    const fake = createHost();
    (fake.host.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: BrowserTabInput, method: string, params?: Record<string, unknown>) => {
        fake.calls.push({ tabId: input.tabId, method, params });
        if (method === "DOM.resolveNode") {
          return { object: { objectId: "obj-1" } };
        }
        if (method === "Runtime.callFunctionOn") {
          return { result: { value: { selector: "", tagName: "" } } };
        }
        return {};
      },
    );
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();

    expect(fake.picked).toEqual([]);
    expect(fake.cancelled[0]?.reason).toBe("error");
    expect(picker.isPicking(THREAD_ID)).toBe(false);
  });

  it("ignores unrelated CDP events", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, { method: "Page.frameNavigated", params: {} });
    await flush();

    expect(fake.picked).toEqual([]);
    expect(fake.cancelled).toEqual([]);
    expect(picker.isPicking(THREAD_ID)).toBe(true);
  });

  // Regression guard for the completion-phase half of the generation race: an in-flight
  // completePick on tab A must not tear down a session the user has since started on tab B.
  // Reverting the generation checks in endSession/completePick makes this fail — tab A's
  // teardown deletes session B and unsubscribes its listener, leaving tab B armed.
  it("does not tear down a newer session started while a pick is completing", async () => {
    const fake = createHost({ gateOn: "DOM.resolveNode" });
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();

    // Tab A is parked inside DOM.resolveNode; the user now starts a pick on tab B.
    await picker.start({ threadId: THREAD_ID, tabId: "tab-2" });
    expect(fake.inspectModeCallsFor("tab-2")).toEqual(["searchForNode"]);

    fake.openGates();
    await flush();

    // Session B survives tab A's completion.
    expect(picker.isPicking(THREAD_ID)).toBe(true);
    expect(fake.listeners[1]?.unsubscribed).toBe(false);
    // Tab B is still armed: nothing disarmed the mode the user just entered.
    expect(fake.inspectModeCallsFor("tab-2")).toEqual(["searchForNode"]);
    // Tab A's pick still lands in the draft — the user did click that element.
    expect(fake.picked).toHaveLength(1);
    expect(fake.picked[0]?.selection.tabId).toBe(TAB_ID);
    expect(fake.cancelled).toEqual([]);
  });

  it("suppresses a stale error cancellation from a superseded pick", async () => {
    const fake = createHost({ gateOn: "DOM.resolveNode" });
    (fake.host.getTabUrl as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("tab is gone");
    });
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();

    await picker.start({ threadId: THREAD_ID, tabId: "tab-2" });
    fake.openGates();
    await flush();

    // The failing tab-A pick must not knock the renderer out of the tab-B session.
    expect(fake.cancelled).toEqual([]);
    expect(picker.isPicking(THREAD_ID)).toBe(true);
  });

  it("ignores a second inspect hit after the first one settled the session", async () => {
    const fake = createHost();
    const picker = new BrowserElementPicker(fake.host);

    await picker.start({ threadId: THREAD_ID, tabId: TAB_ID });
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();
    fake.emit(0, {
      method: "Overlay.inspectNodeRequested",
      params: { backendNodeId: BACKEND_NODE_ID },
    });
    await flush();

    expect(fake.picked).toHaveLength(1);
  });
});
