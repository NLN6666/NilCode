import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DaemonLog, LOG_FILE, PREVIOUS_LOG_FILE } from "./DaemonLog";

const dirs: string[] = [];
const logs: DaemonLog[] = [];

afterEach(async () => {
  for (const log of logs.splice(0)) await log.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function openLog(options?: { maxBytes?: number }): Promise<DaemonLog> {
  const dir = await mkdtemp(path.join(tmpdir(), "synara-daemonlog-"));
  dirs.push(dir);
  const log = await DaemonLog.open(dir, options);
  logs.push(log);
  return log;
}

const readAll = { cursor: 0, lines: 1_000, head: false, grep: null };

describe("DaemonLog output accounting", () => {
  it("counts appended bytes, including multi-byte characters", async () => {
    const log = await openLog();

    await log.append("hello");
    await log.append("世界");

    expect(log.outputBytes).toBe(5 + 6);
  });

  it("returns everything from cursor zero", async () => {
    const log = await openLog();
    await log.append("alpha\nbeta\n");

    const read = await log.read(readAll);

    expect(read.content).toBe("alpha\nbeta\n");
    expect(read.nextCursor).toBe(11);
    expect(read.droppedBytes).toBe(0);
  });

  it("returns only the delta once the cursor advanced", async () => {
    const log = await openLog();
    await log.append("alpha\n");
    const first = await log.read(readAll);
    await log.append("beta\n");

    const second = await log.read({ ...readAll, cursor: first.nextCursor });

    expect(second.content).toBe("beta\n");
    expect(second.nextCursor).toBe(11);
  });

  it("never splits a multi-byte character at the cursor", async () => {
    const log = await openLog();
    await log.append("你好");

    const read = await log.read({ ...readAll, cursor: 1 });

    expect(read.content).not.toContain("�");
    expect(read.content).toBe("好");
  });
});

describe("DaemonLog rotation", () => {
  it("keeps reads continuous across a rotation", async () => {
    const log = await openLog({ maxBytes: 64 });

    await log.append("a".repeat(50) + "\n");
    await log.append("b".repeat(50) + "\n");
    const read = await log.read(readAll);

    // The rotation moved the first block into the previous file; both must show up.
    expect(read.content).toContain("a".repeat(50));
    expect(read.content).toContain("b".repeat(50));
  });

  it("reports dropped bytes once content falls off the back", async () => {
    const log = await openLog({ maxBytes: 64 });

    for (let index = 0; index < 20; index += 1) {
      await log.append(`${index}`.padStart(9, "0") + "\n");
    }
    const read = await log.read(readAll);

    expect(read.droppedBytes).toBeGreaterThan(0);
    expect(read.nextCursor).toBe(log.outputBytes);
  });

  it("moves a pre-existing log aside on open instead of discarding it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synara-daemonlog-"));
    dirs.push(dir);
    await writeFile(path.join(dir, LOG_FILE), "from the previous run\n");

    const log = await DaemonLog.open(dir);
    logs.push(log);

    expect(await readFile(path.join(dir, PREVIOUS_LOG_FILE), "utf8")).toBe(
      "from the previous run\n",
    );
  });
});

describe("DaemonLog filtering", () => {
  it("returns only the last N lines", async () => {
    const log = await openLog();
    await log.append("one\ntwo\nthree\nfour\nfive\n");

    const read = await log.read({ ...readAll, lines: 2 });

    expect(read.content.trim().split("\n")).toEqual(["four", "five"]);
  });

  it("returns the first N lines when reading from the head", async () => {
    const log = await openLog();
    await log.append("one\ntwo\nthree\nfour\nfive\n");

    const read = await log.read({ ...readAll, lines: 2, head: true });

    expect(read.content.trim().split("\n")).toEqual(["one", "two"]);
  });

  it("filters lines by regular expression", async () => {
    const log = await openLog();
    await log.append("[INFO] fine\n[ERROR] broken\n[WARN] iffy\n");

    const read = await log.read({ ...readAll, grep: "ERROR|WARN" });

    expect(read.content.trim().split("\n")).toEqual(["[ERROR] broken", "[WARN] iffy"]);
  });

  it("treats an invalid pattern as matching nothing rather than throwing", async () => {
    const log = await openLog();
    await log.append("[INFO] fine\n");

    const read = await log.read({ ...readAll, grep: "([unclosed" });

    expect(read.content).toBe("");
  });

  it("advances the cursor past filtered-out content", async () => {
    const log = await openLog();
    await log.append("[INFO] fine\n[ERROR] broken\n");

    const read = await log.read({ ...readAll, grep: "ERROR" });

    // Filtering shapes what the caller sees; it must not strand the cursor, or a
    // follow-up read would replay the same lines forever.
    expect(read.nextCursor).toBe(log.outputBytes);
  });
});
