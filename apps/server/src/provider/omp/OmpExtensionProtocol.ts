import { Effect, Option, Result, Schema } from "effect";
import type {
  OmpLaunchDescribeResult,
  OmpLaunchReadLogsResult,
  OmpProviderRuntimeStatus,
  OmpRuntimeService,
} from "@synara/contracts";

import type { AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime.ts";

/**
 * Typed Oh My Pi ACP extension protocol consumer.
 *
 * This module owns version/envelope validation and generation/sequence ordering.
 * It never infers state from transcript, tool copy, XML, or logs.
 */
export const OMP_EXTENSION_SCHEMA_VERSION = 1 as const;

export const OMP_EXTENSION_METHODS = {
  capabilities: "_omp/capabilities",
  advisorStatus: "_omp/advisor/status",
  advisorSet: "_omp/advisor/set",
  advisorDrain: "_omp/advisor/drain",
  autolearnStatus: "_omp/autolearn/status",
  autolearnDrain: "_omp/autolearn/drain",
  memoryStatus: "_omp/memory/status",
  memoryStats: "_omp/memory/stats",
  memoryDiagnose: "_omp/memory/diagnose",
  memoryEnqueue: "_omp/memory/enqueue",
  memoryClear: "_omp/memory/clear",
  launchList: "_omp/launch/list",
  launchDescribe: "_omp/launch/describe",
  launchLogs: "_omp/launch/logs",
  launchSend: "_omp/launch/send",
  launchStop: "_omp/launch/stop",
  launchRestart: "_omp/launch/restart",
} as const;

export const OMP_EXTENSION_EVENTS = {
  advisorNote: "_omp/advisor/note",
  autolearnLifecycle: "_omp/autolearn/lifecycle",
  launchLifecycle: "_omp/launch/lifecycle",
} as const;

const EVENT_SET = new Set<string>(Object.values(OMP_EXTENSION_EVENTS));

export interface OmpExtensionError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly detail?: Record<string, unknown>;
}

export interface OmpExtensionEnvelope {
  readonly schemaVersion: typeof OMP_EXTENSION_SCHEMA_VERSION;
  readonly ompVersion: string;
  readonly sessionId: string;
  readonly generation: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly data?: Record<string, unknown>;
  readonly error?: OmpExtensionError;
}

export interface OmpExtensionClientState {
  readonly mode: "configured-only" | "typed";
  readonly degradedReason?: string;
  readonly sessionId?: string;
  readonly generation?: string;
  readonly ompVersion?: string;
  readonly lastSequence: number;
  readonly capabilities?: Record<string, unknown>;
  readonly advisor?: Record<string, unknown>;
  readonly autolearn?: Record<string, unknown>;
  readonly memory?: Record<string, unknown>;
  readonly launch?: Record<string, unknown>;
  readonly updatedAt?: string;
}

export type OmpEnvelopeAcceptanceReason =
  | "accepted"
  | "not-negotiated"
  | "cross-session"
  | "stale-generation"
  | "duplicate-sequence";

export interface OmpEnvelopeAcceptance {
  readonly accepted: boolean;
  readonly reason: OmpEnvelopeAcceptanceReason;
  readonly state: OmpExtensionClientState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OMP extension ${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function decodeError(value: unknown): OmpExtensionError | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("OMP extension error must be an object.");
  if (typeof value.recoverable !== "boolean") {
    throw new Error("OMP extension error.recoverable must be a boolean.");
  }
  const detail = optionalRecord(value.detail);
  return {
    code: requiredString(value.code, "error.code"),
    message: requiredString(value.message, "error.message"),
    recoverable: value.recoverable,
    ...(detail ? { detail } : {}),
  };
}

export function decodeOmpExtensionEnvelope(value: unknown): OmpExtensionEnvelope {
  if (!isRecord(value)) throw new Error("OMP extension envelope must be an object.");
  if (value.schemaVersion !== OMP_EXTENSION_SCHEMA_VERSION) {
    throw new Error(`OMP extension unsupported schemaVersion: ${String(value.schemaVersion)}.`);
  }
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    throw new Error("OMP extension sequence must be a positive safe integer.");
  }
  if (value.data !== undefined && !isRecord(value.data)) {
    throw new Error("OMP extension data must be an object when present.");
  }
  const timestamp = requiredString(value.timestamp, "timestamp");
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("OMP extension timestamp must be ISO date-time.");
  const data = value.data;
  const error = decodeError(value.error);
  const correlationId = optionalString(value.correlationId, "correlationId");
  if ((data === undefined) === (error === undefined)) {
    throw new Error("OMP extension envelope must contain exactly one of data or error.");
  }
  return {
    schemaVersion: OMP_EXTENSION_SCHEMA_VERSION,
    ompVersion: requiredString(value.ompVersion, "ompVersion"),
    sessionId: requiredString(value.sessionId, "sessionId"),
    generation: requiredString(value.generation, "generation"),
    sequence: value.sequence,
    timestamp,
    ...(correlationId ? { correlationId } : {}),
    ...(data ? { data } : {}),
    ...(error ? { error } : {}),
  };
}

