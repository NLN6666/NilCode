// FILE: desktopHangWatchdog.ts
// Purpose: Keeps Windows hang diagnostics outside Electron's main event loop.
// Layer: Desktop process supervision

import type { ChildProcess } from "node:child_process";
import { fork as defaultFork } from "node:child_process";
import path from "node:path";

import { resolveWindowsSystemRoot } from "@synara/shared/windowsProcess";

export const DESKTOP_HANG_HEARTBEAT_INTERVAL_MS = 1_000;
export const DESKTOP_HANG_THRESHOLD_MS = 6_000;
const WATCHDOG_MAX_RESTARTS = 3;
const WATCHDOG_RESTART_WINDOW_MS = 60_000;

export type HangDumpMode = "triage" | "full";
export type HangTargetKind = "main" | "renderer";

export interface HangWatchdogConfiguration {
  readonly type: "configure";
  readonly diagnosticsDir: string;
  readonly mainPid: number;
  readonly runId: string;
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly commit: string | null;
  readonly mode: HangDumpMode;
  readonly runStartedAtMs: number;
  readonly executablePath: string;
}

export interface HangWatchdogHeartbeat {
  readonly type: "heartbeat";
  readonly sentAtMs: number;
  readonly backendPid: number | null;
  readonly rendererPid: number | null;
}

export type HangWatchdogMessage =
  | HangWatchdogConfiguration
  | HangWatchdogHeartbeat
  | { readonly type: "renderer-unresponsive"; readonly rendererPid: number; readonly sentAtMs: number }
  | { readonly type: "renderer-responsive"; readonly rendererPid: number }
  | { readonly type: "stop" };

export type HangWatchdogDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "reset-after-suspend" }
  | {
      readonly kind: "capture";
      readonly target: { readonly kind: HangTargetKind; readonly pid?: number };
      readonly lastHeartbeatAtMs: number | null;
      readonly detectedAtMs: number;
    };

function isPositivePid(value: number | null | undefined): value is number {
  return Number.isInteger(value) && value > 0;
}

export function getRendererOsProcessId(webContents: { getOSProcessId(): number }): number {
  return webContents.getOSProcessId();
}

/** Pure incident gate. It intentionally knows no IPC, files, or Electron details. */
export class HangWatchdogPolicy {
  private lastHeartbeatAtMs: number | null = null;
  private lastTickAtMs: number | null = null;
  private mainCaptured = false;
  private readonly unresponsiveRenderers = new Set<number>();

  recordHeartbeat(input: { readonly nowMs: number; readonly rendererPid?: number | null }): void {
    this.lastHeartbeatAtMs = input.nowMs;
    this.mainCaptured = false;
  }

  tick(nowMs: number): HangWatchdogDecision {
    const previousTick = this.lastTickAtMs;
    this.lastTickAtMs = nowMs;
    if (previousTick !== null && nowMs - previousTick > DESKTOP_HANG_THRESHOLD_MS) {
      this.lastHeartbeatAtMs = nowMs;
      this.mainCaptured = false;
      return { kind: "reset-after-suspend" };
    }
    if (
      this.lastHeartbeatAtMs === null ||
      this.mainCaptured ||
      nowMs - this.lastHeartbeatAtMs < DESKTOP_HANG_THRESHOLD_MS
    ) {
      return { kind: "wait" };
    }

    this.mainCaptured = true;
    return {
      kind: "capture",
      target: { kind: "main" },
      lastHeartbeatAtMs: this.lastHeartbeatAtMs,
      detectedAtMs: nowMs,
    };
  }

  rendererUnresponsive(input: {
    readonly nowMs: number;
    readonly rendererPid: number;
  }): HangWatchdogDecision {
    if (!isPositivePid(input.rendererPid) || this.unresponsiveRenderers.has(input.rendererPid)) {
      return { kind: "wait" };
    }
    this.unresponsiveRenderers.add(input.rendererPid);
    return {
      kind: "capture",
      target: { kind: "renderer", pid: input.rendererPid },
      lastHeartbeatAtMs: this.lastHeartbeatAtMs,
      detectedAtMs: input.nowMs,
    };
  }

  rendererResponsive(rendererPid: number): void {
    this.unresponsiveRenderers.delete(rendererPid);
  }
}

type ForkedWatchdog = Pick<ChildProcess, "connected" | "disconnect" | "kill" | "once" | "on" | "send">;

export interface DesktopHangWatchdogControllerOptions {
  readonly enabled: boolean;
  readonly config: Omit<HangWatchdogConfiguration, "type">;
  readonly execPath: string;
  readonly watchdogEntryPath?: string;
  readonly systemRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  readonly fork?: (
    modulePath: string,
    args: string[],
    options: Parameters<typeof defaultFork>[2],
  ) => ForkedWatchdog;
  readonly log: (message: string) => void;
}

