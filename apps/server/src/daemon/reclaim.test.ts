import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonSpec } from "@synara/contracts";

import { createBrokerCore, type BrokerCore, type DaemonProcessHandle } from "./brokerCore";
import { LOG_FILE } from "./DaemonLog";
import {
  daemonDirectory,
  readDaemonMetadata,
  writeDaemonMetadata,
  type PersistedDaemon,
} from "./persistence";
import type { ProcessIdentity, ProcessIdentityMap } from "./processIdentity";

const decodeSpec = Schema.decodeUnknownSync(DaemonSpec);

const LIVE_IDENTITY: ProcessIdentity = {
  pid: 4_242,
  startedAt: "Thu Aug  7 10:00:00 2026",
  commandLine: "java -jar server.jar nogui",
};

/** A handle for a process this test pretends is already running. */
class StubHandle implements DaemonProcessHandle {
  readonly writesOwnLog = true;
  consumedBytes = 0;
  readonly signals: string[] = [];
  private exitListener: ((result: { code: number | null; signal: string | null }) => void) | null =
    null;

  constructor(readonly pid: number) {}

  write(): void {
    throw new Error("a detached daemon has no stdin channel");
  }

  signalSelf(signal: string): void {
    this.signals.push(signal);
  }

  killTree(): void {}

  onOutput(): void {}

  onExit(listener: (result: { code: number | null; signal: string | null }) => void): void {
    this.exitListener = listener;
  }

  emitExit(): void {
    this.exitListener?.({ code: null, signal: null });
  }
}

class StubLauncher {
  readonly launched: DaemonProcessHandle[] = [];
  readonly reclaimed: Array<{ identity: ProcessIdentity; outputOffset: number }> = [];
  nextPid = 4_242;

  launch = vi.fn(async (): Promise<DaemonProcessHandle> => {
    const handle = new StubHandle(this.nextPid);
    this.launched.push(handle);
    return handle;
  });

  reclaim = vi.fn((input: { identity: ProcessIdentity; outputOffset: number }) => {
    this.reclaimed.push({ identity: input.identity, outputOffset: input.outputOffset });
    return new StubHandle(input.identity.pid);
  });
}

const dirs: string[] = [];
let rootDir: string;
let launcher: StubLauncher;
const cores: BrokerCore[] = [];

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "synara-reclaim-"));
  dirs.push(rootDir);
  launcher = new StubLauncher();
});

afterEach(async () => {
  for (const core of cores.splice(0)) await core.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function makeCore(identities: ProcessIdentityMap | null): BrokerCore {
  const core = createBrokerCore({ rootDir, launcher, readIdentities: () => identities });
  cores.push(core);
  return core;
}

const detachedSpec = decodeSpec({
  name: "mc",
  application: "java",
  args: ["-jar", "server.jar"],
  detached: true,
  pty: false,
});

async function seedPersisted(overrides: Partial<PersistedDaemon> = {}): Promise<string> {
  const dir = daemonDirectory(rootDir, "mc");
  await writeDaemonMetadata(dir, {
    spec: detachedSpec,
    id: "d1",
    identity: LIVE_IDENTITY,
    createdAt: "2026-08-07T10:00:00.000Z",
    startedAt: "2026-08-07T10:00:01.000Z",
    outputOffset: 0,
    ...overrides,
  });
  return dir;
}

describe("persisting a detached daemon", () => {
  it("records the process identity, not just the pid", async () => {
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));

    await core.start(detachedSpec);

    const persisted = await readDaemonMetadata(daemonDirectory(rootDir, "mc"));
    expect(persisted?.identity).toEqual(LIVE_IDENTITY);
    expect(persisted?.spec.name).toBe("mc");
  });

  it("writes nothing for a supervised daemon", async () => {
    // A supervised daemon dies with the server; reclaiming it would resurrect a
    // process the user never asked to survive.
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));

    await core.start(decodeSpec({ name: "web", application: "node", pty: false }));

    expect(await readDaemonMetadata(daemonDirectory(rootDir, "web"))).toBeNull();
  });

  it("drops the record once the daemon exits", async () => {
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));
    await core.start(detachedSpec);

    (launcher.launched[0] as StubHandle).emitExit();
    await vi.waitFor(async () =>
      expect(await readDaemonMetadata(daemonDirectory(rootDir, "mc"))).toBeNull(),
    );
  });
});

