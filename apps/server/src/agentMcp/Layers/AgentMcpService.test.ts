import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentMcpServiceShape } from "../Services/AgentMcpService";
import { makeAgentMcpService, type AgentMcpServiceOptions } from "./AgentMcpService";

const CODEX_CONFIG = [
  "# codex",
  'model = "gpt-5.6-sol"',
  "",
  "[mcp_servers.context7]",
  'command = "npx"',
  'args = ["-y", "@upstash/context7-mcp"]',
  "",
  "[mcp_servers.context7.env]",
  'CONTEXT7_API_KEY = "ctx7sk-plaintext"',
  "",
].join("\n");

const DISABLED_CODEX_CONFIG = CODEX_CONFIG.replace('args = ["-y", "@upstash/context7-mcp"]', () =>
  ['args = ["-y", "@upstash/context7-mcp"]', "enabled = false"].join("\n"),
);

const CLAUDE_CONFIG = `${JSON.stringify(
  {
    numStartups: 7,
    mcpServers: { x64dbg: { command: "uvx", args: ["x64dbg-mcp"], disabled: true } },
  },
  null,
  2,
)}\n`;

let directory: string;
let codexConfigPath: string;
let claudeConfigPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "synara-agent-mcp-"));
  codexConfigPath = join(directory, "config.toml");
  claudeConfigPath = join(directory, ".claude.json");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * Stands in for the Codex CLI clobbering `config.toml` between our atomic write and our
 * read-back: the listed 1-based read calls are answered with the content seen on the very first
 * read, exactly as if our edit had been reverted.
 */
const clobberingFileSystemLayer = (staleReadCalls: ReadonlySet<number>) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      let readCount = 0;
      let firstRead: string | undefined;
      return {
        ...real,
        readFileString: (path: string, encoding?: string) =>
          real.readFileString(path, encoding).pipe(
            Effect.map((text) => {
              readCount += 1;
              firstRead ??= text;
              return staleReadCalls.has(readCount) ? firstRead : text;
            }),
          ),
      };
    }),
  ).pipe(Layer.provide(NodeServices.layer));

const run = <A, E>(
  body: (service: AgentMcpServiceShape) => Effect.Effect<A, E>,
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = NodeServices.layer,
  options?: AgentMcpServiceOptions,
) =>
  makeAgentMcpService({ codexConfigPath, claudeConfigPath, ...options }).pipe(
    Effect.flatMap(body),
    Effect.provide(fileSystemLayer),
    Effect.runPromise,
  );

