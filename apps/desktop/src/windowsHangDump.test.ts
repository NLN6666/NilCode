import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildPowerShellDumpInvocation,
  pruneHangDiagnostics,
  writeWindowsHangDump,
} from "./windowsHangDump";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-hang-dump-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const request = (diagnosticsDir: string) => ({
  diagnosticsDir,
  incidentId: "20260811-123456-main",
  target: { kind: "main" as const, pid: 1234 },
  runId: "run-123",
  appVersion: "0.7.1",
  electronVersion: "40.10.6",
  commit: "7ebfd99643a6",
  mainPid: 1234,
  rendererPid: 4567,
  backendPid: 5678,
  lastHeartbeatAtMs: 1_000,
  detectedAtMs: 7_000,
  mode: "triage" as const,
  runStartedAtMs: 1_000,
  executablePath: "C:\\Synara\\Synara.exe",
});

describe("Windows hang dumps", () => {
  it("uses an absolute PowerShell path and a UTF-16LE encoded, non-interactive script", () => {
    const invocation = buildPowerShellDumpInvocation({
      pid: 1234,
      dumpPath: "C:\\diagnostics\\synara-hang-test.dmp.tmp",
      mode: "triage",
      systemRoot: "C:\\Windows",
      temp: "C:\\Temp",
      tmp: "C:\\Tmp",
      executablePath: "C:\\Synara\\Synara.exe",
      runStartedAtMs: 1_000,
      targetKind: "renderer",
    });

    expect(invocation.executable).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(invocation.args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-EncodedCommand"]));
    expect(Buffer.from(invocation.args.at(-1)!, "base64").toString("utf16le")).toContain(
      "MiniDumpWriteDump",
    );
    const script = Buffer.from(invocation.args.at(-1)!, "base64").toString("utf16le");
    expect(script).toContain("Win32_Process");
    expect(script).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(script).toContain("([DateTime]$target.CreationDate).ToUniversalTime()");
    expect(JSON.parse(Buffer.from(invocation.env.SYNARA_HANG_DUMP_REQUEST!, "base64").toString("utf8"))).toMatchObject({
      executablePath: "C:\\Synara\\Synara.exe",
      runStartedAtMs: 1_000,
      targetKind: "renderer",
    });
    expect(invocation.env).toMatchObject({ TEMP: "C:\\Temp", TMP: "C:\\Tmp" });
  });

  it("atomically publishes non-empty dumps and writes only whitelisted metadata", async () => {
    const diagnosticsDir = makeTempDir();
    const result = await writeWindowsHangDump(request(diagnosticsDir), {
      isProcessAlive: () => true,
      runPowerShell: async ({ dumpPath }) => {
        fs.writeFileSync(dumpPath, "MDMP");
        return { ok: true, stderr: "" };
      },
    });

    expect(result.captureResult).toBe("captured");
    expect(fs.existsSync(result.dumpPath!)).toBe(true);
    expect(fs.existsSync(result.dumpPath + ".tmp")).toBe(false);
    const metadata = JSON.parse(fs.readFileSync(result.metadataPath, "utf8")) as Record<string, unknown>;
    expect(metadata).toMatchObject({ runId: "run-123", target: { kind: "main", pid: 1234 } });
    expect(Object.keys(metadata)).not.toContain("env");
  });

  it("keeps failure metadata when the target is invalid or PowerShell times out", async () => {
    const diagnosticsDir = makeTempDir();
    const invalid = await writeWindowsHangDump({ ...request(diagnosticsDir), target: { kind: "main", pid: 0 } });
    expect(invalid.captureResult).toBe("failed");
    expect(fs.existsSync(invalid.metadataPath)).toBe(true);

    const timeout = await writeWindowsHangDump(request(diagnosticsDir), {
      isProcessAlive: () => true,
      runPowerShell: async () => ({ ok: false, stderr: "timed out after 15000ms" }),
    });
    expect(timeout.captureResult).toBe("failed");
    expect(JSON.parse(fs.readFileSync(timeout.metadataPath, "utf8"))).toMatchObject({
      captureResult: "failed",
    });
  });

  it("writes failure metadata without invoking PowerShell when injected target identity validation rejects reuse", async () => {
    const diagnosticsDir = makeTempDir();
    let powerShellCalls = 0;
    const result = await writeWindowsHangDump(
      { ...request(diagnosticsDir), executablePath: "C:\\Synara\\Synara.exe", runStartedAtMs: 1_000 },
      {
        isProcessAlive: () => true,
        validateTargetIdentity: () => "Target executable identity does not match the current application run.",
        runPowerShell: async () => {
          powerShellCalls += 1;
          return { ok: true, stderr: "" };
        },
      } as never,
    );

    expect(result.captureResult).toBe("failed");
    expect(powerShellCalls).toBe(0);
    expect(JSON.parse(fs.readFileSync(result.metadataPath, "utf8"))).toMatchObject({
      error: "Target executable identity does not match the current application run.",
    });
  });

  it("uses a unique owned temporary path for concurrent captures", async () => {
    const diagnosticsDir = makeTempDir();
    const temporaryPaths: string[] = [];
    const capture = async () =>
      await writeWindowsHangDump(request(diagnosticsDir), {
        isProcessAlive: () => true,
        runPowerShell: async ({ dumpPath }) => {
          temporaryPaths.push(dumpPath);
          fs.writeFileSync(dumpPath, "MDMP");
          return { ok: true, stderr: "" };
        },
      });

    await Promise.all([capture(), capture()]);

    expect(new Set(temporaryPaths).size).toBe(2);
  });

  it("fails open instead of following a diagnostics-directory symlink", async () => {
    const root = makeTempDir();
    const external = path.join(root, "external");
    const diagnosticsLink = path.join(root, "diagnostics-link");
    fs.mkdirSync(external);
    try {
      fs.symlinkSync(external, diagnosticsLink, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }

    const result = await writeWindowsHangDump(request(diagnosticsLink), {
      isProcessAlive: () => true,
      runPowerShell: async () => ({ ok: true, stderr: "" }),
    });

    expect(result.captureResult).toBe("failed");
    expect(fs.readdirSync(external)).toEqual([]);
  });

  it("resolves a failed result when the diagnostics root disappears during capture", async () => {
    const diagnosticsDir = makeTempDir();

    await expect(
      writeWindowsHangDump(request(diagnosticsDir), {
        isProcessAlive: () => true,
        runPowerShell: async () => {
          fs.rmSync(diagnosticsDir, { recursive: true, force: true });
          return { ok: true, stderr: "" };
        },
      }),
    ).resolves.toMatchObject({ captureResult: "failed", dumpPath: null });
  });

  it("retains only the newest three owned incidents and leaves unrelated files alone", () => {
    const diagnosticsDir = makeTempDir();
    for (const id of ["one", "two", "three", "four"]) {
      fs.writeFileSync(path.join(diagnosticsDir, "synara-hang-" + id + ".json"), id);
    }
    fs.writeFileSync(path.join(diagnosticsDir, "unrelated.json"), "keep");

    pruneHangDiagnostics(diagnosticsDir, 3);

    expect(fs.existsSync(path.join(diagnosticsDir, "synara-hang-one.json"))).toBe(false);
    expect(fs.existsSync(path.join(diagnosticsDir, "synara-hang-four.json"))).toBe(true);
    expect(fs.existsSync(path.join(diagnosticsDir, "unrelated.json"))).toBe(true);
  });

  it("removes only expired owned temporary files during retention", () => {
    const diagnosticsDir = makeTempDir();
    const expired = path.join(diagnosticsDir, "synara-hang-old.dmp.00000000-0000-0000-0000-000000000000.tmp");
    const recent = path.join(diagnosticsDir, "synara-hang-new.json.00000000-0000-0000-0000-000000000000.tmp");
    const unrelated = path.join(diagnosticsDir, "other.tmp");
    fs.writeFileSync(expired, "old");
    fs.writeFileSync(recent, "new");
    fs.writeFileSync(unrelated, "keep");
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    fs.utimesSync(expired, yesterday, yesterday);

    pruneHangDiagnostics(diagnosticsDir);

    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });
});
