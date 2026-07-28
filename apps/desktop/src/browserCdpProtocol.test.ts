import { describe, expect, it, vi } from "vitest";

import type { CdpTargetInfo } from "./browserCdpTargetRegistry";
import {
  CDP_METHOD_NOT_FOUND_CODE,
  CDP_SERVER_ERROR_CODE,
  CDP_SESSION_NOT_FOUND_CODE,
  buildBrowserVersionResult,
  buildCdpErrorResponse,
  buildCdpEvent,
  buildCdpResponse,
  handleBrowserCdpCommand,
  methodNotFoundError,
  parseCdpClientMessage,
  sessionNotFoundError,
  type BrowserCdpCommandHost,
  type CdpClientMessage,
} from "./browserCdpProtocol";

const PAGE_TARGET: CdpTargetInfo = {
  targetId: "A".repeat(32),
  type: "page",
  title: "Example",
  url: "https://example.com/",
  attached: false,
  canAccessOpener: false,
  browserContextId: "B".repeat(32),
};

function createHost(overrides: Partial<BrowserCdpCommandHost> = {}): BrowserCdpCommandHost {
  return {
    getVersion: () => ({
      chromeVersion: "132.0.0.0",
      userAgent: "Mozilla/5.0 Synara",
      v8Version: "13.2.1",
    }),
    listTargets: () => [PAGE_TARGET],
    getTargetInfo: (targetId) => (targetId === PAGE_TARGET.targetId ? PAGE_TARGET : null),
    getBrowserTargetInfo: () => ({
      ...PAGE_TARGET,
      targetId: "C".repeat(32),
      type: "browser",
      title: "",
      url: "",
      attached: true,
    }),
    announceDiscoveredTargets: vi.fn(),
    setAutoAttach: vi.fn(async () => {}),
    attachToTarget: vi.fn(async () => "D".repeat(32)),
    detachFromTarget: vi.fn(async () => true),
    createTarget: vi.fn(async () => PAGE_TARGET.targetId),
    closeTarget: vi.fn(async () => true),
    activateTarget: vi.fn(async () => {}),
    ...overrides,
  };
}

function command(method: string, params: Record<string, unknown> = {}, id = 1): CdpClientMessage {
  return { id, method, params };
}

