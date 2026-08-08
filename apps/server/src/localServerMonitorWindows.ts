// FILE: localServerMonitorWindows.ts
// Purpose: Collects listening TCP sockets and the process table on Windows, where the
//          lsof/ps pipeline the monitor uses elsewhere does not exist.
// Layer: Server runtime utility used by localServerMonitor.
// Depends on: powershell.exe (Get-NetTCPConnection + Get-CimInstance) and the monitor's row shapes.

import { execFile } from "node:child_process";

import type { LocalServerProcessInfo, ParsedLsofListener } from "./localServerMonitor";

const POWERSHELL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const POWERSHELL_TIMEOUT_MS = 8_000;

/**
 * Both tables come back from a single PowerShell round-trip. Starting powershell.exe
 * costs a few hundred milliseconds, and the monitor needs the process table anyway to
 * name listeners and to walk the parent chain, so splitting this into two invocations
 * would double the latency of every refresh for no benefit.
 *
 * `Get-NetTCPConnection` reports the owning pid but no process name; `Win32_Process`
 * supplies the name, parent pid, and command line that dev-server detection keys on.
 * The full table is fetched rather than a pid-filtered slice because the detection
 * walks up the parent chain - `dotnet run` launches the app that actually holds the
 * port, so the identifying command line lives on an ancestor.
 */
const SNAPSHOT_SCRIPT = [
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
  "$ErrorActionPreference='SilentlyContinue'",
  "$l=@(Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess)",
  "$p=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)",
  "[pscustomobject]@{listeners=$l;processes=$p} | ConvertTo-Json -Compress -Depth 4",
].join("; ");

export interface WindowsLocalServerSnapshot {
  readonly listeners: ParsedLsofListener[];
  readonly processInfoByPid: Map<number, LocalServerProcessInfo>;
}

const EMPTY_SNAPSHOT: WindowsLocalServerSnapshot = {
  listeners: [],
  processInfoByPid: new Map(),
};

/** ConvertTo-Json emits a bare object for a single record and nothing at all for none. */
function asRecordArray(value: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    );
  }
  return typeof value === "object" && value !== null ? [value as Record<string, unknown>] : [];
}

function asPid(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asPort(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseProcessTable(rows: ReadonlyArray<Record<string, unknown>>) {
  const processInfoByPid = new Map<number, LocalServerProcessInfo>();
  const nameByPid = new Map<number, string>();
  for (const row of rows) {
    const pid = asPid(row.ProcessId);
    if (pid === null) {
      continue;
    }
    const ppidValue = row.ParentProcessId;
    const ppid = typeof ppidValue === "number" && Number.isInteger(ppidValue) ? ppidValue : 0;
    // Protected processes report no command line; the row still carries the parent
    // link, which is what the lineage walk needs to reach a readable ancestor.
    processInfoByPid.set(pid, { ppid, commandLine: asText(row.CommandLine) });
    const name = asText(row.Name).trim();
    if (name.length > 0) {
      nameByPid.set(pid, name);
    }
  }
  return { processInfoByPid, nameByPid };
}

function parseListeners(
  rows: ReadonlyArray<Record<string, unknown>>,
  nameByPid: ReadonlyMap<number, string>,
): ParsedLsofListener[] {
  const listeners: ParsedLsofListener[] = [];
  for (const row of rows) {
    const pid = asPid(row.OwningProcess);
    const port = asPort(row.LocalPort);
    if (pid === null || port === null) {
      continue;
    }
    const host = asText(row.LocalAddress).trim() || "*";
    listeners.push({
      pid,
      command: nameByPid.get(pid) ?? "unknown",
      protocol: "tcp",
      host,
      port,
      family: host.includes(":") ? "tcp6" : "tcp4",
    });
  }
  return listeners;
}

/** Exported for focused parser tests; `readWindowsLocalServerSnapshot` supplies the input. */
export function parseWindowsLocalServerSnapshot(output: string): WindowsLocalServerSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return EMPTY_SNAPSHOT;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return EMPTY_SNAPSHOT;
  }

  const root = parsed as Record<string, unknown>;
  const { processInfoByPid, nameByPid } = parseProcessTable(asRecordArray(root.processes));
  return { listeners: parseListeners(asRecordArray(root.listeners), nameByPid), processInfoByPid };
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        encoding: "utf8",
        maxBuffer: POWERSHELL_MAX_BUFFER_BYTES,
        timeout: POWERSHELL_TIMEOUT_MS,
        windowsHide: true,
      },
      // A missing or refused powershell.exe degrades to "no servers found" rather
      // than failing the refresh; partial stdout is still worth parsing.
      (_error, stdout) => resolve(stdout ?? ""),
    );
  });
}

export async function readWindowsLocalServerSnapshot(): Promise<WindowsLocalServerSnapshot> {
  return parseWindowsLocalServerSnapshot(await runPowerShell(SNAPSHOT_SCRIPT));
}