export function createConfiguredOnlyOmpExtensionState(reason: string): OmpExtensionClientState {
  return {
    mode: "configured-only",
    degradedReason: reason,
    lastSequence: 0,
  };
}

export function acceptOmpExtensionEnvelope(
  state: OmpExtensionClientState,
  envelope: OmpExtensionEnvelope,
): OmpEnvelopeAcceptance {
  if (state.sessionId && state.sessionId !== envelope.sessionId) {
    return { accepted: false, reason: "cross-session", state };
  }
  if (state.generation && state.generation !== envelope.generation) {
    return { accepted: false, reason: "stale-generation", state };
  }
  if (envelope.sequence <= state.lastSequence) {
    return { accepted: false, reason: "duplicate-sequence", state };
  }
  return {
    accepted: true,
    reason: "accepted",
    state: {
      ...state,
      mode: "typed",
      degradedReason: undefined,
      sessionId: envelope.sessionId,
      generation: envelope.generation,
      ompVersion: envelope.ompVersion,
      lastSequence: envelope.sequence,
      updatedAt: envelope.timestamp,
    },
  };
}

export function acceptOmpExtensionNotification(
  state: OmpExtensionClientState,
  envelope: OmpExtensionEnvelope,
): OmpEnvelopeAcceptance {
  if (state.mode !== "typed" || !state.sessionId || !state.generation) {
    return { accepted: false, reason: "not-negotiated", state };
  }
  return acceptOmpExtensionEnvelope(state, envelope);
}

export function isKnownOmpExtensionNotification(method: string): boolean {
  return EVENT_SET.has(method);
}

export type OmpExtensionRuntime = Pick<
  AcpSessionRuntimeShape,
  "handleExtNotification" | "request"
>;

export function registerOmpExtensionNotifications(
  runtime: OmpExtensionRuntime,
  handler: (method: string, envelope: OmpExtensionEnvelope) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.forEach(
    Object.values(OMP_EXTENSION_EVENTS),
    (method) =>
      runtime.handleExtNotification(method, Schema.Unknown, (payload) =>
        Effect.try({
          try: () => decodeOmpExtensionEnvelope(payload),
          catch: () => undefined,
        }).pipe(
          Effect.flatMap((envelope) => (envelope ? handler(method, envelope) : Effect.void)),
          Effect.catchCause(() => Effect.void),
        ),
      ),
    { discard: true },
  );
}

export function requestOmpExtension(
  runtime: Pick<AcpSessionRuntimeShape, "request">,
  input: {
    readonly method: string;
    readonly sessionId: string;
    readonly timeoutMs: number;
    readonly correlationId?: string;
    readonly params?: Record<string, unknown>;
  },
) {
  const payload = {
    ...input.params,
    sessionId: input.sessionId,
    timeoutMs: input.timeoutMs,
    correlationId: input.correlationId ?? crypto.randomUUID(),
  };
  return runtime.request(input.method, payload).pipe(
    Effect.timeoutOption(input.timeoutMs),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new Error(`${input.method} timed out.`)),
        onSome: (value) =>
          Effect.try({
            try: () => decodeOmpExtensionEnvelope(value),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }),
      }),
    ),
    Effect.flatMap((envelope) =>
      envelope.error
        ? Effect.fail(
            new Error(
              `${input.method} failed (${envelope.error.code}): ${envelope.error.message}`,
            ),
          )
        : Effect.succeed(envelope),
    ),
  );
}

