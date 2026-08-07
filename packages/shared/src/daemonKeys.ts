// FILE: daemonKeys.ts
// Purpose: Terminal key-name table and process-signal whitelist for daemon input.
// Layer: Shared runtime utility
// Exports: resolveTerminalKey, TERMINAL_KEY_NAMES, isAllowedSignal, AllowedSignal.
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md. The `keys`/`signal`
// split on the send operation follows that project: writing Ctrl+C into a PTY goes
// through the terminal line discipline, while a signal is delivered straight to the
// process. A stateful server can react to those differently, so they stay separate.

const TERMINAL_KEYS: Readonly<Record<string, string>> = {
  CTRL_A: "\x01",
  CTRL_B: "\x02",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_E: "\x05",
  CTRL_L: "\x0c",
  CTRL_U: "\x15",
  CTRL_Z: "\x1a",
  ENTER: "\r",
  TAB: "\t",
  BACKSPACE: "\x7f",
  ESC: "\x1b",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  LEFT: "\x1b[D",
  HOME: "\x1b[H",
  END: "\x1b[F",
  PAGE_UP: "\x1b[5~",
  PAGE_DOWN: "\x1b[6~",
  DELETE: "\x1b[3~",
};

export const TERMINAL_KEY_NAMES: readonly string[] = Object.keys(TERMINAL_KEYS);

/**
 * Resolve a key name to the bytes a terminal would send.
 *
 * Unknown names return null and are never passed through as literal text: the name
 * comes from the model, and a passthrough would turn this whitelist into an
 * arbitrary-byte injection channel into a live server's stdin.
 */
export function resolveTerminalKey(name: string): string | null {
  return TERMINAL_KEYS[name.trim().toUpperCase()] ?? null;
}

const ALLOWED_SIGNALS = ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP"] as const;

export type AllowedSignal = (typeof ALLOWED_SIGNALS)[number];

export const ALLOWED_SIGNAL_NAMES: readonly AllowedSignal[] = ALLOWED_SIGNALS;

/**
 * Signals a daemon may be sent. Deliberately narrow: `SIGSTOP` and friends can wedge
 * a process in a state the broker cannot recover it from, which would strand a
 * daemon the agent can no longer stop or restart.
 */
export function isAllowedSignal(name: string): name is AllowedSignal {
  return (ALLOWED_SIGNALS as readonly string[]).includes(name.trim().toUpperCase());
}
