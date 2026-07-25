import type { AgentMcpToolDescriptor, AgentMcpToolSourceError } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { buildMcpToolComposerItems } from "./useComposerCommandMenuItems";

const TOOLS: ReadonlyArray<AgentMcpToolDescriptor> = [
  {
    provider: "codex",
    serverName: "context7",
    toolName: "query-docs",
    description: "Fetch up-to-date documentation for a library by ID.",
  },
  { provider: "codex", serverName: "context7", toolName: "resolve-library-id" },
  { provider: "codex", serverName: "docsearch", toolName: "grep" },
];

const idsOf = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id);

describe("buildMcpToolComposerItems", () => {
  it("offers a whole-server entry per server ahead of the individual tools", () => {
    const items = buildMcpToolComposerItems({ query: "", tools: TOOLS, errors: [] });

    expect(idsOf(items)).toEqual([
      "mcp-server:codex:context7",
      "mcp-server:codex:docsearch",
      "mcp-tool:codex:context7:query-docs",
      "mcp-tool:codex:context7:resolve-library-id",
      "mcp-tool:codex:docsearch:grep",
    ]);
    expect(items[0]).toMatchObject({
      toolName: null,
      label: "&context7",
      description: "All 2 tools",
    });
    expect(items[1]).toMatchObject({ description: "1 tool" });
  });

  it("matches on the tool name and on the server name at the same time", () => {
    const items = buildMcpToolComposerItems({ query: "doc", tools: TOOLS, errors: [] });

    // `docsearch` matches by server name, `context7:query-docs` by tool name.
    expect(idsOf(items)).toContain("mcp-server:codex:docsearch");
    expect(idsOf(items)).toContain("mcp-tool:codex:context7:query-docs");
    expect(idsOf(items)).not.toContain("mcp-tool:codex:context7:resolve-library-id");
  });

  it("ranks an exact server:tool phrase first", () => {
    const items = buildMcpToolComposerItems({
      query: "context7:query",
      tools: TOOLS,
      errors: [],
    });

    expect(items[0]?.id).toBe("mcp-tool:codex:context7:query-docs");
  });

  it("appends a dimmed, unselectable row per unreachable server without hiding the rest", () => {
    const errors: ReadonlyArray<AgentMcpToolSourceError> = [
      { provider: "codex", serverName: "fastctx", message: "Timed out after 10000ms." },
    ];

    const items = buildMcpToolComposerItems({ query: "context", tools: TOOLS, errors });
    const failure = items.at(-1);

    expect(items.length).toBeGreaterThan(1);
    expect(failure).toMatchObject({
      id: "mcp-error:codex:fastctx",
      unavailable: true,
      label: "fastctx",
      description: "Timed out after 10000ms.",
    });
  });

  it("reports a config-level failure that names no server", () => {
    const items = buildMcpToolComposerItems({
      query: "",
      tools: [],
      errors: [{ provider: "codex", message: "Could not parse config.toml." }],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "mcp-error:codex:0", label: "codex", unavailable: true });
  });
});