export function negotiateOmpExtensions(
  runtime: Pick<AcpSessionRuntimeShape, "request">,
  input: { readonly sessionId: string; readonly timeoutMs?: number },
): Effect.Effect<OmpExtensionClientState> {
  const timeoutMs = Math.max(1, Math.min(15_000, input.timeoutMs ?? 5_000));
  const negotiate = Effect.gen(function* () {
    const capabilities = yield* requestOmpExtension(runtime, {
      method: OMP_EXTENSION_METHODS.capabilities,
      sessionId: input.sessionId,
      timeoutMs,
      correlationId: `capabilities:${crypto.randomUUID()}`,
      params: { supportedSchemaVersions: [OMP_EXTENSION_SCHEMA_VERSION] },
    });
    if (capabilities.data?.protocol !== "omp-acp-extensions") {
      return yield* Effect.fail(new Error("OMP returned an incompatible typed extension protocol."));
    }
    if (
      capabilities.data.selectedSchemaVersion !== OMP_EXTENSION_SCHEMA_VERSION ||
      !Array.isArray(capabilities.data.supportedSchemaVersions) ||
      !capabilities.data.supportedSchemaVersions.includes(OMP_EXTENSION_SCHEMA_VERSION)
    ) {
      return yield* Effect.fail(new Error("OMP does not advertise typed extension schema v1."));
    }
    const advertisedFeatures = optionalRecord(capabilities.data.features);
    if (
      !advertisedFeatures ||
      !projectFeature(advertisedFeatures.advisor) ||
      !projectFeature(advertisedFeatures.autolearn) ||
      !projectFeature(advertisedFeatures.memory) ||
      !projectFeature(advertisedFeatures.launch)
    ) {
      return yield* Effect.fail(new Error("OMP returned a malformed typed extension feature matrix."));
    }
    let state = projectOmpEnvelopeData(
      createConfiguredOnlyOmpExtensionState("negotiating"),
      OMP_EXTENSION_METHODS.capabilities,
      capabilities,
    );
    for (const method of [
      OMP_EXTENSION_METHODS.advisorStatus,
      OMP_EXTENSION_METHODS.autolearnStatus,
      OMP_EXTENSION_METHODS.memoryStatus,
      OMP_EXTENSION_METHODS.launchList,
    ]) {
      const response = yield* requestOmpExtension(runtime, {
        method,
        sessionId: input.sessionId,
        timeoutMs,
      });
      state = projectOmpEnvelopeData(state, method, response);
    }
    const projected = projectOmpExtensionRuntimeStatus(state, 1);
    if (!projected.advisor || !projected.autolearn || !projected.memory || !projected.launch) {
      return yield* Effect.fail(new Error("OMP returned a malformed typed owner status snapshot."));
    }
    return state;
  });
  return negotiate.pipe(
    Effect.catch((cause) =>
      Effect.succeed(
        createConfiguredOnlyOmpExtensionState(
          `OMP typed ACP extensions unavailable; using Phase 2 configured policy only: ${cause.message}`,
        ),
      ),
    ),
  );
}

export function drainOmpTurnExtensions(
  runtime: Pick<AcpSessionRuntimeShape, "request">,
  state: OmpExtensionClientState,
  input: { readonly sessionId: string; readonly timeoutMs: number; readonly cancelAutolearn?: boolean },
): Effect.Effect<{ readonly typed: boolean; readonly settled: boolean; readonly state: OmpExtensionClientState }> {
  if (state.mode !== "typed") return Effect.succeed({ typed: false, settled: false, state });
  return Effect.gen(function* () {
    let next = state;
    let settled = true;
    for (const [method, params] of [
      [OMP_EXTENSION_METHODS.advisorDrain, {}],
      [OMP_EXTENSION_METHODS.autolearnDrain, { cancel: input.cancelAutolearn === true }],
    ] as const) {
      const outcome = yield* requestOmpExtension(runtime, {
        method,
        sessionId: input.sessionId,
        timeoutMs: input.timeoutMs,
        params,
      }).pipe(Effect.result);
      if (Result.isFailure(outcome)) {
        const key = method === OMP_EXTENSION_METHODS.advisorDrain ? "advisor" : "autolearn";
        next = {
          ...next,
          [key]: {
            ...next[key],
            drain: { settled: false, error: outcome.failure.message },
          },
        };
        settled = false;
        continue;
      }
      const response = outcome.success;
      next = projectOmpEnvelopeData(next, method, response);
      if (response.data?.settled !== true) settled = false;
    }
    return { typed: true, settled, state: next };
  });
}

