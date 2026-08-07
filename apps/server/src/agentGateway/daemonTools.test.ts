import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DAEMON_LOGS_MAX_LINES, SYNARA_GATEWAY_MAX_WAIT_MS } from "@synara/contracts";
import type { DaemonSnapshot } from "@synara/contracts";

import { DaemonError, type DaemonBrokerShape } from "../daemon/Services/Broker";
import type { McpToolCallResult } from "./protocol";
import type { ToolContext, ToolEntry } from "./toolRuntime";
import { makeDaemonTools } from "./daemonTools";

const snapshot = {
  name: "mc",
  id: "d1",
  state: "running",
  pid: 4_242,
  outputBytes: 128,
} as DaemonSnapshot;

const context = {} as ToolContext;

function stubBroker(overrides: Partial<DaemonBrokerShape> = {}) {
  const broker: DaemonBrokerShape = {
    start: vi.fn(() => Effect.succeed(snapshot)),
    list: Effect.succeed([snapshot]),
    describe: vi.fn(() => Effect.succeed(snapshot)),
    logs: vi.fn(() =>
      Effect.succeed({
        snapshot,
        content: "hello\n",
        nextCursor: 128,
        droppedBytes: 64,
        truncated: false,
      }),
    ),
    send: vi.fn(() => Effect.succeed(snapshot)),
    wait: vi.fn(() => Effect.succeed({ snapshot, matched: false, timedOut: true })),
    stop: vi.fn(() => Effect.succeed(snapshot)),
    restart: vi.fn(() => Effect.succeed(snapshot)),
    reclaimDetached: Effect.succeed([]),
    dispose: Effect.void,
    ...overrides,
  };
  return { broker, tools: makeDaemonTools({ broker }) };
}

function toolNamed(tools: ReadonlyArray<ToolEntry>, name: string): ToolEntry {
  const entry = tools.find((candidate) => candidate.definition.name === name);
  if (entry === undefined) throw new Error(`no tool named ${name}`);
  return entry;
}

function call(
  tools: ReadonlyArray<ToolEntry>,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  return Effect.runPromise(toolNamed(tools, name).handler(args, context));
}

function payload(result: McpToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("tool surface", () => {
  it("exposes exactly the eight daemon operations", () => {
    const { tools } = stubBroker();

    expect(tools.map((tool) => tool.definition.name)).toEqual([
      "synara_start_daemon",
      "synara_list_daemons",
      "synara_describe_daemon",
      "synara_read_daemon_logs",
      "synara_send_daemon_input",
      "synara_wait_daemon",
      "synara_stop_daemon",
      "synara_restart_daemon",
    ]);
  });

  it("gates every tool behind daemon:control", () => {
    const { tools } = stubBroker();

    expect(tools.every((tool) => tool.requiredCapability === "daemon:control")).toBe(true);
  });

  it("warns in the stop description that force-killing can corrupt saved state", () => {
    // The description is the only place an agent learns that stopping a Minecraft
    // server the blunt way can lose a world; it is load-bearing, not decoration.
    const { tools } = stubBroker();
    const description = toolNamed(tools, "synara_stop_daemon").definition.description;

    expect(description).toContain("synara_send_daemon_input");
    expect(description).toContain("corrupt saved state");
  });

  it("marks the blocking tools as not read-only", () => {
    const { tools } = stubBroker();

    expect(toolNamed(tools, "synara_wait_daemon").definition.annotations?.readOnlyHint).toBe(false);
    expect(toolNamed(tools, "synara_read_daemon_logs").definition.annotations?.readOnlyHint).toBe(
      false,
    );
    expect(toolNamed(tools, "synara_list_daemons").definition.annotations?.readOnlyHint).toBe(true);
  });
});

describe("synara_start_daemon", () => {
  it("decodes a spec and applies contract defaults", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_start_daemon", {
      name: "mc",
      application: "java",
      args: ["-jar", "server.jar"],
      ready: { log: "Done \\(" },
    });

    expect(broker.start).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "mc",
        application: "java",
        args: ["-jar", "server.jar"],
        pty: true,
        restart: "no",
        detached: false,
      }),
    );
  });

  it("rejects a name that could escape its log directory", async () => {
    const { broker, tools } = stubBroker();

    const result = await call(tools, "synara_start_daemon", {
      name: "../escape",
      application: "java",
    });

    expect(result.isError).toBe(true);
    expect(broker.start).not.toHaveBeenCalled();
  });

  it("rejects a non-string environment value instead of coercing it", async () => {
    const { tools } = stubBroker();

    const result = await call(tools, "synara_start_daemon", {
      name: "mc",
      application: "java",
      env: { PORT: 25565 },
    });

    expect(result.isError).toBe(true);
  });
});

