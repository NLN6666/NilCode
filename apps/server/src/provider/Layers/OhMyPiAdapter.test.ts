import { NodeServices } from "@effect/platform-node";
import type * as Acp from "@agentclientprotocol/sdk";
import type { ProviderRuntimeEvent } from "@synara/contracts";
import { Deferred, Effect, Layer, PubSub, Scope, Stream } from "effect";
import { appendFileSync, chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import {
  AgentGatewayCredentials,
  type AgentGatewayCredentialsShape,
} from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import * as AcpErrors from "../acp/AcpErrors.ts";
import type { AcpParsedSessionEvent } from "../acp/AcpRuntimeModel.ts";
import type {
  AcpSessionRuntimeShape,
  AcpSessionRuntimeStartResult,
} from "../acp/AcpSessionRuntime.ts";
import { OH_MY_PI_ACP_17_3_3_FIXTURE } from "../acp/fixtures/ohMyPiAcp17_3_3.ts";
import type { OhMyPiAcpRuntimeInput } from "../acp/OhMyPiAcpSupport.ts";
import { OMP_EXTENSION_EVENTS, OMP_EXTENSION_METHODS } from "../omp/OmpExtensionProtocol.ts";
import { OhMyPiAdapter } from "../Services/OhMyPiAdapter.ts";
import { makeOhMyPiAdapterLive, unknownOmpExtensionNotificationMethod } from "./OhMyPiAdapter.ts";

type PermissionHandler = Parameters<AcpSessionRuntimeShape["handleRequestPermission"]>[0];
type ElicitationHandler = Parameters<AcpSessionRuntimeShape["handleElicitation"]>[0];

interface FakeRuntimeState {
  readonly inputs: OhMyPiAcpRuntimeInput[];
  readonly configurationCalls: Array<{ id: string; value?: string | boolean }>;
  readonly registrations: string[];
  prompts: number;
  enqueued: number;
  cancels: number;
  closed: number;
  permissionHandler?: PermissionHandler;
  elicitationHandler?: ElicitationHandler;
  promptEffect?: () => Effect.Effect<void, AcpErrors.AcpError>;
  signalProcessExit?: () => void;
  emitUnknownExtension?: boolean;
  eventBurst?: number;
  undeliveredEvents?: number;
  setupMethod?: "new" | "load" | "resume";
  failStart?: boolean;
  neverStart?: boolean;
  typedExtensions?: boolean;
  extensionSequence: number;
  readonly extensionRequests: string[];
  emitExtension?: (method: string, data: Record<string, unknown>) => Promise<void>;
}

describe("unknownOmpExtensionNotificationMethod", () => {
  it("ignores request responses and known typed events while diagnosing real unknown notifications", () => {
    expect(
      unknownOmpExtensionNotificationMethod({
        method: OMP_EXTENSION_METHODS.capabilities,
        result: { schemaVersion: 1 },
      }),
    ).toBeUndefined();
    expect(
      unknownOmpExtensionNotificationMethod({
        method: OMP_EXTENSION_EVENTS.advisorNote,
        params: { schemaVersion: 1 },
      }),
    ).toBeUndefined();
    expect(
      unknownOmpExtensionNotificationMethod({ method: "_omp/fixture_notice", params: {} }),
    ).toBe("_omp/fixture_notice");
  });
});

function makeFakeRuntimeFactory(state: FakeRuntimeState) {
  return (input: OhMyPiAcpRuntimeInput) =>
    Effect.gen(function* () {
      state.inputs.push(input);
      const scope = yield* Scope.Scope;
      const exit = yield* Deferred.make<void>();
      state.signalProcessExit = () => {
        Effect.runFork(Deferred.succeed(exit, undefined));
      };
      const events = yield* PubSub.unbounded<AcpParsedSessionEvent>();
      const extensionNotifications = new Map<
        string,
        (payload: unknown) => Effect.Effect<void, unknown>
      >();
      const extensionEnvelope = (data: Record<string, unknown>) => ({
        schemaVersion: 1,
        ompVersion: "17.3.3-phase3-test",
        sessionId: input.resumeSessionId ?? "omp-session-new",
        generation: "omp-generation-test",
        sequence: ++state.extensionSequence,
        timestamp: new Date().toISOString(),
        data,
      });
      state.emitExtension = async (method, data) => {
        const handler = extensionNotifications.get(method);
        if (!handler) throw new Error(`Missing extension handler for ${method}`);
        await Effect.runPromise(handler(extensionEnvelope(data)));
      };
      let configOptions = [
        ...(OH_MY_PI_ACP_17_3_3_FIXTURE.sessionNewResponse
          .configOptions as unknown as ReadonlyArray<Acp.SessionConfigOption>),
      ];
      const modes = OH_MY_PI_ACP_17_3_3_FIXTURE.sessionNewResponse
        .modes as unknown as Acp.SessionModeState;
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          state.closed += 1;
        }).pipe(Effect.andThen(Deferred.succeed(exit, undefined)), Effect.asVoid),
      );
      const register = (name: string, assign?: () => void) =>
        Effect.sync(() => {
          state.registrations.push(name);
          assign?.();
        });
      const runtime: AcpSessionRuntimeShape = {
        handleRequestPermission: (handler) =>
          register("permission", () => {
            state.permissionHandler = handler;
          }),
        handleElicitation: (handler) =>
          register("elicitation", () => {
            state.elicitationHandler = handler;
          }),
        handleReadTextFile: () => register("fs.read"),
        handleWriteTextFile: () => register("fs.write"),
        handleCreateTerminal: () => register("terminal.create"),
        handleTerminalOutput: () => register("terminal.output"),
        handleTerminalWaitForExit: () => register("terminal.wait"),
        handleTerminalKill: () => register("terminal.kill"),
        handleTerminalRelease: () => register("terminal.release"),
        handleSessionUpdate: () => Effect.void,
        handleElicitationComplete: () => Effect.void,
        handleExtRequest: () => Effect.void,
        handleExtNotification: (method, _schema, handler) =>
          Effect.sync(() => {
            extensionNotifications.set(
              method,
              handler as (payload: unknown) => Effect.Effect<void, unknown>,
            );
          }),
        start: () =>
          state.neverStart
            ? Effect.never
            : state.failStart
              ? Effect.fail(
                  new AcpErrors.AcpRequestError({
                    code: -32000,
                    errorMessage: "resume failed",
                  }),
                )
              : Effect.succeed({
                  sessionId: input.resumeSessionId ?? "omp-session-new",
                  initializeResult:
                    OH_MY_PI_ACP_17_3_3_FIXTURE.initializeResponse as unknown as Acp.InitializeResponse,
                  sessionSetupResult:
                    OH_MY_PI_ACP_17_3_3_FIXTURE.sessionNewResponse as unknown as Acp.NewSessionResponse,
                  modelConfigId: "model",
                  sessionSetupMethod:
                    state.setupMethod ?? (input.resumeSessionId ? "resume" : "new"),
                } satisfies AcpSessionRuntimeStartResult),
        awaitExit: Deferred.await(exit),
        getEvents: () => Stream.fromPubSub(events),
        sessionUpdatesEnqueuedCount: Effect.sync(() => state.enqueued),
        supportsSessionFork: Effect.succeed(false),
        getModeState: Effect.succeed({
          currentModeId: modes.currentModeId,
          availableModes: modes.availableModes,
        }),
        getConfigOptions: Effect.sync(() => configOptions),
        getAvailableCommands: Effect.succeed([
          { name: "compact", description: "Compact the current session" },
        ]),
        prompt: () =>
          Effect.gen(function* () {
            state.prompts += 1;
            if (state.promptEffect) yield* state.promptEffect();
            if (state.emitUnknownExtension) {
              yield* (
                input.protocolLogging?.logger?.({
                  direction: "incoming",
                  stage: "decoded",
                  payload: { jsonrpc: "2.0", method: "_omp/fixture_notice", params: {} },
                }) ?? Effect.void
              );
            }
            for (let index = 0; index < (state.eventBurst ?? 0); index += 1) {
              state.enqueued += 1;
              yield* PubSub.publish(events, {
                _tag: "ContentDelta",
                itemId: "assistant-burst",
                text: "x",
                streamKind: "assistant_text",
                rawPayload: { index },
              });
            }
            state.enqueued += 1;
            yield* PubSub.publish(events, {
              _tag: "ContentDelta",
              itemId: "assistant-1",
              text: "hello",
              streamKind: "assistant_text",
              rawPayload: {},
            });
            state.enqueued += 1;
            yield* PubSub.publish(events, {
              _tag: "AssistantItemCompleted",
              itemId: "assistant-1",
            });
            state.enqueued += state.undeliveredEvents ?? 0;
            return { stopReason: "end_turn" as const };
          }),
        cancel: Effect.sync(() => {
          state.cancels += 1;
        }),
        setMode: (id) => {
          state.configurationCalls.push({ id });
          return Effect.succeed({});
        },
        setConfigOption: (id, value) => {
          state.configurationCalls.push({ id, value });
          configOptions = configOptions.map((option) =>
            option.id === id
              ? ({ ...option, currentValue: value } as Acp.SessionConfigOption)
              : option,
          );
          return Effect.succeed({ configOptions });
        },
        setModel: () => Effect.void,
        forkSession: () => Effect.die("unsupported"),
        request: (method) => {
          state.extensionRequests.push(method);
          if (!state.typedExtensions) {
            return Effect.fail(
              new AcpErrors.AcpRequestError({ code: -32601, errorMessage: "Method not found" }),
            );
          }
          const service = {
            serviceId: "omp-service-1",
            name: "fixture-service",
            state: "ready",
            restartCount: 0,
            outputBytes: 12,
            owner: input.resumeSessionId ?? "omp-session-new",
            persist: false,
            detached: false,
          };
          const data =
            method === OMP_EXTENSION_METHODS.capabilities
              ? {
                  protocol: "omp-acp-extensions",
                  supportedSchemaVersions: [1],
                  selectedSchemaVersion: 1,
                  features: {
                    advisor: {
                      available: true,
                      enabled: true,
                      observable: true,
                      controllable: true,
                      recoverable: true,
                      methods: [],
                      events: [],
                    },
                    autolearn: {
                      available: true,
                      enabled: true,
                      observable: true,
                      controllable: true,
                      recoverable: true,
                      methods: [],
                      events: [],
                    },
                    memory: {
                      available: true,
                      enabled: true,
                      observable: true,
                      controllable: true,
                      recoverable: true,
                      methods: [],
                      events: [],
                    },
                    launch: {
                      available: true,
                      enabled: true,
                      observable: true,
                      controllable: true,
                      recoverable: true,
                      methods: [],
                      events: [],
                    },
                  },
                }
              : method === OMP_EXTENSION_METHODS.advisorStatus
                ? {
                    enabled: true,
                    active: true,
                    grantedTools: ["bash"],
                    toolRisk: "write-or-exec",
                    inFlight: false,
                  }
                : method === OMP_EXTENSION_METHODS.autolearnStatus
                  ? {
                      enabled: true,
                      autoContinue: true,
                      state: "idle",
                      captureGeneration: 1,
                      pending: false,
                    }
                  : method === OMP_EXTENSION_METHODS.memoryStatus
                    ? {
                        backend: "local",
                        active: true,
                        writable: true,
                        searchable: true,
                        scope: "isolated-test",
                      }
                    : method === OMP_EXTENSION_METHODS.launchList
                      ? { authority: "omp", services: [service] }
                      : method === OMP_EXTENSION_METHODS.launchDescribe
                        ? {
                            authority: "omp",
                            service,
                            command: "bun server.ts",
                            cwd: "C:/isolated/project",
                            restart: "no",
                          }
                        : method === OMP_EXTENSION_METHODS.launchLogs
                          ? {
                              authority: "omp",
                              text: "ready",
                              cursor: 12,
                              state: "ready",
                              timedOut: false,
                            }
                          : method === OMP_EXTENSION_METHODS.launchSend ||
                              method === OMP_EXTENSION_METHODS.launchStop ||
                              method === OMP_EXTENSION_METHODS.launchRestart
                            ? { authority: "omp", service }
                            : method === OMP_EXTENSION_METHODS.advisorDrain ||
                                method === OMP_EXTENSION_METHODS.autolearnDrain
                              ? { settled: true }
                              : {};
          return Effect.succeed(extensionEnvelope(data));
        },
        notify: () => Effect.void,
      };
      return runtime;
    });
}

