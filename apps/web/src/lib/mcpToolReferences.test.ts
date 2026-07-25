import { describe, expect, it } from "vitest";

import {
  appendAvailableMcpToolsBlock,
  buildAvailableMcpToolLines,
  buildMcpToolReferenceKeys,
  collectMcpToolReferences,
  formatMcpToolReference,
  isMcpToolReferenceUnavailable,
  parseMcpToolReference,
  stripAvailableMcpToolsBlock,
  type McpToolCandidate,
} from "./mcpToolReferences";

const TOOLS: ReadonlyArray<McpToolCandidate> = [
  {
    serverName: "context7",
    toolName: "query-docs",
    description: "Fetch up-to-date documentation for a library by ID.",
  },
  { serverName: "context7", toolName: "resolve-library-id", description: "Resolve a library id." },
  { serverName: "ida-pro-mcp", toolName: "decompile", description: "Decompile a function." },
  { serverName: "ida-pro-mcp", toolName: "disasm" },
];

describe("parseMcpToolReference", () => {
  it("reads the three reference shapes", () => {
    expect(parseMcpToolReference("context7")).toEqual({
      serverName: "context7",
      toolName: null,
    });
    expect(parseMcpToolReference("context7:query-docs")).toEqual({
      serverName: "context7",
      toolName: "query-docs",
    });
    expect(parseMcpToolReference("context7:*")).toEqual({
      serverName: "context7",
      toolName: null,
    });
  });

  it("accepts a leading sigil and rejects malformed input", () => {
    expect(parseMcpToolReference("&context7")).toEqual({ serverName: "context7", toolName: null });
    expect(parseMcpToolReference("")).toBeNull();
    expect(parseMcpToolReference("has space")).toBeNull();
    expect(parseMcpToolReference("a:b:c")).toBeNull();
  });
});

describe("formatMcpToolReference", () => {
  it("collapses the wildcard back to the bare server name", () => {
    expect(formatMcpToolReference({ serverName: "context7", toolName: null })).toBe("context7");
    expect(formatMcpToolReference({ serverName: "context7", toolName: "query-docs" })).toBe(
      "context7:query-docs",
    );
  });
});

describe("collectMcpToolReferences", () => {
  it("finds all three shapes anywhere in the text", () => {
    expect(collectMcpToolReferences("start &alpha middle &beta:one end &gamma:* tail")).toEqual([
      { serverName: "alpha", toolName: null },
      { serverName: "beta", toolName: "one" },
      { serverName: "gamma", toolName: null },
    ]);
  });

  it("matches a reference sitting at the very end of the text", () => {
    expect(collectMcpToolReferences("look this up &context7:query-docs")).toEqual([
      { serverName: "context7", toolName: "query-docs" },
    ]);
  });

  it("never reads a URL query separator as a reference", () => {
    expect(collectMcpToolReferences("see https://x.com/a?b=1&c=2 for details")).toEqual([]);
    expect(collectMcpToolReferences("https://x.com/?q=1&utm_source=news&ref=abc")).toEqual([]);
    expect(collectMcpToolReferences("a&b c&d:e")).toEqual([]);
  });

  it("reports a repeated reference once", () => {
    expect(collectMcpToolReferences("&alpha and &alpha again")).toEqual([
      { serverName: "alpha", toolName: null },
    ]);
  });
});

describe("isMcpToolReferenceUnavailable", () => {
  const keys = buildMcpToolReferenceKeys(TOOLS);

  it("indexes both the server and every server:tool pair", () => {
    expect([...keys].toSorted()).toEqual([
      "context7",
      "context7:query-docs",
      "context7:resolve-library-id",
      "ida-pro-mcp",
      "ida-pro-mcp:decompile",
      "ida-pro-mcp:disasm",
    ]);
  });

  it("accepts every shape the catalog still covers", () => {
    expect(isMcpToolReferenceUnavailable("context7", keys)).toBe(false);
    expect(isMcpToolReferenceUnavailable("context7:*", keys)).toBe(false);
    expect(isMcpToolReferenceUnavailable("context7:query-docs", keys)).toBe(false);
  });

  it("flags a reference the loaded catalog no longer has", () => {
    expect(isMcpToolReferenceUnavailable("context7:removed-tool", keys)).toBe(true);
    expect(isMcpToolReferenceUnavailable("gone", keys)).toBe(true);
    expect(isMcpToolReferenceUnavailable("not a reference", keys)).toBe(true);
  });

  it("flags nothing without a catalog, so a cold cache never greys a draft", () => {
    expect(isMcpToolReferenceUnavailable("context7:query-docs", null)).toBe(false);
    expect(isMcpToolReferenceUnavailable("gone", null)).toBe(false);
  });

  it("agrees with the send-time expansion about what resolves", () => {
    const emptyCatalogKeys = buildMcpToolReferenceKeys([]);

    expect(isMcpToolReferenceUnavailable("context7:query-docs", emptyCatalogKeys)).toBe(true);
    expect(buildAvailableMcpToolLines("&context7:query-docs", [])).toEqual([]);
  });
});