describe("AgentMcpService", () => {
  it("reports a missing config as unavailable rather than an error", async () => {
    const catalog = await run((service) => service.listServers());

    expect(catalog.sources.map((source) => [source.provider, source.available])).toEqual([
      ["codex", false],
      ["claudeAgent", false],
    ]);
  });

  it("aggregates both providers and never leaks secret values", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);

    const catalog = await run((service) => service.listServers());

    expect(catalog.sources[0]?.servers.map((server) => server.name)).toEqual(["context7"]);
    expect(catalog.sources[1]?.servers.map((server) => [server.name, server.enabled])).toEqual([
      ["x64dbg", false],
    ]);
    expect(JSON.stringify(catalog)).not.toContain("ctx7sk-");
  });

  it("keeps a broken source read-only without breaking the other one", async () => {
    writeFileSync(codexConfigPath, "[mcp_servers.broken");
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);

    const catalog = await run((service) => service.listServers());

    expect(catalog.sources[0]?.parseError).toBeTruthy();
    expect(catalog.sources[0]?.servers).toEqual([]);
    expect(catalog.sources[1]?.servers).toHaveLength(1);
  });

  // `smol-toml` quotes three raw lines of the document in its error message and V8's
  // `JSON.parse` embeds a ~16 character snippet around the offending token. Both files hold
  // plaintext API keys, and both of these paths cross the WebSocket to the browser.
  it("never puts file content in a Codex parse error", async () => {
    writeFileSync(
      codexConfigPath,
      [
        "[mcp_servers.context7]",
        'command = "npx"',
        "",
        "[mcp_servers.context7.env]",
        'CONTEXT7_API_KEY = "ctx7sk-plaintext-super-secret-oops',
      ].join("\n"),
    );

    const catalog = await run((service) => service.listServers());
    const parseError = catalog.sources[0]?.parseError ?? "";
    const failure = await run((service) =>
      service
        .setServerEnabled({ provider: "codex", name: "context7", enabled: false })
        .pipe(Effect.flip),
    );

    expect(parseError).toContain("config.toml");
    expect(parseError).not.toContain("ctx7sk");
    expect(parseError).not.toContain("CONTEXT7_API_KEY");
    expect(failure.code).toBe("parse-failed");
    expect(failure.message).not.toContain("ctx7sk");
    expect(failure.message).not.toContain("CONTEXT7_API_KEY");
  });

  it("never puts file content in a Claude parse error", async () => {
    writeFileSync(claudeConfigPath, '{"mcpServers": {"a": {"env": ctx7sk-plaintext-secret}}}');

    const catalog = await run((service) => service.listServers());
    const parseError = catalog.sources[1]?.parseError ?? "";
    const failure = await run((service) =>
      service
        .setServerEnabled({ provider: "claudeAgent", name: "a", enabled: false })
        .pipe(Effect.flip),
    );

    expect(parseError).toContain(".claude.json");
    expect(parseError).not.toContain("ctx7sk");
    expect(failure.code).toBe("parse-failed");
    expect(failure.message).not.toContain("ctx7sk");
  });

  it("refuses to write when the config cannot be parsed", async () => {
    writeFileSync(codexConfigPath, "[mcp_servers.broken");

    const error = await run((service) =>
      service
        .setServerEnabled({ provider: "codex", name: "context7", enabled: false })
        .pipe(Effect.flip),
    );

    expect(error.code).toBe("parse-failed");
    expect(readFileSync(codexConfigPath, "utf8")).toBe("[mcp_servers.broken");
  });

  it("fails when the config file does not exist", async () => {
    const error = await run((service) =>
      service
        .setServerEnabled({ provider: "codex", name: "context7", enabled: false })
        .pipe(Effect.flip),
    );

    expect(error.code).toBe("unavailable");
  });

  it("fails when the server was removed externally", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);

    const error = await run((service) =>
      service
        .setServerEnabled({ provider: "codex", name: "absent", enabled: false })
        .pipe(Effect.flip),
    );

    expect(error.code).toBe("not-found");
  });

  it("disables a Codex server and returns only that provider's refreshed view", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);

    const view = await run((service) =>
      service.setServerEnabled({ provider: "codex", name: "context7", enabled: false }),
    );

    expect(view.provider).toBe("codex");
    expect(view.servers).toEqual([expect.objectContaining({ name: "context7", enabled: false })]);
    expect(readFileSync(codexConfigPath, "utf8")).toBe(DISABLED_CODEX_CONFIG);
    expect(readFileSync(claudeConfigPath, "utf8")).toBe(CLAUDE_CONFIG);
  });

  it("enables a Claude server by deleting the disabled key", async () => {
    writeFileSync(claudeConfigPath, CLAUDE_CONFIG);

    const view = await run((service) =>
      service.setServerEnabled({ provider: "claudeAgent", name: "x64dbg", enabled: true }),
    );

    expect(view.servers).toEqual([expect.objectContaining({ name: "x64dbg", enabled: true })]);
    expect(JSON.parse(readFileSync(claudeConfigPath, "utf8")).mcpServers.x64dbg).toEqual({
      command: "uvx",
      args: ["x64dbg-mcp"],
    });
  });

  it("retries when the first read-back shows the edit was overwritten", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);

    const view = await run(
      (service) =>
        service.setServerEnabled({ provider: "codex", name: "context7", enabled: false }),
      clobberingFileSystemLayer(new Set([2])),
    );

    expect(view.servers).toEqual([expect.objectContaining({ name: "context7", enabled: false })]);
    expect(readFileSync(codexConfigPath, "utf8")).toBe(DISABLED_CODEX_CONFIG);
  });

  it("reports a conflict when every read-back shows the edit was overwritten", async () => {
    writeFileSync(codexConfigPath, CODEX_CONFIG);

    const error = await run(
      (service) =>
        service
          .setServerEnabled({ provider: "codex", name: "context7", enabled: false })
          .pipe(Effect.flip),
      clobberingFileSystemLayer(new Set([2, 3, 4, 5, 6])),
    );

    expect(error.code).toBe("conflict");
  });
});
