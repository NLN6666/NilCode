// FILE: windowsHangDump.ts
// Purpose: Captures a bounded, local Windows minidump from outside the affected process.
// Layer: Desktop hang diagnostics

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveWindowsSystemRoot } from "@synara/shared/windowsProcess";

import type { HangDumpMode, HangTargetKind } from "./desktopHangWatchdog";

const HANG_DIAGNOSTIC_PREFIX = "synara-hang-";
const HANG_INCIDENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const HANG_FILE_PATTERN = /^synara-hang-([a-z0-9][a-z0-9._-]*)\.(json|dmp)$/i;
const HANG_TEMP_FILE_PATTERN = /^synara-hang-[a-z0-9][a-z0-9._-]*\.(?:json|dmp)\.[a-z0-9-]+\.tmp$/i;
const MAX_POWERSHELL_OUTPUT_BYTES = 4 * 1024;
const POWERSHELL_TIMEOUT_MS = 15_000;
const STALE_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1_000;

export interface WindowsHangDumpRequest {
  readonly diagnosticsDir: string;
  readonly incidentId: string;
  readonly target: { readonly kind: HangTargetKind; readonly pid: number };
  readonly runId: string;
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly commit: string | null;
  readonly mainPid: number;
  readonly rendererPid: number | null;
  readonly backendPid: number | null;
  readonly lastHeartbeatAtMs: number | null;
  readonly detectedAtMs: number;
  readonly mode: HangDumpMode;
  readonly runStartedAtMs: number;
  readonly executablePath: string;
}

export interface PowerShellDumpInvocation {
  readonly executable: string;
  readonly args: string[];
  readonly env: NodeJS.ProcessEnv;
}

export interface WindowsHangDumpResult {
  readonly metadataPath: string;
  readonly dumpPath: string | null;
  readonly captureResult: "captured" | "failed";
  readonly error: string | null;
}

export interface WindowsHangDumpDependencies {
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly validateTargetIdentity?: (request: WindowsHangDumpRequest) => string | null;
  readonly runPowerShell?: (input: {
    readonly pid: number;
    readonly dumpPath: string;
    readonly mode: HangDumpMode;
    readonly runStartedAtMs: number;
    readonly executablePath: string;
    readonly targetKind: HangTargetKind;
  }) => Promise<{ readonly ok: boolean; readonly stderr: string }>;
}

function isPositivePid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0;
}

function safeErrorSummary(value: unknown): string {
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
}

function assertOwnedIncidentId(incidentId: string): void {
  if (!HANG_INCIDENT_ID_PATTERN.test(incidentId)) {
    throw new Error("Hang diagnostic incident id is invalid.");
  }
}

function resolveContainedPath(root: string, filename: string): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, filename);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Hang diagnostic path escaped its directory.");
  }
  return candidate;
}

function verifyDiagnosticsRoot(rootReference: string, expectedRealPath?: string): string {
  const reference = path.resolve(rootReference);
  const referenceStats = fs.lstatSync(reference);
  if (!referenceStats.isDirectory() || referenceStats.isSymbolicLink()) {
    throw new Error("Hang diagnostics directory is not a regular directory.");
  }
  const realPath = fs.realpathSync(reference);
  const realStats = fs.lstatSync(realPath);
  if (
    !realStats.isDirectory() ||
    realStats.isSymbolicLink() ||
    (expectedRealPath && realPath !== expectedRealPath)
  ) {
    throw new Error("Hang diagnostics directory changed while capturing.");
  }
  return realPath;
}

function resolveVerifiedOwnedPath(
  rootReference: string,
  expectedRealPath: string,
  filename: string,
): string {
  const diagnosticsDir = verifyDiagnosticsRoot(rootReference, expectedRealPath);
  const candidate = resolveContainedPath(diagnosticsDir, filename);
  if (fs.existsSync(candidate) && !fs.lstatSync(candidate).isFile()) {
    throw new Error("Hang diagnostic path is not a regular file.");
  }
  return candidate;
}

function dumpScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SYNARA_HANG_DUMP_REQUEST)) | ConvertFrom-Json",
    '$target = Get-CimInstance Win32_Process -Filter "ProcessId = $($request.pid)"',
    "if ($null -eq $target) { throw 'Target process no longer exists.' }",
    "if ([string]::IsNullOrWhiteSpace($target.ExecutablePath) -or -not ($target.ExecutablePath -ieq $request.executablePath)) { throw 'Target executable identity does not match the current application run.' }",
    "$createdAt = ([DateTime]$target.CreationDate).ToUniversalTime()",
    "$minimumStartedAt = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$request.runStartedAtMs - 5000).UtcDateTime",
    "if ($createdAt -lt $minimumStartedAt) { throw 'Target process predates the current application run.' }",
    "if ($request.targetKind -eq 'renderer' -and ([string]::IsNullOrWhiteSpace($target.CommandLine) -or $target.CommandLine -notmatch '(?:^|\\s)--type=renderer(?:\\s|$)')) { throw 'Target is not an Electron renderer process.' }",
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class SynaraMiniDump {",
    '  [DllImport("Dbghelp.dll", SetLastError = true)]',
    "  public static extern bool MiniDumpWriteDump(IntPtr process, uint processId, IntPtr fileHandle, uint dumpType, IntPtr exceptionParam, IntPtr userStreamParam, IntPtr callbackParam);",
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    "  public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);",
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    "  public static extern bool CloseHandle(IntPtr handle);",
    "}",
    "'@",
    "$access = 0x0010 -bor 0x0400",
    "$process = [SynaraMiniDump]::OpenProcess($access, $false, [uint32]$request.pid)",
    'if ($process -eq [IntPtr]::Zero) { throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }',
    "try {",
    "  $flags = [uint32]0x1160",
    "  if ($request.mode -eq 'full') { $flags = $flags -bor [uint32]0x2 }",
    "  $stream = [IO.File]::Open($request.dumpPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)",
    "  try {",
    "    if (-not [SynaraMiniDump]::MiniDumpWriteDump($process, [uint32]$request.pid, $stream.SafeFileHandle.DangerousGetHandle(), $flags, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)) {",
    '      throw "MiniDumpWriteDump failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"',
    "    }",
    "  } finally { $stream.Dispose() }",
    "} finally { [void][SynaraMiniDump]::CloseHandle($process) }",
  ].join("\n");
}

export function buildPowerShellDumpInvocation(input: {
  readonly pid: number;
  readonly dumpPath: string;
  readonly mode: HangDumpMode;
  readonly systemRoot?: string;
  readonly temp?: string;
  readonly tmp?: string;
  readonly runStartedAtMs: number;
  readonly executablePath: string;
  readonly targetKind: HangTargetKind;
}): PowerShellDumpInvocation {
  const systemRoot = input.systemRoot?.trim() || resolveWindowsSystemRoot();
  const payload = Buffer.from(
    JSON.stringify({
      pid: input.pid,
      dumpPath: input.dumpPath,
      mode: input.mode,
      runStartedAtMs: input.runStartedAtMs,
      executablePath: input.executablePath,
      targetKind: input.targetKind,
    }),
    "utf8",
  ).toString("base64");
  return {
    executable: path.win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(dumpScript(), "utf16le").toString("base64"),
    ],
    env: {
      SystemRoot: systemRoot,
      ...(input.temp?.trim() ? { TEMP: input.temp } : {}),
      ...(input.tmp?.trim() ? { TMP: input.tmp } : {}),
      SYNARA_HANG_DUMP_REQUEST: payload,
    },
  };
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunPowerShell(input: {
  readonly pid: number;
  readonly dumpPath: string;
  readonly mode: HangDumpMode;
  readonly runStartedAtMs: number;
  readonly executablePath: string;
  readonly targetKind: HangTargetKind;
}): Promise<{ readonly ok: boolean; readonly stderr: string }> {
  const invocation = buildPowerShellDumpInvocation({
    ...input,
    temp: process.env.TEMP,
    tmp: process.env.TMP,
  });
  return await new Promise((resolve) => {
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const settle = (ok: boolean, message = stderr.toString("utf8")): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ ok, stderr: safeErrorSummary(message) });
    };
    let child;
    try {
      child = spawn(invocation.executable, invocation.args, {
        env: invocation.env,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      settle(false, error);
      return;
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      const next = Buffer.concat([stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      stderr =
        next.byteLength > MAX_POWERSHELL_OUTPUT_BYTES
          ? next.subarray(next.byteLength - MAX_POWERSHELL_OUTPUT_BYTES)
          : next;
    });
    child.once("error", (error) => settle(false, error));
    child.once("close", (code) =>
      settle(
        code === 0,
        stderr.byteLength > 0
          ? stderr.toString("utf8")
          : "PowerShell exited with code " + (code ?? "null") + ".",
      ),
    );
    timeout = setTimeout(() => {
      child.kill();
      settle(false, "PowerShell timed out after " + POWERSHELL_TIMEOUT_MS + "ms.");
    }, POWERSHELL_TIMEOUT_MS);
    timeout.unref();
  });
}

