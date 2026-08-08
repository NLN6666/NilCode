import type { DaemonSnapshot } from "@synara/contracts";
import { DAEMON_LOGS_MAX_LINES } from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  daemonRosterEvent,
  readDaemonLogs,
  restartDaemon,
  sendDaemonText,
  stopDaemon,
} from "./daemonClientOperations";
import { DaemonError, type DaemonBrokerShape } from "./Services/Broker";

const snapshot = { name: "mc", id: "d1", state: "running", outputBytes: 512 } as DaemonSnapshot;

function stubBroker(overrides: Partial<DaemonBrokerShape> = {}) {
  return {
    list: Effect.succeed([snapshot]),
    logs: vi.fn(() =>
      Effect.succeed({
        snapshot,
        content: "Done (12.3s)!\n",
        nextCursor: 512,
        droppedBytes: 40,
        truncated: true,
      }),
    ),
    send: vi.fn(() => Effect.succeed(snapshot)),
    stop: vi.fn(() => Effect.succeed(snapshot)),
    restart: vi.fn(() => Effect.succeed(snapshot)),
    ...overrides,
  } as unknown as DaemonBrokerShape;
}

describe("readDaemonLogs", () => {
  it("reads the backlog without blocking, because the live feed carries new output", async () => {
    const broker = stubBroker();

    await Effect.runPromise(readDaemonLogs(broker, { name: "mc", lines: 50 }));

    expect(broker.logs).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mc", lines: 50, follow: false, cursor: 0, timeoutMs: 0 }),
    );
  });

  it("clamps a caller asking for more lines than the shared ceiling", async () => {
    const broker = stubBroker();

    await Effect.runPromise(readDaemonLogs(broker, { name: "mc", lines: 100_000 }));

    expect(broker.logs).toHaveBeenCalledWith(
      expect.objectContaining({ lines: DAEMON_LOGS_MAX_LINES }),
    );
  });

  it("applies the shared default when the field never reached the schema", async () => {
    const broker = stubBroker();

    await Effect.runPromise(readDaemonLogs(broker, { name: "mc" } as never));

    expect(broker.logs).toHaveBeenCalledWith(expect.objectContaining({ lines: 100 }));
  });

  it("passes truncation through verbatim instead of papering over it", async () => {
    const result = await Effect.runPromise(readDaemonLogs(stubBroker(), { name: "mc", lines: 10 }));

    expect(result).toMatchObject({ droppedBytes: 40, truncated: true, nextCursor: 512 });
  });

  it("surfaces an unknown name as the broker's typed error", async () => {
    const broker = stubBroker({
      logs: vi.fn(() =>
        Effect.fail(
          new DaemonError({ code: "daemon_not_found", message: "no daemon named ghost" }),
        ),
      ),
    });

    const exit = await Effect.runPromiseExit(readDaemonLogs(broker, { name: "ghost", lines: 10 }));

    expect(exit._tag).toBe("Failure");
  });
});

describe("sendDaemonText", () => {
  it("submits the line and offers neither terminal keys nor signals", async () => {
    const broker = stubBroker();

    await Effect.runPromise(sendDaemonText(broker, { name: "mc", text: "stop" }));

    // The panel is a line editor: a half-submitted line would leave a stateful server
    // mis-parsing the next one. Keys and signals stay on the agent surface.
    expect(broker.send).toHaveBeenCalledWith({
      name: "mc",
      text: "stop",
      enter: true,
      keys: [],
      signal: null,
    });
  });
});

describe("stopDaemon", () => {
  it("converts the caller's seconds into the broker's milliseconds", async () => {
    const broker = stubBroker();

    await Effect.runPromise(stopDaemon(broker, { name: "mc", timeoutSeconds: 8 }));

    expect(broker.stop).toHaveBeenCalledWith({ name: "mc", timeoutMs: 8_000 });
  });

  it("falls back to the shared default when the field is absent", async () => {
    const broker = stubBroker();

    await Effect.runPromise(stopDaemon(broker, { name: "mc" } as never));

    expect(broker.stop).toHaveBeenCalledWith({ name: "mc", timeoutMs: 5_000 });
  });
});

describe("restartDaemon", () => {
  it("forwards the name", async () => {
    const broker = stubBroker();

    await Effect.runPromise(restartDaemon(broker, { name: "mc" }));

    expect(broker.restart).toHaveBeenCalledWith("mc");
  });
});

describe("daemonRosterEvent", () => {
  it("wraps the live roster as the subscription's opening event", async () => {
    const event = await Effect.runPromise(daemonRosterEvent(stubBroker()));

    expect(event).toEqual({ type: "snapshot", daemons: [snapshot] });
  });
});
