import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseClaudeMcpServers, resolveClaudeMcpConfigPath } from "./claudeSource";

const SAMPLE = JSON.stringify({
  numStartups: 412,
  mcpServers: {
    context7: {
      type: "http",
      url: "https://alice:pw@mcp.context7.com/mcp?apiKey=ctx7sk-plaintext#frag",
      headers: { Authorization: "Bearer abc", "X-Trace": "1" },
    },
    x64dbg: {
      command: "uvx",
      args: ["x64dbg-mcp"],
      env: { X64DBG_TOKEN: "plaintext" },
      disabled: true,
    },
  },
  projects: {
    "/repo": { disabledMcpServers: ["context7"] },
  },
});

describe("parseClaudeMcpServers", () => {
  it("inverts the disabled flag and defaults a missing one to enabled", () => {
    const servers = parseClaudeMcpServers(SAMPLE);

    expect(servers.map((server) => [server.name, server.enabled])).toEqual([
      ["context7", true],
      ["x64dbg", false],
    ]);
    expect(servers.every((server) => server.provider === "claudeAgent")).toBe(true);
  });

  it("redacts http urls and exposes header key names only", () => {
    const [context7] = parseClaudeMcpServers(SAMPLE);

    expect(context7?.transport).toEqual({
      _tag: "http",
      url: "https://mcp.context7.com/mcp",
      headerKeys: ["Authorization", "X-Trace"],
    });
    expect(JSON.stringify(context7)).not.toContain("ctx7sk-");
  });

  it("keeps command and args but exposes env key names only", () => {
    const x64dbg = parseClaudeMcpServers(SAMPLE)[1];

    expect(x64dbg?.transport).toEqual({
      _tag: "stdio",
      command: "uvx",
      args: ["x64dbg-mcp"],
      envKeys: ["X64DBG_TOKEN"],
    });
    expect(JSON.stringify(x64dbg)).not.toContain("plaintext");
  });

  it("ignores the per-project disable lists", () => {
    expect(parseClaudeMcpServers(SAMPLE)[0]?.enabled).toBe(true);
  });

  it("returns nothing when the config declares no servers", () => {
    expect(parseClaudeMcpServers('{"numStartups": 1}')).toEqual([]);
  });

  it("throws on malformed json so callers can report a parse error", () => {
    expect(() => parseClaudeMcpServers("{ not json")).toThrow();
  });
});

describe("resolveClaudeMcpConfigPath", () => {
  it("resolves .claude.json inside the home directory", () => {
    expect(resolveClaudeMcpConfigPath("/home/kim")).toBe(join("/home/kim", ".claude.json"));
  });
});