type RendererControlMessage = Extract<
  HangWatchdogMessage,
  { readonly type: "renderer-unresponsive" } | { readonly type: "renderer-responsive" }
>;
type PriorityControlMessage = HangWatchdogConfiguration | { readonly type: "stop" };
const MAX_PENDING_RENDERER_STATES = 32;

export class DesktopHangWatchdogController {
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly forkFn: NonNullable<DesktopHangWatchdogControllerOptions["fork"]>;
  private child: ForkedWatchdog | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private sendInFlight = false;
  private stopping = false;
  private stopPending = false;
  private rendererPid: number | null = null;
  private backendPid: number | null = null;
  private restartTimes: number[] = [];
  private pendingHeartbeat: HangWatchdogHeartbeat | null = null;
  private pendingControls: PriorityControlMessage[] = [];
  private pendingRendererStates = new Map<number, RendererControlMessage>();

  constructor(private readonly options: DesktopHangWatchdogControllerOptions) {
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setInterval ?? setInterval;
    this.clearIntervalFn = options.clearInterval ?? clearInterval;
    this.setTimeoutFn = options.setTimeout ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeout ?? clearTimeout;
    this.forkFn = options.fork ?? defaultFork;
  }

  start(): void {
    if (!this.options.enabled || this.stopping || this.child) return;
    let child: ForkedWatchdog | null = null;
    try {
      child = this.forkFn(
        this.options.watchdogEntryPath ?? path.join(__dirname, "desktopHangWatchdogProcess.js"),
        [],
        {
          execPath: this.options.execPath,
          env: this.watchdogEnvironment(),
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
        },
      );
      this.child = child;
      child.once("error", (error) => {
        this.handleChildFailure(child, "failed: " + error.message);
      });
      child.once("exit", (code, signal) => {
        this.handleChildFailure(child, "exited code=" + (code ?? "null") + " signal=" + (signal ?? "null"));
      });
      child.once("close", (code, signal) => {
        this.handleChildFailure(child, "closed code=" + (code ?? "null") + " signal=" + (signal ?? "null"));
      });
      child.once("disconnect", () => {
        this.handleChildFailure(child, "disconnected");
      });
      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const record = message as Record<string, unknown>;
        if (
          record.type !== "capture-result" ||
          (record.result !== "captured" && record.result !== "failed") ||
          (record.target !== "main" && record.target !== "renderer") ||
          !isPositivePid(typeof record.pid === "number" ? record.pid : 0)
        ) {
          return;
        }
        this.options.log(
          "hang watchdog capture result target=" +
            record.target +
            " pid=" +
            record.pid +
            " result=" +
            record.result,
        );
      });
      this.send({ type: "configure", ...this.options.config });
      this.heartbeatTimer = this.setIntervalFn(() => this.sendHeartbeat(), DESKTOP_HANG_HEARTBEAT_INTERVAL_MS);
      this.heartbeatTimer.unref?.();
      this.sendHeartbeat();
    } catch (error) {
      this.options.log("hang watchdog start failed: " + (error instanceof Error ? error.message : String(error)));
      if (child && this.child === child) {
        this.handleChildFailure(child, "start setup failed");
      } else if (!this.stopping) {
        this.scheduleRestart();
      }
    }
  }

  updateRendererPid(rendererPid: number | null): void {
    this.rendererPid = isPositivePid(rendererPid) ? rendererPid : null;
  }

  updateBackendPid(backendPid: number | null): void {
    this.backendPid = isPositivePid(backendPid) ? backendPid : null;
  }

  rendererUnresponsive(rendererPid: number): void {
    if (isPositivePid(rendererPid)) {
      this.send({ type: "renderer-unresponsive", rendererPid, sentAtMs: this.now() });
    }
  }

  rendererResponsive(rendererPid: number): void {
    if (isPositivePid(rendererPid)) {
      this.send({ type: "renderer-responsive", rendererPid });
    }
  }

  stop(): void {
    this.stopping = true;
    this.clearHeartbeatTimer();
    this.clearRestartTimer();
    const child = this.child;
    this.pendingHeartbeat = null;
    this.pendingControls = [];
    this.pendingRendererStates.clear();
    if (!child) {
      this.clearStopTimer();
      return;
    }
    this.stopPending = true;
    this.stopTimer = this.setTimeoutFn(() => this.finishStop(child), DESKTOP_HANG_HEARTBEAT_INTERVAL_MS);
    this.stopTimer.unref?.();
    this.send({ type: "stop" });
  }

  private sendHeartbeat(): void {
    this.send({
      type: "heartbeat",
      sentAtMs: this.now(),
      rendererPid: this.rendererPid,
      backendPid: this.backendPid,
    });
  }

  private send(message: HangWatchdogMessage): void {
    if (message.type === "heartbeat") {
      this.pendingHeartbeat = message;
    } else {
      this.enqueueControl(message);
    }
    this.drain();
  }

  private drain(): void {
    const child = this.child;
    if (!child || this.sendInFlight) return;
    if (!child.connected) {
      this.handleChildFailure(child, "IPC disconnected");
      return;
    }
    const message = this.pendingControls.shift() ?? this.takePendingRendererState() ?? this.pendingHeartbeat;
    if (!message) {
      if (this.stopPending) this.finishStop(child);
      return;
    }
    if (message.type === "heartbeat") this.pendingHeartbeat = null;
    this.sendInFlight = true;
    try {
      child.send(message, (error) => {
        if (this.child !== child) return;
        this.sendInFlight = false;
        if (error && !this.stopping) {
          this.options.log("hang watchdog IPC failed: " + error.message);
          this.handleChildFailure(child, "IPC failed");
          return;
        }
        this.drain();
      });
    } catch (error) {
      this.sendInFlight = false;
      if (!this.stopping) {
        this.options.log("hang watchdog IPC failed: " + (error instanceof Error ? error.message : String(error)));
        this.handleChildFailure(child, "IPC threw");
      } else {
        this.finishStop(child);
      }
    }
  }

  private enqueueControl(message: Exclude<HangWatchdogMessage, HangWatchdogHeartbeat>): void {
    if (message.type === "configure") {
      const existing = this.pendingControls.findIndex((candidate) => candidate.type === "configure");
      if (existing >= 0) this.pendingControls.splice(existing, 1);
      this.pendingControls.unshift(message);
    } else if (message.type === "stop") {
      this.pendingControls = [message];
      this.pendingRendererStates.clear();
    } else {
      const refreshedExistingState = this.pendingRendererStates.delete(message.rendererPid);
      if (!refreshedExistingState && this.pendingRendererStates.size >= MAX_PENDING_RENDERER_STATES) {
        const oldestRendererPid = this.pendingRendererStates.keys().next().value;
        if (oldestRendererPid !== undefined) {
          this.pendingRendererStates.delete(oldestRendererPid);
          this.options.log("hang watchdog renderer state queue is full; evicting the oldest pending renderer state");
        }
      }
      this.pendingRendererStates.set(message.rendererPid, message);
    }
  }

  private takePendingRendererState(): RendererControlMessage | null {
    const next = this.pendingRendererStates.entries().next();
    if (next.done) return null;
    const [rendererPid, message] = next.value;
    this.pendingRendererStates.delete(rendererPid);
    return message;
  }

  private handleChildFailure(child: ForkedWatchdog, detail: string): void {
    if (this.child !== child) return;
    this.child = null;
    this.sendInFlight = false;
    this.pendingHeartbeat = null;
    this.pendingControls = [];
    this.pendingRendererStates.clear();
    this.clearHeartbeatTimer();
    if (this.stopping) {
      this.finishStop(child);
      return;
    }
    this.options.log("hang watchdog " + detail);
    this.scheduleRestart();
  }

  private finishStop(child: ForkedWatchdog): void {
    this.clearStopTimer();
    this.stopPending = false;
    if (this.child === child) {
      this.child = null;
      this.sendInFlight = false;
    }
    try {
      if (child.connected) child.disconnect();
      child.kill();
    } catch {
      // The process may already have exited; diagnosis must remain fail-open.
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      this.clearIntervalFn(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      this.clearTimeoutFn(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) {
      this.clearTimeoutFn(this.stopTimer);
      this.stopTimer = null;
    }
  }

  private watchdogEnvironment(): NodeJS.ProcessEnv {
    const env = this.options.env ?? process.env;
    const actualSystemRoot = this.options.systemRoot?.trim() || env.SystemRoot?.trim() || env.SYSTEMROOT?.trim();
    const childEnv: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
    if (actualSystemRoot) {
      childEnv.SystemRoot = resolveWindowsSystemRoot({ SystemRoot: actualSystemRoot });
    }
    if (env.TEMP?.trim()) childEnv.TEMP = env.TEMP;
    if (env.TMP?.trim()) childEnv.TMP = env.TMP;
    return childEnv;
  }

  private scheduleRestart(): void {
    const now = this.now();
    this.restartTimes = this.restartTimes.filter((time) => now - time < WATCHDOG_RESTART_WINDOW_MS);
    if (this.restartTimes.length >= WATCHDOG_MAX_RESTARTS || this.restartTimer) {
      if (this.restartTimes.length >= WATCHDOG_MAX_RESTARTS) {
        this.options.log("hang watchdog restart budget exhausted");
      }
      return;
    }
    this.restartTimes.push(now);
    this.restartTimer = this.setTimeoutFn(() => {
      this.restartTimer = null;
      this.start();
    }, DESKTOP_HANG_HEARTBEAT_INTERVAL_MS);
    this.restartTimer.unref?.();
  }
}
