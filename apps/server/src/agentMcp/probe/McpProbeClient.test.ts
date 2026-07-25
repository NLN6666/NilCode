import { describe, expect, it, vi } from "vitest";

import type { McpServerConnection } from "../mcpConfigParser";
import {
  McpProbeError,
  probeMcpServerTools,
  readJsonRpcMessages,
  readToolDescriptors,
  resolveMcpProbeSpawnTarget,
  runMcpProbeSession,
  type McpProbeChildProcess,
  type McpProbeFetch,
  type McpProbeSession,
} from "./McpProbeClient";

const STDIO_CONNECTION: McpServerConnection = {
  provider: "codex",
  name: "context7",
  enabled: true,
  transport: {
    _tag: "stdio",
    command: "node",
    args: ["server.mjs"],
    env: { CONTEXT7_API_KEY: "ctx7sk-plaintext-secret" },
  },
};

const HTTP_CONNECTION: McpServerConnection = {
  provider: "codex",
  name: "remote",
  enabled: true,
  transport: {
    _tag: "http",
    url: "https://mcp.example.com/mcp?token=supersecret",
    headers: { Authorization: "Bearer topsecrettoken" },
  },
};

/** Records the exact method sequence a probe performs, with no I/O at all. */
function createRecordingSession(results: Record<string, unknown>): {
  session: McpProbeSession;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    session: {
      request: async (method) => {
        calls.push(`request:${method}`);
        return results[method];
      },
      notify: async (method) => {
        calls.push(`notify:${method}`);
      },
      dispose: () => {
        calls.push("dispose");
      },
    },
  };
}

describe("runMcpProbeSession", () => {
  it("handshakes then lists tools, and never calls one", async () => {
    const { session, calls } = createRecordingSession({
      initialize: { protocolVersion: "2025-06-18" },
      "tools/list": { tools: [{ name: "query-docs", description: "Fetch docs." }] },
    });

    const tools = await runMcpProbeSession(session);

    expect(calls).toEqual([
      "request:initialize",
      "notify:notifications/initialized",
      "request:tools/list",
    ]);
    expect(calls.some((call) => call.includes("tools/call"))).toBe(false);
    expect(tools).toEqual([{ name: "query-docs", description: "Fetch docs." }]);
  });

  it("follows tools/list pagination", async () => {
    const pages: unknown[] = [
      { tools: [{ name: "a" }], nextCursor: "page-2" },
      { tools: [{ name: "b" }] },
    ];
    let page = 0;
    const session: McpProbeSession = {
      request: async (method) => {
        if (method !== "tools/list") return {};
        const result = pages[page];
        page += 1;
        return result;
      },
      notify: async () => {},
      dispose: () => {},
    };

    await expect(runMcpProbeSession(session)).resolves.toEqual([
      { name: "a", description: null },
      { name: "b", description: null },
    ]);
  });
});

describe("readToolDescriptors", () => {
  it("drops unnamed entries and normalizes a missing description", () => {
    expect(
      readToolDescriptors({ tools: [{ name: "ok" }, { description: "no name" }, { name: "" }] }),
    ).toEqual([{ name: "ok", description: null }]);
  });

  it("rejects a payload without a tools array", () => {
    expect(() => readToolDescriptors({})).toThrow(McpProbeError);
  });
});

describe("readJsonRpcMessages", () => {
  it("parses a plain JSON body", () => {
    expect(readJsonRpcMessages('{"jsonrpc":"2.0","id":1,"result":{}}')).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
    ]);
  });

  it("parses server-sent-event framing and skips keepalives", () => {
    const body = [
      ": ping",
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}',
      "",
    ].join("\n");

    expect(readJsonRpcMessages(body)).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: 1 } }]);
  });
});

// ── stdio ─────────────────────────────────────────────────────────────

interface FakeChild extends McpProbeChildProcess {
  emitStdout(chunk: string): void;
  /** Throws when nothing is listening, exactly as Node does for an unhandled `error` event. */
  emitStdinError(error: Error): void;
  emitStdoutError(error: Error): void;
  readonly written: string[];
  readonly killed: () => boolean;
  readonly unreffed: () => boolean;
}

function emitStreamError(listener: ((error: Error) => void) | undefined, error: Error): void {
  if (!listener) throw error;
  listener(error);
}

function createFakeChild(): FakeChild {
  const written: string[] = [];
  let dataListener: ((chunk: string) => void) | undefined;
  let stdinErrorListener: ((error: Error) => void) | undefined;
  let stdoutErrorListener: ((error: Error) => void) | undefined;
  let killed = false;
  let unreffed = false;

  return {
    written,
    killed: () => killed,
    unreffed: () => unreffed,
    emitStdout: (chunk) => dataListener?.(chunk),
    emitStdinError: (error) => emitStreamError(stdinErrorListener, error),
    emitStdoutError: (error) => emitStreamError(stdoutErrorListener, error),
    stdin: {
      write: (chunk: string) => written.push(chunk),
      end: () => undefined,
      on: (_event: "error", listener: (error: Error) => void) => {
        stdinErrorListener = listener;
      },
    },
    stdout: {
      setEncoding: () => undefined,
      on: (event: "data" | "error", listener: (payload: never) => void) => {
        if (event === "data") {
          dataListener = listener as unknown as (chunk: string) => void;
          return;
        }
        stdoutErrorListener = listener as unknown as (error: Error) => void;
      },
    },
    on: () => undefined,
    kill: () => {
      killed = true;
    },
    unref: () => {
      unreffed = true;
    },
  };
}

