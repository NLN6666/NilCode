import { describe, expect, it } from "vitest";
import type { ThreadId } from "@synara/contracts";

import { BrowserCdpSessionRouter } from "./browserCdpSessionRouter";

const THREAD_ID = "thread-1" as ThreadId;
const TARGET_ID = "A".repeat(32);
const OTHER_TARGET_ID = "B".repeat(32);
const CHILD_SESSION_ID = "child-session-77";

describe("BrowserCdpSessionRouter", () => {
  it("attach mints a synthetic top-level sessionId that resolves to the tab", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");

    expect(session.sessionId).toMatch(/^[0-9A-F]{32}$/);
    expect(router.resolve(session.sessionId)).toEqual({ kind: "top", session });
    expect(router.sessionsForTarget(TARGET_ID)).toEqual([session]);
    expect(router.hasSessions()).toBe(true);
  });

  it("detach removes the session and unknown sessionIds resolve to null", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");

    expect(router.detach(session.sessionId)).toEqual(session);
    expect(router.resolve(session.sessionId)).toBeNull();
    expect(router.detach(session.sessionId)).toBeNull();
    expect(router.hasSessions()).toBe(false);
  });

  it("detachByTarget only drops sessions of that target", () => {
    const router = new BrowserCdpSessionRouter();
    const kept = router.attach(OTHER_TARGET_ID, THREAD_ID, "tab-2");
    const dropped = router.attach(TARGET_ID, THREAD_ID, "tab-1");

    expect(router.detachByTarget(TARGET_ID)).toEqual([dropped]);
    expect(router.resolve(kept.sessionId)).toEqual({ kind: "top", session: kept });
    expect(router.detachByTarget(TARGET_ID)).toEqual([]);
  });

  it("detachAll drains every session", () => {
    const router = new BrowserCdpSessionRouter();
    router.attach(TARGET_ID, THREAD_ID, "tab-1");
    router.attach(OTHER_TARGET_ID, THREAD_ID, "tab-2");

    expect(router.detachAll()).toHaveLength(2);
    expect(router.hasSessions()).toBe(false);
  });

  it("stamps the synthetic sessionId onto top-level upstream events", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");

    const routed = router.routeUpstreamEvent(session, {
      method: "Page.frameNavigated",
      params: { frame: { id: "F1" } },
    });

    expect(routed).toEqual({
      method: "Page.frameNavigated",
      params: { frame: { id: "F1" } },
      sessionId: session.sessionId,
    });
  });

  it("registers nested sessions from Target.attachedToTarget and routes their commands", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");

    router.routeUpstreamEvent(session, {
      method: "Target.attachedToTarget",
      params: { sessionId: CHILD_SESSION_ID, targetInfo: { type: "iframe" } },
    });

    expect(router.resolve(CHILD_SESSION_ID)).toEqual({
      kind: "child",
      session,
      upstreamSessionId: CHILD_SESSION_ID,
    });
  });

  it("passes nested-session events through with Chromium's own sessionId untouched", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");
    router.routeUpstreamEvent(session, {
      method: "Target.attachedToTarget",
      params: { sessionId: CHILD_SESSION_ID },
    });

    const routed = router.routeUpstreamEvent(session, {
      method: "Runtime.consoleAPICalled",
      params: { type: "log" },
      sessionId: CHILD_SESSION_ID,
    });

    expect(routed).toEqual({
      method: "Runtime.consoleAPICalled",
      params: { type: "log" },
      sessionId: CHILD_SESSION_ID,
    });
  });

  it("drops the nested route on Target.detachedFromTarget", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");
    router.routeUpstreamEvent(session, {
      method: "Target.attachedToTarget",
      params: { sessionId: CHILD_SESSION_ID },
    });

    router.routeUpstreamEvent(session, {
      method: "Target.detachedFromTarget",
      params: { sessionId: CHILD_SESSION_ID },
    });

    expect(router.resolve(CHILD_SESSION_ID)).toBeNull();
  });

  it("detaching the owning top session drops its nested routes too", () => {
    const router = new BrowserCdpSessionRouter();
    const session = router.attach(TARGET_ID, THREAD_ID, "tab-1");
    router.routeUpstreamEvent(session, {
      method: "Target.attachedToTarget",
      params: { sessionId: CHILD_SESSION_ID },
    });

    router.detach(session.sessionId);

    expect(router.resolve(CHILD_SESSION_ID)).toBeNull();
  });
});
