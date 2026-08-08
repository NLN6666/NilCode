// FILE: shellBackgrounding.ts
// Purpose: Recognise a shell call that backgrounds a process, so the host can say
//          out loud what the harness policy can only ask for in prose.
// Layer: Daemon infrastructure
// Depends on: nothing.
// Exports: ShellBackgroundingMechanism, detectShellBackgrounding, shellBackgroundingGuidance.
//
// See findings.md #16. The rule "long-running services go through synara_*_daemon" lived
// only in the system prompt, competing with the provider's own backgrounding affordances,
// and nothing observed a violation — so a PowerShell-launched server was invisible in the
// services panel with no signal to anyone that a rule had been bypassed. Detection here is
// deliberately advisory: it cannot know a command's lifetime, so it reports the mechanism
// and lets the agent decide, rather than blocking work on a guess.

export type ShellBackgroundingMechanism =
  | "run-in-background-flag"
  | "posix-ampersand"
  | "nohup"
  | "setsid"
  | "cmd-start"
  | "powershell-start-process"
  | "powershell-start-job";

export interface ShellBackgroundingInput {
  readonly command: string;
  /** The provider tool's own background flag, which needs no shell syntax to spot. */
  readonly runInBackground?: boolean;
}

// Word-bounded so an unrelated `nohuptest.sh` or `restart /build` stays quiet: a notice
// that fires on ordinary calls is one the agent learns to skip past.
const COMMAND_MECHANISMS: ReadonlyArray<readonly [RegExp, ShellBackgroundingMechanism]> = [
  [/\bstart-process\b/i, "powershell-start-process"],
  [/\bstart-job\b/i, "powershell-start-job"],
  [/\bnohup\b/i, "nohup"],
  [/\bsetsid\b/i, "setsid"],
  [/\bstart\s+\/b\b/i, "cmd-start"],
  // A trailing `&` only. `a && b` is sequencing, not backgrounding.
  [/(^|[^&])&\s*$/, "posix-ampersand"],
];

export function detectShellBackgrounding(
  input: ShellBackgroundingInput,
): ShellBackgroundingMechanism | null {
  if (input.runInBackground === true) return "run-in-background-flag";
  for (const [pattern, mechanism] of COMMAND_MECHANISMS) {
    if (pattern.test(input.command)) return mechanism;
  }
  return null;
}

/**
 * The notice handed back to the agent at the moment it reaches for the wrong tool.
 *
 * Phrased as a condition rather than a verdict. Detection sees syntax, not lifetime, so a
 * legitimate short-lived background command must be able to read this and move on without
 * arguing — otherwise the false positives cost more trust than the true positives buy.
 */
export function shellBackgroundingGuidance(mechanism: ShellBackgroundingMechanism): string {
  return [
    `Synara host notice: this call backgrounds a process (${mechanism}).`,
    "If this process must outlive the current turn — a game server, dev server, database, or anything the user keeps using afterwards — start it with synara_start_daemon instead.",
    "A shell-backgrounded process is a child of this session's process tree, so it dies when the session tears down, and it never appears in Synara's background services panel: the user can neither watch its log nor stop it.",
    "If it is short-lived and the user will not need it after this turn, ignore this notice and continue.",
  ].join(" ");
}
