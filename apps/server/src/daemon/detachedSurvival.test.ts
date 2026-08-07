// Regression guard for findings.md #1.
//
// oh-my-pi spawns Windows daemons with `detached: false`. Under node:child_process that
// child dies with its parent, which would make Synara's detached daemons vanish the
// moment the server exits — silently, with no error anywhere. This test pins the real
// behaviour by spawning actual processes rather than asserting on option objects.
//
// The supervised case is measured alongside the detached one on purpose: the test
// runner may reap process trees when a command finishes (findings.md #2), so "the
// child stopped" only means something if a sibling case kept running under the very
// same conditions.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "testFixtures");
const TICKING_CHILD = path.join(FIXTURES, "tickingChild.cjs");
const SPAWN_AND_EXIT = path.join(FIXTURES, "spawnAndExit.cjs");

const spawnedPids: number[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  // A detached child genuinely outlives this suite; leaving it running would leak an
  // orphan on every test run.
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone — that is the expected state for the supervised case.
    }
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function countTicks(logPath: string): Promise<number> {
  const text = await readFile(logPath, "utf8");
  return text.split("\n").filter((line) => line.startsWith("tick ")).length;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run the intermediate parent to completion and return the pid it reported. */
async function spawnThenExit(mode: "detached" | "supervised", logPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const parent = spawn(process.execPath, [SPAWN_AND_EXIT, TICKING_CHILD, logPath, mode], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    parent.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    parent.on("error", reject);
    parent.on("exit", () => {
      const pid = Number.parseInt(stdout.trim(), 10);
      if (Number.isNaN(pid)) {
        reject(new Error(`intermediate parent reported no pid, stdout=${JSON.stringify(stdout)}`));
        return;
      }
      spawnedPids.push(pid);
      resolve(pid);
    });
  });
}

async function prepareLog(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "synara-daemon-"));
  tempDirs.push(dir);
  const logPath = path.join(dir, "output.log");
  await writeFile(logPath, "");
  return logPath;
}

describe("detached daemon survival", () => {
  it("keeps ticking after its parent exits", async () => {
    const logPath = await prepareLog();

    await spawnThenExit("detached", logPath);
    await delay(1_000);
    const first = await countTicks(logPath);
    await delay(1_000);
    const second = await countTicks(logPath);

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  }, 20_000);

  it("a supervised child does not outlive its parent", async () => {
    const logPath = await prepareLog();

    await spawnThenExit("supervised", logPath);
    await delay(1_000);
    const first = await countTicks(logPath);
    await delay(1_000);
    const second = await countTicks(logPath);

    expect(second).toBe(first);
  }, 20_000);
});
