import type { DaemonSnapshot } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { applyDaemonEvent, useDaemonStore } from "./daemonStore";

const daemon = (name: string, state: DaemonSnapshot["state"] = "running"): DaemonSnapshot =>
  ({ name, id: name, state }) as DaemonSnapshot;

const store = () => useDaemonStore.getState();

beforeEach(() => {
  useDaemonStore.getState().reset();
});

describe("roster projection", () => {
  it("marks itself hydrated and selects something on the opening roster", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc"), daemon("vite")] });

    expect(store().hydrated).toBe(true);
    expect(Object.keys(store().daemonsByName).toSorted()).toEqual(["mc", "vite"]);
    expect(store().selectedName).not.toBeNull();
  });

  it("replaces the whole snapshot on a resync", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc"), daemon("gone")] });
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });

    expect(Object.keys(store().daemonsByName)).toEqual(["mc"]);
  });

  it("keeps scrollback for daemons that survive a resync", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });
    applyDaemonEvent(store(), { type: "output", name: "mc", chunk: "hello\n", cursor: 6 });

    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });

    // A blinking socket must not cost the user the log they were reading.
    expect(store().logsByName.mc?.pending).toHaveLength(1);
  });

  it("drops scrollback for daemons the resync no longer knows about", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });
    applyDaemonEvent(store(), { type: "output", name: "mc", chunk: "hello\n", cursor: 6 });

    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("vite")] });

    expect(store().logsByName.mc).toBeUndefined();
  });

  it("re-points a selection at a daemon the resync removed", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("gone")] });
    expect(store().selectedName).toBe("gone");

    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });

    expect(store().selectedName).toBe("mc");
  });

  it("leaves an explicit selection alone when the daemon is still there", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("a"), daemon("b")] });
    store().select("b");

    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("a"), daemon("b")] });

    expect(store().selectedName).toBe("b");
  });
});

describe("state events", () => {
  it("replaces the whole snapshot rather than merging fields", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });

    applyDaemonEvent(store(), {
      type: "state",
      snapshot: { ...daemon("mc", "exited"), exitCode: 1 } as DaemonSnapshot,
    });

    expect(store().daemonsByName.mc).toMatchObject({ state: "exited", exitCode: 1 });
  });

  it("adopts a daemon that appears after the roster", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [] });

    applyDaemonEvent(store(), { type: "state", snapshot: daemon("mc", "starting") });

    expect(store().daemonsByName.mc).toBeDefined();
    expect(store().selectedName).toBe("mc");
  });
});

describe("output events", () => {
  it("buffers output for a daemon whose log was never opened", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });

    applyDaemonEvent(store(), { type: "output", name: "mc", chunk: "Done!\n", cursor: 42 });

    expect(store().logsByName.mc?.cursor).toBe(42);
  });

  it("appends into a hydrated buffer", () => {
    applyDaemonEvent(store(), { type: "snapshot", daemons: [daemon("mc")] });
    store().markLogHydrating("mc");
    store().applyLogBacklog("mc", {
      content: "history\n",
      nextCursor: 8,
      droppedBytes: 0,
      truncated: false,
    });

    applyDaemonEvent(store(), { type: "output", name: "mc", chunk: "live\n", cursor: 13 });

    expect(store().logsByName.mc?.text).toBe("history\nlive\n");
  });
});