describe("probeMcpServerTools over stdio", () => {
  it("reassembles newline-delimited frames split across chunks", async () => {
    const child = createFakeChild();
    const probe = probeMcpServerTools({
      connection: STDIO_CONNECTION,
      spawnProcess: () => child,
    });

    // Answer each request as it arrives, splitting one frame mid-JSON on purpose.
    await vi.waitFor(() => expect(child.written).toHaveLength(1));
    child.emitStdout('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}\n');
    await vi.waitFor(() => expect(child.written).toHaveLength(3));
    child.emitStdout('{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"deco');
    child.emitStdout('mpile","description":"Decompile."}]}}\n');

    await expect(probe).resolves.toEqual([{ name: "decompile", description: "Decompile." }]);
    expect(child.killed()).toBe(true);
    expect(child.unreffed()).toBe(true);
  });

  it("sends only the three handshake messages", async () => {
    const child = createFakeChild();
    const probe = probeMcpServerTools({ connection: STDIO_CONNECTION, spawnProcess: () => child });

    await vi.waitFor(() => expect(child.written).toHaveLength(1));
    child.emitStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await vi.waitFor(() => expect(child.written).toHaveLength(3));
    child.emitStdout('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n');
    await probe;

    expect(child.written.map((line) => JSON.parse(line).method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
  });

  it("kills the child when the probe times out", async () => {
    const child = createFakeChild();
    const killProcessTree = vi.fn();

    await expect(
      probeMcpServerTools({
        connection: STDIO_CONNECTION,
        spawnProcess: () => child,
        killProcessTree,
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/did not respond within/);
    expect(child.killed()).toBe(true);
    expect(child.unreffed()).toBe(true);
    // A directly spawned server is its own process; no tree walk is needed to reach it.
    expect(killProcessTree).not.toHaveBeenCalled();
  });

  it("fails the probe when stdin reports an error asynchronously", async () => {
    const child = createFakeChild();
    const probe = probeMcpServerTools({
      connection: STDIO_CONNECTION,
      spawnProcess: () => child,
      timeoutMs: 5_000,
    });

    await vi.waitFor(() => expect(child.written).toHaveLength(1));
    // EPIPE never reaches the `write` call site. Unlistened it would be an uncaught exception,
    // which takes down the server process rather than this one probe.
    expect(() => child.emitStdinError(new Error("write EPIPE"))).not.toThrow();

    await expect(probe).rejects.toThrow(/write EPIPE/);
    expect(child.killed()).toBe(true);
  });

  it("fails the probe when stdout reports an error asynchronously", async () => {
    const child = createFakeChild();
    const probe = probeMcpServerTools({
      connection: STDIO_CONNECTION,
      spawnProcess: () => child,
      timeoutMs: 5_000,
    });

    await vi.waitFor(() => expect(child.written).toHaveLength(1));
    expect(() => child.emitStdoutError(new Error("read ECONNRESET"))).not.toThrow();

    await expect(probe).rejects.toThrow(/read ECONNRESET/);
    expect(child.killed()).toBe(true);
  });

  it("takes down the whole tree when the child is a Windows shell wrapper", async () => {
    const child = createFakeChild();
    const wrapper: McpProbeChildProcess = { ...child, shellWrapped: true, pid: 4242 };
    const killProcessTree = vi.fn();

    await expect(
      probeMcpServerTools({
        connection: STDIO_CONNECTION,
        spawnProcess: () => wrapper,
        killProcessTree,
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/did not respond within/);

    expect(killProcessTree.mock.calls.map(([pid]) => pid)).toEqual([4242]);
    // cmd.exe must stay alive until taskkill has walked down from it, or the server it forked
    // is reparented and survives the probe.
    expect(child.killed()).toBe(false);
  });

  it("falls back to killing the wrapper when the tree kill cannot run", async () => {
    const child = createFakeChild();
    const wrapper: McpProbeChildProcess = { ...child, shellWrapped: true, pid: 4242 };

    await expect(
      probeMcpServerTools({
        connection: STDIO_CONNECTION,
        spawnProcess: () => wrapper,
        killProcessTree: (_pid, fallback) => fallback(),
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/did not respond within/);
    expect(child.killed()).toBe(true);
  });

  it("scrubs env values out of a failure message", async () => {
    const child = createFakeChild();
    const failing: McpProbeChildProcess = {
      ...child,
      stdin: {
        write: () => {
          throw new Error("write failed for ctx7sk-plaintext-secret");
        },
        end: () => undefined,
        on: () => undefined,
      },
    };

    await expect(
      probeMcpServerTools({ connection: STDIO_CONNECTION, spawnProcess: () => failing }),
    ).rejects.toThrow(/write failed for <redacted>/);
  });

  it("scrubs a short value under a credential-named key but spares an ordinary one", async () => {
    const child = createFakeChild();
    const failing: McpProbeChildProcess = {
      ...child,
      stdin: {
        write: () => {
          throw new Error("spawn failed: pin=123 mode=dev");
        },
        end: () => undefined,
        on: () => undefined,
      },
    };

    await expect(
      probeMcpServerTools({
        connection: {
          ...STDIO_CONNECTION,
          transport: {
            _tag: "stdio",
            command: "node",
            args: [],
            env: { GATEWAY_TOKEN: "123", MODE: "dev" },
          },
        },
        spawnProcess: () => failing,
      }),
    ).rejects.toThrow("spawn failed: pin=<redacted> mode=dev");
  });
});

// ── http ──────────────────────────────────────────────────────────────

function createFakeFetch(
  handler: (body: Record<string, unknown>) => {
    status?: number;
    body?: string;
    sessionId?: string;
  },
): {
  fetchImpl: McpProbeFetch;
  requests: Array<Record<string, unknown>>;
  headers: Array<Record<string, string>>;
} {
  const requests: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string>> = [];
  return {
    requests,
    headers,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      requests.push(body);
      headers.push(init.headers);
      const response = handler(body);
      const status = response.status ?? 200;
      return {
        ok: status < 400,
        status,
        headers: {
          get: (name) => (name === "mcp-session-id" ? (response.sessionId ?? null) : null),
        },
        text: async () => response.body ?? "",
      };
    },
  };
}

/** Mimics a transport error whose message quotes the full URL and the Authorization header. */
const leakyFetch: McpProbeFetch = async () => {
  throw new Error(
    "connect ECONNREFUSED https://mcp.example.com/mcp?token=supersecret (Bearer topsecrettoken)",
  );
};

describe("probeMcpServerTools over http", () => {
  it("echoes the negotiated session id back on later requests", async () => {
    const { fetchImpl, requests, headers } = createFakeFetch((body) => {
      if (body["method"] === "initialize") {
        return {
          sessionId: "session-42",
          body: JSON.stringify({ jsonrpc: "2.0", id: body["id"], result: {} }),
        };
      }
      if (body["method"] === "tools/list") {
        return {
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: body["id"],
            result: { tools: [{ name: "query-docs", description: "Fetch docs." }] },
          }),
        };
      }
      return { status: 202 };
    });

    await expect(
      probeMcpServerTools({ connection: HTTP_CONNECTION, fetch: fetchImpl }),
    ).resolves.toEqual([{ name: "query-docs", description: "Fetch docs." }]);
    expect(requests.map((request) => request["method"])).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(headers[0]?.["Mcp-Session-Id"]).toBeUndefined();
    expect(headers[2]?.["Mcp-Session-Id"]).toBe("session-42");
    expect(headers[0]?.["Authorization"]).toBe("Bearer topsecrettoken");
  });

  it("surfaces an http failure without leaking the url or header token", async () => {
    const { fetchImpl } = createFakeFetch(() => ({ status: 401 }));

    await expect(
      probeMcpServerTools({ connection: HTTP_CONNECTION, fetch: fetchImpl }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("redacts the endpoint and header value when a transport error quotes them", async () => {
    await expect(
      probeMcpServerTools({ connection: HTTP_CONNECTION, fetch: leakyFetch }),
    ).rejects.toThrow(/https:\/\/mcp\.example\.com\/mcp \(<redacted>\)/);
  });
});

describe("resolveMcpProbeSpawnTarget", () => {
  it("is the identity on posix", () => {
    expect(
      resolveMcpProbeSpawnTarget({
        command: "npx",
        args: ["-y", "pkg"],
        platform: "linux",
        env: {},
      }),
    ).toEqual({ command: "npx", args: ["-y", "pkg"], shell: false });
  });

  it("passes an unresolvable Windows command through so the spawn error is the real one", () => {
    expect(
      resolveMcpProbeSpawnTarget({
        command: "definitely-not-installed",
        args: ["a b"],
        platform: "win32",
        env: { PATH: "", PATHEXT: ".COM;.EXE;.CMD" },
      }),
    ).toEqual({ command: "definitely-not-installed", args: ["a b"], shell: false });
  });

  it("routes an explicit .cmd through cmd.exe with quoted arguments", () => {
    expect(
      resolveMcpProbeSpawnTarget({
        command: "C:\\tools\\npx.cmd",
        args: ["-y", 'a "quoted" arg'],
        platform: "win32",
        env: { PATH: "", PATHEXT: ".COM;.EXE;.CMD" },
      }),
    ).toEqual({
      command: '"C:\\tools\\npx.cmd"',
      args: ['"-y"', '"a ""quoted"" arg"'],
      shell: true,
    });
  });
});
