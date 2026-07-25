import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCodexMcpServers, resolveCodexMcpConfigPath } from "./codexSource";

const SAMPLE = [
  'model = "gpt-5.6-sol"',
  "",
  "[mcp_servers.context7]",
  'command = "npx"',
  'args = ["-y", "@upstash/context7-mcp"]',
  "",
  "[mcp_servers.context7.env]",
  'CONTEXT7_API_KEY = "ctx7sk-plaintext"',
  'ZED_TOKEN = "zed-plaintext"',
  "",
  '[mcp_servers."ida-pro-mcp"]',
  'url = "http://user:pw@127.0.0.1:8744/mcp?token=secret#frag"',
  "enabled = false",
  "",
  "[mcp_servers.ida-pro-mcp.http_headers]",
  'Authorization = "Bearer abc"',
  "",
].join("\n");

describe("parseCodexMcpServers", () => {
  it("normalizes a missing enabled key to on and keeps file order", () => {
    const servers = parseCodexMcpServers(SAMPLE);

    expect(servers.map((server) => server.name)).toEqual(["context7", "ida-pro-mcp"]);
    expect(servers[0]?.enabled).toBe(true);
    expect(servers[1]?.enabled).toBe(false);
    expect(servers.every((server) => server.provider === "codex")).toBe(true);
  });

  it("keeps command and args but exposes env key names only", () => {
    const [context7] = parseCodexMcpServers(SAMPLE);

    expect(context7?.transport).toEqual({
      _tag: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      envKeys: ["CONTEXT7_API_KEY", "ZED_TOKEN"],
    });
    expect(JSON.stringify(context7)).not.toContain("ctx7sk-");
  });

  it("redacts http urls and exposes header key names only", () => {
    const ida = parseCodexMcpServers(SAMPLE)[1];

    expect(ida?.transport).toEqual({
      _tag: "http",
      url: "http://127.0.0.1:8744/mcp",
      headerKeys: ["Authorization"],
    });
    expect(JSON.stringify(ida)).not.toContain("Bearer");
  });

  it("returns nothing when the config declares no servers", () => {
    expect(parseCodexMcpServers('model = "gpt-5.6-sol"')).toEqual([]);
  });

  it("throws on malformed toml so callers can report a parse error", () => {
    expect(() => parseCodexMcpServers("[mcp_servers.broken")).toThrow();
  });
});

describe("resolveCodexMcpConfigPath", () => {
  it("honours CODEX_HOME instead of assuming ~/.codex", () => {
    expect(resolveCodexMcpConfigPath({ CODEX_HOME: "/tmp/codex-home" })).toBe(
      join("/tmp/codex-home", "config.toml"),
    );
  });
});
