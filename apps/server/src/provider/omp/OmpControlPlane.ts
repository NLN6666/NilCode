/**
 * OMP-specific host policy: deterministic process overlay, truthful status
 * projection, and bounded lifecycle settling. No transcript parsing belongs here.
 *
 * @module OmpControlPlane
 */
import type { OmpProviderPolicyStatus } from "@synara/contracts";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type OmpEffectiveMemoryBackend = OmpProviderPolicyStatus["memory"]["backend"];

export interface OmpControlPlanePlan {
  readonly overlayPath: string;
  readonly overlayContent: string;
  readonly policy: OmpProviderPolicyStatus;
}

export interface PreparedOmpControlPlane extends OmpControlPlanePlan {
  readonly overlayWritten: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[\r\n]/u.test(trimmed) ? trimmed : undefined;
}

function parseModelRole(value: unknown): string | undefined {
  const role = nonEmptyString(value);
  if (!role) return undefined;
  // OMP's configured model roles use a provider/model reference, optionally
  // followed by a thinking level. Do not treat YAML block markers or aliases as
  // a usable Advisor model: stock ACP exposes no safe current-model fallback.
  return /^[^\s/:]+\/.+?(?::[^\s:]+)?$/u.test(role) ? role : undefined;
}

function nestedValue(root: Record<string, unknown>, group: string, key: string): unknown {
  const value = root[group];
  return isRecord(value) ? value[key] : undefined;
}

function parseYamlScalar(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'")) {
    return trimmed.endsWith("'") ? trimmed.slice(1, -1).replaceAll("''", "'") : undefined;
  }
  return trimmed.split(/\s+#/u, 1)[0]?.trim() || undefined;
}

function parseRelevantYaml(content: string): Record<string, unknown> | undefined {
  const result: Record<string, Record<string, string>> = {};
  let group: string | undefined;
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const topLevel = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/u.exec(line);
    if (topLevel) {
      const hasNestedMapping = topLevel[2] === "" || topLevel[2]?.startsWith("#");
      const relevantGroup =
        topLevel[1] === "memory" || topLevel[1] === "hindsight" || topLevel[1] === "modelRoles";
      group = hasNestedMapping && relevantGroup ? topLevel[1] : undefined;
      if (group) result[group] ??= {};
      continue;
    }
    const nested = /^\s{2,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/u.exec(line);
    if (nested && group) {
      const value = parseYamlScalar(nested[2]);
      if (value === undefined) return undefined;
      result[group]![nested[1]] = value;
      continue;
    }
    // Ignore scalar top-level settings and sequences outside the narrow groups
    // Synara reads. A malformed line inside a relevant group fails closed.
    if (group === "memory" || group === "hindsight" || group === "modelRoles") {
      return undefined;
    }
    group = undefined;
  }
  return result;
}

function parseGlobalConfig(content: string | null | undefined): {
  readonly config: Record<string, unknown>;
  readonly warning?: string;
} {
  if (!content?.trim()) return { config: {} };
  const parsed = parseRelevantYaml(content);
  if (!parsed) {
    return {
      config: {},
      warning: "OMP global config could not be parsed; Synara will use safe local memory fallback.",
    };
  }
  return { config: parsed };
}

function resolveMemoryBackend(
  config: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): {
  readonly backend: OmpEffectiveMemoryBackend;
  readonly source: "user-config" | "synara-fallback";
} {
  const configured = nestedValue(config, "memory", "backend");
  if (configured === "local" || configured === "mnemopi") {
    return { backend: configured, source: "user-config" };
  }
  if (configured === "hindsight") {
    const apiUrl = nonEmptyString(env.HINDSIGHT_API_URL) ?? nonEmptyString(nestedValue(config, "hindsight", "apiUrl"));
    if (apiUrl) return { backend: "hindsight", source: "user-config" };
  }
  return { backend: "local", source: "synara-fallback" };
}

export function buildOmpControlPlanePlan(input: {
  readonly overlayPath: string;
  readonly globalConfigText?: string | null;
  readonly env?: NodeJS.ProcessEnv;
}): OmpControlPlanePlan {
  const parsed = parseGlobalConfig(input.globalConfigText);
  const memory = resolveMemoryBackend(parsed.config, input.env ?? process.env);
  const modelRoles = isRecord(parsed.config.modelRoles) ? parsed.config.modelRoles : {};
  const advisorRole = parseModelRole(modelRoles.advisor);
  const advisorWarning = advisorRole
    ? parsed.warning
    : parsed.warning ??
      "OMP Advisor is enabled, but modelRoles.advisor is missing or invalid. Configure that role and retry; Synara will not guess a current-model fallback.";

  const lines = [
    "launch:",
    "  enabled: true",
    "advisor:",
    "  enabled: true",
    "autolearn:",
    "  enabled: true",
    "  autoContinue: true",
  ];
  if (memory.source === "synara-fallback") {
    lines.push("memory:", "  backend: local");
  }

  return {
    overlayPath: input.overlayPath,
    overlayContent: `${lines.join("\n")}\n`,
    policy: {
      owner: "omp-native",
      overlayPath: input.overlayPath,
      sharedHome: true,
      launch: { configured: true, observability: "acp-tool-activity-only" },
      advisor: {
        configured: true,
        state: advisorRole ? "configured" : "degraded",
        ...(advisorRole ? { modelRole: advisorRole } : {}),
        ...(advisorWarning ? { warning: advisorWarning } : {}),
        observability: "transcript-only",
      },
      memory: {
        ...memory,
        observability: "ordinary-tools-only",
      },
      autoLearn: {
        configured: true,
        autoContinue: true,
        experimental: true,
        observability: "bounded-settle-only",
      },
      typedObservability: "phase-3-required",
    },
  };
}

