// FILE: claudeShellBackgroundingNotice.ts
// Purpose: Turn a Claude PreToolUse hook call into the host's backgrounding notice.
// Layer: Provider adapter support
// Depends on: Claude Agent SDK hook types, daemon shell-backgrounding detection.
// Exports: claudeShellBackgroundingNotice.
//
// The SDK's PreToolUse hook is the one channel that reaches the agent at the moment it
// reaches for the wrong tool, which is why the steer lives here rather than as more prose
// in the system prompt: prompt text is read once at session start and competes with the
// provider's own backgrounding affordances, while this arrives with the offending command
// in hand. See findings.md #16.

import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

import {
  detectShellBackgrounding,
  shellBackgroundingGuidance,
} from "../daemon/shellBackgrounding.ts";

// Only the shell tool. Scanning every tool's input would fire on the very docs and tests
// that describe this rule, and a notice that cries wolf gets tuned out.
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set(["Bash"]);

/**
 * The notice to hand back for one tool call, or null to stay silent.
 *
 * Fires on every tool call in the session, so the quiet path stays trivial and nothing here
 * may throw: an unrecognised tool input is a reason to return null, not to fail the call.
 */
export function claudeShellBackgroundingNotice(hookInput: HookInput): string | null {
  if (hookInput.hook_event_name !== "PreToolUse") return null;
  if (!SHELL_TOOL_NAMES.has(hookInput.tool_name)) return null;

  const toolInput = hookInput.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return null;

  const { command, run_in_background: runInBackground } = toolInput as Record<string, unknown>;
  if (typeof command !== "string") return null;

  const mechanism = detectShellBackgrounding({
    command,
    ...(runInBackground === true ? { runInBackground: true } : {}),
  });
  return mechanism === null ? null : shellBackgroundingGuidance(mechanism);
}
