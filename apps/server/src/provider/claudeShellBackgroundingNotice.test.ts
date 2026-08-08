import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import { claudeShellBackgroundingNotice } from "./claudeShellBackgroundingNotice";

const preToolUse = (toolName: string, toolInput: unknown): HookInput =>
  ({
    hook_event_name: "PreToolUse",
    session_id: "s",
    transcript_path: "t",
    cwd: "D:/repo",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "u",
  }) as HookInput;

describe("claudeShellBackgroundingNotice", () => {
  it("notices a PowerShell-backgrounded server", () => {
    const notice = claudeShellBackgroundingNotice(
      preToolUse("Bash", { command: 'powershell -Command "Start-Process java -jar server.jar"' }),
    );

    expect(notice).toContain("synara_start_daemon");
  });

  it("notices the tool's own run_in_background flag", () => {
    const notice = claudeShellBackgroundingNotice(
      preToolUse("Bash", { command: "bun run dev", run_in_background: true }),
    );

    expect(notice).toContain("synara_start_daemon");
  });

  it("stays quiet for a foreground shell command", () => {
    expect(
      claudeShellBackgroundingNotice(preToolUse("Bash", { command: "git status" })),
    ).toBeNull();
  });

  it("stays quiet for a non-shell tool whose input merely mentions backgrounding", () => {
    // Writing documentation about `Start-Process` is not running it; scanning every
    // tool's input would nag on exactly the work that documents this rule.
    expect(
      claudeShellBackgroundingNotice(
        preToolUse("Write", {
          file_path: "docs/services.md",
          content: "Never use Start-Process for a server &",
        }),
      ),
    ).toBeNull();
  });

  it("stays quiet on hook events other than PreToolUse", () => {
    expect(
      claudeShellBackgroundingNotice({
        hook_event_name: "SessionStart",
        session_id: "s",
        transcript_path: "t",
        cwd: "D:/repo",
      } as HookInput),
    ).toBeNull();
  });

  it("tolerates a tool input that is not the shape it expects", () => {
    // The hook fires on every tool call, including tools this build has never seen,
    // so a malformed input must return null rather than throw into the SDK.
    expect(claudeShellBackgroundingNotice(preToolUse("Bash", null))).toBeNull();
    expect(claudeShellBackgroundingNotice(preToolUse("Bash", { command: 42 }))).toBeNull();
  });
});
