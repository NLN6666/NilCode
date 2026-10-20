import { describe, expect, it } from "vitest";

import {
  deriveToolFailureSummary,
  deriveWorkLogToolDetails,
  mergeWorkLogToolDetails,
} from "./toolCallDetails";

describe("deriveWorkLogToolDetails for tool calls", () => {
  it("builds details for an MCP tool call from its arguments and result", () => {
    const details = deriveWorkLogToolDetails({
      payload: {
        data: {
          input: { query: "composer chip", repo_path: "D:/Codes/NilCode" },
          result: { output: "apps/web/src/components/chat/InlineMcpToolChip.tsx" },
        },
      },
      itemType: "mcp_tool_call",
      label: "lcc:search_code",
    });

    expect(details?.kind).toBe("tool");
    expect(details?.arguments).toContain('"query": "composer chip"');
    expect(details?.output?.output).toBe("apps/web/src/components/chat/InlineMcpToolChip.tsx");
  });

  it("covers dynamic and collab agent tool calls too", () => {
    for (const itemType of ["dynamic_tool_call", "collab_agent_tool_call"] as const) {
      const details = deriveWorkLogToolDetails({
        payload: { data: { arguments: { path: "README.md" } } },
        itemType,
        label: "some_tool",
      });

      expect(details?.kind).toBe("tool");
    }
  });

  it("takes an already-serialized argument string as-is", () => {
    const details = deriveWorkLogToolDetails({
      payload: { data: { input: '{"query":"already serialized"}' } },
      itemType: "mcp_tool_call",
      label: "lcc:search_code",
    });

    expect(details?.arguments).toBe('{"query":"already serialized"}');
  });

  it("reports the ingestion truncation marker so the row can say the result is clipped", () => {
    const details = deriveWorkLogToolDetails({
      payload: { data: { result: { output: "first 2000 chars" }, __synaraTruncated: true } },
      itemType: "mcp_tool_call",
      label: "ida-pro-mcp:decompile",
    });

    expect(details?.output?.truncated).toBe(true);
  });

  it("returns nothing when a tool call carries neither arguments nor a result", () => {
    expect(
      deriveWorkLogToolDetails({
        payload: { data: {} },
        itemType: "mcp_tool_call",
        label: "lcc:search_code",
      }),
    ).toBeUndefined();
  });

  it("does not divert a shell command into the tool branch", () => {
    const details = deriveWorkLogToolDetails({
      payload: { data: { rawOutput: { stdout: "ok" } } },
      itemType: "command_execution",
      command: "bun run test",
      label: "bun run test",
    });

    expect(details?.kind).toBe("command");
  });
});

describe("mergeWorkLogToolDetails for tool calls", () => {
  it("keeps the arguments from tool.started when tool.completed brings the result", () => {
    // The two lifecycle events derive separate details; only the merge sees both.
    const started = deriveWorkLogToolDetails({
      payload: { data: { input: { query: "composer chip" } } },
      itemType: "mcp_tool_call",
      label: "lcc:search_code",
    });
    const completed = deriveWorkLogToolDetails({
      payload: { data: { result: { output: "one hit" } } },
      itemType: "mcp_tool_call",
      label: "lcc:search_code",
    });

    const merged = mergeWorkLogToolDetails(started, completed);

    expect(merged?.arguments).toContain('"query": "composer chip"');
    expect(merged?.output?.output).toBe("one hit");
  });
});

describe("deriveToolFailureSummary", () => {
  it("reads Claude's leading exit code and skips it for the excerpt", () => {
    expect(
      deriveToolFailureSummary({
        kind: "command",
        title: "Command run",
        output: {
          output:
            "Exit code 2\nugrep: warning: missing.txt: No such file or directory\n1:def add(a, b):",
        },
      }),
    ).toEqual({
      exitCode: 2,
      excerpt: "ugrep: warning: missing.txt: No such file or directory",
    });
  });

  it("prefers a structured exit code and stderr", () => {
    expect(
      deriveToolFailureSummary({
        kind: "command",
        title: "Command run",
        output: { stdout: "partial", stderr: "\nzsh: command not found: rg\n", exitCode: 127 },
      }),
    ).toEqual({ exitCode: 127, excerpt: "zsh: command not found: rg" });
  });

  it("reports nothing when the call carried no output", () => {
    expect(deriveToolFailureSummary(undefined)).toEqual({ exitCode: null, excerpt: null });
  });
});

describe("tool output exit-code suffixes", () => {
  it("preserves a large whitespace run inside raw output", () => {
    const stdout = `start${" ".repeat(23_980)}end`;
    const details = deriveWorkLogToolDetails({
      label: "Command",
      command: "run",
      payload: { data: { rawOutput: { stdout } } },
    });
    expect(details?.output).toEqual({ stdout });
  });

  it.each([
    ["  output\n", "  output\n", undefined],
    ["  output\n <exited with exit code 2>\n", "  output", 2],
    ["\toutput\r\n<EXITED WITH EXIT CODE 000>\t", "\toutput", 0],
    ["<exited with exit code 1>", undefined, 1],
    ["<exited with exit code -1>", "<exited with exit code -1>", undefined],
    ["<exited with exit code 1> later", "<exited with exit code 1> later", undefined],
    ["<exited with exit code 1>\n<exited with exit code 2>", "<exited with exit code 1>", 2],
    ["\n\t", undefined, undefined],
  ])("preserves raw stdout and parses only the final suffix: %j", (stdout, output, exitCode) => {
    const details = deriveWorkLogToolDetails({
      label: "Command",
      command: "run",
      detail: stdout,
      payload: { data: { rawOutput: { stdout } } },
    });
    expect(details?.output?.stdout).toBe(output);
    expect(details?.output?.exitCode).toBe(exitCode);
  });
});
