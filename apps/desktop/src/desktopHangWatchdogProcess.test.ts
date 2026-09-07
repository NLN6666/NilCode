import { describe, expect, it } from "vitest";

import { createDesktopHangWatchdogRuntime } from "./desktopHangWatchdogProcess";

describe("desktop hang watchdog child runtime", () => {
  it("captures configured targets, reports dump failures, and exits cleanly after parent disconnect", async () => {
    const listeners = new Map<string, (message?: unknown) => void>();
    const sent: unknown[] = [];
    let tick: (() => void) | undefined;
    let cleared = 0;
    let exited = 0;
    let now = 1_000;
    const runtime = createDesktopHangWatchdogRuntime({
      parent: {
        connected: true,
        on: (event, listener) => listeners.set(event, listener),
        send: (message) => {
          sent.push(message);
          return true;
        },
      },
      now: () => now,
      setInterval: ((callback: () => void) => {
        tick = callback;
        return { unref: () => undefined } as never;
      }) as typeof setInterval,
      clearInterval: (() => {
        cleared += 1;
      }) as typeof clearInterval,
      exit: () => {
        exited += 1;
      },
      writeDump: async () => ({
        metadataPath: "C:\\diagnostics\\result.json",
        dumpPath: null,
        captureResult: "failed" as const,
        error: "Target process is no longer running.",
      }),
    });

    runtime.start();
    listeners.get("message")?.({
      type: "configure",
      diagnosticsDir: "C:\\diagnostics",
      mainPid: 123,
      runId: "run",
      appVersion: "0.7.1",
      electronVersion: "40",
      commit: null,
      mode: "triage",
      runStartedAtMs: 1_000,
      executablePath: "C:\\Synara\\Synara.exe",
    });
    listeners.get("message")?.({
      type: "heartbeat",
      sentAtMs: 1_000,
      rendererPid: 456,
      backendPid: null,
    });
    now = 7_000;
    tick?.();
    await Promise.resolve();

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "capture-result",
        target: "main",
        pid: 123,
        result: "failed",
      }),
    );

    listeners.get("disconnect")?.();
    expect(cleared).toBe(1);
    expect(exited).toBe(1);
  });

  it("allows a renderer responsive message to rearm that renderer after a capture", async () => {
    const listeners = new Map<string, (message?: unknown) => void>();
    const requests: Array<{ target: { kind: string; pid: number } }> = [];
    let now = 1_000;
    const runtime = createDesktopHangWatchdogRuntime({
      parent: {
        connected: true,
        on: (event, listener) => listeners.set(event, listener),
        send: () => true,
      },
      now: () => now,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      clearInterval: (() => undefined) as typeof clearInterval,
      exit: () => undefined,
      writeDump: async (request) => {
        requests.push(request);
        return {
          metadataPath: "result.json",
          dumpPath: "result.dmp",
          captureResult: "captured" as const,
          error: null,
        };
      },
    });

    runtime.start();
    listeners.get("message")?.({
      type: "configure",
      diagnosticsDir: "C:\\diagnostics",
      mainPid: 123,
      runId: "run",
      appVersion: "0.7.1",
      electronVersion: "40",
      commit: null,
      mode: "triage",
      runStartedAtMs: 1_000,
      executablePath: "C:\\Synara\\Synara.exe",
    });
    listeners.get("message")?.({ type: "renderer-unresponsive", rendererPid: 456, sentAtMs: now });
    listeners.get("message")?.({ type: "renderer-unresponsive", rendererPid: 456, sentAtMs: now });
    listeners.get("message")?.({ type: "renderer-responsive", rendererPid: 456 });
    now += 1;
    listeners.get("message")?.({ type: "renderer-unresponsive", rendererPid: 456, sentAtMs: now });
    await Promise.resolve();

    expect(requests.map((request) => request.target)).toEqual([
      { kind: "renderer", pid: 456 },
      { kind: "renderer", pid: 456 },
    ]);
  });

  it("absorbs a dump writer rejection without terminating the watchdog runtime", async () => {
    const listeners = new Map<string, (message?: unknown) => void>();
    const runtime = createDesktopHangWatchdogRuntime({
      parent: {
        connected: true,
        on: (event, listener) => listeners.set(event, listener),
        send: () => true,
      },
      now: () => 1_000,
      setInterval: (() => ({ unref: () => undefined }) as never) as typeof setInterval,
      clearInterval: (() => undefined) as typeof clearInterval,
      exit: () => undefined,
      writeDump: async () => Promise.reject(new Error("dump writer rejected")),
    });

    runtime.start();
    listeners.get("message")?.({
      type: "configure",
      diagnosticsDir: "C:\\diagnostics",
      mainPid: 123,
      runId: "run",
      appVersion: "0.7.1",
      electronVersion: "40",
      commit: null,
      mode: "triage",
      runStartedAtMs: 1_000,
      executablePath: "C:\\Synara\\Synara.exe",
    });
    listeners.get("message")?.({
      type: "renderer-unresponsive",
      rendererPid: 456,
      sentAtMs: 1_000,
    });
    await Promise.resolve();

    expect(() =>
      listeners.get("message")?.({ type: "renderer-responsive", rendererPid: 456 }),
    ).not.toThrow();
  });
});
