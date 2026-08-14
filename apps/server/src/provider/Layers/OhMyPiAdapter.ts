/** OhMyPiAdapterLive - stock Oh My Pi ACP provider integration. */
import type * as Acp from "@agentclientprotocol/sdk";
import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderComposerCapabilities,
  type ProviderInteractionMode,
  type ProviderListCommandsResult,
  type ProviderListModelsResult,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeRequestId,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import {
  Cause,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Random,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  type SynaraHarnessPolicyDeliveryState,
  takeSynaraHarnessPolicyTextPartForProviderSession,
} from "../../agentGateway/harnessPolicy.ts";
import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { executableIdentity } from "../../executableLookup.ts";
import { appendFileAttachmentsPromptBlock } from "../attachmentProjection.ts";
import { appendProviderReferencesPromptBlock } from "../promptReferenceProjection.ts";
import { loadProviderPromptImageBlocks } from "../promptAttachments.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import {
  classifyAcpPromptTurnCompletion,
  mapAcpToAdapterError,
  readAcpFailedToolDetail,
  resolveAcpPermissionPolicy,
  selectAcpPermissionOptionId,
} from "../acp/AcpAdapterSupport.ts";
import {
  acceptAcpPlanUpdate,
  clearAcpActiveTurn,
  finalizeAcpActiveTurnCost,
  makeAcpThreadLock,
  recordAcpSessionCost,
  resolveAcpSessionCwd,
  resolveAcpTurnInteractionMode,
  scopeAcpRuntimeItemIdForTurn,
  scopeAcpToolCallStateForTurn,
  settleAcpPendingApprovalsAsCancelled,
  settleAcpPendingUserInputsAsEmptyAnswers,
} from "../acp/AcpAdapterSessionSupport.ts";
import { registerStandardAcpClientHandlers } from "../acp/AcpClientCapabilities.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpTokenUsageEvent,
  makeAcpToolCallEvent,
  stampAcpRuntimeEventLifecycleGeneration,
} from "../acp/AcpCoreRuntimeEvents.ts";
import {
  elicitationQuestionsFromRequest,
  elicitationResponseFromAnswers,
  isFormElicitationRequest,
} from "../acp/AcpElicitationSupport.ts";
import {
  applyOhMyPiAcpSessionConfiguration,
  discoverOhMyPiAcpModels,
  makeOhMyPiAcpRuntime,
  resolveOhMyPiCliBinaryPath,
  type OhMyPiAcpRuntimeInput,
  type OhMyPiAcpRuntimeSettings,
} from "../acp/OhMyPiAcpSupport.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import type { AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime.ts";
import {
  prepareOmpControlPlane,
  type PreparedOmpControlPlane,
  waitForOmpTurnSettle,
} from "../omp/OmpControlPlane.ts";
import { OhMyPiAdapter, type OhMyPiAdapterShape } from "../Services/OhMyPiAdapter.ts";
import { PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY } from "../Services/ProviderAdapter.ts";

const PROVIDER = "omp" as const;
const OMP_RESUME_VERSION = 1 as const;
const OMP_REQUEST_TIMEOUT_MS = 30_000;
const OMP_DISCOVERY_TIMEOUT_MS = 30_000;
const OMP_DISCOVERY_CACHE_MS = 30_000;
const OMP_DISCOVERY_CACHE_MAX_ENTRIES = 16;
const OMP_TURN_DRAIN_MAX_WAIT_MS = 1_500;
const OMP_TURN_DRAIN_POLL_MS = 25;
const OMP_TURN_DRAIN_QUIET_WINDOW_MS = 200;

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface OhMyPiSessionContext extends SynaraHarnessPolicyDeliveryState {
  readonly threadId: ThreadId;
  readonly lifecycleGeneration?: string;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntimeShape;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  processExitFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeInteractionMode: ProviderInteractionMode | undefined;
  activeTurnId: TurnId | undefined;
  activeTurnHadAssistantContent: boolean;
  readonly activeAssistantItemsWithContent: Set<string>;
  activeTurnFailedToolDetail: string | undefined;
  activePromptFiber: Fiber.Fiber<void, never> | undefined;
  lastPlanFingerprint: string | undefined;
  latestSessionCostUsd: number | undefined;
  sessionUpdatesProcessed: number;
  sessionActivityVersion: number;
  processExited: boolean;
  turnStarting: boolean;
  pendingTurnInterrupted: boolean;
  stopped: boolean;
  readonly teardownComplete: Deferred.Deferred<void>;
}

