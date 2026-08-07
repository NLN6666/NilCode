// FILE: processIdentity.ts
// Purpose: Identify a daemon process across a Synara restart, guarding against pid reuse.
// Layer: Daemon infrastructure
// Depends on: node:child_process (ps on POSIX, CIM via PowerShell on Windows).
//
// Ported in intent from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md. That project
// pins identity by comparing a persisted process start time on macOS and by holding a
// pidfd on Linux. Neither path covers Windows, and this repo's existing
// `processTreeKiller.readCurrentCommands` shells out to `ps`, which does not exist there —
// so the Windows branch below is new work rather than a port.
//
// Why this matters: a detached daemon outlives the server, so after a restart all we hold
// is a number. Operating systems recycle pids. Acting on a recycled pid means Synara would
// adopt — and eventually kill — an unrelated process the user is running.

import { spawnSync } from "node:child_process";

const QUERY_TIMEOUT_MS = 5_000;
const QUERY_MAX_BUFFER_BYTES = 8_388_608;

export interface ProcessIdentity {
  readonly pid: number;
  /** Platform-reported start time. Null when the platform would not report one. */
  readonly startedAt: string | null;
  readonly commandLine: string;
}

export type IdentityLiveness = "running" | "exited" | "unknown";

export type ProcessIdentityMap = ReadonlyMap<number, ProcessIdentity>;

/** Collapse the whitespace differences platforms introduce when re-rendering argv. */
function normalizeCommandLine(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function processIdentityMatches(
  persisted: ProcessIdentity,
  current: ProcessIdentity,
): boolean {
  if (normalizeCommandLine(persisted.commandLine) !== normalizeCommandLine(current.commandLine)) {
    return false;
  }
  // Start time is the strong signal; the command line alone is the fallback for
  // platforms that will not report one.
  if (persisted.startedAt === null || current.startedAt === null) return true;
  return persisted.startedAt === current.startedAt;
}

/**
 * Decide whether a persisted daemon is still the process behind its pid.
 *
 * A null table means the query itself failed, and that must surface as "unknown"
 * rather than collapsing to "exited": reporting a live daemon as gone leads the agent
 * to relaunch it, and two Minecraft servers writing one world save is a worse failure
 * than an unanswered status.
 */
export function resolveIdentityLiveness(
  persisted: ProcessIdentity,
  current: ProcessIdentityMap | null,
): IdentityLiveness {
  if (current === null) return "unknown";
  const observed = current.get(persisted.pid);
  if (observed === undefined) return "exited";
  return processIdentityMatches(persisted, observed) ? "running" : "exited";
}

/** `ps -p <pids> -o pid=,lstart=,command=` — pid, a fixed 5-field date, then argv. */
export function parsePosixIdentities(output: string): Map<number, ProcessIdentity> {
  const identities = new Map<number, ProcessIdentity>();

  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/u.exec(line);
    if (match === null) continue;
    const pid = Number.parseInt(match[1]!, 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    identities.set(pid, {
      pid,
      startedAt: match[2]!.trim(),
      commandLine: match[3]!.trim(),
    });
  }

  return identities;
}

/** Parse `ConvertTo-Json` output from the CIM query. Null when it is not usable. */
export function parseWindowsIdentities(output: string): Map<number, ProcessIdentity> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }

  // ConvertTo-Json emits a bare object when the result set holds exactly one row.
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const identities = new Map<number, ProcessIdentity>();

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const pid = typeof record.ProcessId === "number" ? record.ProcessId : Number.NaN;
    if (!Number.isInteger(pid) || pid <= 0) continue;
    identities.set(pid, {
      pid,
      startedAt: typeof record.CreationDate === "string" ? record.CreationDate : null,
      commandLine: typeof record.CommandLine === "string" ? record.CommandLine : "",
    });
  }

  return identities;
}

/**
 * Read current identities for the given pids, or null when the platform query failed.
 *
 * Batched into one call: PowerShell startup runs into hundreds of milliseconds, so a
 * per-daemon query would degrade linearly with the number of supervised daemons.
 */
export function readProcessIdentities(pids: readonly number[]): ProcessIdentityMap | null {
  const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (unique.length === 0) return new Map();

  return globalThis.process.platform === "win32"
    ? readWindowsIdentities(unique)
    : readPosixIdentities(unique);
}

function readPosixIdentities(pids: readonly number[]): ProcessIdentityMap | null {
  try {
    const result = spawnSync("ps", ["-p", pids.join(","), "-o", "pid=,lstart=,command="], {
      encoding: "utf8",
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: QUERY_MAX_BUFFER_BYTES,
    });
    if (result.error) return null;
    // A non-zero status with no output means none of the pids exist, which is an
    // answer ("all gone"), not a failure.
    if (result.status !== 0) return new Map();
    return parsePosixIdentities(result.stdout);
  } catch {
    return null;
  }
}

function readWindowsIdentities(pids: readonly number[]): ProcessIdentityMap | null {
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(" or ");
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter '${filter}' -ErrorAction SilentlyContinue;`,
    "if ($null -eq $p) { '[]' } else {",
    "$p | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress -Depth 3 }",
  ].join(" ");

  try {
    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: QUERY_TIMEOUT_MS, maxBuffer: QUERY_MAX_BUFFER_BYTES },
    );
    if (result.error || result.status !== 0) return null;
    return parseWindowsIdentities(result.stdout.trim());
  } catch {
    return null;
  }
}
