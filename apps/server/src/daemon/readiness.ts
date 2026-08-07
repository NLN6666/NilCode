// FILE: readiness.ts
// Purpose: Daemon readiness probes — log-pattern matching over a bounded window and
//          TCP port reachability.
// Layer: Daemon infrastructure
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.
//
// The pattern comes from the model and cannot be audited, so it only ever runs against
// a bounded buffer of recent output — never against the whole history, and never once
// per byte of a flooding server. That bound is what keeps a pathological pattern from
// turning into a stalled event loop.

import { createConnection } from "node:net";

import type { DaemonReadyCondition, DaemonReadySpec } from "@synara/contracts";

/** How much recent output the log pattern is matched against. */
export const READINESS_BUFFER_BYTES = 64 * 1_024;

export const DEFAULT_READINESS_HOST = "127.0.0.1";

export interface ReadinessTracker {
  feedOutput(chunk: string): void;
  markPortReady(): void;
  readonly isReady: boolean;
  readonly pending: readonly DaemonReadyCondition[];
  /** Exposed so tests can prove the scan window stays bounded. */
  readonly bufferedBytes: number;
}

export function createReadinessTracker(spec: DaemonReadySpec | null): ReadinessTracker {
  const wantsLog = typeof spec?.log === "string" && spec.log.length > 0;
  const wantsPort = typeof spec?.port === "number";

  const pattern = wantsLog ? compilePattern(spec.log as string) : null;
  // A pattern that will not compile can never be satisfied. Reporting it as pending
  // forever is deliberate: silently treating the daemon as ready would hand the agent
  // a "started successfully" it has no basis for.
  let logReady = !wantsLog;
  let portReady = !wantsPort;
  let buffer = "";

  return {
    feedOutput(chunk: string): void {
      if (logReady || pattern === null) return;

      buffer += chunk;
      if (buffer.length > READINESS_BUFFER_BYTES) {
        buffer = buffer.slice(-READINESS_BUFFER_BYTES);
      }
      if (pattern.test(buffer)) {
        logReady = true;
        buffer = "";
      }
    },

    markPortReady(): void {
      portReady = true;
    },

    get isReady(): boolean {
      return logReady && portReady;
    },

    get pending(): readonly DaemonReadyCondition[] {
      const unmet: DaemonReadyCondition[] = [];
      if (!logReady) unmet.push("log");
      if (!portReady) unmet.push("port");
      return unmet;
    },

    get bufferedBytes(): number {
      return buffer.length;
    },
  };
}

function compilePattern(source: string): RegExp | null {
  try {
    return new RegExp(source, "u");
  } catch {
    return null;
  }
}

/**
 * Probe whether something is accepting connections on a port.
 *
 * The timeout is armed explicitly rather than left to the OS: a filtered port drops
 * SYN packets instead of refusing them, so the default connect timeout runs into
 * minutes and would stall the readiness loop well past the daemon's own deadline.
 */
export function connectPort(input: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    const socket = createConnection({ host: input.host, port: input.port });
    socket.setTimeout(input.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
