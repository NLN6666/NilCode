// FILE: spawnOptions.ts
// Purpose: Cross-platform spawn options for daemon processes. The single source of
//          the detached decision.
// Layer: Daemon infrastructure
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.
//
// DELIBERATE DIVERGENCE FROM THE SOURCE: oh-my-pi sets `detached: false` on Windows.
// That holds for `Bun.spawn` but not for `node:child_process` — measured on Node v24 /
// Windows 11, a `detached: false` child stops the moment its parent exits, which makes
// the whole detached feature fail *silently*: the daemon appears to start, and then
// vanishes with the server. See findings.md #1.
//
// Everything that decides detachment lives here so that divergence has exactly one
// place to regress, with `spawnOptions.test.ts` watching it.

import type { SpawnOptions } from "node:child_process";

export interface DaemonSpawnOptionsInput {
  /** Whether the daemon must outlive the Synara server process. */
  readonly detached: boolean;
  readonly platform: NodeJS.Platform;
  /** File descriptor of the daemon's log file; receives both stdout and stderr. */
  readonly logFd: number;
}

export function daemonSpawnOptions(input: DaemonSpawnOptionsInput): SpawnOptions {
  return {
    detached: input.detached,
    // Detaching on Windows would otherwise pop a console window; hiding it costs
    // nothing for supervised daemons, so it is unconditional on that platform.
    windowsHide: input.platform === "win32",
    // stdin is discarded: a detached daemon has no stdin channel, and keeping the
    // shape identical for both modes means one code path writes the log file.
    stdio: ["ignore", input.logFd, input.logFd],
  };
}