export function projectOmpEnvelopeData(
  state: OmpExtensionClientState,
  method: string,
  envelope: OmpExtensionEnvelope,
): OmpExtensionClientState {
  const accepted = acceptOmpExtensionEnvelope(state, envelope);
  if (!accepted.accepted || !envelope.data) return accepted.state;
  switch (method) {
    case OMP_EXTENSION_METHODS.capabilities:
      return { ...accepted.state, capabilities: envelope.data };
    case OMP_EXTENSION_METHODS.advisorStatus:
      return { ...accepted.state, advisor: envelope.data };
    case OMP_EXTENSION_METHODS.advisorDrain:
      return {
        ...accepted.state,
        advisor: projectOmpDrainStatus(accepted.state.advisor, envelope),
      };
    case OMP_EXTENSION_EVENTS.advisorNote:
      return accepted.state;
    case OMP_EXTENSION_METHODS.autolearnStatus:
      return { ...accepted.state, autolearn: envelope.data };
    case OMP_EXTENSION_METHODS.autolearnDrain:
      return {
        ...accepted.state,
        autolearn: projectOmpDrainStatus(accepted.state.autolearn, envelope),
      };
    case OMP_EXTENSION_EVENTS.autolearnLifecycle:
      return {
        ...accepted.state,
        autolearn: { ...accepted.state.autolearn, ...envelope.data },
      };
    case OMP_EXTENSION_METHODS.memoryStatus:
      return { ...accepted.state, memory: envelope.data };
    case OMP_EXTENSION_METHODS.launchList:
      return { ...accepted.state, launch: envelope.data };
    case OMP_EXTENSION_METHODS.launchDescribe:
    case OMP_EXTENSION_METHODS.launchSend:
    case OMP_EXTENSION_METHODS.launchStop:
    case OMP_EXTENSION_METHODS.launchRestart:
      return projectOmpLaunchLifecycle(accepted.state, envelope.data);
    case OMP_EXTENSION_EVENTS.launchLifecycle:
      return projectOmpLaunchLifecycle(accepted.state, envelope.data);
    default:
      return accepted.state;
  }
}

function projectOmpDrainStatus(
  current: Record<string, unknown> | undefined,
  envelope: OmpExtensionEnvelope,
): Record<string, unknown> {
  const data = envelope.data ?? {};
  const status = optionalRecord(data.status);
  return {
    ...current,
    ...status,
    drain: {
      settled: data.settled === true,
      ...(typeof data.cancelled === "boolean" ? { cancelled: data.cancelled } : {}),
      updatedAt: envelope.timestamp,
    },
  };
}

function projectOmpLaunchLifecycle(
  state: OmpExtensionClientState,
  data: Record<string, unknown>,
): OmpExtensionClientState {
  const service = optionalRecord(data.service);
  if (!service || typeof service.serviceId !== "string") return state;
  const launch = optionalRecord(state.launch);
  const existing = Array.isArray(launch?.services) ? launch.services : [];
  const services = [
    ...existing.filter(
      (candidate) =>
        !isRecord(candidate) || candidate.serviceId !== service.serviceId,
    ),
    service,
  ];
  return { ...state, launch: { ...launch, authority: "omp", services } };
}

