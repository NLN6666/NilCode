// FILE: daemonRestart.ts
// Purpose: Exponential backoff schedule for daemon restart policies.
// Layer: Shared runtime utility
// Exports: restartDelayMs, RESTART_BASE_DELAY_MS, RESTART_MAX_DELAY_MS.
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.

export const RESTART_BASE_DELAY_MS = 500;
export const RESTART_MAX_DELAY_MS = 30_000;

/** Beyond this the delay has long since saturated; clamping keeps the shift finite. */
const MAX_BACKOFF_EXPONENT = 20;

/**
 * Delay before relaunching a daemon that has failed `consecutiveFailures` times in a
 * row.
 *
 * The exponent is clamped before the shift rather than after: a crash loop that runs
 * for hours would otherwise reach `2 ** 1000` — `Infinity` — and arm a timer that
 * never fires, leaving the daemon stuck in `restarting` forever.
 */
export function restartDelayMs(consecutiveFailures: number): number {
  const failures = Math.max(1, Math.floor(consecutiveFailures));
  const exponent = Math.min(failures - 1, MAX_BACKOFF_EXPONENT);
  return Math.min(RESTART_BASE_DELAY_MS * 2 ** exponent, RESTART_MAX_DELAY_MS);
}