describe("buildAvailableMcpToolLines", () => {
  it("carries the description for a single-tool reference", () => {
    expect(buildAvailableMcpToolLines("look it up &context7:query-docs", TOOLS)).toEqual([
      "context7:query-docs — Fetch up-to-date documentation for a library by ID.",
    ]);
  });

  it("lists names only for a whole-server reference", () => {
    expect(buildAvailableMcpToolLines("&ida-pro-mcp please", TOOLS)).toEqual([
      "ida-pro-mcp:decompile",
      "ida-pro-mcp:disasm",
    ]);
    expect(buildAvailableMcpToolLines("&ida-pro-mcp:* please", TOOLS)).toEqual([
      "ida-pro-mcp:decompile",
      "ida-pro-mcp:disasm",
    ]);
  });

  it("merges several references and keeps the more informative line", () => {
    expect(
      buildAvailableMcpToolLines(
        "&context7 then &context7:query-docs &ida-pro-mcp:decompile",
        TOOLS,
      ),
    ).toEqual([
      "context7:query-docs — Fetch up-to-date documentation for a library by ID.",
      "context7:resolve-library-id",
      "ida-pro-mcp:decompile — Decompile a function.",
    ]);
  });

  it("contributes nothing for a reference that no longer resolves", () => {
    expect(buildAvailableMcpToolLines("&context7:removed-tool &gone", TOOLS)).toEqual([]);
  });
});

describe("appendAvailableMcpToolsBlock", () => {
  it("keeps the body verbatim and appends one merged block", () => {
    const text = "帮我查一下 React 19 的用法 &context7:query-docs";

    expect(appendAvailableMcpToolsBlock(text, TOOLS)).toBe(
      [
        "帮我查一下 React 19 的用法 &context7:query-docs",
        "",
        "<available-mcp-tools>",
        "context7:query-docs — Fetch up-to-date documentation for a library by ID.",
        "</available-mcp-tools>",
        "Please use the MCP tools listed above.",
      ].join("\n"),
    );
  });

  it("emits the block once for several references", () => {
    const result = appendAvailableMcpToolsBlock(
      "&context7:query-docs and &ida-pro-mcp:decompile",
      TOOLS,
    );

    expect(result.match(/<available-mcp-tools>/g)).toHaveLength(1);
    expect(result).toContain("context7:query-docs — Fetch up-to-date documentation");
    expect(result).toContain("ida-pro-mcp:decompile — Decompile a function.");
  });

  it("appends nothing when the prompt has no reference", () => {
    expect(appendAvailableMcpToolsBlock("just a message", TOOLS)).toBe("just a message");
    expect(appendAvailableMcpToolsBlock("see https://x.com/a?b=1&c=2", TOOLS)).toBe(
      "see https://x.com/a?b=1&c=2",
    );
  });

  it("sends the prompt untouched when no catalog was ever loaded", () => {
    // The `&` picker was never opened, so nothing probed and the cache is empty. Sending must
    // still work: the reference travels as plain text instead of expanding.
    expect(appendAvailableMcpToolsBlock("&context7:query-docs please", [])).toBe(
      "&context7:query-docs please",
    );
  });

  it("sends a dead reference unchanged rather than blocking or stripping it", () => {
    expect(appendAvailableMcpToolsBlock("&context7:removed-tool please", TOOLS)).toBe(
      "&context7:removed-tool please",
    );
  });
});

describe("stripAvailableMcpToolsBlock", () => {
  it("undoes what appendAvailableMcpToolsBlock added", () => {
    const text = "帮我查一下 React 19 的用法 &context7:query-docs";

    expect(stripAvailableMcpToolsBlock(appendAvailableMcpToolsBlock(text, TOOLS))).toBe(text);
  });

  it("leaves a prompt that never carried a block alone", () => {
    expect(stripAvailableMcpToolsBlock("just a message")).toBe("just a message");
    expect(stripAvailableMcpToolsBlock("&context7:query-docs please")).toBe(
      "&context7:query-docs please",
    );
  });

  it("keeps a block the user wrote mid-message", () => {
    // Only the generated trailing block is display-stripped; text the user typed stays put.
    const text = "look at <available-mcp-tools>\nfoo\n</available-mcp-tools> and then continue";

    expect(stripAvailableMcpToolsBlock(text)).toBe(text);
  });

  it("strips a block stored before the instruction line existed", () => {
    const text = [
      "check this &context7:query-docs",
      "",
      "<available-mcp-tools>",
      "context7:query-docs — Fetch up-to-date documentation for a library by ID.",
      "</available-mcp-tools>",
    ].join("\n");

    expect(stripAvailableMcpToolsBlock(text)).toBe("check this &context7:query-docs");
  });
});