export interface OhMyPiAdapterLiveOptions {
  readonly makeRuntime?: (
    input: OhMyPiAcpRuntimeInput,
  ) => Effect.Effect<AcpSessionRuntimeShape, import("../acp/AcpErrors.ts").AcpError, Scope.Scope>;
  readonly discoveryCacheMs?: number;
  readonly discoveryTimeoutMs?: number;
  readonly prepareControlPlane?: () => Effect.Effect<PreparedOmpControlPlane, Error>;
  readonly settleQuietWindowMs?: number;
  readonly settleMaxWaitMs?: number;
  readonly settlePollMs?: number;
}

function parseResumeCursor(raw: unknown): { sessionId: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  return value.schemaVersion === OMP_RESUME_VERSION &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0
    ? { sessionId: value.sessionId.trim() }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function standardAcpInboundMethod(method: string): boolean {
  return (
    method === "session/update" ||
    method === "session/request_permission" ||
    method === "session/elicitation" ||
    method.startsWith("fs/") ||
    method.startsWith("terminal/") ||
    method.startsWith("mcp/")
  );
}

function resolveSessionCwd(inputCwd: string | undefined, config: ServerConfigShape): string | undefined {
  return resolveAcpSessionCwd({
    inputCwd,
    serverCwd: config.cwd,
    homeDir: config.homeDir,
  });
}

function timeoutError(method: string): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: `Oh My Pi ACP did not respond to ${method} within ${OMP_REQUEST_TIMEOUT_MS / 1000}s.`,
  });
}

function cacheSet<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > OMP_DISCOVERY_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function discoveryCacheKey(binaryPath: string | undefined, cwd: string): string {
  const resolved = resolveOhMyPiCliBinaryPath(binaryPath);
  return `${resolved}\u0000${executableIdentity(resolved) ?? "identity-unavailable"}\u0000${cwd}`;
}

function effectiveDiscoveryBinaryPath(
  inputBinaryPath: string | undefined,
  settingsBinaryPath: string | undefined,
): string | undefined {
  return inputBinaryPath?.trim() || settingsBinaryPath?.trim() || undefined;
}

