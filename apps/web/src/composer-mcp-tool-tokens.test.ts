import { describe, expect, it } from "vitest";

import {
  splitPromptIntoComposerSegments,
  splitPromptIntoDisplaySegments,
} from "./composer-editor-mentions";
import { detectComposerTrigger } from "./composer-logic";

describe("detectComposerTrigger for &", () => {
  it("opens the picker on a bare & and carries the typed query", () => {
    expect(detectComposerTrigger("look up &", 9)).toEqual({
      kind: "mcp-tool",
      query: "",
      rangeStart: 8,
      rangeEnd: 9,
    });
    expect(detectComposerTrigger("look up &context7:que", 21)).toEqual({
      kind: "mcp-tool",
      query: "context7:que",
      rangeStart: 8,
      rangeEnd: 21,
    });
  });

  it("stays closed inside a URL, where & separates query parameters", () => {
    const text = "see https://x.com/a?b=1&c=2";

    expect(detectComposerTrigger(text, text.length)).toBeNull();
  });
});

describe("MCP tool segments", () => {
  it("chips all three reference shapes once a delimiter follows", () => {
    expect(splitPromptIntoComposerSegments("&alpha &beta:one &gamma:* end")).toEqual([
      { type: "mcp-tool", reference: "alpha" },
      { type: "text", text: " " },
      { type: "mcp-tool", reference: "beta:one" },
      { type: "text", text: " " },
      { type: "mcp-tool", reference: "gamma:*" },
      { type: "text", text: " end" },
    ]);
  });

  it("leaves a still-being-typed reference as plain text", () => {
    expect(splitPromptIntoComposerSegments("&context7:query")).toEqual([
      { type: "text", text: "&context7:query" },
    ]);
  });

  it("chips a reference at the end of read-only text", () => {
    expect(splitPromptIntoDisplaySegments("look up &context7:query-docs")).toEqual([
      { type: "text", text: "look up " },
      { type: "mcp-tool", reference: "context7:query-docs" },
    ]);
  });

  it("never chips the & inside a URL", () => {
    const segments = splitPromptIntoDisplaySegments("see https://x.com/a?b=1&c=2 now");

    expect(segments.some((segment) => segment.type === "mcp-tool")).toBe(false);
    expect(segments).toEqual([
      { type: "text", text: "see " },
      { type: "link", url: "https://x.com/a?b=1&c=2" },
      { type: "text", text: " now" },
    ]);
  });

  it("keeps an & that is glued to the preceding word as text", () => {
    expect(splitPromptIntoDisplaySegments("R&D and AT&T:corp")).toEqual([
      { type: "text", text: "R&D and AT&T:corp" },
    ]);
  });
});
