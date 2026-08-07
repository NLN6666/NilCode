import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonSpec } from "@synara/contracts";
import { RESTART_BASE_DELAY_MS } from "@synara/shared/daemonRestart";

import { createBrokerCore, type BrokerCore, type DaemonProcessHandle } from "./brokerCore";

const decodeSpec = Schema.decodeUnknownSync(DaemonSpec);

/** A launcher whose processes the test drives by hand. */
class FakeLauncher {
  readonly launched: FakeProcess[] = [];
  nextPid = 1_000;

  launch = vi.fn(async (): Promise<DaemonProcessHandle> => {
    this.nextPid += 1;
    const proc = new FakeProcess(this.nextPid);
    this.launched.push(proc);
    return proc;
  });

  get latest(): FakeProcess {
    const proc = this.launched.at(-1);
    if (proc === undefined) throw new Error("nothing launched yet");
    return proc;
  }
}

class FakeProcess implements DaemonProcessHandle {
  readonly written: string[] = [];
  readonly signals: string[] = [];
  killedWith: string | null = null;
  private outputListener: ((chunk: string) => void) | null = null;
  private exitListener: ((result: { code: number | null; signal: string | null }) => void) | null =
    null;

  constructor(readonly pid: number) {}

  write(data: string): void {
    this.written.push(data);
  }

  signalSelf(signal: string): void {
    this.signals.push(signal);
  }

  killTree(signal: string): void {
    this.killedWith = signal;
  }

  onOutput(listener: (chunk: string) => void): void {
    this.outputListener = listener;
  }

  onExit(listener: (result: { code: number | null; signal: string | null }) => void): void {
    this.exitListener = listener;
  }

  emitOutput(chunk: string): void {
    this.outputListener?.(chunk);
  }

  emitExit(code: number | null, signal: string | null = null): void {
    this.exitListener?.({ code, signal });
  }
}

let launcher: FakeLauncher;
let core: BrokerCore;
let rootDir: string;
const dirs: string[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  rootDir = await mkdtemp(path.join(tmpdir(), "synara-broker-"));
  dirs.push(rootDir);
  launcher = new FakeLauncher();
  core = createBrokerCore({ rootDir, launcher, readIdentities: () => new Map() });
});

afterEach(async () => {
  await core.dispose();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const simpleSpec = () => decodeSpec({ name: "mc", application: "java" });

describe("start", () => {
  it("goes straight to running when no readiness is declared", async () => {
    const snapshot = await core.start(simpleSpec());

    expect(snapshot.state).toBe("running");
    expect(snapshot.pid).toBe(launcher.latest.pid);
  });

  it("stays starting until the readiness pattern matches", async () => {
    const spec = decodeSpec({ name: "mc", application: "java", ready: { log: "Done \\(" } });

    const started = await core.start(spec);
    expect(started.state).toBe("starting");
    expect(started.readyPending).toEqual(["log"]);

    launcher.latest.emitOutput("[Server thread/INFO]: Done (1.2s)!");

    const after = core.describe("mc");
    expect(after.state).toBe("ready");
    expect(after.readyPending).toEqual([]);
    expect(after.readyAt).not.toBeNull();
  });

  it("returns the existing daemon instead of failing on a duplicate name", async () => {
    const first = await core.start(simpleSpec());
    const second = await core.start(simpleSpec());

    expect(second.id).toBe(first.id);
    expect(launcher.launch).toHaveBeenCalledTimes(1);
  });

  it("relaunches a name whose previous run already settled", async () => {
    await core.start(simpleSpec());
    launcher.latest.emitExit(0);

    const restarted = await core.start(simpleSpec());

    expect(restarted.state).toBe("running");
    expect(launcher.launch).toHaveBeenCalledTimes(2);
  });
});

describe("exit handling", () => {
  it("settles a clean exit as exited", async () => {
    await core.start(simpleSpec());

    launcher.latest.emitExit(0);

    const snapshot = core.describe("mc");
    expect(snapshot.state).toBe("exited");
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.exitedAt).not.toBeNull();
  });

  it("settles a non-zero exit as failed", async () => {
    await core.start(simpleSpec());

    launcher.latest.emitExit(1);

    expect(core.describe("mc").state).toBe("failed");
  });

  it("ignores an exit from a superseded generation", async () => {
    // The relaunched process is live; the old one's exit callback must not settle it.
    const spec = decodeSpec({ name: "mc", application: "java", restart: "always" });
    await core.start(spec);
    const first = launcher.latest;

    first.emitExit(1);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);
    expect(core.describe("mc").state).toBe("running");

    first.emitExit(1);

    expect(core.describe("mc").state).toBe("running");
  });
});

