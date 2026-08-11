import { describe, expect, it } from "vitest";

import {
  DESKTOP_HANG_HEARTBEAT_INTERVAL_MS,
  DESKTOP_HANG_THRESHOLD_MS,
  DesktopHangWatchdogController,
  getRendererOsProcessId,
  HangWatchdogPolicy,
} from "./desktopHangWatchdog";

describe("HangWatchdogPolicy", () => {
  it("uses Electron's OS renderer process identifier for dump targets", () => {
    expect(getRendererOsProcessId({ getOSProcessId: () => 9_001 })).toBe(9_001);
  });

  it("captures one missed-main-heartbeat incident then rearms after a heartbeat", () => {
    const policy = new HangWatchdogPolicy();
    policy.recordHeartbeat({ nowMs: 1_000, rendererPid: 42 });

    expect(policy.tick(1_000 + DESKTOP_HANG_THRESHOLD_MS - 1)).toEqual({ kind: "wait" });
    expect(policy.tick(1_000 + DESKTOP_HANG_THRESHOLD_MS)).toMatchObject({
      kind: "capture",
      target: { kind: "main" },
    });
    expect(policy.tick(1_000 + DESKTOP_HANG_THRESHOLD_MS + DESKTOP_HANG_HEARTBEAT_INTERVAL_MS)).toEqual({
      kind: "wait",
    });

    policy.recordHeartbeat({ nowMs: 9_000, rendererPid: 42 });
    expect(policy.tick(9_000 + DESKTOP_HANG_THRESHOLD_MS - DESKTOP_HANG_HEARTBEAT_INTERVAL_MS)).toEqual({
      kind: "wait",
    });
    expect(policy.tick(9_000 + DESKTOP_HANG_THRESHOLD_MS)).toMatchObject({
      kind: "capture",
      target: { kind: "main" },
    });
  });

  it("resets instead of capturing after watchdog scheduling was suspended", () => {
    const policy = new HangWatchdogPolicy();
    policy.recordHeartbeat({ nowMs: 1_000 });
    policy.tick(1_000);

    expect(policy.tick(1_000 + DESKTOP_HANG_THRESHOLD_MS + 1)).toEqual({
      kind: "reset-after-suspend",
    });
  });

  it("captures an unresponsive renderer once until it reports responsive", () => {
    const policy = new HangWatchdogPolicy();

    expect(policy.rendererUnresponsive({ nowMs: 1_000, rendererPid: 99 })).toMatchObject({
      kind: "capture",
      target: { kind: "renderer", pid: 99 },
    });
    expect(policy.rendererUnresponsive({ nowMs: 1_001, rendererPid: 99 })).toEqual({ kind: "wait" });

    policy.rendererResponsive(99);
    expect(policy.rendererUnresponsive({ nowMs: 1_002, rendererPid: 99 })).toMatchObject({
      kind: "capture",
      target: { kind: "renderer", pid: 99 },
    });
  });
});

