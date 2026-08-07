import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DAEMON_NAME_MAX_LENGTH, DaemonSnapshot, DaemonSpec } from "./daemon";

const decodeSpec = Schema.decodeUnknownSync(DaemonSpec);
const decodeSnapshot = Schema.decodeUnknownSync(DaemonSnapshot);

describe("DaemonSpec", () => {
  it("decodes a minimal spec and applies defaults", () => {
    const spec = decodeSpec({ name: "minecraft", application: "java" });

    expect(spec.args).toEqual([]);
    expect(spec.pty).toBe(true);
    expect(spec.restart).toBe("no");
    expect(spec.persist).toBe(false);
    expect(spec.detached).toBe(false);
  });

  it("rejects a name longer than the cap", () => {
    expect(() =>
      decodeSpec({ name: "x".repeat(DAEMON_NAME_MAX_LENGTH + 1), application: "java" }),
    ).toThrow();
  });

  it("rejects a name carrying path separators", () => {
    // The name doubles as an on-disk directory name, so traversal has to die here.
    expect(() => decodeSpec({ name: "../escape", application: "java" })).toThrow();
    expect(() => decodeSpec({ name: "a/b", application: "java" })).toThrow();
    expect(() => decodeSpec({ name: "a\\b", application: "java" })).toThrow();
  });

  it("accepts a readiness spec carrying both log and port", () => {
    const spec = decodeSpec({
      name: "minecraft",
      application: "java",
      ready: { log: "Done \\(", port: 25_565, timeout: 120 },
    });

    expect(spec.ready?.log).toBe("Done \\(");
    expect(spec.ready?.port).toBe(25_565);
    expect(spec.ready?.timeout).toBe(120);
  });

  it("rejects an unknown restart policy", () => {
    expect(() => decodeSpec({ name: "a", application: "java", restart: "sometimes" })).toThrow();
  });

  it("keeps explicit flags over the defaults", () => {
    const spec = decodeSpec({
      name: "mc",
      application: "java",
      args: ["-jar", "server.jar"],
      pty: false,
      restart: "on-failure",
      persist: true,
      detached: true,
    });

    expect(spec.args).toEqual(["-jar", "server.jar"]);
    expect(spec.pty).toBe(false);
    expect(spec.restart).toBe("on-failure");
    expect(spec.detached).toBe(true);
  });
});

describe("DaemonSnapshot", () => {
  it("round-trips a running snapshot", () => {
    const snapshot = decodeSnapshot({
      name: "minecraft",
      id: "d1",
      state: "running",
      pid: 4242,
      createdAt: "2026-08-07T10:00:00Z",
      startedAt: "2026-08-07T10:00:01Z",
      readyAt: "2026-08-07T10:00:30Z",
      exitedAt: null,
      exitCode: null,
      exitReason: null,
      restartCount: 0,
      outputBytes: 1024,
      readyPending: [],
    });

    expect(snapshot.state).toBe("running");
    expect(snapshot.outputBytes).toBe(1024);
    expect(snapshot.readyPending).toEqual([]);
  });

  it("carries the unmet readiness conditions while starting", () => {
    const snapshot = decodeSnapshot({
      name: "mc",
      id: "d1",
      state: "starting",
      pid: 7,
      createdAt: "2026-08-07T10:00:00Z",
      startedAt: "2026-08-07T10:00:01Z",
      readyAt: null,
      exitedAt: null,
      exitCode: null,
      exitReason: null,
      restartCount: 0,
      outputBytes: 0,
      readyPending: ["log", "port"],
    });

    expect(snapshot.readyPending).toEqual(["log", "port"]);
  });

  it("rejects an unknown state", () => {
    expect(() => decodeSnapshot({ name: "a", id: "d1", state: "zombie" })).toThrow();
  });
});
