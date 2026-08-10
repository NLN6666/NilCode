import { describe, expect, it } from "vitest";

import { applyGrokMcpEnabled } from "./grokTomlDocument";
import { parseGrokMcpServerConnections } from "./mcpConfigParser";

const NL = "\n";

const SAMPLE = [
  "disabled_mcp_servers = [",
  '    "muted",',
  '    "other",',
  "]",
  "",
  "[cli]",
  'installer = "internal"',
  "",
  "[mcp_servers.muted]",
  'command = "uvx"',
  'args = ["muted-mcp"]',
  "",
  "[mcp_servers.live]",
  'command = "npx"',
  "",
].join(NL);

const enabledOf = (text: string, name: string) =>
  parseGrokMcpServerConnections(text).find((server) => server.name === name)?.enabled;

describe("applyGrokMcpEnabled", () => {
  // The list wins over the table field, so writing `enabled = true` alone would leave the
  // server off and the toggle would silently do nothing.
  it("drops the name from disabled_mcp_servers when enabling", () => {
    const next = applyGrokMcpEnabled(SAMPLE, "muted", true);

    expect(enabledOf(next, "muted")).toBe(true);
    expect(next).toContain('disabled_mcp_servers = ["other"]');
    expect(enabledOf(next, "live")).toBe(true);
  });

  it("removes the assignment entirely once the list would be empty", () => {
    const single = SAMPLE.replace('    "other",' + NL, "");
    const next = applyGrokMcpEnabled(single, "muted", true);

    expect(next).not.toContain("disabled_mcp_servers");
    expect(enabledOf(next, "muted")).toBe(true);
  });

  it("leaves unrelated sections and the other entry untouched", () => {
    const next = applyGrokMcpEnabled(SAMPLE, "muted", true);

    expect(next).toContain("[cli]");
    expect(next).toContain('installer = "internal"');
    expect(next).toContain('args = ["muted-mcp"]');
    expect(next).toContain("[mcp_servers.live]");
  });

  it("writes the table flag when disabling and leaves the list alone", () => {
    const next = applyGrokMcpEnabled(SAMPLE, "live", false);

    expect(enabledOf(next, "live")).toBe(false);
    expect(next).toContain('"muted",');
    expect(next).toContain('"other",');
  });

  it("is a no-op for a server that is already enabled and unlisted", () => {
    expect(applyGrokMcpEnabled(SAMPLE, "live", true)).toBe(SAMPLE);
  });

  it("handles an inline array", () => {
    const inline = SAMPLE.replace(
      ["disabled_mcp_servers = [", '    "muted",', '    "other",', "]"].join(NL),
      'disabled_mcp_servers = ["muted", "other"]',
    );

    expect(applyGrokMcpEnabled(inline, "muted", true)).toContain(
      'disabled_mcp_servers = ["other"]',
    );
  });

  it("throws instead of creating a server that is not declared", () => {
    expect(() => applyGrokMcpEnabled(SAMPLE, "absent", false)).toThrow();
  });

  // Re-serializing the list is only safe inside the charset Grok itself allows.
  it("refuses to rewrite a list holding a name it could not have written", () => {
    const exotic = SAMPLE.replace('    "other",', '    "we\\"ird",');

    expect(() => applyGrokMcpEnabled(exotic, "muted", true)).toThrow(/by hand/);
  });
});