function writeJsonAtomically(
  rootReference: string,
  diagnosticsDir: string,
  filename: string,
  payload: unknown,
): string {
  const filePath = resolveVerifiedOwnedPath(rootReference, diagnosticsDir, filename);
  const temporaryPath = resolveVerifiedOwnedPath(
    rootReference,
    diagnosticsDir,
    filename + "." + randomUUID() + ".tmp",
  );
  fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  resolveVerifiedOwnedPath(rootReference, diagnosticsDir, filename);
  resolveVerifiedOwnedPath(rootReference, diagnosticsDir, path.basename(temporaryPath));
  fs.renameSync(temporaryPath, filePath);
  return filePath;
}

function validRegularOwnedFile(
  rootReference: string,
  diagnosticsDir: string,
  filename: string,
): string | null {
  if (!HANG_FILE_PATTERN.test(filename)) return null;
  try {
    const candidate = resolveVerifiedOwnedPath(rootReference, diagnosticsDir, filename);
    return fs.lstatSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** Deletes only regular, correctly prefixed diagnostic files after a containment check. */
export function pruneHangDiagnostics(diagnosticsDir: string, retain = 3): void {
  const groups = new Map<string, { files: string[]; newestMtime: number }>();
  const rootReference = diagnosticsDir;
  let entries: string[];
  try {
    diagnosticsDir = verifyDiagnosticsRoot(rootReference);
    entries = fs.readdirSync(diagnosticsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const match = HANG_FILE_PATTERN.exec(entry);
    const filePath = match ? validRegularOwnedFile(rootReference, diagnosticsDir, entry) : null;
    if (!match || !filePath) continue;
    const group = groups.get(match[1]) ?? { files: [], newestMtime: 0 };
    group.files.push(filePath);
    group.newestMtime = Math.max(group.newestMtime, fs.statSync(filePath).mtimeMs);
    groups.set(match[1], group);
  }
  for (const entry of entries) {
    if (!HANG_TEMP_FILE_PATTERN.test(entry)) continue;
    try {
      const filePath = resolveVerifiedOwnedPath(rootReference, diagnosticsDir, entry);
      if (fs.statSync(filePath).mtimeMs <= Date.now() - STALE_TEMP_FILE_AGE_MS) {
        fs.unlinkSync(resolveVerifiedOwnedPath(rootReference, diagnosticsDir, entry));
      }
    } catch {
      // Retention must never make diagnostics fatal.
    }
  }
  const staleGroups = [...groups.entries()]
    .sort(([leftId, left], [rightId, right]) => {
      const byTime = right.newestMtime - left.newestMtime;
      return byTime !== 0 ? byTime : rightId.localeCompare(leftId);
    })
    .slice(Math.max(0, retain));
  for (const [, group] of staleGroups) {
    for (const filePath of group.files) {
      try {
        fs.unlinkSync(
          resolveVerifiedOwnedPath(rootReference, diagnosticsDir, path.basename(filePath)),
        );
      } catch {
        // Retention must never make diagnostics fatal.
      }
    }
  }
}

/**
 * Writes a final JSON record for every attempt. The dump is published only after
 * MiniDumpWriteDump succeeds and produces bytes, so readers never observe a partial dump.
 */
export async function writeWindowsHangDump(
  request: WindowsHangDumpRequest,
  dependencies: WindowsHangDumpDependencies = {},
): Promise<WindowsHangDumpResult> {
  let diagnosticsDir: string;
  let metadataPath: string;
  let dumpPath: string;
  try {
    assertOwnedIncidentId(request.incidentId);
    fs.mkdirSync(request.diagnosticsDir, { recursive: true });
    diagnosticsDir = verifyDiagnosticsRoot(request.diagnosticsDir);
    const baseName = HANG_DIAGNOSTIC_PREFIX + request.incidentId;
    metadataPath = resolveVerifiedOwnedPath(
      request.diagnosticsDir,
      diagnosticsDir,
      baseName + ".json",
    );
    dumpPath = resolveVerifiedOwnedPath(request.diagnosticsDir, diagnosticsDir, baseName + ".dmp");
  } catch (error) {
    return {
      metadataPath: path.join(request.diagnosticsDir, HANG_DIAGNOSTIC_PREFIX + "invalid.json"),
      dumpPath: null,
      captureResult: "failed",
      error: safeErrorSummary(error),
    };
  }

  let dumpTemporaryPath: string | null = null;
  let failure: string | null = null;
  let captured = false;
  try {
    if (!isPositivePid(request.target.pid)) {
      failure = "Target PID is invalid.";
    } else if (!isPositivePid(request.mainPid)) {
      failure = "Main PID is invalid.";
    } else if (request.target.kind === "main" && request.target.pid !== request.mainPid) {
      failure = "Main target PID does not match the configured main PID.";
    } else if (request.target.kind === "renderer" && request.target.pid !== request.rendererPid) {
      failure = "Renderer target PID does not match the last reported renderer PID.";
    } else if (!Number.isInteger(request.runStartedAtMs) || request.runStartedAtMs <= 0) {
      failure = "Application run start time is invalid.";
    } else if (!request.executablePath.trim()) {
      failure = "Application executable path is invalid.";
    } else if (!(dependencies.isProcessAlive ?? defaultIsProcessAlive)(request.target.pid)) {
      failure = "Target process is no longer running.";
    } else {
      failure = dependencies.validateTargetIdentity?.(request) ?? null;
    }
  } catch (error) {
    failure = safeErrorSummary(error);
  }

  if (!failure) {
    try {
      dumpTemporaryPath = resolveVerifiedOwnedPath(
        request.diagnosticsDir,
        diagnosticsDir,
        path.basename(dumpPath) + "." + randomUUID() + ".tmp",
      );
      fs.rmSync(
        resolveVerifiedOwnedPath(
          request.diagnosticsDir,
          diagnosticsDir,
          path.basename(dumpTemporaryPath),
        ),
        {
          force: true,
        },
      );
      const outcome = await (dependencies.runPowerShell ?? defaultRunPowerShell)({
        pid: request.target.pid,
        dumpPath: dumpTemporaryPath,
        mode: request.mode,
        runStartedAtMs: request.runStartedAtMs,
        executablePath: request.executablePath,
        targetKind: request.target.kind,
      });
      if (!outcome.ok) {
        failure = outcome.stderr || "MiniDumpWriteDump failed.";
      } else if (
        !fs.existsSync(
          resolveVerifiedOwnedPath(
            request.diagnosticsDir,
            diagnosticsDir,
            path.basename(dumpTemporaryPath),
          ),
        ) ||
        fs.statSync(
          resolveVerifiedOwnedPath(
            request.diagnosticsDir,
            diagnosticsDir,
            path.basename(dumpTemporaryPath),
          ),
        ).size === 0
      ) {
        failure = "MiniDumpWriteDump completed without a non-empty dump.";
      } else {
        resolveVerifiedOwnedPath(request.diagnosticsDir, diagnosticsDir, path.basename(dumpPath));
        fs.renameSync(dumpTemporaryPath, dumpPath);
        captured = true;
      }
    } catch (error) {
      failure = safeErrorSummary(error);
    } finally {
      if (!captured && dumpTemporaryPath) {
        try {
          fs.rmSync(
            resolveVerifiedOwnedPath(
              request.diagnosticsDir,
              diagnosticsDir,
              path.basename(dumpTemporaryPath),
            ),
            {
              force: true,
            },
          );
        } catch {
          // Cleanup is best effort; diagnostics must never reject the caller.
        }
      }
    }
  }

  const metadata = {
    schemaVersion: 1,
    runId: request.runId,
    appVersion: request.appVersion,
    electronVersion: request.electronVersion,
    commit: request.commit,
    target: request.target,
    mainPid: request.mainPid,
    rendererPid: request.rendererPid,
    backendPid: request.backendPid,
    lastHeartbeatAtMs: request.lastHeartbeatAtMs,
    detectedAtMs: request.detectedAtMs,
    detectionDelayMs:
      request.lastHeartbeatAtMs === null
        ? null
        : Math.max(0, request.detectedAtMs - request.lastHeartbeatAtMs),
    dumpMode: request.mode,
    dumpMayContainSensitiveMemory: request.mode === "full",
    captureResult: captured ? "captured" : "failed",
    error: captured ? null : safeErrorSummary(failure ?? "Unknown dump failure."),
  };
  try {
    metadataPath = writeJsonAtomically(
      request.diagnosticsDir,
      diagnosticsDir,
      path.basename(metadataPath),
      metadata,
    );
    pruneHangDiagnostics(diagnosticsDir);
  } catch (error) {
    return {
      metadataPath,
      dumpPath: captured ? dumpPath : null,
      captureResult: captured ? "captured" : "failed",
      error: safeErrorSummary(error),
    };
  }
  return {
    metadataPath,
    dumpPath: captured ? dumpPath : null,
    captureResult: captured ? "captured" : "failed",
    error: captured ? null : metadata.error,
  };
}
