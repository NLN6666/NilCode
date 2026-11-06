// FILE: computerProvisioning.test.ts
// Purpose: Pin the one "set up computer control" vocabulary the chat card and the
//          settings panel now share.
// Layer: Web UI logic tests

import type {
  ComputerProvisionResult,
  ComputerStatusResult,
  DesktopAppSnapState,
} from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPUTER_PERMISSION_KINDS } from "@synara/shared/computerGrants";

import {
  computerProvisionErrorToast,
  computerProvisionNote,
  computerProvisionOutcome,
  computerProvisionResultToast,
  prepareComputerPermissionGuide,
  readLocalComputerPermissionBridge,
  computerPermissionSetupSupported,
} from "./computerProvisioning";

function grantState(overrides: Partial<DesktopAppSnapState> = {}): DesktopAppSnapState {
  return {
    platform: "macos",
    supported: true,
    enabled: false,
    status: "disabled",
    shortcut: null,
    accessibilityPermission: "granted",
    inputMonitoringPermission: "granted",
    screenRecordingPermission: "granted",
    message: null,
    appDisplayName: "Synara",
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("prepareComputerPermissionGuide", () => {
  it("does not probe without a native setup bridge", async () => {
    const getPermissionState = vi.fn();
    await expect(
      prepareComputerPermissionGuide({ getPermissionState, isCurrent: () => true }),
    ).resolves.toBe(true);
    expect(getPermissionState).not.toHaveBeenCalled();
  });
  it("checks real grants before the first task instead of trusting idle server availability", async () => {
    const getStatus = vi.fn(async () => ({ availability: { kind: "available", backend: "cua" } }));
    const getPermissionState = vi.fn(async () =>
      grantState({ inputMonitoringPermission: "denied" }),
    );
    const startPermissionSetup = vi.fn().mockResolvedValue(undefined);
    await expect(
      prepareComputerPermissionGuide({
        getPermissionState,
        startPermissionSetup,
        isCurrent: () => true,
      }),
    ).resolves.toBe(false);
    expect(getPermissionState).toHaveBeenCalledExactlyOnceWith(COMPUTER_PERMISSION_KINDS);
    expect(startPermissionSetup).toHaveBeenCalledExactlyOnceWith(COMPUTER_PERMISSION_KINDS);
    expect(getStatus).not.toHaveBeenCalled();
  });
  it("does not open setup after cancellation overtakes the grant check", async () => {
    let current = true;
    const startPermissionSetup = vi.fn();
    const getPermissionState = vi.fn(async () => {
      current = false;
      return grantState({ screenRecordingPermission: "denied" });
    });
    await expect(
      prepareComputerPermissionGuide({
        getPermissionState,
        startPermissionSetup,
        isCurrent: () => current,
      }),
    ).resolves.toBe(false);
    expect(getPermissionState).toHaveBeenCalledOnce();
    expect(startPermissionSetup).not.toHaveBeenCalled();
  });
  it("continues without setup when all requested grants exist", async () => {
    const startPermissionSetup = vi.fn();
    await expect(
      prepareComputerPermissionGuide({
        getPermissionState: async () => grantState(),
        startPermissionSetup,
        isCurrent: () => true,
      }),
    ).resolves.toBe(true);
    expect(startPermissionSetup).not.toHaveBeenCalled();
  });
  it.each([
    { platform: "linux" as const, supported: true },
    { platform: "macos" as const, supported: false },
  ])("never offers Mac grants for unsupported state %j", async (overrides) => {
    const state = grantState({
      ...overrides,
      accessibilityPermission: "unknown",
      inputMonitoringPermission: "unknown",
      screenRecordingPermission: "unknown",
    });
    const startPermissionSetup = vi.fn();
    expect(computerPermissionSetupSupported(state)).toBe(false);
    await expect(
      prepareComputerPermissionGuide({
        getPermissionState: async () => state,
        startPermissionSetup,
        isCurrent: () => true,
      }),
    ).resolves.toBe(true);
    expect(startPermissionSetup).not.toHaveBeenCalled();
  });
  it("keeps the draft unsent when the native check fails", async () => {
    const startPermissionSetup = vi.fn();
    await expect(
      prepareComputerPermissionGuide({
        getPermissionState: async () => {
          throw new Error("helper unavailable");
        },
        startPermissionSetup,
        isCurrent: () => true,
      }),
    ).rejects.toThrow("helper unavailable");
    expect(startPermissionSetup).not.toHaveBeenCalled();
  });
});

describe("local Computer permission ownership", () => {
  it("does not infer locality for an injected API from an unrelated desktop endpoint", () => {
    vi.stubGlobal("window", {
      nativeApi: {},
      desktopBridge: { getWsUrl: () => "ws://127.0.0.1:4111", appSnap: {} },
    });
    expect(readLocalComputerPermissionBridge()).toBeNull();
  });
  it.each(["ws://127.0.0.1:4312", "ws://[::1]:4312", "wss://localhost:4312"])(
    "uses the desktop-owned loopback endpoint %s",
    (endpoint) => {
      const appSnap = {};
      vi.stubGlobal("window", { desktopBridge: { getWsUrl: () => endpoint, appSnap } });
      expect(readLocalComputerPermissionBridge()).toBe(appSnap);
    },
  );
  it.each(["ws://192.168.1.42:4312", "http://localhost:4312", "invalid", null])(
    "does not require local client grants for remote or unknown endpoint %s",
    (endpoint) => {
      vi.stubGlobal("window", { desktopBridge: { getWsUrl: () => endpoint, appSnap: {} } });
      expect(readLocalComputerPermissionBridge()).toBeNull();
    },
  );
});

const READY_STATUS: ComputerStatusResult = {
  computerId: "computer-1",
  availability: { kind: "available", backend: "mac" },
  health: {
    status: "connected",
    captureAvailable: true,
    consecutiveFailures: 0,
    reconnects: 0,
  },
  capabilities: {
    windows: true,
    windowBounds: true,
    stacking: true,
    capture: true,
    input: true,
    clipboard: true,
    focus: true,
    raise: true,
    ghostCursor: true,
    visibleDesktop: true,
  },
} as unknown as ComputerStatusResult;

function result(
  overrides: Partial<ComputerStatusResult>,
  summary: string,
): ComputerProvisionResult {
  return { summary, status: { ...READY_STATUS, ...overrides } };
}

describe("computerProvisionOutcome", () => {
  it("never reports unsupported or disconnected desktops as ready", () => {
    expect(
      computerProvisionOutcome(
        result(
          { availability: { kind: "unsupported-platform", platform: "win32" } },
          "Unavailable.",
        ),
      ),
    ).toBe("incomplete");
    expect(
      computerProvisionOutcome(
        result(
          { provisionable: false, health: { ...READY_STATUS.health, status: "unavailable" } },
          "Unavailable.",
        ),
      ),
    ).toBe("incomplete");
  });
  it("keeps setup incomplete while a provisionable desktop is disconnected", () => {
    expect(
      computerProvisionOutcome(
        result(
          {
            availability: { kind: "available", backend: "kwin" },
            provisionable: true,
            health: { ...READY_STATUS.health, status: "unavailable" },
          },
          "Still starting.",
        ),
      ),
    ).toBe("incomplete");
  });
});

describe("computer provision toasts", () => {
  it("distinguishes a finished setup from one still missing a grant", () => {
    expect(computerProvisionResultToast(result({}, "All set.")).type).toBe("success");
    const incomplete = computerProvisionResultToast(
      result(
        {
          availability: {
            kind: "permission-required",
            missing: ["accessibility"],
            message: "needs Accessibility",
            buildSignature: "adhoc",
          },
        },
        "Asked macOS.",
      ),
    );
    expect(incomplete.type).toBe("warning");
    // The server's own sentence, not a second account of it.
    expect(incomplete.description).toBe("Asked macOS.");
  });

  it("reports a failure without inventing a reason", () => {
    expect(computerProvisionErrorToast(new Error("build failed")).description).toBe("build failed");
    expect(computerProvisionErrorToast(undefined).description.length).toBeGreaterThan(0);
  });
});

describe("computerProvisionNote", () => {
  it("says the same three things the toasts do, for a surface with room", () => {
    expect(computerProvisionNote({ isPending: true })?.length).toBeGreaterThan(0);
    expect(computerProvisionNote({ isPending: false, error: new Error("nope") })).toContain("nope");
    expect(
      computerProvisionNote({ isPending: false, result: result({}, "Started the helper.") }),
    ).toBe("Started the helper.");
    expect(computerProvisionNote({ isPending: false })).toBeUndefined();
  });

  it("lets the in-flight message outrank a previous attempt's outcome", () => {
    const note = computerProvisionNote({ isPending: true, error: new Error("nope") });
    expect(note?.length).toBeGreaterThan(0);
    expect(note).not.toContain("nope");
  });
});