describe("DesktopHangWatchdogController", () => {
  it("starts with a minimal run-as-node environment and coalesces IPC writes", () => {
    const sent: unknown[] = [];
    const listeners = new Map<string, (...args: any[]) => void>();
    let interval: (() => void) | undefined;
    const child = {
      connected: true,
      once: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener),
      on: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener),
      send: (message: unknown, callback?: (error: Error | null) => void) => {
        sent.push(message);
        callback?.(null);
        return true;
      },
      disconnect: () => undefined,
      kill: () => true,
    };
    let forkOptions: unknown;
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\Synara\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\Synara\\Synara.exe",
      },
      fork: (_entry, _args, options) => {
        forkOptions = options;
        return child as never;
      },
      env: { SystemRoot: "D:\\Windows", TEMP: "D:\\Temp", SYNARA_AUTH_TOKEN: "secret" },
      setInterval: ((callback: () => void) => {
        interval = callback;
        return { unref: () => undefined } as never;
      }) as typeof setInterval,
      clearInterval: (() => undefined) as typeof clearInterval,
      log: () => undefined,
    });

    controller.start();
    controller.updateBackendPid(2);
    controller.updateRendererPid(3);
    interval?.();

    expect(forkOptions).toMatchObject({
      env: { ELECTRON_RUN_AS_NODE: "1", SystemRoot: "D:\\Windows", TEMP: "D:\\Temp" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "configure" }),
        expect.objectContaining({ type: "heartbeat", backendPid: 2, rendererPid: 3 }),
      ]),
    );
    expect(JSON.stringify(forkOptions)).not.toContain("SYNARA_AUTH_TOKEN");
  });

  it("restarts a synchronous fork failure within the bounded watchdog budget", () => {
    let now = 0;
    let starts = 0;
    let restart: (() => void) | undefined;
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\Synara\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\Synara\\Synara.exe",
      },
      now: () => now,
      fork: () => {
        starts += 1;
        throw new Error("fork unavailable");
      },
      setTimeout: ((callback: () => void) => {
        restart = callback;
        return { unref: () => undefined } as never;
      }) as typeof setTimeout,
      log: () => undefined,
    });

    controller.start();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(restart).toBeTypeOf("function");
      const scheduledRestart = restart!;
      restart = undefined;
      now += DESKTOP_HANG_HEARTBEAT_INTERVAL_MS;
      scheduledRestart();
    }

    expect(starts).toBe(4);
    expect(restart).toBeUndefined();
  });

  it("coalesces renderer controls to the latest responsive state after an in-flight heartbeat", () => {
    const sent: Array<{ message: { type: string }; complete: (error: Error | null) => void }> = [];
    const sentTypes: string[] = [];
    const child = {
      connected: true,
      once: () => undefined,
      on: () => undefined,
      send: (message: { type: string }, callback?: (error: Error | null) => void) => {
        sentTypes.push(message.type);
        sent.push({ message, complete: callback! });
        return true;
      },
      disconnect: () => undefined,
      kill: () => true,
    };
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\Synara\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\Synara\\Synara.exe",
      },
      fork: () => child as never,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      log: () => undefined,
    });

    controller.start();
    controller.rendererUnresponsive(99);
    controller.rendererResponsive(99);
    expect(sent.map(({ message }) => message.type)).toEqual(["configure"]);

    while (sent.length > 0) {
      sent.shift()!.complete(null);
    }

    expect(sentTypes).toEqual(["configure", "renderer-responsive", "heartbeat"]);
  });

  it("keeps the newest unresponsive state for a renderer while a control message is in flight", () => {
    const sent: Array<{ message: { type: string; rendererPid?: number }; complete: (error: Error | null) => void }> = [];
    const sentMessages: Array<{ type: string; rendererPid?: number }> = [];
    const child = {
      connected: true,
      once: () => undefined,
      on: () => undefined,
      send: (message: { type: string; rendererPid?: number }, callback?: (error: Error | null) => void) => {
        sentMessages.push(message);
        sent.push({ message, complete: callback! });
        return true;
      },
      disconnect: () => undefined,
      kill: () => true,
    };
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\\\Synara\\\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\\\Synara\\\\Synara.exe",
      },
      fork: () => child as never,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      log: () => undefined,
    });

    controller.start();
    controller.rendererUnresponsive(99);
    controller.rendererResponsive(99);
    controller.rendererUnresponsive(99);
    sent.shift()!.complete(null);
    while (sent.length > 0) {
      sent.shift()!.complete(null);
    }

    expect(sentMessages.filter((message) => message.rendererPid === 99)).toEqual([
      expect.objectContaining({ type: "renderer-unresponsive", rendererPid: 99 }),
    ]);
  });

  it("bounds saturated renderer controls while preserving the newest states, configure, and stop", () => {
    const sent: Array<{ message: { type: string; rendererPid?: number }; complete: (error: Error | null) => void }> = [];
    const sentMessages: Array<{ type: string; rendererPid?: number }> = [];
    const child = {
      connected: true,
      once: () => undefined,
      on: () => undefined,
      send: (message: { type: string; rendererPid?: number }, callback?: (error: Error | null) => void) => {
        sentMessages.push(message);
        sent.push({ message, complete: callback! });
        return true;
      },
      disconnect: () => undefined,
      kill: () => true,
    };
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\\\Synara\\\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\\\Synara\\\\Synara.exe",
      },
      fork: () => child as never,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      setTimeout: (() => ({ unref: () => undefined }) as never) as typeof setTimeout,
      log: () => undefined,
    });

    controller.start();
    for (let rendererPid = 1; rendererPid <= 32; rendererPid += 1) {
      controller.rendererUnresponsive(rendererPid);
    }
    controller.rendererResponsive(32);
    controller.rendererUnresponsive(33);
    while (sent.length > 0) {
      sent.shift()!.complete(null);
    }

    expect(sentMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "renderer-responsive", rendererPid: 32 })]),
    );
    expect(sentMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "renderer-unresponsive", rendererPid: 33 })]),
    );
    expect(sentMessages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "renderer-unresponsive", rendererPid: 1 })]),
    );

    controller.stop();

    expect(sent.map(({ message }) => message)).toEqual([expect.objectContaining({ type: "stop" })]);
  });

  it("cleans the old heartbeat once when error and exit are both emitted", () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const child = {
      connected: true,
      once: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener),
      on: () => undefined,
      send: (_message: unknown, callback?: (error: Error | null) => void) => {
        callback?.(null);
        return true;
      },
      disconnect: () => undefined,
      kill: () => true,
    };
    let clears = 0;
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\Synara\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\Synara\\Synara.exe",
      },
      fork: () => child as never,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      clearInterval: (() => {
        clears += 1;
      }) as typeof clearInterval,
      setTimeout: (() => ({ unref: () => undefined }) as never) as typeof setTimeout,
      log: () => undefined,
    });

    controller.start();
    listeners.get("error")?.(new Error("lost IPC"));
    listeners.get("exit")?.(1, null);

    expect(clears).toBe(1);
  });

  it("cleans injected heartbeat and stop timeout handles during shutdown", () => {
    const child = {
      connected: true,
      once: () => undefined,
      on: () => undefined,
      send: (_message: unknown, callback?: (error: Error | null) => void) => {
        callback?.(null);
        return true;
      },
      disconnect: () => undefined,
      kill: () => true,
    };
    let intervalClears = 0;
    let timeoutClears = 0;
    const controller = new DesktopHangWatchdogController({
      enabled: true,
      execPath: "C:\\Synara\\Synara.exe",
      config: {
        diagnosticsDir: "C:\\diagnostics",
        mainPid: 1,
        runId: "run",
        appVersion: "0.7.1",
        electronVersion: "40",
        commit: null,
        mode: "triage",
        runStartedAtMs: 1_000,
        executablePath: "C:\\Synara\\Synara.exe",
      },
      fork: () => child as never,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      clearInterval: (() => {
        intervalClears += 1;
      }) as typeof clearInterval,
      setTimeout: (() => ({ unref: () => undefined }) as never) as typeof setTimeout,
      clearTimeout: (() => {
        timeoutClears += 1;
      }) as typeof clearTimeout,
      log: () => undefined,
    });

    controller.start();
    controller.stop();

    expect(intervalClears).toBe(1);
    expect(timeoutClears).toBe(1);
  });
});