function projectFeature(value: unknown) {
  const feature = optionalRecord(value);
  if (
    !feature ||
    typeof feature.available !== "boolean" ||
    typeof feature.enabled !== "boolean" ||
    typeof feature.observable !== "boolean" ||
    typeof feature.controllable !== "boolean" ||
    typeof feature.recoverable !== "boolean"
  ) {
    return undefined;
  }
  return {
    available: feature.available,
    enabled: feature.enabled,
    observable: feature.observable,
    controllable: feature.controllable,
    recoverable: feature.recoverable,
    methods: stringArray(feature.methods),
    events: stringArray(feature.events),
    ...(typeof feature.reason === "string" && feature.reason.length > 0
      ? { reason: feature.reason }
      : {}),
  };
}

function projectDrain(value: unknown) {
  const drain = optionalRecord(value);
  if (!drain || typeof drain.settled !== "boolean") return undefined;
  return {
    settled: drain.settled,
    ...(typeof drain.cancelled === "boolean" ? { cancelled: drain.cancelled } : {}),
    ...(typeof drain.updatedAt === "string" ? { updatedAt: drain.updatedAt } : {}),
    ...(typeof drain.error === "string" && drain.error.length > 0 ? { error: drain.error } : {}),
  };
}

export function projectOmpRuntimeServices(value: unknown): OmpRuntimeService[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const service = optionalRecord(candidate);
    const states = new Set([
      "starting",
      "running",
      "ready",
      "restarting",
      "stopping",
      "exited",
      "failed",
    ]);
    if (
      !service ||
      typeof service.serviceId !== "string" ||
      typeof service.name !== "string" ||
      typeof service.state !== "string" ||
      !states.has(service.state) ||
      typeof service.restartCount !== "number" ||
      typeof service.outputBytes !== "number" ||
      typeof service.persist !== "boolean" ||
      typeof service.detached !== "boolean"
    ) {
      return [];
    }
    return [
      {
        serviceId: service.serviceId,
        name: service.name,
        state: service.state as
          | "starting"
          | "running"
          | "ready"
          | "restarting"
          | "stopping"
          | "exited"
          | "failed",
        ...(typeof service.pid === "number" ? { pid: service.pid } : {}),
        ...(typeof service.startedAt === "string" ? { startedAt: service.startedAt } : {}),
        ...(typeof service.exitedAt === "string" ? { exitedAt: service.exitedAt } : {}),
        ...(typeof service.exitCode === "number" ? { exitCode: service.exitCode } : {}),
        ...(typeof service.failure === "string" ? { failure: service.failure } : {}),
        restartCount: service.restartCount,
        outputBytes: service.outputBytes,
        ...(typeof service.owner === "string" ? { owner: service.owner } : {}),
        persist: service.persist,
        detached: service.detached,
      },
    ];
  });
}

export function projectOmpRuntimeService(value: unknown): OmpRuntimeService | undefined {
  return projectOmpRuntimeServices([value])[0];
}

export function projectOmpLaunchLogs(data: unknown): OmpLaunchReadLogsResult | undefined {
  const value = optionalRecord(data);
  if (
    !value ||
    typeof value.text !== "string" ||
    typeof value.cursor !== "number" ||
    !Number.isSafeInteger(value.cursor) ||
    value.cursor < 0 ||
    typeof value.state !== "string" ||
    typeof value.timedOut !== "boolean"
  ) {
    return undefined;
  }
  return {
    content: value.text,
    nextCursor: value.cursor,
    state: value.state,
    timedOut: value.timedOut,
  };
}

export function projectOmpLaunchDescribe(data: unknown): OmpLaunchDescribeResult | undefined {
  const value = optionalRecord(data);
  const service = projectOmpRuntimeService(value?.service);
  if (
    !value ||
    !service ||
    typeof value.command !== "string" ||
    value.command.trim().length === 0 ||
    typeof value.cwd !== "string" ||
    value.cwd.trim().length === 0 ||
    typeof value.restart !== "string" ||
    value.restart.trim().length === 0
  ) {
    return undefined;
  }
  return { service, command: value.command, cwd: value.cwd, restart: value.restart };
}