describe("parseCdpClientMessage", () => {
  it("parses a flatten-envelope command with sessionId", () => {
    const message = parseCdpClientMessage(
      JSON.stringify({ id: 7, method: "Page.navigate", params: { url: "x" }, sessionId: "S1" }),
    );
    expect(message).toEqual({
      id: 7,
      method: "Page.navigate",
      params: { url: "x" },
      sessionId: "S1",
    });
  });

  it("defaults missing params to an empty object and drops empty sessionIds", () => {
    const message = parseCdpClientMessage(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
    expect(message).toEqual({ id: 1, method: "Browser.getVersion", params: {} });
  });

  it.each([
    ["invalid json", "{nope"],
    ["missing id", JSON.stringify({ method: "Foo.bar" })],
    ["non-integer id", JSON.stringify({ id: 1.5, method: "Foo.bar" })],
    ["missing method", JSON.stringify({ id: 1 })],
    ["non-string sessionId", JSON.stringify({ id: 1, method: "Foo.bar", sessionId: 5 })],
    ["array payload", JSON.stringify([1, 2])],
  ])("rejects %s", (_label, raw) => {
    expect(parseCdpClientMessage(raw)).toBeNull();
  });
});

describe("wire encoding", () => {
  it("stamps sessionId onto responses and events only when present", () => {
    expect(JSON.parse(buildCdpResponse(1, { ok: true }, "S1"))).toEqual({
      id: 1,
      result: { ok: true },
      sessionId: "S1",
    });
    expect(JSON.parse(buildCdpResponse(2, undefined))).toEqual({ id: 2, result: {} });
    expect(JSON.parse(buildCdpErrorResponse(3, methodNotFoundError("Foo.bar")))).toEqual({
      id: 3,
      error: { code: CDP_METHOD_NOT_FOUND_CODE, message: "'Foo.bar' wasn't found" },
    });
    expect(JSON.parse(buildCdpEvent("Target.targetDestroyed", { targetId: "T" }, "S2"))).toEqual({
      method: "Target.targetDestroyed",
      params: { targetId: "T" },
      sessionId: "S2",
    });
  });

  it("shapes the session-not-found error like Chrome", () => {
    expect(sessionNotFoundError()).toEqual({
      code: CDP_SESSION_NOT_FOUND_CODE,
      message: "Session with given id not found.",
    });
  });
});

describe("handleBrowserCdpCommand", () => {
  it("synthesizes Browser.getVersion from real runtime versions", async () => {
    const outcome = await handleBrowserCdpCommand(command("Browser.getVersion"), createHost());
    expect(outcome).toEqual({
      kind: "result",
      result: buildBrowserVersionResult({
        chromeVersion: "132.0.0.0",
        userAgent: "Mozilla/5.0 Synara",
        v8Version: "13.2.1",
      }),
    });
    expect(
      outcome.kind === "result" && (outcome.result as { protocolVersion: string }).protocolVersion,
    ).toBe("1.3");
  });

  it("refuses Browser.close with an explicit error", async () => {
    const outcome = await handleBrowserCdpCommand(command("Browser.close"), createHost());
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.error.code).toBe(CDP_SERVER_ERROR_CODE);
  });

  it("announces current targets when discovery turns on", async () => {
    const host = createHost();
    await handleBrowserCdpCommand(command("Target.setDiscoverTargets", { discover: true }), host);
    expect(host.announceDiscoveredTargets).toHaveBeenCalledTimes(1);

    await handleBrowserCdpCommand(command("Target.setDiscoverTargets", { discover: false }), host);
    expect(host.announceDiscoveredTargets).toHaveBeenCalledTimes(1);
  });

  it("lists targets and looks up target info", async () => {
    const host = createHost();
    expect(await handleBrowserCdpCommand(command("Target.getTargets"), host)).toEqual({
      kind: "result",
      result: { targetInfos: [PAGE_TARGET] },
    });
    expect(
      await handleBrowserCdpCommand(
        command("Target.getTargetInfo", { targetId: PAGE_TARGET.targetId }),
        host,
      ),
    ).toEqual({ kind: "result", result: { targetInfo: PAGE_TARGET } });

    const missing = await handleBrowserCdpCommand(
      command("Target.getTargetInfo", { targetId: "F".repeat(32) }),
      host,
    );
    expect(missing.kind).toBe("error");
  });

  it("returns the synthetic browser target for Target.getTargetInfo without a targetId", async () => {
    const outcome = await handleBrowserCdpCommand(command("Target.getTargetInfo"), createHost());
    expect(
      outcome.kind === "result" &&
        (outcome.result as { targetInfo: { type: string } }).targetInfo.type,
    ).toBe("browser");
  });

  it("forwards setAutoAttach and attach/detach to the host", async () => {
    const host = createHost();
    await handleBrowserCdpCommand(
      command("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true }),
      host,
    );
    expect(host.setAutoAttach).toHaveBeenCalledWith(true);

    const attached = await handleBrowserCdpCommand(
      command("Target.attachToTarget", { targetId: PAGE_TARGET.targetId, flatten: true }),
      host,
    );
    expect(attached).toEqual({ kind: "result", result: { sessionId: "D".repeat(32) } });

    const detached = await handleBrowserCdpCommand(
      command("Target.detachFromTarget", { sessionId: "D".repeat(32) }),
      host,
    );
    expect(detached).toEqual({ kind: "result", result: {} });
  });

  it("maps a failed detach to the Chrome session-not-found error", async () => {
    const host = createHost({ detachFromTarget: vi.fn(async () => false) });
    const outcome = await handleBrowserCdpCommand(
      command("Target.detachFromTarget", { sessionId: "nope" }),
      host,
    );
    expect(outcome).toEqual({ kind: "error", error: sessionNotFoundError() });
  });

  it("surfaces attach failures as errors instead of pretending success", async () => {
    const host = createHost({
      attachToTarget: vi.fn(async () => {
        throw new Error("No target with given id found");
      }),
    });
    const outcome = await handleBrowserCdpCommand(
      command("Target.attachToTarget", { targetId: "F".repeat(32) }),
      host,
    );
    expect(outcome.kind).toBe("error");
    expect(outcome.kind === "error" && outcome.error.message).toContain(
      "No target with given id found",
    );
  });

  it("creates, closes, and activates targets through the host", async () => {
    const host = createHost();
    expect(
      await handleBrowserCdpCommand(
        command("Target.createTarget", { url: "https://example.com/" }),
        host,
      ),
    ).toEqual({ kind: "result", result: { targetId: PAGE_TARGET.targetId } });
    expect(host.createTarget).toHaveBeenCalledWith("https://example.com/");

    expect(
      await handleBrowserCdpCommand(
        command("Target.closeTarget", { targetId: PAGE_TARGET.targetId }),
        host,
      ),
    ).toEqual({ kind: "result", result: { success: true } });

    expect(
      await handleBrowserCdpCommand(
        command("Target.activateTarget", { targetId: PAGE_TARGET.targetId }),
        host,
      ),
    ).toEqual({ kind: "result", result: {} });
    expect(host.activateTarget).toHaveBeenCalledWith(PAGE_TARGET.targetId);
  });

  it("reports only the default browser context and refuses to create new ones", async () => {
    const host = createHost();
    expect(await handleBrowserCdpCommand(command("Target.getBrowserContexts"), host)).toEqual({
      kind: "result",
      result: { browserContextIds: [] },
    });

    const created = await handleBrowserCdpCommand(command("Target.createBrowserContext"), host);
    expect(created.kind).toBe("error");
    expect(created.kind === "error" && created.error.code).toBe(CDP_SERVER_ERROR_CODE);
  });

  it("answers unknown browser-level methods with a Chrome-shaped -32601", async () => {
    const outcome = await handleBrowserCdpCommand(command("Browser.whatIsThis"), createHost());
    expect(outcome).toEqual({
      kind: "error",
      error: { code: CDP_METHOD_NOT_FOUND_CODE, message: "'Browser.whatIsThis' wasn't found" },
    });
  });
});
