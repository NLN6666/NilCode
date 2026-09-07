import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeWindowsHangDump } from "./windowsHangDump";

const tempRoots: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== "win32")("Windows MiniDumpWriteDump integration", () => {
  it("captures a same-integrity renderer-identity process with an MDMP header", async () => {
    const diagnosticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-hang-dump-integration-"));
    tempRoots.push(diagnosticsDir);
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)", "--", "--type=renderer"],
      { stdio: "ignore" },
    );
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    expect(child.pid).toBeTypeOf("number");

    const result = await writeWindowsHangDump({
      diagnosticsDir,
      incidentId: "integration-renderer",
      target: { kind: "renderer", pid: child.pid! },
      runId: "integration",
      appVersion: "test",
      electronVersion: process.versions.electron ?? "node",
      commit: null,
      mainPid: process.pid,
      rendererPid: child.pid!,
      backendPid: null,
      lastHeartbeatAtMs: Date.now() - 6_000,
      detectedAtMs: Date.now(),
      mode: "triage",
      runStartedAtMs: Date.now() - 5_000,
      executablePath: process.execPath,
    });

    expect(result.captureResult, result.error ?? "").toBe("captured");
    expect(fs.readFileSync(result.dumpPath!).subarray(0, 4).toString("ascii")).toBe("MDMP");
  }, 30_000);
});