describe("reclaimDetached", () => {
  it("adopts a daemon whose identity still matches", async () => {
    await seedPersisted();
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));

    const reclaimed = await core.reclaimDetached();

    expect(reclaimed.map((entry) => entry.name)).toEqual(["mc"]);
    expect(core.describe("mc").state).toBe("running");
    expect(core.describe("mc").pid).toBe(4_242);
  });

  it("preserves the original id and creation time", async () => {
    await seedPersisted();
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));

    await core.reclaimDetached();

    expect(core.describe("mc").id).toBe("d1");
    expect(core.describe("mc").createdAt).toBe("2026-08-07T10:00:00.000Z");
  });

  it("resumes the log tail from the recorded offset", async () => {
    await seedPersisted({ outputOffset: 512 });
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));

    await core.reclaimDetached();

    expect(launcher.reclaimed[0]?.outputOffset).toBe(512);
  });

  it("keeps reading the log the daemon has been writing all along", async () => {
    // Reclaim must not rotate the file: the daemon still holds an fd to it, so a
    // rename would leave it writing into a log nobody reads.
    const dir = await seedPersisted();
    await writeFile(path.join(dir, LOG_FILE), "before the restart\n", "utf8");
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));

    await core.reclaimDetached();
    await appendFile(path.join(dir, LOG_FILE), "after the restart\n", "utf8");

    const read = await core.logs({
      name: "mc",
      lines: 100,
      head: false,
      grep: null,
      follow: false,
      cursor: 0,
      timeoutMs: 0,
    });
    expect(read.content).toContain("before the restart");
    expect(read.content).toContain("after the restart");
  });

  it("records a dead daemon as gone and forgets it", async () => {
    await seedPersisted();
    const core = makeCore(new Map());

    const reclaimed = await core.reclaimDetached();

    expect(reclaimed).toEqual([]);
    expect(await readDaemonMetadata(daemonDirectory(rootDir, "mc"))).toBeNull();
  });

  it("does not adopt a pid that now belongs to something else", async () => {
    // The whole reason identity is persisted: pid 4242 has been recycled.
    await seedPersisted();
    const core = makeCore(
      new Map([[4_242, { ...LIVE_IDENTITY, commandLine: "notepad.exe" }]]),
    );

    expect(await core.reclaimDetached()).toEqual([]);
    expect(() => core.describe("mc")).toThrow();
  });

  it("does not adopt a pid whose start time moved", async () => {
    await seedPersisted();
    const core = makeCore(
      new Map([[4_242, { ...LIVE_IDENTITY, startedAt: "Thu Aug  7 18:00:00 2026" }]]),
    );

    expect(await core.reclaimDetached()).toEqual([]);
  });

  it("adopts as running — never as exited — when the identity query fails", async () => {
    // Reporting a live Minecraft server as exited would have the agent relaunch it,
    // putting two processes on one world save. A stale status is the cheaper error.
    await seedPersisted();
    const core = makeCore(null);

    const reclaimed = await core.reclaimDetached();

    expect(reclaimed.map((entry) => entry.state)).toEqual(["running"]);
    expect(await readDaemonMetadata(daemonDirectory(rootDir, "mc"))).not.toBeNull();
  });

  it("leaves an already-tracked daemon alone", async () => {
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));
    await core.start(detachedSpec);

    expect(await core.reclaimDetached()).toEqual([]);
    expect(launcher.reclaim).not.toHaveBeenCalled();
  });

  it("returns nothing when no daemon was ever persisted", async () => {
    expect(await makeCore(new Map()).reclaimDetached()).toEqual([]);
  });

  it("can stop a reclaimed daemon", async () => {
    await seedPersisted();
    const core = makeCore(new Map([[4_242, LIVE_IDENTITY]]));
    await core.reclaimDetached();

    const pending = core.stop({ name: "mc", timeoutMs: 1_000 });
    const handle = launcher.reclaim.mock.results[0]?.value as StubHandle;
    expect(handle.signals).toEqual(["SIGTERM"]);
    handle.emitExit();
    await pending;

    expect(core.describe("mc").state).toBe("exited");
  });
});
