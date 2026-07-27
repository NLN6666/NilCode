// FILE: previewReadiness.ts
// Purpose: Wait for a declared preview port to start serving, so preview opens on a
//          live page instead of a connection error.
// Layer: Web runtime utility
//
// The port comes from `.nilcode/launch.json` rather than from port sniffing:
// `localServerMonitor` discovers listeners via `lsof`, which is unavailable on
// Windows, so a declared port is the only portable readiness signal.

export const PREVIEW_URL_HOST = "localhost";
const DEFAULT_POLL_INTERVAL_MS = 400;
const DEFAULT_TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 2_000;

export function previewUrlForPort(port: number): string {
  return `http://${PREVIEW_URL_HOST}:${port}`;
}

/**
 * A dev server that is up answers; one that is not refuses the connection. The
 * request is `no-cors` because the response body is irrelevant — only whether
 * the socket accepted at all — and an opaque response keeps the probe from
 * needing CORS headers the dev server has no reason to send.
 */
async function probeOnce(url: string, signal: AbortSignal): Promise<boolean> {
  const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: probeSignal });
    return true;
  } catch {
    return false;
  }
}

export interface WaitForPreviewOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly probe?: (url: string, signal: AbortSignal) => Promise<boolean>;
  readonly now?: () => number;
  readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function defaultDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Poll until the URL answers, the deadline passes, or the caller aborts.
 * Resolves `true` only when the server actually responded.
 */
export async function waitForPreviewReady(
  url: string,
  options: WaitForPreviewOptions = {},
): Promise<boolean> {
  const signal = options.signal ?? new AbortController().signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const probe = options.probe ?? probeOnce;
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? defaultDelay;
  const deadline = now() + timeoutMs;

  while (!signal.aborted) {
    if (await probe(url, signal)) {
      return true;
    }
    if (signal.aborted || now() + pollIntervalMs > deadline) {
      return false;
    }
    await delay(pollIntervalMs, signal);
  }
  return false;
}
