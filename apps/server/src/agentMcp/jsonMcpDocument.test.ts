import { describe, expect, it } from "vitest";

import {
  ANTIGRAVITY_JSON_MCP_DIALECT,
  applyJsonMcpEnabled,
  CLAUDE_JSON_MCP_DIALECT,
  OPENCODE_JSON_MCP_DIALECT,
} from "./jsonMcpDocument";

const applyClaudeMcpDisabled = (text: string, name: string, enabled: boolean) =>
  applyJsonMcpEnabled(text, name, enabled, CLAUDE_JSON_MCP_DIALECT);

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

describe("applyJsonMcpEnabled (Claude dialect)", () => {
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

// OpenCode and Kilo invert the polarity: the key is `enabled` and lives under `mcp`, so
// switching a server off writes `false` where Claude writes `disabled: true`.
describe("applyJsonMcpEnabled (OpenCode dialect)", () => {
  const OPENCODE_SAMPLE = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "context7": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/context7-mcp"],
      "enabled": true
    },
    "other": {
      "type": "local",
      "command": ["uvx", "thing"]
    }
  },
  "theme": "dark"
}
`;

  const apply = (text: string, name: string, enabled: boolean) =>
    applyJsonMcpEnabled(text, name, enabled, OPENCODE_JSON_MCP_DIALECT);

  it("writes enabled: false to switch a server off", () => {
    const next = apply(OPENCODE_SAMPLE, "other", false);

    expect(JSON.parse(next).mcp.other.enabled).toBe(false);
    expect(next).toContain('"theme": "dark"');
    expect(next).toContain('"$schema": "https://opencode.ai/config.json"');
  });

  it("deletes the key when switching on, since a missing enabled already means on", () => {
    const next = apply(OPENCODE_SAMPLE, "context7", true);

    expect(JSON.parse(next).mcp.context7.enabled).toBeUndefined();
    expect(JSON.parse(next).mcp.context7.command).toEqual(["npx", "-y", "@upstash/context7-mcp"]);
  });

  it("round-trips back to the original bytes", () => {
    const off = apply(OPENCODE_SAMPLE, "other", false);

    expect(apply(off, "other", true)).toBe(OPENCODE_SAMPLE);
  });

  it("throws instead of creating a server that is not declared", () => {
    expect(() => apply(OPENCODE_SAMPLE, "absent", false)).toThrow(/absent/);
  });
});

// Antigravity's config carries a UTF-8 BOM; an edit must neither choke on it nor drop it,
// or the IDE would stop reading its own file.
describe("applyJsonMcpEnabled (Antigravity BOM)", () => {
  const WITH_BOM = `\uFEFF{
  "mcpServers": {
    "ida": {
      "type": "http",
      "url": "http://127.0.0.1:13337/mcp"
    }
  }
}
`;

  it("preserves the byte order mark across an edit", () => {
    const next = applyJsonMcpEnabled(WITH_BOM, "ida", false, ANTIGRAVITY_JSON_MCP_DIALECT);

    expect(next.charCodeAt(0)).toBe(0xfeff);
    expect(JSON.parse(next.slice(1)).mcpServers.ida.disabled).toBe(true);
  });

  it("round-trips back to the original bytes", () => {
    const off = applyJsonMcpEnabled(WITH_BOM, "ida", false, ANTIGRAVITY_JSON_MCP_DIALECT);

    expect(applyJsonMcpEnabled(off, "ida", true, ANTIGRAVITY_JSON_MCP_DIALECT)).toBe(WITH_BOM);
  });
});
