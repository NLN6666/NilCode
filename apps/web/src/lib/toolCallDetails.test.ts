import { describe, expect, it } from "vitest";

import { deriveWorkLogToolDetails, mergeWorkLogToolDetails } from "./toolCallDetails";

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
