import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DaemonSpec } from "@synara/contracts";

import {
  DAEMON_METADATA_FILE,
  daemonDirectory,
  listPersistedDaemons,
  readDaemonMetadata,
  removeDaemonMetadata,
  writeDaemonMetadata,
  type PersistedDaemon,
} from "./persistence";

const decodeSpec = Schema.decodeUnknownSync(DaemonSpec);

const dirs: string[] = [];
let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "synara-persist-"));
  dirs.push(rootDir);
});

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function makeRecord(name: string): PersistedDaemon {
  return {
    spec: decodeSpec({ name, application: "java", args: ["-jar", "server.jar"], detached: true }),
    id: "d1",
    identity: { pid: 4_242, startedAt: "Thu Aug  7 10:00:00 2026", commandLine: "java -jar x" },
    createdAt: "2026-08-07T10:00:00.000Z",
    startedAt: "2026-08-07T10:00:01.000Z",
    outputOffset: 128,
  };
}

describe("writeDaemonMetadata", () => {
  it("round-trips a record", async () => {
    const dir = daemonDirectory(rootDir, "mc");
    const record = makeRecord("mc");

    await writeDaemonMetadata(dir, record);

    expect(await readDaemonMetadata(dir)).toEqual(record);
  });

  it("creates the directory when it does not exist yet", async () => {
    const dir = daemonDirectory(rootDir, "fresh");

    await writeDaemonMetadata(dir, makeRecord("fresh"));

    expect(await readDaemonMetadata(dir)).not.toBeNull();
  });

  it("leaves no staging file behind", async () => {
    // The atomic write uses a sibling temp file; a leftover would be picked up by
    // nothing, but it would accumulate one file per relaunch.
    const dir = daemonDirectory(rootDir, "mc");

    await writeDaemonMetadata(dir, makeRecord("mc"));

    expect(await readdir(dir)).toEqual([DAEMON_METADATA_FILE]);
  });

  it("overwrites a previous record rather than appending", async () => {
    const dir = daemonDirectory(rootDir, "mc");
    await writeDaemonMetadata(dir, makeRecord("mc"));

    await writeDaemonMetadata(dir, { ...makeRecord("mc"), outputOffset: 9_999 });

    expect((await readDaemonMetadata(dir))?.outputOffset).toBe(9_999);
  });
});

describe("readDaemonMetadata", () => {
  it("returns null when there is no record", async () => {
    expect(await readDaemonMetadata(daemonDirectory(rootDir, "absent"))).toBeNull();
  });

  it("returns null for unparseable JSON instead of throwing", async () => {
    const dir = daemonDirectory(rootDir, "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, DAEMON_METADATA_FILE), "{ not json", "utf8");

    expect(await readDaemonMetadata(dir)).toBeNull();
  });

  it("returns null when the record does not match the schema", async () => {
    // A record from an older layout must not be adopted half-decoded: acting on a
    // spec whose fields moved would launch something other than what was recorded.
    const dir = daemonDirectory(rootDir, "stale");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, DAEMON_METADATA_FILE), JSON.stringify({ id: "d1" }), "utf8");

    expect(await readDaemonMetadata(dir)).toBeNull();
  });
});

describe("listPersistedDaemons", () => {
  it("finds every recorded daemon", async () => {
    await writeDaemonMetadata(daemonDirectory(rootDir, "mc"), makeRecord("mc"));
    await writeDaemonMetadata(daemonDirectory(rootDir, "web"), makeRecord("web"));

    const found = await listPersistedDaemons(rootDir);

    expect(found.map((entry) => entry.record.spec.name).sort()).toEqual(["mc", "web"]);
  });

  it("skips a daemon directory that only holds logs", async () => {
    // A supervised daemon leaves its log directory behind but writes no metadata;
    // reclaiming it would resurrect a process nobody asked to survive.
    await mkdir(daemonDirectory(rootDir, "supervised"), { recursive: true });
    await writeDaemonMetadata(daemonDirectory(rootDir, "mc"), makeRecord("mc"));

    const found = await listPersistedDaemons(rootDir);

    expect(found.map((entry) => entry.record.spec.name)).toEqual(["mc"]);
  });

  it("returns nothing when the root has never been used", async () => {
    expect(await listPersistedDaemons(path.join(rootDir, "never-created"))).toEqual([]);
  });
});

describe("removeDaemonMetadata", () => {
  it("drops the record and tolerates a second removal", async () => {
    const dir = daemonDirectory(rootDir, "mc");
    await writeDaemonMetadata(dir, makeRecord("mc"));

    await removeDaemonMetadata(dir);
    await removeDaemonMetadata(dir);

    expect(await readDaemonMetadata(dir)).toBeNull();
  });
});
