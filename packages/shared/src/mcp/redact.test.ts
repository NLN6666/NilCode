import { describe, expect, it } from "vitest";

import { REDACTED_URL_PLACEHOLDER, redactMcpUrl, redactedMcpKeys } from "./redact";

describe("redactMcpUrl", () => {
  it("drops query tokens", () => {
    expect(redactMcpUrl("https://mcp.example.com/sse?api_key=ctx7sk-secret")).toBe(
      "https://mcp.example.com/sse",
    );
  });

  it("drops fragments", () => {
    expect(redactMcpUrl("https://mcp.example.com/sse#token=abc")).toBe(
      "https://mcp.example.com/sse",
    );
  });

  it("drops userinfo", () => {
    expect(redactMcpUrl("https://user:hunter2@mcp.example.com/mcp")).toBe(
      "https://mcp.example.com/mcp",
    );
  });

  it("keeps scheme, host, port and path", () => {
    expect(redactMcpUrl("http://127.0.0.1:8931/mcp/v1")).toBe("http://127.0.0.1:8931/mcp/v1");
  });

  it("returns a placeholder for unparsable urls instead of echoing them", () => {
    expect(redactMcpUrl("not a url ?key=ctx7sk-secret")).toBe(REDACTED_URL_PLACEHOLDER);
  });
});

describe("redactedMcpKeys", () => {
  it("returns sorted key names without values", () => {
    expect(redactedMcpKeys({ ZED_TOKEN: "z", CONTEXT7_API_KEY: "ctx7sk-secret" })).toEqual([
      "CONTEXT7_API_KEY",
      "ZED_TOKEN",
    ]);
  });

  it("treats missing or non-record input as empty", () => {
    expect(redactedMcpKeys(undefined)).toEqual([]);
    expect(redactedMcpKeys(null)).toEqual([]);
    expect(redactedMcpKeys(["a"])).toEqual([]);
    expect(redactedMcpKeys("Authorization: Bearer x")).toEqual([]);
  });
});