describe("restart policy", () => {
  it("does not relaunch under the default policy", async () => {
    await core.start(simpleSpec());

    launcher.latest.emitExit(1);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(launcher.launch).toHaveBeenCalledTimes(1);
  });

  it("relaunches a failure under on-failure but not a clean exit", async () => {
    const spec = decodeSpec({ name: "mc", application: "java", restart: "on-failure" });
    await core.start(spec);

    launcher.latest.emitExit(1);
    expect(core.describe("mc").state).toBe("restarting");
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);
    expect(launcher.launch).toHaveBeenCalledTimes(2);

    launcher.latest.emitExit(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(launcher.launch).toHaveBeenCalledTimes(2);
    expect(core.describe("mc").state).toBe("exited");
  });

  it("backs off exponentially across consecutive failures", async () => {
    const spec = decodeSpec({ name: "mc", application: "java", restart: "always" });
    await core.start(spec);

    launcher.latest.emitExit(1);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS - 10);
    expect(launcher.launch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(launcher.launch).toHaveBeenCalledTimes(2);

    launcher.latest.emitExit(1);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);
    expect(launcher.launch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS);
    expect(launcher.launch).toHaveBeenCalledTimes(3);

    expect(core.describe("mc").restartCount).toBe(2);
  });

  it("resets the failure streak after a run that held long enough", async () => {
    const spec = decodeSpec({ name: "mc", application: "java", restart: "always" });
    await core.start(spec);

    launcher.latest.emitExit(1);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);
    expect(launcher.launch).toHaveBeenCalledTimes(2);

    // This run stays up well past the healthy threshold, so the crash loop is over and
    // the next failure starts the backoff from the base delay rather than doubling.
    await vi.advanceTimersByTimeAsync(30_000);
    launcher.latest.emitExit(1);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);

    expect(launcher.launch).toHaveBeenCalledTimes(3);
  });

  it("keeps escalating when a relaunch dies immediately", async () => {
    const spec = decodeSpec({ name: "mc", application: "java", restart: "always" });
    await core.start(spec);

    launcher.latest.emitExit(1);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);
    launcher.latest.emitExit(1);

    // Second failure in a row: the base delay must not be enough this time.
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS + 10);
    expect(launcher.launch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RESTART_BASE_DELAY_MS);
    expect(launcher.launch).toHaveBeenCalledTimes(3);
  });
});

describe("send", () => {
  it("appends a carriage return when enter is set", async () => {
    await core.start(simpleSpec());

    await core.send({ name: "mc", text: "op Steve", enter: true, keys: [], signal: null });

    expect(launcher.latest.written).toEqual(["op Steve\r"]);
  });

  it("writes bare text when enter is cleared", async () => {
    await core.start(simpleSpec());

    await core.send({ name: "mc", text: "y", enter: false, keys: [], signal: null });

    expect(launcher.latest.written).toEqual(["y"]);
  });

  it("writes resolved key bytes after the text", async () => {
    await core.start(simpleSpec());

    await core.send({ name: "mc", text: null, enter: false, keys: ["CTRL_C"], signal: null });

    expect(launcher.latest.written).toEqual(["\x03"]);
  });

  it("delivers a signal without touching stdin", async () => {
    await core.start(simpleSpec());

    await core.send({ name: "mc", text: null, enter: false, keys: [], signal: "SIGTERM" });

    expect(launcher.latest.signals).toEqual(["SIGTERM"]);
    expect(launcher.latest.written).toEqual([]);
  });

  it("refuses stdin on a detached daemon and says why", async () => {
    await core.start(decodeSpec({ name: "mc", application: "java", detached: true, pty: false }));

    await expect(
      core.send({ name: "mc", text: "stop", enter: true, keys: [], signal: null }),
    ).rejects.toThrow(/detached/iu);
  });

  it("refuses to write to a daemon that already exited", async () => {
    await core.start(simpleSpec());
    launcher.latest.emitExit(0);

    await expect(
      core.send({ name: "mc", text: "stop", enter: true, keys: [], signal: null }),
    ).rejects.toThrow(/exited/iu);
  });
});