export function projectOmpExtensionRuntimeStatus(
  state: OmpExtensionClientState,
  sessionCount: number,
): OmpProviderRuntimeStatus {
  const features = optionalRecord(state.capabilities?.features);
  const advisor = optionalRecord(state.advisor);
  const autolearn = optionalRecord(state.autolearn);
  const memory = optionalRecord(state.memory);
  const launch = optionalRecord(state.launch);
  const advisorEnabled = typeof advisor?.enabled === "boolean" ? advisor.enabled : undefined;
  const advisorActive = typeof advisor?.active === "boolean" ? advisor.active : undefined;
  const autolearnEnabled = typeof autolearn?.enabled === "boolean" ? autolearn.enabled : undefined;
  const autoContinue = typeof autolearn?.autoContinue === "boolean" ? autolearn.autoContinue : undefined;
  const captureGeneration =
    typeof autolearn?.captureGeneration === "number" ? autolearn.captureGeneration : undefined;
  const memoryActive = typeof memory?.active === "boolean" ? memory.active : undefined;
  const memoryWritable = typeof memory?.writable === "boolean" ? memory.writable : undefined;
  const memorySearchable = typeof memory?.searchable === "boolean" ? memory.searchable : undefined;
  return {
    mode: state.mode,
    sessionCount,
    ...(state.ompVersion ? { ompVersion: state.ompVersion } : {}),
    ...(state.generation ? { generation: state.generation } : {}),
    ...(state.updatedAt ? { updatedAt: state.updatedAt } : {}),
    ...(state.degradedReason ? { degradedReason: state.degradedReason } : {}),
    ...(features
      ? {
          features: {
            ...(projectFeature(features.advisor) ? { advisor: projectFeature(features.advisor) } : {}),
            ...(projectFeature(features.autolearn)
              ? { autolearn: projectFeature(features.autolearn) }
              : {}),
            ...(projectFeature(features.memory) ? { memory: projectFeature(features.memory) } : {}),
            ...(projectFeature(features.launch) ? { launch: projectFeature(features.launch) } : {}),
            ...(projectFeature(features.managedSkills)
              ? { managedSkills: projectFeature(features.managedSkills) }
              : {}),
          },
        }
      : {}),
    ...(advisorEnabled !== undefined && advisorActive !== undefined
      ? {
          advisor: {
            enabled: advisorEnabled,
            active: advisorActive,
            toolRisk: advisor?.toolRisk === "write-or-exec" ? "write-or-exec" : "read-only",
            grantedTools: stringArray(advisor?.grantedTools),
            inFlight: advisor?.inFlight === true,
            ...(projectDrain(advisor?.drain) ? { drain: projectDrain(advisor?.drain) } : {}),
            status: advisor,
          },
        }
      : {}),
    ...(autolearnEnabled !== undefined && autoContinue !== undefined && captureGeneration !== undefined
      ? {
          autolearn: {
            enabled: autolearnEnabled,
            autoContinue,
            state: typeof autolearn?.state === "string" ? autolearn.state : "unknown",
            captureGeneration,
            ...(typeof autolearn?.turn === "number" && Number.isSafeInteger(autolearn.turn) && autolearn.turn >= 0
              ? { turn: autolearn.turn }
              : {}),
            pending: autolearn?.pending === true,
            ...(projectDrain(autolearn?.drain)
              ? { drain: projectDrain(autolearn?.drain) }
              : {}),
            ...(typeof autolearn?.lastResult === "string"
              ? { lastResult: autolearn.lastResult }
              : {}),
            ...(typeof autolearn?.lastFailure === "string"
              ? { lastFailure: autolearn.lastFailure }
              : {}),
          },
        }
      : {}),
    ...(typeof memory?.backend === "string" && memoryActive !== undefined && memoryWritable !== undefined && memorySearchable !== undefined
      ? {
          memory: {
            backend: memory.backend,
            active: memoryActive,
            writable: memoryWritable,
            searchable: memorySearchable,
            ...(typeof memory.scope === "string" ? { scope: memory.scope } : {}),
            ...(memory.storage !== undefined ? { storage: memory.storage } : {}),
            ...(memory.queue !== undefined ? { queue: memory.queue } : {}),
            ...(typeof memory.error === "string" ? { error: memory.error } : {}),
          },
        }
      : {}),
    ...(launch?.authority === "omp"
      ? { launch: { authority: "omp", services: projectOmpRuntimeServices(launch.services) } }
      : {}),
  };
}
