import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { DaemonSnapshot } from "@synara/contracts";

import { DaemonNotFoundError, type BrokerCore } from "../brokerCore";
import { DaemonError } from "../Services/Broker";
import { makeDaemonBroker } from "./Broker";

const snapshot = { name: "mc", id: "d1", state: "running" } as DaemonSnapshot;

function stubCore(overrides: Partial<BrokerCore> = {}): BrokerCore {
  return {
    start: vi.fn(async () => snapshot),
    list: vi.fn(() => [snapshot]),
    describe: vi.fn(() => snapshot),
    logs: vi.fn(async () => ({
      snapshot,
      content: "",
      nextCursor: 0,
      droppedBytes: 0,
      truncated: false,
    })),
    send: vi.fn(async () => snapshot),
    wait: vi.fn(async () => ({ snapshot, matched: true, timedOut: false })),
    stop: vi.fn(async () => snapshot),
    restart: vi.fn(async () => snapshot),
    reclaimDetached: vi.fn(async () => []),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("makeDaemonBroker", () => {
  it("passes a snapshot straight through", async () => {
    const broker = makeDaemonBroker(stubCore());

    expect(await Effect.runPromise(broker.describe("mc"))).toEqual(snapshot);
  });

  it("reports an unknown name with a code the agent can act on", async () => {
    const broker = makeDaemonBroker(
      stubCore({
        describe: vi.fn(() => {
          throw new DaemonNotFoundError("ghost");
        }),
      }),
    );

    const error = await Effect.runPromise(Effect.flip(broker.describe("ghost")));

    expect(error).toBeInstanceOf(DaemonError);
    expect(error.code).toBe("daemon_not_found");
    expect(error.message).toContain("ghost");
  });

  it("wraps any other failure as a typed daemon error", async () => {
    const broker = makeDaemonBroker(
      stubCore({
        send: vi.fn(async () => {
          throw new Error("no stdin channel");
        }),
      }),
    );

    const error = await Effect.runPromise(
      Effect.flip(broker.send({ name: "mc", text: "stop", enter: true, keys: [], signal: null })),
    );

    expect(error.code).toBe("daemon_failed");
    expect(error.message).toBe("no stdin channel");
  });

  it("never fails a listing — an empty list beats a broken tool call", async () => {
    const broker = makeDaemonBroker(
      stubCore({
        list: vi.fn(() => {
          throw new Error("state directory unreadable");
        }),
      }),
    );

    expect(await Effect.runPromise(broker.list)).toEqual([]);
  });

  it("survives a reclaim that throws, rather than blocking startup", async () => {
    // Reclaim runs while the server is coming up; refusing to start over one stale
    // record would cost the agent every daemon, not just that one.
    const broker = makeDaemonBroker(
      stubCore({
        reclaimDetached: vi.fn(async () => {
          throw new Error("state directory unreadable");
        }),
      }),
    );

    expect(await Effect.runPromise(broker.reclaimDetached)).toEqual([]);
  });
});
