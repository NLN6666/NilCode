// FILE: desktopHangWatchdogProcess.ts
// Purpose: Independent run-as-node watchdog entrypoint for Windows Electron hangs.
// Layer: Desktop diagnostics helper process

import {
  DESKTOP_HANG_HEARTBEAT_INTERVAL_MS,
  HangWatchdogPolicy,
  type HangWatchdogConfiguration,
  type HangWatchdogMessage,
} from "./desktopHangWatchdog";
import {
  writeWindowsHangDump,
  type WindowsHangDumpRequest,
  type WindowsHangDumpResult,
} from "./windowsHangDump";

type ParentChannel = {
  readonly connected: boolean;
  on(event: "message" | "disconnect", listener: (message?: unknown) => void): unknown;
  send(message: Record<string, unknown>): boolean;
  disconnect?(): void;
};

export interface DesktopHangWatchdogRuntimeOptions {
  readonly parent: ParentChannel;
  readonly now?: () => number;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
  readonly exit?: (code?: number) => never | void;
  readonly writeDump?: (request: WindowsHangDumpRequest) => Promise<WindowsHangDumpResult>;
}

export interface DesktopHangWatchdogRuntime {
  start(): void;
  stop(): void;
}

export function createDesktopHangWatchdogRuntime(
  options: DesktopHangWatchdogRuntimeOptions,
): DesktopHangWatchdogRuntime {
  const now = options.now ?? Date.now;
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;
  const exit = options.exit ?? process.exit;
  const writeDump = options.writeDump ?? writeWindowsHangDump;
  const policy = new HangWatchdogPolicy();
  let configuration: HangWatchdogConfiguration | null = null;
  let rendererPid: number | null = null;
  let backendPid: number | null = null;
  let captureSequence = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const sendResult = (message: Record<string, unknown>): void => {
    if (!options.parent.connected || stopped) return;
    try {
      options.parent.send(message);
    } catch {
      // Parent loss must leave the watchdog harmless and self-terminating.
    }
  };

  const capture = (decision: ReturnType<HangWatchdogPolicy["tick"]>): void => {
    if (decision.kind !== "capture" || !configuration || stopped) return;
    const targetPid = decision.target.kind === "main" ? configuration.mainPid : decision.target.pid;
    if (!targetPid) return;
    const incidentId = now() + "-" + decision.target.kind + "-" + ++captureSequence;
    void writeDump({
      diagnosticsDir: configuration.diagnosticsDir,
      incidentId,
      target: { kind: decision.target.kind, pid: targetPid },
      runId: configuration.runId,
      appVersion: configuration.appVersion,
      electronVersion: configuration.electronVersion,
      commit: configuration.commit,
      mainPid: configuration.mainPid,
      rendererPid,
      backendPid,
      lastHeartbeatAtMs: decision.lastHeartbeatAtMs,
      detectedAtMs: decision.detectedAtMs,
      mode: configuration.mode,
      runStartedAtMs: configuration.runStartedAtMs,
      executablePath: configuration.executablePath,
    })
      .then((result) => {
        sendResult({
          type: "capture-result",
          target: decision.target.kind,
          pid: targetPid,
          result: result.captureResult,
          metadataPath: result.metadataPath,
          error: result.error,
        });
      })
      .catch(() => undefined);
  };

  const handleMessage = (message: unknown): void => {
    if (!message || typeof message !== "object" || stopped) return;
    const typedMessage = message as HangWatchdogMessage;
    switch (typedMessage.type) {
      case "configure":
        configuration = typedMessage;
        return;
      case "heartbeat":
        rendererPid = typedMessage.rendererPid;
        backendPid = typedMessage.backendPid;
        policy.recordHeartbeat({ nowMs: now(), rendererPid });
        return;
      case "renderer-unresponsive":
        capture(policy.rendererUnresponsive({ nowMs: now(), rendererPid: typedMessage.rendererPid }));
        return;
      case "renderer-responsive":
        policy.rendererResponsive(typedMessage.rendererPid);
        return;
      case "stop":
        stop();
        return;
    }
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
    try {
      options.parent.disconnect?.();
    } catch {
      // A disconnected parent is the normal shutdown path.
    }
    exit(0);
  };

  return {
    start(): void {
      if (stopped || timer !== null) return;
      options.parent.on("message", handleMessage);
      options.parent.on("disconnect", stop);
      timer = setIntervalFn(() => capture(policy.tick(now())), DESKTOP_HANG_HEARTBEAT_INTERVAL_MS);
      timer.unref?.();
    },
    stop,
  };
}

if (process.env.ELECTRON_RUN_AS_NODE === "1" && typeof process.send === "function" && process.connected) {
  createDesktopHangWatchdogRuntime({
    parent: {
      get connected() {
        return process.connected;
      },
      on: (event, listener) => process.on(event, listener),
      send: (message) => process.send?.(message) ?? false,
      disconnect: () => process.disconnect(),
    },
  }).start();
}