describe("synara_read_daemon_logs", () => {
  it("clamps a line count above the contract ceiling", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_read_daemon_logs", { name: "mc", lines: 100_000 });

    expect(broker.logs).toHaveBeenCalledWith(
      expect.objectContaining({ lines: DAEMON_LOGS_MAX_LINES }),
    );
  });

  it("clamps a follow timeout to the gateway ceiling rather than failing", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_read_daemon_logs", { name: "mc", follow: true, timeout: 3_600 });

    expect(broker.logs).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: SYNARA_GATEWAY_MAX_WAIT_MS }),
    );
  });

  it("passes dropped bytes through instead of hiding the gap", async () => {
    // An agent that believed the stream was continuous would draw conclusions from
    // output that silently lost its middle.
    const { tools } = stubBroker();

    const result = await call(tools, "synara_read_daemon_logs", { name: "mc" });

    expect(payload(result).droppedBytes).toBe(64);
    expect(payload(result).nextCursor).toBe(128);
  });

  it("defaults to a tail read from the start of the log", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_read_daemon_logs", { name: "mc" });

    expect(broker.logs).toHaveBeenCalledWith(
      expect.objectContaining({ head: false, cursor: 0, follow: false, grep: null }),
    );
  });
});

describe("synara_send_daemon_input", () => {
  it("submits text with a carriage return by default", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_send_daemon_input", { name: "mc", text: "list" });

    expect(broker.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "list", enter: true, keys: [], signal: null }),
    );
  });

  it("rejects an unknown key name rather than passing bytes through", async () => {
    // Passing the name through would let a model smuggle arbitrary control bytes
    // into a live console under the guise of a key.
    const { broker, tools } = stubBroker();

    const result = await call(tools, "synara_send_daemon_input", {
      name: "mc",
      keys: ["CTRL_ALT_DEL"],
    });

    expect(result.isError).toBe(true);
    expect(broker.send).not.toHaveBeenCalled();
  });

  it("accepts a whitelisted key", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_send_daemon_input", { name: "mc", keys: ["CTRL_C"] });

    expect(broker.send).toHaveBeenCalledWith(expect.objectContaining({ keys: ["CTRL_C"] }));
  });

  it("rejects a signal outside the whitelist", async () => {
    const { broker, tools } = stubBroker();

    const result = await call(tools, "synara_send_daemon_input", { name: "mc", signal: "SIGSTOP" });

    expect(result.isError).toBe(true);
    expect(broker.send).not.toHaveBeenCalled();
  });

  it("normalizes an allowed signal to upper case", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_send_daemon_input", { name: "mc", signal: "sigterm" });

    expect(broker.send).toHaveBeenCalledWith(expect.objectContaining({ signal: "SIGTERM" }));
  });

  it("surfaces the reason a detached daemon refused the write", async () => {
    const { tools } = stubBroker({
      send: vi.fn(() =>
        Effect.fail(
          new DaemonError({
            code: "daemon_failed",
            message: "daemon mc is detached: its stdio is redirected to the log file",
          }),
        ),
      ),
    });

    const result = await call(tools, "synara_send_daemon_input", { name: "mc", text: "stop" });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("detached");
  });
});

describe("synara_wait_daemon", () => {
  it("reports a timeout as data, not as a failed call", async () => {
    // A timeout is an answer — "not yet" — and an isError result would push the agent
    // toward retry logic instead of a longer wait.
    const { tools } = stubBroker();

    const result = await call(tools, "synara_wait_daemon", { name: "mc", for: "ready" });

    expect(result.isError).toBeUndefined();
    expect(payload(result).timedOut).toBe(true);
  });

  it("clamps the timeout to the gateway ceiling", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_wait_daemon", { name: "mc", timeout: 600 });

    expect(broker.wait).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: SYNARA_GATEWAY_MAX_WAIT_MS }),
    );
  });

  it("rejects a condition that is neither ready nor exit", async () => {
    const { broker, tools } = stubBroker();

    const result = await call(tools, "synara_wait_daemon", { name: "mc", for: "restarting" });

    expect(result.isError).toBe(true);
    expect(broker.wait).not.toHaveBeenCalled();
  });

  it("prefers an output pattern over the lifecycle condition", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_wait_daemon", { name: "mc", for: "exit", pattern: "players online" });

    expect(broker.wait).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "players online", for: "exit" }),
    );
  });
});

describe("failure handling", () => {
  it("reports an unknown daemon without falling back to another one", async () => {
    const { tools } = stubBroker({
      describe: vi.fn(() =>
        Effect.fail(
          new DaemonError({ code: "daemon_not_found", message: "no daemon named ghost" }),
        ),
      ),
    });

    const result = await call(tools, "synara_describe_daemon", { name: "ghost" });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("ghost");
  });

  it("requires a name rather than defaulting to some daemon", async () => {
    const { broker, tools } = stubBroker();

    const result = await call(tools, "synara_stop_daemon", {});

    expect(result.isError).toBe(true);
    expect(broker.stop).not.toHaveBeenCalled();
  });

  it("uses the contract's stop grace period by default", async () => {
    const { broker, tools } = stubBroker();

    await call(tools, "synara_stop_daemon", { name: "mc" });

    expect(broker.stop).toHaveBeenCalledWith({ name: "mc", timeoutMs: 5_000 });
  });
});
