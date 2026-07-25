import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerConnection } from "../mcpConfigParser";
import type { McpProbeToolDescriptor } from "../probe/McpProbeClient";
import type { AgentMcpToolCatalogServiceShape } from "../Services/AgentMcpToolCatalogService";
import { makeAgentMcpToolCatalog, type AgentMcpToolCatalogOptions } from "./AgentMcpToolCatalog";

const CODEX_CONFIG = [
  "[mcp_servers.context7]",
  'command = "npx"',
  'args = ["-y", "@upstash/context7-mcp"]',
  "",
  "[mcp_servers.fastctx]",
  'command = "uvx"',
  'args = ["fastctx"]',
  "",
  "[mcp_servers.disabled-one]",
  'command = "uvx"',
  "enabled = false",
  "",
].join("\n");

const CLAUDE_CONFIG = JSON.stringify({
  mcpServers: { x64dbg: { command: "uvx", args: ["x64dbg-mcp"] } },
});

let directory: string;
let codexConfigPath: string;
let claudeConfigPath: string;
let cacheFilePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "synara-mcp-tools-"));
  codexConfigPath = join(directory, "config.toml");
  claudeConfigPath = join(directory, ".claude.json");
  cacheFilePath = join(directory, "agent-mcp-tools.json");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const run = <A>(
  body: (service: AgentMcpToolCatalogServiceShape) => Effect.Effect<A, unknown>,
  options: AgentMcpToolCatalogOptions,
) =>
  makeAgentMcpToolCatalog({
    codexConfigPath,
    claudeConfigPath,
    cacheFilePath,
    ...options,
  }).pipe(Effect.flatMap(body), Effect.provide(NodeServices.layer), Effect.runPromise);

const toolsFor = (name: string): ReadonlyArray<McpProbeToolDescriptor> => [
  { name: `${name}-tool`, description: `${name} description` },
];

describe("AgentMcpToolCatalog", () => {
  it("probes every enabled server across both providers and skips disabled ones", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);
    const probe = vi.fn(async (connection: McpServerConnection) => toolsFor(connection.name));

    const catalog = await run((service) => service.listTools(), { probe });

    expect(probe.mock.calls.map(([connection]) => connection.name).toSorted()).toEqual([
      "context7",
      "fastctx",
      "x64dbg",
    ]);
    expect(catalog.tools).toEqual([
      {
        provider: "codex",
        serverName: "context7",
        toolName: "context7-tool",
        description: "context7 description",
      },
      {
        provider: "codex",
        serverName: "fastctx",
        toolName: "fastctx-tool",
        description: "fastctx description",
      },
      {
        provider: "claudeAgent",
        serverName: "x64dbg",
        toolName: "x64dbg-tool",
        description: "x64dbg description",
      },
    ]);
    expect(catalog.errors).toEqual([]);
    expect(catalog.staleAt).toBeUndefined();
  });

  it("merges concurrent requests for the same server into a single probe", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = vi.fn(async (connection: McpServerConnection) => {
      await gate;
      return toolsFor(connection.name);
    });

    const results = await run(
      (service) =>
        Effect.promise(async () => {
          const inFlight = Promise.all([
            Effect.runPromise(service.listTools()),
            Effect.runPromise(service.listTools()),
          ]);
          release?.();
          return inFlight;
        }),
      { probe },
    );

    expect(results[0]?.tools).toHaveLength(2);
    expect(results[1]?.tools).toHaveLength(2);
    // Two servers, two probes — not four.
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("serves cached tools past the TTL and marks the response stale while refreshing", async () => {
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);
    let currentTime = 1_000_000;
    let generation = 1;
    const probe = vi.fn(async () => [{ name: `x64dbg-v${generation}`, description: null }]);

    const catalogs = await run(
      (service) =>
        Effect.promise(async () => {
          const first = await Effect.runPromise(service.listTools());
          currentTime += 5_000;
          const cached = await Effect.runPromise(service.listTools());
          currentTime += 60_000;
          generation = 2;
          const stale = await Effect.runPromise(service.listTools());
          // Let the background revalidation settle before asking again.
          await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
          const refreshed = await Effect.runPromise(service.listTools());
          return { first, cached, stale, refreshed };
        }),
      { probe, ttlMs: 30_000, now: () => currentTime },
    );

    expect(catalogs.first.tools[0]?.toolName).toBe("x64dbg-v1");
    expect(catalogs.cached.tools[0]?.toolName).toBe("x64dbg-v1");
    expect(catalogs.cached.staleAt).toBeUndefined();
    // Stale-while-revalidate: the old list is returned, flagged, and replaced afterwards.
    expect(catalogs.stale.tools[0]?.toolName).toBe("x64dbg-v1");
    expect(catalogs.stale.staleAt).toBe(new Date(1_000_000).toISOString());
    expect(catalogs.refreshed.tools[0]?.toolName).toBe("x64dbg-v2");
  });

  it("re-probes when that server's own config entry changes", async () => {
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);
    const probe = vi.fn(async (connection: McpServerConnection) => toolsFor(connection.name));

    await run(
      (service) =>
        Effect.promise(async () => {
          await Effect.runPromise(service.listTools());
          await Effect.runPromise(service.listTools());
          expect(probe).toHaveBeenCalledTimes(1);

          writeFileSync(
            claudeConfigPath,
            JSON.stringify({
              mcpServers: { x64dbg: { command: "uvx", args: ["x64dbg-mcp", "--verbose"] } },
            }),
          );
          await Effect.runPromise(service.listTools());
          expect(probe).toHaveBeenCalledTimes(2);
        }),
      { probe },
    );
  });

  it("reports one failing server without dropping the others", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);
    const probe = vi.fn(async (connection: McpServerConnection) => {
      if (connection.name === "fastctx") throw new Error("Timed out after 10000ms.");
      return toolsFor(connection.name);
    });

    const catalog = await run((service) => service.listTools(), { probe });

    expect(catalog.tools.map((tool) => tool.serverName)).toEqual(["context7"]);
    expect(catalog.errors).toEqual([
      { provider: "codex", serverName: "fastctx", message: "Timed out after 10000ms." },
    ]);
  });

  it("degrades a broken config to an error without touching the other provider", async () => {
    writeFileSync(codexConfigPath, "[mcp_servers.broken");
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);
    const probe = vi.fn(async (connection: McpServerConnection) => toolsFor(connection.name));

    const catalog = await run((service) => service.listTools(), { probe });

    expect(catalog.errors).toEqual([
      { provider: "codex", message: "Could not parse config.toml." },
    ]);
    expect(catalog.tools.map((tool) => tool.serverName)).toEqual(["x64dbg"]);
  });

  it("reuses the persisted cache across service instances", async () => {
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);
    const probe = vi.fn(async (connection: McpServerConnection) => toolsFor(connection.name));

    await run(
      (service) =>
        Effect.promise(async () => {
          await Effect.runPromise(service.listTools());
          // The write is queued behind the probe; wait for the file to appear.
          await vi.waitFor(() => expect(existsSync(cacheFilePath)).toBe(true));
        }),
      { probe },
    );

    const second = await run((service) => service.listTools(), { probe });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(second.tools.map((tool) => tool.toolName)).toEqual(["x64dbg-tool"]);
  });
});
