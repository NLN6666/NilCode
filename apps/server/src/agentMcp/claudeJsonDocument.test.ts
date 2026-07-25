import { describe, expect, it } from "vitest";

import { applyClaudeMcpDisabled } from "./claudeJsonDocument";

const SAMPLE = `{
  "numStartups": 412,
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp?apiKey=ctx7sk-plaintext"
    },
    "x64dbg": {
      "command": "uvx",
      "args": ["x64dbg-mcp"],
      "disabled": true
    }
  },
  "tipsHistory": {
    "new-user-warmup": 1
  }
}
`;

describe("applyClaudeMcpDisabled", () => {
  it("adds disabled with 2-space indentation and leaves other lines untouched", () => {
    const next = applyClaudeMcpDisabled(SAMPLE, "context7", false);

    expect(next).toBe(`{
  "numStartups": 412,
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp?apiKey=ctx7sk-plaintext",
      "disabled": true
    },
    "x64dbg": {
      "command": "uvx",
      "args": ["x64dbg-mcp"],
      "disabled": true
    }
  },
  "tipsHistory": {
    "new-user-warmup": 1
  }
}
`);
  });

  it("removes an existing disabled key when enabling", () => {
    const next = applyClaudeMcpDisabled(SAMPLE, "x64dbg", true);

    expect(JSON.parse(next).mcpServers.x64dbg).toEqual({
      command: "uvx",
      args: ["x64dbg-mcp"],
    });
    expect(next).toContain('"numStartups": 412');
    expect(next).toContain('"new-user-warmup": 1');
  });

  it("round-trips back to the original bytes", () => {
    const disabled = applyClaudeMcpDisabled(SAMPLE, "context7", false);

    expect(applyClaudeMcpDisabled(disabled, "context7", true)).toBe(SAMPLE);
  });

  it("replaces rather than duplicates when disabled already exists", () => {
    const next = applyClaudeMcpDisabled(SAMPLE, "x64dbg", false);

    expect(next).toBe(SAMPLE);
    expect(next.match(/"disabled"/g)).toHaveLength(1);
  });

  it("is a no-op when the server is already enabled", () => {
    expect(applyClaudeMcpDisabled(SAMPLE, "context7", true)).toBe(SAMPLE);
  });

  it("keeps the result valid JSON", () => {
    expect(() => JSON.parse(applyClaudeMcpDisabled(SAMPLE, "context7", false))).not.toThrow();
    expect(() => JSON.parse(applyClaudeMcpDisabled(SAMPLE, "x64dbg", true))).not.toThrow();
  });

  it("preserves CRLF line endings", () => {
    const next = applyClaudeMcpDisabled(SAMPLE.replaceAll("\n", "\r\n"), "context7", false);

    expect(next).toContain('"url": "https://mcp.context7.com/mcp?apiKey=ctx7sk-plaintext",\r\n');
    expect(next).not.toMatch(/[^\r]\n/);
  });

  it("throws instead of creating a missing server", () => {
    expect(() => applyClaudeMcpDisabled(SAMPLE, "absent", false)).toThrow(/absent/);
    expect(() => applyClaudeMcpDisabled(SAMPLE, "absent", true)).toThrow(/absent/);
  });

  it("throws when the config has no mcpServers object", () => {
    expect(() => applyClaudeMcpDisabled('{"numStartups": 1}', "context7", false)).toThrow(
      /mcpServers/,
    );
  });
});
