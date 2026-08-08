import type { DaemonSnapshot } from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DaemonError } from "./Services/Broker";
import { DAEMON_SHUTDOWN_GRACE_MS, shutdownDaemons } from "./shutdown";

const daemon = (name: string, detached: boolean): DaemonSnapshot =>
  ({ name, id: name, state: "running", detached }) as DaemonSnapshot;

function stubBroker(daemons: readonly DaemonSnapshot[]) {
  const stopped: string[] = [];
  const dispose = vi.fn(() => Effect.void);
  return {
    stopped,
    dispose,
    broker: {
      list: Effect.succeed(daemons),
      stop: vi.fn((input: { name: string; timeoutMs: number }) => {
        stopped.push(input.name);
        return Effect.succeed(daemon(input.name, false));
      }),
      dispose: Effect.suspend(dispose),
    },
  };
}

describe("shutdownDaemons", () => {
  it("stops supervised daemons and leaves detached ones running", async () => {
    const { broker, stopped } = stubBroker([
      daemon("vite", false),
      daemon("minecraft", true),
      daemon("postgres", false),
    ]);

    await Effect.runPromise(shutdownDaemons(broker));

    // Detached survival is the whole point of the flag; killing it here would make
    // reclaimDetached dead code on the next boot.
    expect(stopped.toSorted()).toEqual(["postgres", "vite"]);
  });

  it("gives a stateful server longer than the agent-facing default to save", async () => {
    const { broker } = stubBroker([daemon("minecraft", false)]);

    await Effect.runPromise(shutdownDaemons(broker));

    expect(broker.stop).toHaveBeenCalledWith({
      name: "minecraft",
      timeoutMs: DAEMON_SHUTDOWN_GRACE_MS,
    });
  });

  it("disposes the broker even when a stop fails", async () => {
    const { broker, dispose } = stubBroker([daemon("vite", false)]);
    broker.stop.mockReturnValue(
      Effect.fail(new DaemonError({ code: "daemon_failed", message: "wedged" })) as never,
    );

    await Effect.runPromise(shutdownDaemons(broker));

    // dispose is the only thing that checkpoints detached log offsets and closes file
    // handles, so a failed stop must not cost us that.
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes the broker when nothing is running", async () => {
    const { broker, dispose } = stubBroker([]);

    await Effect.runPromise(shutdownDaemons(broker));

    expect(broker.stop).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
