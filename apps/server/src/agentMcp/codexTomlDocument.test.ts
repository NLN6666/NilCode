import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import { applyCodexMcpEnabled } from "./codexTomlDocument";

const SAMPLE = [
  "# Codex configuration",
  'model = "gpt-5.6-sol"',
  "",
  "[mcp_servers.foo]",
  'command = "npx"',
  'args = ["-y", "foo-mcp"] # inline comment',
  "",
  "[mcp_servers.foo.env]",
  'CONTEXT7_API_KEY = "ctx7sk-plaintext"',
  "",
  "[mcp_servers.foobar]",
  "command = 'echo'",
  "",
  '[mcp_servers."ida-pro-mcp"]',
  'url = "http://127.0.0.1:8744/mcp?token=secret"',
  "",
  "[mcp_servers.foo.http_headers]",
  'Authorization = "Bearer abc"',
  "",
].join("\n");

function serverTable(text: string, name: string): Record<string, unknown> {
  const document = parseToml(text) as { mcp_servers?: Record<string, Record<string, unknown>> };
  const server = document.mcp_servers?.[name];
  if (!server) throw new Error(`missing server ${name}`);
  return server;
}

describe("applyCodexMcpEnabled", () => {
  it("does not match a same-prefix section", () => {
    const next = applyCodexMcpEnabled(SAMPLE, "foo", false);

    expect(serverTable(next, "foo").enabled).toBe(false);
    expect(serverTable(next, "foobar").enabled).toBeUndefined();
    expect(next).toContain("[mcp_servers.foobar]\ncommand = 'echo'");
  });

  it("does not match a sub-table of the same server", () => {
    const next = applyCodexMcpEnabled(SAMPLE, "foo", false);
    const lines = next.split("\n");

    expect(lines.indexOf("enabled = false")).toBeLessThan(lines.indexOf("[mcp_servers.foo.env]"));
    expect(parseToml(next)).toMatchObject({
      mcp_servers: { foo: { env: { CONTEXT7_API_KEY: "ctx7sk-plaintext" } } },
    });
  });

  it("resolves a quoted section name", () => {
    const next = applyCodexMcpEnabled(SAMPLE, "ida-pro-mcp", false);

    expect(serverTable(next, "ida-pro-mcp").enabled).toBe(false);
    expect(next).toContain('[mcp_servers."ida-pro-mcp"]');
  });

  it("resolves a bare section name written unquoted", () => {
    const text = ["[mcp_servers.ida-pro-mcp]", 'command = "ida"', ""].join("\n");

    const next = applyCodexMcpEnabled(text, "ida-pro-mcp", false);

    expect(serverTable(next, "ida-pro-mcp").enabled).toBe(false);
  });

  it("inserts before a sub-table rather than inside it", () => {
    const text = [
      "[mcp_servers.alpha]",
      'command = "echo"',
      "[mcp_servers.alpha.env]",
      'KEY = "value"',
      "",
    ].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);

    expect(next).toBe(
      [
        "[mcp_servers.alpha]",
        'command = "echo"',
        "enabled = false",
        "[mcp_servers.alpha.env]",
        'KEY = "value"',
        "",
      ].join("\n"),
    );
    expect(serverTable(next, "alpha")).not.toHaveProperty("env.enabled");
  });

  it("replaces an existing enabled line instead of appending a second one", () => {
    const text = ["[mcp_servers.alpha]", 'command = "echo"', "enabled = false", ""].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);

    expect(next.match(/enabled/g)).toHaveLength(1);
    expect(serverTable(next, "alpha").enabled).toBe(false);
  });

  it("keeps a trailing comment when rewriting an existing enabled line", () => {
    const text = [
      "[mcp_servers.alpha]",
      "enabled  =  true   # temporarily on",
      'command = "echo"',
      "",
    ].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);

    expect(next).toContain("enabled  =  false   # temporarily on");
  });

  it("preserves comments and blank lines around the edit", () => {
    const text = [
      "[mcp_servers.alpha]",
      "# why this server exists",
      'command = "echo"',
      "",
      "# the environment lives below",
      "[mcp_servers.alpha.env]",
      'KEY = "value"',
      "",
    ].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);

    expect(next).toBe(
      [
        "[mcp_servers.alpha]",
        "# why this server exists",
        'command = "echo"',
        "enabled = false",
        "",
        "# the environment lives below",
        "[mcp_servers.alpha.env]",
        'KEY = "value"',
        "",
      ].join("\n"),
    );
  });

  it("preserves CRLF line endings", () => {
    const text = ["[mcp_servers.alpha]", 'command = "echo"', ""].join("\r\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);

    expect(next).toBe(
      ["[mcp_servers.alpha]", 'command = "echo"', "enabled = false", ""].join("\r\n"),
    );
    expect(next).not.toMatch(/[^\r]\n/);
  });

  it("terminates the last line when the file has no trailing newline", () => {
    const text = ["[mcp_servers.alpha]", 'command = "echo"'].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);

    expect(next).toBe(["[mcp_servers.alpha]", 'command = "echo"', "enabled = false"].join("\n"));
  });

  it("removes the whole line when enabling, leaving no blank residue", () => {
    const disabled = applyCodexMcpEnabled(SAMPLE, "foo", false);

    const enabled = applyCodexMcpEnabled(disabled, "foo", true);

    expect(enabled).toBe(SAMPLE);
    expect(serverTable(enabled, "foo").enabled).toBeUndefined();
  });

  it("is a no-op when the server is already enabled", () => {
    expect(applyCodexMcpEnabled(SAMPLE, "foo", true)).toBe(SAMPLE);
  });

  it("leaves every non-target byte unchanged", () => {
    const next = applyCodexMcpEnabled(SAMPLE, "foo", false);

    expect(next.split("\n").filter((line) => line !== "enabled = false")).toEqual(
      SAMPLE.split("\n"),
    );
  });

  it("still parses as TOML after editing", () => {
    expect(() => parseToml(applyCodexMcpEnabled(SAMPLE, "foo", false))).not.toThrow();
    expect(() => parseToml(applyCodexMcpEnabled(SAMPLE, "ida-pro-mcp", false))).not.toThrow();
  });

  it("throws instead of creating a missing section", () => {
    expect(() => applyCodexMcpEnabled(SAMPLE, "absent", false)).toThrow(/absent/);
    expect(() => applyCodexMcpEnabled(SAMPLE, "absent", true)).toThrow(/absent/);
  });

  it("resolves a section name written with unicode escapes", () => {
    const text = ['[mcp_servers."caf\\u00e9"]', 'command = "brew"', ""].join("\n");

    const next = applyCodexMcpEnabled(text, "café", false);

    expect(serverTable(next, "café").enabled).toBe(false);
    expect(next).toContain('[mcp_servers."caf\\u00e9"]');
  });

  it("ignores a table header that only appears inside a multi-line string", () => {
    const text = [
      "[mcp_servers.alpha]",
      'command = "echo"',
      'notes = """',
      "[mcp_servers.bar]",
      "enabled = true",
      '"""',
      "[mcp_servers.beta]",
      'command = "echo"',
      "",
    ].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);
    const lines = next.split("\n");

    // The key lands after the closing delimiter, never inside the string body.
    expect(lines.indexOf("enabled = false")).toBe(lines.indexOf('"""') + 1);
    expect(serverTable(next, "alpha").notes).toBe(
      ["[mcp_servers.bar]", "enabled = true", ""].join("\n"),
    );
    expect(serverTable(next, "beta").enabled).toBeUndefined();
  });

  it("does not mistake an enabled line inside a multi-line string for the real key", () => {
    const text = [
      "[mcp_servers.alpha]",
      'notes = """',
      "enabled = false",
      '"""',
      "enabled = false",
      "",
    ].join("\n");

    // Deletes the real key on the last line, not the string's copy on line 3.
    const next = applyCodexMcpEnabled(text, "alpha", true);

    expect(next).toBe(
      ["[mcp_servers.alpha]", 'notes = """', "enabled = false", '"""', ""].join("\n"),
    );
    expect(serverTable(next, "alpha").notes).toBe("enabled = false\n");
  });

  it("is not fooled by an array element that looks like a table header", () => {
    const text = [
      "[mcp_servers.alpha]",
      "args = [",
      '  ["nested"],',
      "]",
      "[mcp_servers.beta]",
      'command = "echo"',
      "",
    ].join("\n");

    const next = applyCodexMcpEnabled(text, "alpha", false);
    const lines = next.split("\n");

    expect(lines.indexOf("enabled = false")).toBeLessThan(lines.indexOf("[mcp_servers.beta]"));
    expect(serverTable(next, "beta").enabled).toBeUndefined();
  });
});