function resolveOmpControlPlanePaths(homeDir = homedir()): {
  readonly globalConfigPaths: ReadonlyArray<string>;
  readonly overlayPath: string;
} {
  const ompRoot = join(homeDir, ".omp");
  const agentDir = join(ompRoot, "agent");
  return {
    globalConfigPaths: [join(agentDir, "config.yml"), join(agentDir, "config.yaml")],
    overlayPath: join(ompRoot, "synara", "acp-provider.yml"),
  };
}

async function readFirstExisting(paths: ReadonlyArray<string>): Promise<string | null> {
  for (const path of paths) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return null;
}

export async function inspectOmpControlPlane(input: {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<OmpControlPlanePlan> {
  const paths = resolveOmpControlPlanePaths(input.homeDir);
  const globalConfigText = await readFirstExisting(paths.globalConfigPaths);
  return buildOmpControlPlanePlan({
    overlayPath: paths.overlayPath,
    globalConfigText,
    env: input.env,
  });
}

async function writeOverlayAtomically(path: string, content: string): Promise<boolean> {
  try {
    if ((await readFile(path, "utf8")) === content) return false;
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") throw error;
  }

  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryExists = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    temporaryExists = false;
    if (process.platform !== "win32") await access(path, fsConstants.R_OK);
    return true;
  } finally {
    if (temporaryExists) await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function prepareOmpControlPlane(input: {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<PreparedOmpControlPlane> {
  const plan = await inspectOmpControlPlane(input);
  const overlayWritten = await writeOverlayAtomically(plan.overlayPath, plan.overlayContent);
  return { ...plan, overlayWritten };
}

export type OmpTurnSettleOutcome = "settled" | "timed-out" | "aborted" | "process-exited";

export interface OmpTurnSettleSnapshot {
  readonly processed: number;
  readonly activityVersion: number;
  readonly aborted: boolean;
  readonly processExited: boolean;
}

export interface OmpTurnSettleResult {
  readonly outcome: OmpTurnSettleOutcome;
  readonly waitedMs: number;
  readonly queueDrained: boolean;
}

/**
 * Wait for the already-enqueued ACP events and then for a bounded quiet window.
 *
 * This is deliberately not an Auto-Learn completion signal. Stock ACP 1 has no
 * typed capture/drain method, so callers may only use this result to delay turn
 * finalization briefly and must continue closing after timeout or interruption.
 */
export async function waitForOmpTurnSettle(input: {
  readonly targetEnqueued: number;
  readonly getSnapshot: () => OmpTurnSettleSnapshot;
  readonly quietWindowMs: number;
  readonly maxWaitMs: number;
  readonly pollMs: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly signal?: AbortSignal;
}): Promise<OmpTurnSettleResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  let quietSince: number | undefined;
  let quietActivityVersion: number | undefined;

  while (true) {
    const observedAt = now();
    const snapshot = input.getSnapshot();
    const queueDrained = snapshot.processed >= input.targetEnqueued;
    if (input.signal?.aborted || snapshot.aborted) {
      return { outcome: "aborted", waitedMs: observedAt - startedAt, queueDrained };
    }
    if (snapshot.processExited) {
      return { outcome: "process-exited", waitedMs: observedAt - startedAt, queueDrained };
    }

    if (queueDrained) {
      if (quietSince === undefined || quietActivityVersion !== snapshot.activityVersion) {
        quietSince = observedAt;
        quietActivityVersion = snapshot.activityVersion;
      }
      if (observedAt - quietSince >= input.quietWindowMs) {
        return { outcome: "settled", waitedMs: observedAt - startedAt, queueDrained: true };
      }
    } else {
      quietSince = undefined;
      quietActivityVersion = undefined;
    }

    const waitedMs = observedAt - startedAt;
    if (waitedMs >= input.maxWaitMs) {
      return { outcome: "timed-out", waitedMs, queueDrained };
    }
    await sleep(Math.min(input.pollMs, input.maxWaitMs - waitedMs));
  }
}