describe("wait", () => {
  it("resolves when the process exits", async () => {
    await core.start(simpleSpec());

    const pending = core.wait({ name: "mc", for: "exit", pattern: null, timeoutMs: 5_000 });
    launcher.latest.emitExit(0);
    const result = await pending;

    expect(result.timedOut).toBe(false);
    expect(result.snapshot.state).toBe("exited");
  });

  it("resolves when readiness is reached", async () => {
    await core.start(decodeSpec({ name: "mc", application: "java", ready: { log: "Done \\(" } }));

    const pending = core.wait({ name: "mc", for: "ready", pattern: null, timeoutMs: 5_000 });
    launcher.latest.emitOutput("Done (1.0s)!");
    const result = await pending;

    expect(result.timedOut).toBe(false);
    expect(result.snapshot.state).toBe("ready");
  });

  it("resolves when an output pattern matches, ahead of the lifecycle condition", async () => {
    await core.start(simpleSpec());

    const pending = core.wait({
      name: "mc",
      for: "exit",
      pattern: "There are \\d+ players",
      timeoutMs: 5_000,
    });
    launcher.latest.emitOutput("There are 3 players online\n");
    const result = await pending;

    expect(result.matched).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("reports a timeout without raising an error", async () => {
    await core.start(simpleSpec());

    const pending = core.wait({ name: "mc", for: "exit", pattern: null, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_100);
    const result = await pending;

    expect(result.timedOut).toBe(true);
    expect(result.matched).toBe(false);
  });

  it("wakes a pattern waiter as soon as the process dies", async () => {
    // Otherwise a crashed launch strands the agent until the full timeout lapses.
    await core.start(simpleSpec());

    const pending = core.wait({ name: "mc", for: "exit", pattern: "never", timeoutMs: 60_000 });
    launcher.latest.emitExit(1);
    const result = await pending;

    expect(result.matched).toBe(false);
    expect(result.snapshot.state).toBe("failed");
  });
});

describe("stop", () => {
  it("signals gracefully before force-killing the tree", async () => {
    await core.start(simpleSpec());
    const proc = launcher.latest;

    const pending = core.stop({ name: "mc", timeoutMs: 5_000 });
    expect(proc.signals).toEqual(["SIGTERM"]);
    proc.emitExit(0, "SIGTERM");
    await pending;

    expect(proc.killedWith).toBeNull();
    expect(core.describe("mc").state).toBe("exited");
  });

  it("force-kills once the grace period lapses", async () => {
    await core.start(simpleSpec());
    const proc = launcher.latest;

    const pending = core.stop({ name: "mc", timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_100);
    proc.emitExit(null, "SIGKILL");
    await pending;

    expect(proc.killedWith).toBe("SIGKILL");
  });

  it("does not relaunch a daemon the caller stopped on purpose", async () => {
    await core.start(decodeSpec({ name: "mc", application: "java", restart: "always" }));
    const proc = launcher.latest;

    const pending = core.stop({ name: "mc", timeoutMs: 1_000 });
    proc.emitExit(143, "SIGTERM");
    await pending;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(launcher.launch).toHaveBeenCalledTimes(1);
    expect(core.describe("mc").state).toBe("exited");
  });
});

describe("list and describe", () => {
  it("lists every known daemon", async () => {
    await core.start(simpleSpec());
    await core.start(decodeSpec({ name: "web", application: "node" }));

    expect(core.list().map((entry) => entry.name).sort()).toEqual(["mc", "web"]);
  });

  it("raises a typed error for an unknown name", () => {
    expect(() => core.describe("nope")).toThrow(/nope/u);
  });
});
