import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonSpec } from "@synara/contracts";

import { DaemonLog } from "./DaemonLog";
import type { DaemonExitResult, DaemonProcessHandle } from "./brokerCore";
import { createDaemonLauncher } from "./launcher";

const decodeSpec = Schema.decodeUnknownSync(DaemonSpec);

const dirs: string[] = [];
const spawnedPids: number[] = [];
let dir: string;
let log: DaemonLog;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "synara-launcher-"));
  dirs.push(dir);
  log = await DaemonLog.open(dir);
});

afterEach(async () => {
  await log.close();
  // Detached children outlive this process by design; leaving them behind would
  // accumulate one orphan per test run.
  for (const pid of spawnedPids.splice(0)) {
    try {
      globalThis.process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const target of dirs.splice(0)) await rm(target, { recursive: true, force: true });
});

function track(handle: DaemonProcessHandle): DaemonProcessHandle {
  if (handle.pid > 0) spawnedPids.push(handle.pid);
  return handle;
}

function exitOf(handle: DaemonProcessHandle): Promise<DaemonExitResult> {
  return new Promise((resolve) => handle.onExit(resolve));
}

function collectOutput(handle: DaemonProcessHandle): { text: () => string } {
  let text = "";
  handle.onOutput((chunk) => {
    text += chunk;
  });
  return { text: () => text };
}

/** Node evaluating an inline program: available on every platform the server runs on. */
function nodeSpec(name: string, program: string, overrides: Record<string, unknown> = {}) {
  return decodeSpec({
    name,
    application: globalThis.process.execPath,
    args: ["-e", program],
    pty: false,
    ...overrides,
  });
}

describe("piped launch", () => {
  it("streams stdout and stderr to the output listener", async () => {
    const launcher = createDaemonLauncher();
    const handle = track(
      await launcher.launch({
        spec: nodeSpec("piped", "process.stdout.write('out\\n');process.stderr.write('err\\n')"),
        dir,
        log,
      }),
    );
    const output = collectOutput(handle);

    await exitOf(handle);

    expect(output.text()).toContain("out");
    expect(output.text()).toContain("err");
  });

  it("reports the exit code", async () => {
    const launcher = createDaemonLauncher();
    const handle = track(
      await launcher.launch({ spec: nodeSpec("code", "process.exit(3)"), dir, log }),
    );

    expect((await exitOf(handle)).code).toBe(3);
  });

  it("delivers written text to the child's stdin", async () => {
    const launcher = createDaemonLauncher();
    const handle = track(
      await launcher.launch({
        spec: nodeSpec(
          "stdin",
          "process.stdin.setEncoding('utf8');process.stdin.on('data',(d)=>{process.stdout.write('got:'+d.trim()+'\\n');process.exit(0)})",
        ),
        dir,
        log,
      }),
    );
    const output = collectOutput(handle);

    handle.write("hello\n");
    await exitOf(handle);

    expect(output.text()).toContain("got:hello");
  });

  it("settles instead of hanging when the executable does not exist", async () => {
    // Without this the daemon would sit in `starting` forever waiting on a child
    // that was never created.
    const launcher = createDaemonLauncher();
    const handle = await launcher.launch({
      spec: decodeSpec({
        name: "missing",
        application: "synara-no-such-binary",
        pty: false,
      }),
      dir,
      log,
    });

    const result = await exitOf(handle);
    expect(result.code).not.toBe(0);
  });
});

describe("late listener registration", () => {
  // The broker attaches its listeners after `await launch(...)` resolves. A process
  // that dies in that window must still be reported, or the daemon sits in `starting`
  // forever waiting on an exit that already happened.
  it("delivers an exit that happened before the listener was attached", async () => {
    const launcher = createDaemonLauncher();
    const handle = await launcher.launch({
      spec: nodeSpec("fast", "process.exit(7)"),
      dir,
      log,
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect((await exitOf(handle)).code).toBe(7);
  });

  it("delivers output produced before the listener was attached", async () => {
    const launcher = createDaemonLauncher();
    const handle = await launcher.launch({
      spec: nodeSpec("early", "process.stdout.write('early banner\\n')"),
      dir,
      log,
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    const output = collectOutput(handle);

    expect(output.text()).toContain("early banner");
  });
});

describe("pty launch", () => {
  it("passes the spec through to node-pty and wires the handle", async () => {
    // The real native binding is exercised by the terminal suite; here the loader is
    // faked so the assertion is about what the launcher asks for, not about node-pty.
    const listeners: { data?: (chunk: string) => void; exit?: (event: unknown) => void } = {};
    const spawn = vi.fn(() => ({
      pid: 4_242,
      write: vi.fn(),
      kill: vi.fn(),
      onData: (listener: (chunk: string) => void) => {
        listeners.data = listener;
      },
      onExit: (listener: (event: unknown) => void) => {
        listeners.exit = listener;
      },
    }));
    const launcher = createDaemonLauncher({
      loadPty: async () => ({ spawn }) as unknown as typeof import("node-pty"),
    });

    const handle = await launcher.launch({
      spec: decodeSpec({
        name: "mc",
        application: "java",
        args: ["-jar", "server.jar"],
        cwd: dir,
        env: { SYNARA_TEST: "1" },
      }),
      dir,
      log,
    });
    const output = collectOutput(handle);

    expect(handle.pid).toBe(4_242);
    const [application, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string> },
    ];
    expect(application).toBe("java");
    expect(args).toEqual(["-jar", "server.jar"]);
    expect(options.cwd).toBe(dir);
    expect(options.env.SYNARA_TEST).toBe("1");

    listeners.data?.("Done (1.0s)!");
    expect(output.text()).toBe("Done (1.0s)!");

    const exited = exitOf(handle);
    listeners.exit?.({ exitCode: 0, signal: undefined });
    expect((await exited).code).toBe(0);
  });
});

describe("detached launch", () => {
  it("writes the child's output into the log file and replays it as output", async () => {
    const launcher = createDaemonLauncher({ tailIntervalMs: 20 });
    const handle = track(
      await launcher.launch({
        spec: nodeSpec("detached", "process.stdout.write('booted\\n')", { detached: true }),
        dir,
        log,
      }),
    );
    const output = collectOutput(handle);

    await exitOf(handle);

    expect(await readFile(log.filePath, "utf8")).toContain("booted");
    // The broker never appends for this handle, so the replay is the only path by
    // which readiness patterns can ever match a detached daemon.
    expect(output.text()).toContain("booted");
    expect(handle.writesOwnLog).toBe(true);
  });

  it("advances the log's byte counter without the broker appending anything", async () => {
    const launcher = createDaemonLauncher({ tailIntervalMs: 20 });
    const handle = track(
      await launcher.launch({
        spec: nodeSpec("bytes", "process.stdout.write('12345')", { detached: true }),
        dir,
        log,
      }),
    );

    await exitOf(handle);

    expect(log.outputBytes).toBe(5);
  });

  it("refuses stdin rather than pretending to write it", async () => {
    const launcher = createDaemonLauncher({ tailIntervalMs: 20 });
    const handle = track(
      await launcher.launch({
        spec: nodeSpec("nostdin", "setTimeout(()=>{},50)", { detached: true }),
        dir,
        log,
      }),
    );

    expect(() => handle.write("stop\n")).toThrow(/stdin/iu);
    await exitOf(handle);
  });

  it("does not replay the previous run's output after a relaunch", async () => {
    // A relaunched daemon that re-saw the old run's ready banner would report itself
    // ready before the new process had printed anything.
    const launcher = createDaemonLauncher({ tailIntervalMs: 20 });
    const first = track(
      await launcher.launch({
        spec: nodeSpec("relaunch", "process.stdout.write('first run\\n')", { detached: true }),
        dir,
        log,
      }),
    );
    await exitOf(first);

    const second = track(
      await launcher.launch({
        spec: nodeSpec("relaunch", "process.stdout.write('second run\\n')", { detached: true }),
        dir,
        log,
      }),
    );
    const output = collectOutput(second);
    await exitOf(second);

    expect(output.text()).toContain("second run");
    expect(output.text()).not.toContain("first run");
  });
});