function makeState(): FakeRuntimeState {
  return {
    inputs: [],
    configurationCalls: [],
    registrations: [],
    prompts: 0,
    enqueued: 0,
    cancels: 0,
    closed: 0,
    extensionSequence: 0,
    extensionRequests: [],
  };
}

function testLayer(
  state: FakeRuntimeState,
  settings: Parameters<typeof makeOhMyPiAdapterLive>[0] = {},
  options: Omit<NonNullable<Parameters<typeof makeOhMyPiAdapterLive>[1]>, "makeRuntime"> = {},
) {
  return makeOhMyPiAdapterLive(settings, {
    ...options,
    settleQuietWindowMs: options.settleQuietWindowMs ?? 1,
    settleMaxWaitMs: options.settleMaxWaitMs ?? 50,
    settlePollMs: options.settlePollMs ?? 1,
    makeRuntime: makeFakeRuntimeFactory(state),
    prepareControlPlane: () =>
      Effect.succeed({
        overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
        overlayContent: "launch:\n  enabled: true\n",
        overlayWritten: false,
        policy: {
          owner: "omp-native",
          overlayPath: "C:/Users/test/.omp/synara/acp-provider.yml",
          sharedHome: true,
          launch: { configured: true, observability: "acp-tool-activity-only" },
          advisor: {
            configured: true,
            state: "degraded",
            warning: "Configure modelRoles.advisor.",
            observability: "transcript-only",
          },
          memory: {
            backend: "local",
            source: "synara-fallback",
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
      }),
  }).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "omp-adapter-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );
}

describe("OhMyPiAdapter", () => {
  it("does not lease or inject the Synara daemon gateway for OMP-owned Launch", async () => {
    const state = makeState();
    let issued = 0;
    let revoked = 0;
    const credentials = {
      connectionForThread: () => {
        issued += 1;
        return { url: "http://127.0.0.1:3773/mcp", bearerToken: "must-not-reach-omp" };
      },
      revokeSessionToken: () => {
        revoked += 1;
      },
      stdioProxy: { command: "node", args: ["proxy.mjs"] },
    } as unknown as AgentGatewayCredentialsShape;

    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        yield* adapter.startSession({
          threadId: "thread-omp-native-launch",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        expect(state.inputs[0]?.buildMcpServers).toBeUndefined();
        yield* adapter.stopAll();
      }).pipe(
        Effect.provide(
          testLayer(state).pipe(
            Layer.provideMerge(Layer.succeed(AgentGatewayCredentials, credentials)),
          ),
        ),
        Effect.scoped,
      ),
    );

    expect(issued).toBe(0);
    expect(revoked).toBe(0);
  });

  it("registers handlers before start, runs a turn, and proves scoped cleanup", async () => {
    const state = makeState();
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        expect(adapter.capabilities).toMatchObject({
          sessionModelSwitch: "in-session",
          conversationRollback: "restart-session",
          supportsTurnSteering: false,
          supportsLiveTurnDiffPatch: false,
        });
        const session = yield* adapter.startSession({
          threadId: "thread-omp-1",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          modelSelection: {
            provider: "omp",
            model: "fixture/model-b",
            options: { thinkingLevel: "max" },
          },
        });
        expect(session.resumeCursor).toEqual({ schemaVersion: 1, sessionId: "omp-session-new" });
        expect(state.registrations).toEqual([
          "permission",
          "elicitation",
          "fs.read",
          "fs.write",
          "terminal.create",
          "terminal.output",
          "terminal.wait",
          "terminal.kill",
          "terminal.release",
        ]);
        expect(state.configurationCalls.slice(0, 3)).toEqual([
          { id: "default" },
          { id: "model", value: "fixture/model-b" },
          { id: "thinking", value: "max" },
        ]);

        yield* adapter.sendTurn({ threadId: "thread-omp-1", input: "hello" });
        while ((yield* adapter.readThread("thread-omp-1")).turns.length === 0) {
          yield* Effect.sleep(5);
        }
        expect(state.prompts).toBe(1);
        yield* adapter.stopSession("thread-omp-1");
        expect(yield* adapter.hasSession("thread-omp-1")).toBe(false);
        expect(state.closed).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("passes the native resume id once and never retries a failed resume as new", async () => {
    const state = makeState();
    state.failStart = true;
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        return yield* adapter
          .startSession({
            threadId: "thread-omp-resume",
            provider: "omp",
            cwd: process.cwd(),
            runtimeMode: "approval-required",
            resumeCursor: { schemaVersion: 1, sessionId: "native-session" },
          })
          .pipe(Effect.flip);
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );

    expect(failure.message).toContain("resume failed");
    expect(state.inputs).toHaveLength(1);
    expect(state.inputs[0]?.resumeSessionId).toBe("native-session");
    expect(state.closed).toBe(1);
  });

  it("routes permission and elicitation through pending interaction ownership", async () => {
    const state = makeState();
    state.promptEffect = () =>
      Effect.gen(function* () {
        const permission = yield* state.permissionHandler!({
          sessionId: "omp-session-new",
          toolCall: {
            toolCallId: "tool-1",
            title: "Run command",
            kind: "execute",
            status: "pending",
          },
          options: [
            { optionId: "allow-once", name: "Allow", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        });
        expect(permission).toEqual({
          outcome: { outcome: "selected", optionId: "allow-once" },
        });
        const elicitation = yield* state.elicitationHandler!({
          sessionId: "omp-session-new",
          mode: "form",
          message: "Choose a value",
          requestedSchema: {
            type: "object",
            properties: {
              answer: { type: "string", title: "Answer", description: "Choose" },
            },
          },
        });
        expect(elicitation).toEqual({ action: "accept", content: { answer: "yes" } });
      });

    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        const eventLog: ProviderRuntimeEvent[] = [];
        yield* Effect.forkScoped(
          Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              eventLog.push(event);
            }),
          ),
        );
        yield* Effect.yieldNow;
        yield* adapter.startSession({
          threadId: "thread-omp-interactions",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn({ threadId: "thread-omp-interactions", input: "interact" });
        while (!eventLog.some((event) => event.type === "request.opened")) {
          yield* Effect.sleep(5);
        }
        const permission = eventLog.find((event) => event.type === "request.opened")!;
        if (permission.requestId) {
          yield* adapter.respondToRequest(
            "thread-omp-interactions",
            permission.requestId,
            "accept",
          );
        }
        while (!eventLog.some((event) => event.type === "user-input.requested")) {
          yield* Effect.sleep(5);
        }
        const inputEvent = eventLog.find((event) => event.type === "user-input.requested")!;
        if (inputEvent.requestId) {
          yield* adapter.respondToUserInput("thread-omp-interactions", inputEvent.requestId, {
            answer: "yes",
          });
        }
        while ((yield* adapter.readThread("thread-omp-interactions")).turns.length === 0) {
          yield* Effect.sleep(5);
        }
        yield* adapter.stopSession("thread-omp-interactions");
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("makes duplicate cancel idempotent and removes an unexpectedly exited process", async () => {
    const state = makeState();
    state.promptEffect = () => Effect.never;
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        yield* adapter.startSession({
          threadId: "thread-omp-exit",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        const turn = yield* adapter.sendTurn({ threadId: "thread-omp-exit", input: "wait" });
        yield* adapter.interruptTurn("thread-omp-exit", turn.turnId);
        yield* adapter.interruptTurn("thread-omp-exit", turn.turnId);
        expect(state.cancels).toBe(1);
        state.signalProcessExit?.();
        while (yield* adapter.hasSession("thread-omp-exit")) {
          yield* Effect.sleep(5);
        }
        expect(state.closed).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("negotiates typed OMP state, projects Advisor notes, and uses typed drains", async () => {
    const state = makeState();
    state.typedExtensions = true;
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        const eventLog: ProviderRuntimeEvent[] = [];
        yield* Effect.forkScoped(
          Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              eventLog.push(event);
            }),
          ),
        );
        yield* Effect.yieldNow;
        yield* adapter.startSession({
          threadId: "thread-omp-typed",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        expect(state.extensionRequests.slice(0, 5)).toEqual([
          OMP_EXTENSION_METHODS.capabilities,
          OMP_EXTENSION_METHODS.advisorStatus,
          OMP_EXTENSION_METHODS.autolearnStatus,
          OMP_EXTENSION_METHODS.memoryStatus,
          OMP_EXTENSION_METHODS.launchList,
        ]);
        expect(
          yield* adapter.describeLaunchService({
            owner: "omp-session-new",
            name: "fixture-service",
          }),
        ).toMatchObject({ command: "bun server.ts", cwd: "C:/isolated/project", restart: "no" });
        expect(
          yield* adapter.readLaunchLogs({
            owner: "omp-session-new",
            name: "fixture-service",
            lines: 100,
            cursor: 0,
          }),
        ).toMatchObject({ content: "ready", nextCursor: 12, state: "ready" });
        expect(
          yield* adapter.sendLaunchText({
            owner: "omp-session-new",
            name: "fixture-service",
            text: "status\n",
          }),
        ).toMatchObject({ serviceId: "omp-service-1", owner: "omp-session-new" });
        expect(
          yield* adapter.restartLaunchService({
            owner: "omp-session-new",
            name: "fixture-service",
          }),
        ).toMatchObject({ state: "ready" });
        expect(
          yield* adapter.stopLaunchService({
            owner: "omp-session-new",
            name: "fixture-service",
            timeoutSeconds: 5,
          }),
        ).toMatchObject({ name: "fixture-service" });

        yield* Effect.promise(() =>
          state.emitExtension!(OMP_EXTENSION_EVENTS.advisorNote, {
            advisorId: "security",
            severity: "blocker",
            delivery: "steer",
            content: "Do not expose the token.",
            turn: 1,
          }),
        );
        while (!eventLog.some((event) => event.type === "omp.advisor.note")) {
          yield* Effect.sleep(1);
        }
        expect(eventLog.find((event) => event.type === "omp.advisor.note")?.payload).toMatchObject({
          advisorId: "security",
          severity: "blocker",
          delivery: "steer",
          source: "omp",
        });

        yield* adapter.sendTurn({ threadId: "thread-omp-typed", input: "continue" });
        while (!(yield* adapter.readThread("thread-omp-typed")).turns.length) {
          yield* Effect.sleep(1);
        }
        expect(state.extensionRequests).toContain(OMP_EXTENSION_METHODS.advisorDrain);
        expect(state.extensionRequests).toContain(OMP_EXTENSION_METHODS.autolearnDrain);
        expect(
          eventLog.some(
            (event) =>
              event.type === "runtime.warning" &&
              event.payload.message.includes("configured-policy-only"),
          ),
        ).toBe(false);
        yield* adapter.stopSession("thread-omp-typed");
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("keeps a stock OMP ACP session usable when typed negotiation is unsupported", async () => {
    const state = makeState();
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        yield* adapter.startSession({
          threadId: "thread-omp-stock-fallback",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        expect(state.extensionRequests).toEqual([OMP_EXTENSION_METHODS.capabilities]);
        yield* adapter.sendTurn({ threadId: "thread-omp-stock-fallback", input: "continue" });
        while (!(yield* adapter.readThread("thread-omp-stock-fallback")).turns.length) {
          yield* Effect.sleep(1);
        }
        expect(yield* adapter.hasSession("thread-omp-stock-fallback")).toBe(true);
        yield* adapter.stopSession("thread-omp-stock-fallback");
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("diagnoses an unknown extension without breaking the turn", async () => {
    const state = makeState();
    state.emitUnknownExtension = true;
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        const eventLog: ProviderRuntimeEvent[] = [];
        yield* Effect.forkScoped(
          Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              eventLog.push(event);
            }),
          ),
        );
        yield* Effect.yieldNow;
        yield* adapter.startSession({
          threadId: "thread-omp-extension",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn({ threadId: "thread-omp-extension", input: "continue" });
        while (!(yield* adapter.readThread("thread-omp-extension")).turns.length) {
          yield* Effect.sleep(5);
        }
        expect(
          eventLog.some(
            (event) =>
              event.type === "runtime.warning" &&
              event.payload.message.includes("_omp/fixture_notice"),
          ),
        ).toBe(true);
        yield* adapter.stopSession("thread-omp-extension");
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("continues after a bounded Auto-Learn settle timeout with a truthful warning", async () => {
    const state = makeState();
    state.undeliveredEvents = 1;
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        const eventLog: ProviderRuntimeEvent[] = [];
        yield* Effect.forkScoped(
          Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.sync(() => {
              eventLog.push(event);
            }),
          ),
        );
        yield* Effect.yieldNow;
        yield* adapter.startSession({
          threadId: "thread-omp-settle-timeout",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn({ threadId: "thread-omp-settle-timeout", input: "learn" });
        while (!(yield* adapter.readThread("thread-omp-settle-timeout")).turns.length) {
          yield* Effect.sleep(5);
        }

        expect(
          eventLog.some(
            (event) =>
              event.type === "runtime.warning" &&
              event.payload.message.includes("without claiming Auto-Learn capture completed"),
          ),
        ).toBe(true);
        yield* adapter.stopSession("thread-omp-settle-timeout");
      }).pipe(
        Effect.scoped,
        Effect.provide(testLayer(state, {}, { settleMaxWaitMs: 10, settlePollMs: 1 })),
      ),
    );
  });

  it("supports load setup and stopAll waits for every session scope", async () => {
    const state = makeState();
    state.setupMethod = "load";
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        for (const threadId of ["thread-omp-load-1", "thread-omp-load-2"] as const) {
          yield* adapter.startSession({
            threadId,
            provider: "omp",
            cwd: process.cwd(),
            runtimeMode: "approval-required",
            resumeCursor: { schemaVersion: 1, sessionId: `native-${threadId}` },
          });
        }
        expect(yield* adapter.listSessions()).toHaveLength(2);
        yield* adapter.stopAll();
        expect(yield* adapter.listSessions()).toHaveLength(0);
        expect(state.closed).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("keeps a 2048-update burst bounded while a slow canonical consumer drains", async () => {
    const state = makeState();
    state.eventBurst = 2_048;
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        yield* Effect.forkScoped(Stream.runForEach(adapter.streamEvents, () => Effect.sleep(1)));
        yield* Effect.yieldNow;
        yield* adapter.startSession({
          threadId: "thread-omp-burst",
          provider: "omp",
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        yield* adapter.sendTurn({ threadId: "thread-omp-burst", input: "burst" });
        while (!(yield* adapter.readThread("thread-omp-burst")).turns.length) {
          yield* Effect.sleep(5);
        }
        expect(state.enqueued).toBe(2_050);
        yield* adapter.stopSession("thread-omp-burst");
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  }, 10_000);

  it("shares one disposable session across model and command discovery caches", async () => {
    const state = makeState();
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        const models = yield* adapter.listModels!({
          provider: "omp",
          cwd: process.cwd(),
        });
        const commands = yield* adapter.listCommands!({
          provider: "omp",
          cwd: process.cwd(),
        });
        expect(models.models).toHaveLength(2);
        expect(commands.cached).toBe(true);
        expect(commands.commands[0]?.name).toBe("compact");
        expect(state.inputs).toHaveLength(1);
        expect(state.closed).toBe(1);

        yield* adapter.listCommands!({
          provider: "omp",
          cwd: process.cwd(),
          forceReload: true,
        });
        expect(state.inputs).toHaveLength(2);
        expect(state.closed).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
    );
  });

  it("invalidates discovery when the configured binary identity changes", async () => {
    const state = makeState();
    const directory = mkdtempSync(join(tmpdir(), "synara-omp-cache-"));
    const binaryPath = join(directory, process.platform === "win32" ? "omp.cmd" : "omp");
    writeFileSync(binaryPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
    chmodSync(binaryPath, 0o755);
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* OhMyPiAdapter;
          yield* adapter.listModels!({ provider: "omp", cwd: process.cwd() });
          appendFileSync(
            binaryPath,
            process.platform === "win32" ? "rem changed\r\n" : "# changed\n",
          );
          yield* adapter.listCommands!({ provider: "omp", cwd: process.cwd() });
          expect(state.inputs).toHaveLength(2);
          expect(state.closed).toBe(2);
        }).pipe(Effect.scoped, Effect.provide(testLayer(state, { binaryPath }))),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("times out discovery and closes the disposable runtime", async () => {
    const state = makeState();
    state.neverStart = true;
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* OhMyPiAdapter;
          yield* adapter.listModels!({ provider: "omp", cwd: process.cwd() });
        }).pipe(Effect.scoped, Effect.provide(testLayer(state, {}, { discoveryTimeoutMs: 10 }))),
      ),
    ).rejects.toMatchObject({ _tag: "ProviderAdapterRequestError" });
    expect(state.closed).toBe(1);
  });

  it("closes the disposable runtime when ACP discovery startup fails", async () => {
    const state = makeState();
    state.failStart = true;
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* OhMyPiAdapter;
          yield* adapter.listModels!({ provider: "omp", cwd: process.cwd() });
        }).pipe(Effect.scoped, Effect.provide(testLayer(state))),
      ),
    ).rejects.toMatchObject({ _tag: "ProviderAdapterRequestError" });
    expect(state.closed).toBe(1);
  });

  it("expires the short discovery cache and cleans up each runtime", async () => {
    const state = makeState();
    await Effect.runPromise(
      Effect.gen(function* () {
        const adapter = yield* OhMyPiAdapter;
        yield* adapter.listModels!({ provider: "omp", cwd: process.cwd() });
        yield* Effect.sleep(5);
        yield* adapter.listCommands!({ provider: "omp", cwd: process.cwd() });
        expect(state.inputs).toHaveLength(2);
        expect(state.closed).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(testLayer(state, {}, { discoveryCacheMs: 1 }))),
    );
  });
});