export function makeOhMyPiAdapter(
  settings: OhMyPiAcpRuntimeSettings,
  options?: OhMyPiAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* Effect.service(ServerConfig);
    const runtimeFactory = options?.makeRuntime ?? makeOhMyPiAcpRuntime;
    const prepareControlPlane =
      options?.prepareControlPlane ??
      (() =>
        Effect.tryPromise({
          try: () => prepareOmpControlPlane(),
          catch: (cause) =>
            cause instanceof Error
              ? cause
              : new Error(`Failed to prepare Oh My Pi control plane: ${String(cause)}`),
        }));
    const sessions = new Map<ThreadId, OhMyPiSessionContext>();
    const withThreadLock = yield* makeAcpThreadLock();
    const discoveryLock = yield* Semaphore.make(1);
    const modelCache = new Map<
      string,
      { readonly expiresAt: number; readonly result: ProviderListModelsResult }
    >();
    const commandCache = new Map<
      string,
      { readonly expiresAt: number; readonly result: ProviderListCommandsResult }
    >();
    const events = yield* PubSub.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const makeEventStamp = () =>
      Effect.all({
        eventId: Effect.map(Random.nextUUIDv4, EventId.makeUnsafe),
        createdAt: nowIso,
      });
    const publish = (generation: string | undefined, event: ProviderRuntimeEvent) =>
      PubSub.publish(events, stampAcpRuntimeEventLifecycleGeneration(event, generation)).pipe(
        Effect.asVoid,
      );

    const requireSession = (threadId: ThreadId) => {
      const ctx = sessions.get(threadId);
      return ctx && !ctx.stopped
        ? Effect.succeed(ctx)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };

    const stopSessionInternal = (
      ctx: OhMyPiSessionContext,
      stopOptions?: {
        readonly exitKind?: "graceful" | "error";
        readonly reason?: string;
        readonly fromProcessWatcher?: boolean;
      },
    ) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (!ctx.stopped) {
            ctx.stopped = true;
            sessions.delete(ctx.threadId);
            yield* settleAcpPendingApprovalsAsCancelled(ctx.pendingApprovals);
            yield* settleAcpPendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
            if (ctx.notificationFiber) yield* Fiber.interrupt(ctx.notificationFiber);
            if (ctx.processExitFiber && stopOptions?.fromProcessWatcher !== true) {
              yield* Fiber.interrupt(ctx.processExitFiber);
            }
            const teardown = Effect.gen(function* () {
              yield* Scope.close(ctx.scope, Exit.void);
              yield* publish(ctx.lifecycleGeneration, {
                type: "session.exited",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: ctx.threadId,
                payload: {
                  exitKind: stopOptions?.exitKind ?? "graceful",
                  ...(stopOptions?.reason ? { reason: stopOptions.reason } : {}),
                },
              });
            }).pipe(Effect.ensuring(Deferred.succeed(ctx.teardownComplete, undefined)));
            yield* teardown.pipe(Effect.forkDetach, Effect.asVoid);
          }
          yield* restore(Deferred.await(ctx.teardownComplete));
        }),
      );

    const emitParsedEvent = (ctx: OhMyPiSessionContext, event: ReturnType<AcpSessionRuntimeShape["getEvents"]> extends Stream.Stream<infer A, never> ? A : never) =>
      Effect.gen(function* () {
        ctx.sessionActivityVersion += 1;
        const turnId = ctx.activeTurnId;
        switch (event._tag) {
          case "ModeChanged":
            yield* publish(ctx.lifecycleGeneration, {
              type: "session.state.changed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: ctx.threadId,
              payload: { state: "ready", reason: `Oh My Pi mode changed to ${event.modeId}.` },
            });
            return;
          case "AssistantItemStarted":
            return;
          case "AssistantItemCompleted": {
            if (!turnId) return;
            const itemId = scopeAcpRuntimeItemIdForTurn(PROVIDER, turnId, event.itemId);
            if (!ctx.activeAssistantItemsWithContent.delete(itemId)) return;
            yield* publish(
              ctx.lifecycleGeneration,
              makeAcpAssistantItemEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                itemId,
                lifecycle: "item.completed",
              }),
            );
            return;
          }
          case "PlanUpdated":
            if (!turnId || !acceptAcpPlanUpdate(ctx, event.payload)) return;
            yield* publish(
              ctx.lifecycleGeneration,
              makeAcpPlanUpdatedEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                payload: event.payload,
                source: "acp.jsonrpc",
                method: "session/update",
                rawPayload: event.rawPayload,
              }),
            );
            return;
          case "ToolCallUpdated":
            if (!turnId) return;
            ctx.activeTurnFailedToolDetail =
              readAcpFailedToolDetail(event.toolCall) ?? ctx.activeTurnFailedToolDetail;
            yield* publish(
              ctx.lifecycleGeneration,
              makeAcpToolCallEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                toolCall: scopeAcpToolCallStateForTurn(PROVIDER, turnId, event.toolCall),
                rawPayload: event.rawPayload,
              }),
            );
            return;
          case "ContentDelta": {
            if (!turnId) return;
            const itemId = event.itemId
              ? scopeAcpRuntimeItemIdForTurn(PROVIDER, turnId, event.itemId)
              : undefined;
            if (event.text.trim().length > 0) {
              ctx.activeTurnHadAssistantContent = true;
              if (itemId) ctx.activeAssistantItemsWithContent.add(itemId);
            }
            yield* publish(
              ctx.lifecycleGeneration,
              makeAcpContentDeltaEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                ...(itemId ? { itemId } : {}),
                text: event.text,
                ...(event.streamKind ? { streamKind: event.streamKind } : {}),
                rawPayload: event.rawPayload,
              }),
            );
            return;
          }
          case "UsageUpdated":
            if (!turnId) return;
            recordAcpSessionCost(ctx, event.cost);
            yield* publish(
              ctx.lifecycleGeneration,
              makeAcpTokenUsageEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: ctx.threadId,
                turnId,
                usage: event.usage,
                rawPayload: event.rawPayload,
              }),
            );
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            ctx.sessionUpdatesProcessed += 1;
          }),
        ),
      );

    const waitForQueuedEvents = (ctx: OhMyPiSessionContext) =>
      Effect.gen(function* () {
        const target = yield* ctx.acp.sessionUpdatesEnqueuedCount;
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            waitForOmpTurnSettle({
              targetEnqueued: target,
              getSnapshot: () => ({
                processed: ctx.sessionUpdatesProcessed,
                activityVersion: ctx.sessionActivityVersion,
                aborted: ctx.pendingTurnInterrupted || ctx.stopped,
                processExited: ctx.processExited,
              }),
              quietWindowMs: options?.settleQuietWindowMs ?? OMP_TURN_DRAIN_QUIET_WINDOW_MS,
              maxWaitMs: options?.settleMaxWaitMs ?? OMP_TURN_DRAIN_MAX_WAIT_MS,
              pollMs: options?.settlePollMs ?? OMP_TURN_DRAIN_POLL_MS,
              signal,
            }),
          catch: (cause) => cause,
        }).pipe(Effect.orDie);
        if (result.outcome === "timed-out") {
          yield* publish(ctx.lifecycleGeneration, {
            type: "runtime.warning",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: ctx.threadId,
            ...(ctx.activeTurnId ? { turnId: ctx.activeTurnId } : {}),
            payload: {
              message:
                "Oh My Pi ACP did not become quiet before the bounded turn-settle timeout; Synara continued without claiming Auto-Learn capture completed.",
              detail: {
                waitedMs: result.waitedMs,
                queueDrained: result.queueDrained,
                typedDrainAvailable: false,
              },
            },
          });
        }
        return result;
      });

    const startSession: OhMyPiAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          const cwd = resolveSessionCwd(input.cwd, serverConfig);
          if (!cwd) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and no server cwd fallback is available.",
            });
          }
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) yield* stopSessionInternal(existing);

          const selection =
            input.modelSelection?.provider === PROVIDER ? input.modelSelection : undefined;
          const controlPlane = yield* prepareControlPlane().pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/start",
                  detail: `Failed to prepare the Oh My Pi process overlay: ${cause.message}`,
                }),
            ),
          );
          const providerSettings: OhMyPiAcpRuntimeSettings = {
            overlayPath: controlPlane.overlayPath,
            ...(settings.binaryPath ? { binaryPath: settings.binaryPath } : {}),
            ...(input.providerOptions?.omp?.binaryPath
              ? { binaryPath: input.providerOptions.omp.binaryPath }
              : {}),
          };
          const resumeSessionId = parseResumeCursor(input.resumeCursor)?.sessionId;
          const sessionScope = yield* Scope.make("sequential");
          let transferred = false;
          yield* Effect.addFinalizer(() =>
            transferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );

          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
          const acp = yield* runtimeFactory({
            ohMyPiSettings: providerSettings,
            childProcessSpawner,
            cwd,
            ...(resumeSessionId ? { resumeSessionId } : {}),
            clientInfo: { name: "Synara", version: "0.0.0" },
            protocolLogging: {
              logIncoming: true,
              logger: (event) =>
                Effect.gen(function* () {
                  if (event.direction !== "incoming" || event.stage !== "decoded") return;
                  const payload = event.payload;
                  if (!isRecord(payload)) return;
                  const method = typeof payload.method === "string" ? payload.method : undefined;
                  if (!method) return;
                  if (!standardAcpInboundMethod(method)) {
                    yield* publish(input.lifecycleGeneration, {
                      type: "runtime.warning",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      payload: {
                        message: `Oh My Pi sent an unknown ACP extension notification: ${method}.`,
                        detail: { method },
                      },
                      raw: { source: "acp.omp.extension", method, payload },
                    });
                    return;
                  }
                  if (method !== "session/update" || !isRecord(payload.params)) return;
                  const update = isRecord(payload.params.update) ? payload.params.update : undefined;
                  const updateKind =
                    typeof update?.sessionUpdate === "string" ? update.sessionUpdate : undefined;
                  if (
                    updateKind === "config_option_update" ||
                    updateKind === "available_commands_update"
                  ) {
                    yield* publish(input.lifecycleGeneration, {
                      type: "session.state.changed",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      payload: {
                        state: "ready",
                        reason:
                          updateKind === "config_option_update"
                            ? "Oh My Pi session configuration updated."
                            : "Oh My Pi available commands updated.",
                        detail: update,
                      },
                    });
                  }
                }),
            },
          }).pipe(
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", cause),
            ),
          );
          const teardownComplete = yield* Deferred.make<void>();
          const now = yield* nowIso;
          let ctx: OhMyPiSessionContext = {
            threadId: input.threadId,
            ...(input.lifecycleGeneration ? { lifecycleGeneration: input.lifecycleGeneration } : {}),
            session: {
              provider: PROVIDER,
              status: "connecting",
              runtimeMode: input.runtimeMode,
              cwd,
              ...(selection?.model ? { model: selection.model } : {}),
              threadId: input.threadId,
              createdAt: now,
              updatedAt: now,
            },
            scope: sessionScope,
            acp,
            notificationFiber: undefined,
            processExitFiber: undefined,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            activeInteractionMode: undefined,
            activeTurnId: undefined,
            activeTurnHadAssistantContent: false,
            activeAssistantItemsWithContent: new Set(),
            activeTurnFailedToolDetail: undefined,
            activePromptFiber: undefined,
            lastPlanFingerprint: undefined,
            latestSessionCostUsd: undefined,
            sessionUpdatesProcessed: 0,
            sessionActivityVersion: 0,
            processExited: false,
            turnStarting: false,
            pendingTurnInterrupted: false,
            stopped: false,
            teardownComplete,
          };

          yield* acp.handleRequestPermission((params) =>
            Effect.gen(function* () {
              const policy = resolveAcpPermissionPolicy({
                runtimeMode: input.runtimeMode,
                interactionMode: ctx.activeInteractionMode,
                options: params.options,
              });
              if (policy) return { outcome: policy };
              const permissionRequest = parsePermissionRequest(params);
              const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
              const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);
              const decision = yield* Deferred.make<ProviderApprovalDecision>();
              pendingApprovals.set(requestId, { decision });
              yield* publish(
                input.lifecycleGeneration,
                makeAcpRequestOpenedEvent({
                  stamp: yield* makeEventStamp(),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId: ctx.activeTurnId,
                  requestId: runtimeRequestId,
                  permissionRequest,
                  detail: permissionRequest.detail ?? JSON.stringify(params).slice(0, 2_000),
                  args: params,
                  source: "acp.jsonrpc",
                  method: "session/request_permission",
                  rawPayload: params,
                }),
              );
              const resolved = yield* Deferred.await(decision);
              pendingApprovals.delete(requestId);
              yield* publish(
                input.lifecycleGeneration,
                makeAcpRequestResolvedEvent({
                  stamp: yield* makeEventStamp(),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId: ctx.activeTurnId,
                  requestId: runtimeRequestId,
                  permissionRequest,
                  decision: resolved,
                }),
              );
              const optionId = selectAcpPermissionOptionId(resolved, params.options);
              return {
                outcome:
                  optionId === undefined
                    ? ({ outcome: "cancelled" } as const)
                    : ({ outcome: "selected", optionId } as const),
              };
            }),
          );
          yield* acp.handleElicitation((params) =>
            Effect.gen(function* () {
              if (!ctx.activeTurnId || !isFormElicitationRequest(params)) {
                return { action: "decline" as const };
              }
              const questions = elicitationQuestionsFromRequest(params);
              if (questions.length === 0) return { action: "decline" as const };
              const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
              const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);
              const answers = yield* Deferred.make<ProviderUserInputAnswers>();
              pendingUserInputs.set(requestId, { answers });
              yield* publish(input.lifecycleGeneration, {
                type: "user-input.requested",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId: ctx.activeTurnId,
                requestId: runtimeRequestId,
                payload: { questions },
                raw: { source: "acp.jsonrpc", method: "session/elicitation", payload: params },
              });
              const resolved = yield* Deferred.await(answers);
              pendingUserInputs.delete(requestId);
              yield* publish(input.lifecycleGeneration, {
                type: "user-input.resolved",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId: ctx.activeTurnId,
                requestId: runtimeRequestId,
                payload: { answers: resolved },
              });
              return elicitationResponseFromAnswers(params, resolved);
            }),
          );
          yield* registerStandardAcpClientHandlers(acp, sessionScope);

          // Both consumers exist before initialize/session setup begins, so early updates and exit
          // cannot race the adapter's subscriptions.
          ctx.notificationFiber = yield* Stream.runDrain(
            Stream.mapEffect(acp.getEvents(), (event) => emitParsedEvent(ctx, event)),
          ).pipe(Effect.forkIn(sessionScope));
          ctx.processExitFiber = yield* acp.awaitExit.pipe(
            Effect.andThen(
              Effect.suspend(() =>
                Effect.sync(() => {
                  ctx.processExited = true;
                }).pipe(
                  Effect.andThen(
                    stopSessionInternal(ctx, {
                      exitKind: "error",
                      reason: "Oh My Pi ACP process exited.",
                      fromProcessWatcher: true,
                    }),
                  ),
                ),
              ),
            ),
            Effect.ignore,
            Effect.forkDetach,
          );
          const started = yield* acp.start().pipe(
            Effect.timeoutOption(OMP_REQUEST_TIMEOUT_MS),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(timeoutError("session/start")),
                onSome: Effect.succeed,
              }),
            ),
            Effect.mapError((cause) =>
              cause instanceof ProviderAdapterRequestError
                ? cause
                : mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", cause),
            ),
          );
          if (resumeSessionId && started.sessionSetupMethod === "new") {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/resume",
              detail:
                "Oh My Pi could not resume or load the requested native session; Synara refused a fresh fallback.",
            });
          }

          const resumeCursor = { schemaVersion: OMP_RESUME_VERSION, sessionId: started.sessionId };
          ctx.session = {
            ...ctx.session,
            status: "ready",
            resumeCursor,
            updatedAt: yield* nowIso,
          };
          sessions.set(input.threadId, ctx);
          transferred = true;

          yield* applyOhMyPiAcpSessionConfiguration({
            runtime: acp,
            interactionMode: "default",
            model: selection?.model,
            thinkingLevel: selection?.options?.thinkingLevel,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
          }).pipe(
            Effect.timeoutOption(OMP_REQUEST_TIMEOUT_MS),
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(timeoutError("session/set_config_option")),
                onSome: Effect.succeed,
              }),
            ),
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) ? Effect.void : Effect.ignore(stopSessionInternal(ctx)),
            ),
          );
          yield* publish(input.lifecycleGeneration, {
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* publish(input.lifecycleGeneration, {
            type: "session.configured",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: {
              config: {
                setupMethod: started.sessionSetupMethod,
                model: selection?.model ?? null,
                thinkingLevel: selection?.options?.thinkingLevel ?? null,
                mode: "default",
              },
            },
          });
          yield* publish(input.lifecycleGeneration, {
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });
          return ctx.session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: OhMyPiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        if (ctx.turnStarting || ctx.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Another Oh My Pi turn is already active for this thread.",
          });
        }
        if (ctx.session.runtimeMode === "auto") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Auto runtime mode is available only to Codex and Claude.",
          });
        }
        ctx.turnStarting = true;
        ctx.pendingTurnInterrupted = false;
        return yield* Effect.gen(function* () {
          const interactionMode = resolveAcpTurnInteractionMode(input.interactionMode);
          const selection =
            input.modelSelection?.provider === PROVIDER ? input.modelSelection : undefined;
          yield* applyOhMyPiAcpSessionConfiguration({
            runtime: ctx.acp,
            interactionMode,
            model: selection?.model,
            thinkingLevel: selection?.options?.thinkingLevel,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
          });

          const prompt: Array<Acp.ContentBlock> = [];
          const promptText = appendFileAttachmentsPromptBlock({
            text: appendProviderReferencesPromptBlock({
              text: input.input?.trim(),
              mentions: input.mentions,
            }),
            attachments: input.attachments,
            attachmentsDir: serverConfig.attachmentsDir,
            include: "all-files",
          });
          if (promptText) prompt.push({ type: "text", text: promptText });
          prompt.push(
            ...(yield* loadProviderPromptImageBlocks({
              attachments: input.attachments,
              attachmentsDir: serverConfig.attachmentsDir,
              provider: PROVIDER,
              method: "session/prompt",
              readFile: fileSystem.readFile,
            })),
          );
          if (prompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }
          const harnessPolicy = takeSynaraHarnessPolicyTextPartForProviderSession(ctx, {
            provider: PROVIDER,
            scopedGatewayConnectionAvailable: false,
          });
          if (harnessPolicy) prompt.unshift(harnessPolicy);
          if (ctx.stopped) {
            return yield* new ProviderAdapterSessionNotFoundError({
              provider: PROVIDER,
              threadId: input.threadId,
            });
          }

          const turnId = TurnId.makeUnsafe(crypto.randomUUID());
          ctx.activeTurnId = turnId;
          ctx.activeInteractionMode = interactionMode;
          ctx.activeTurnHadAssistantContent = false;
          ctx.activeAssistantItemsWithContent.clear();
          ctx.activeTurnFailedToolDetail = undefined;
          ctx.lastPlanFingerprint = undefined;
          ctx.session = {
            ...ctx.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
            ...(selection?.model ? { model: selection.model } : {}),
          };
          yield* publish(ctx.lifecycleGeneration, {
            type: "turn.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: { ...(selection?.model ? { model: selection.model } : {}) },
          });

          ctx.activePromptFiber = yield* Effect.suspend(() =>
            ctx.pendingTurnInterrupted || ctx.stopped
              ? Effect.interrupt
              : ctx.acp.prompt({ prompt }),
          ).pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", cause),
            ),
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.gen(function* () {
                  yield* waitForQueuedEvents(ctx);
                  if (!clearAcpActiveTurn(ctx, turnId)) return;
                  const completedCost = finalizeAcpActiveTurnCost(ctx);
                  ctx.turns.push({ id: turnId, items: [{ prompt, error }] });
                  ctx.session = {
                    ...ctx.session,
                    status: "error",
                    updatedAt: yield* nowIso,
                    lastError: error.message,
                  };
                  yield* publish(ctx.lifecycleGeneration, {
                    type: "turn.completed",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId,
                    payload: {
                      state: "failed",
                      stopReason: null,
                      errorMessage: error.message,
                      ...completedCost,
                    },
                  });
                  yield* stopSessionInternal(ctx, {
                    exitKind: "error",
                    reason: error.message,
                  });
                }),
              onSuccess: (result) =>
                Effect.gen(function* () {
                  yield* waitForQueuedEvents(ctx);
                  const failedToolDetail = ctx.activeTurnFailedToolDetail;
                  if (!clearAcpActiveTurn(ctx, turnId)) return;
                  const completedCost = finalizeAcpActiveTurnCost(ctx);
                  ctx.turns.push({ id: turnId, items: [{ prompt, result }] });
                  ctx.session = {
                    ...ctx.session,
                    status: "ready",
                    updatedAt: yield* nowIso,
                  };
                  const completion = classifyAcpPromptTurnCompletion({
                    stopReason: result.stopReason,
                    ...(failedToolDetail ? { failedToolDetail } : {}),
                  });
                  yield* publish(ctx.lifecycleGeneration, {
                    type: "turn.completed",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId,
                    payload: {
                      state: completion.state,
                      stopReason: result.stopReason ?? null,
                      ...(completion.errorMessage ? { errorMessage: completion.errorMessage } : {}),
                      ...(result.usage ? { usage: result.usage } : {}),
                      ...completedCost,
                    },
                  });
                }),
            }),
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                if (!clearAcpActiveTurn(ctx, turnId)) return;
                ctx.turns.push({ id: turnId, items: [{ prompt, interrupted: true }] });
                ctx.session = { ...ctx.session, status: "ready", updatedAt: yield* nowIso };
                yield* publish(ctx.lifecycleGeneration, {
                  type: "turn.completed",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: { state: "cancelled", stopReason: "cancelled" },
                });
              }),
            ),
            Effect.ignoreCause({ log: true }),
            Effect.forkIn(ctx.scope),
          );
          return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              ctx.turnStarting = false;
            }),
          ),
        );
      });

    const interruptTurn: OhMyPiAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (turnId !== undefined && turnId !== ctx.activeTurnId) return;
        if (!ctx.turnStarting && !ctx.activeTurnId) return;
        if (ctx.pendingTurnInterrupted) return;
        ctx.pendingTurnInterrupted = true;
        yield* settleAcpPendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settleAcpPendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        yield* ctx.acp.cancel.pipe(Effect.ignore);
        if (ctx.activePromptFiber) yield* Fiber.interrupt(ctx.activePromptFiber);
      });

    const respondToRequest: OhMyPiAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/request_permission",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: OhMyPiAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/elicitation",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.answers, answers);
      });

    const readThread: OhMyPiAdapterShape["readThread"] = (threadId) =>
      Effect.map(requireSession(threadId), (ctx) => ({ threadId, turns: ctx.turns }));

    const rollbackThread: OhMyPiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue:
            "Oh My Pi ACP does not expose native rewind; rollback must restart the session with retained transcript context.",
        });
      });

    const stopSession: OhMyPiAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = sessions.get(threadId);
          if (ctx && !ctx.stopped) yield* stopSessionInternal(ctx);
        }),
      );
    const listSessions: OhMyPiAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));
    const hasSession: OhMyPiAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const ctx = sessions.get(threadId);
        return ctx !== undefined && !ctx.stopped;
      });
    const stopAll: OhMyPiAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

    const getComposerCapabilities: NonNullable<
      OhMyPiAdapterShape["getComposerCapabilities"]
    > = () =>
      Effect.succeed({
        provider: PROVIDER,
        supportsSkillMentions: true,
        supportsSkillDiscovery: false,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsThreadCompaction: false,
        supportsThreadImport: false,
      } satisfies ProviderComposerCapabilities);

    const withDiscoveryRuntime = <A>(
      input: { readonly cwd?: string; readonly binaryPath?: string },
      use: (runtime: AcpSessionRuntimeShape) => Effect.Effect<A, unknown>,
    ) =>
      Effect.gen(function* () {
        const cwd = resolveSessionCwd(input.cwd, serverConfig);
        if (!cwd) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "providerDiscovery",
            issue: "cwd is required and no server cwd fallback is available.",
          });
        }
        const runtime = yield* runtimeFactory({
          ohMyPiSettings: {
            overlayPath: (yield* prepareControlPlane()).overlayPath,
            ...(settings.binaryPath ? { binaryPath: settings.binaryPath } : {}),
            ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
          },
          childProcessSpawner,
          cwd,
          clientInfo: { name: "Synara Discovery", version: "0.0.0" },
        });
        const scope = yield* Scope.Scope;
        yield* registerStandardAcpClientHandlers(runtime, scope);
        yield* runtime.start();
        return yield* use(runtime);
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) =>
          cause instanceof ProviderAdapterValidationError
            ? cause
            : mapAcpToAdapterError(
                PROVIDER,
                ThreadId.makeUnsafe("omp-discovery"),
                "provider/discovery",
                cause,
              ),
        ),
        Effect.timeoutOption(options?.discoveryTimeoutMs ?? OMP_DISCOVERY_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "provider/discovery",
                  detail: "Timed out while discovering Oh My Pi ACP capabilities.",
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );

    const discoverCatalog = (input: { readonly cwd?: string; readonly binaryPath?: string }) =>
      withDiscoveryRuntime(input, (runtime) =>
        Effect.gen(function* () {
          const models = yield* discoverOhMyPiAcpModels(runtime);
          let availableCommands = yield* runtime.getAvailableCommands;
          const startedAt = Date.now();
          while (availableCommands.length === 0 && Date.now() - startedAt < 500) {
            yield* Effect.sleep(25);
            availableCommands = yield* runtime.getAvailableCommands;
          }
          const commands = {
            commands: availableCommands.map((command) => ({
              name: command.name,
              ...(command.description ? { description: command.description } : {}),
            })),
            source: "omp-acp",
            cached: false,
          } satisfies ProviderListCommandsResult;
          return { models, commands };
        }),
      );

    const listModels: NonNullable<OhMyPiAdapterShape["listModels"]> = (input) =>
      discoveryLock.withPermits(1)(
        Effect.gen(function* () {
          const cwd = resolveSessionCwd(input.cwd, serverConfig);
          if (!cwd) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "listModels",
              issue: "cwd is required and no server cwd fallback is available.",
            });
          }
          const key = discoveryCacheKey(
            effectiveDiscoveryBinaryPath(input.binaryPath, settings.binaryPath),
            cwd,
          );
          const cached = modelCache.get(key);
          if (input.forceReload !== true && cached && cached.expiresAt > Date.now()) {
            return { ...cached.result, cached: true };
          }
          const catalog = yield* discoverCatalog(input);
          const ttl = options?.discoveryCacheMs ?? OMP_DISCOVERY_CACHE_MS;
          const expiresAt = Date.now() + ttl;
          cacheSet(modelCache, key, { expiresAt, result: catalog.models });
          cacheSet(commandCache, key, { expiresAt, result: catalog.commands });
          return catalog.models;
        }),
      );

    const listCommands: NonNullable<OhMyPiAdapterShape["listCommands"]> = (input) =>
      discoveryLock.withPermits(1)(
        Effect.gen(function* () {
          const cwd = resolveSessionCwd(input.cwd, serverConfig);
          if (!cwd) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "listCommands",
              issue: "cwd is required and no server cwd fallback is available.",
            });
          }
          const key = discoveryCacheKey(
            effectiveDiscoveryBinaryPath(input.binaryPath, settings.binaryPath),
            cwd,
          );
          const cached = commandCache.get(key);
          if (input.forceReload !== true && cached && cached.expiresAt > Date.now()) {
            return { ...cached.result, cached: true };
          }
          const catalog = yield* discoverCatalog(input);
          const ttl = options?.discoveryCacheMs ?? OMP_DISCOVERY_CACHE_MS;
          const expiresAt = Date.now() + ttl;
          cacheSet(modelCache, key, { expiresAt, result: catalog.models });
          cacheSet(commandCache, key, { expiresAt, result: catalog.commands });
          return catalog.commands;
        }),
      );

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(Effect.tap(() => PubSub.shutdown(events))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        conversationRollback: "restart-session",
        supportsRuntimeModelList: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsSkillDiscovery: false,
        supportsPluginDiscovery: false,
        supportsTurnSteering: false,
        supportsLiveTurnDiffPatch: false,
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      readThread,
      rollbackThread,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromPubSub(events),
      getComposerCapabilities,
      listModels,
      listCommands,
    } satisfies OhMyPiAdapterShape;
  });
}

export const OhMyPiAdapterLive = Layer.effect(OhMyPiAdapter, makeOhMyPiAdapter({}));

export function makeOhMyPiAdapterLive(
  settings: OhMyPiAcpRuntimeSettings = {},
  options?: OhMyPiAdapterLiveOptions,
) {
  return Layer.effect(OhMyPiAdapter, makeOhMyPiAdapter(settings, options));
}
