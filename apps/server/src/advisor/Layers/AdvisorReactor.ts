// Wires the advisor pipeline to the orchestration event stream.
//
// This layer holds no policy. Every decision - whether to ask the advisor, and
// what to do with what it says - is made by the pure pipeline in
// advisorPipeline.ts; the code here subscribes, calls, and dispatches.
//
// Three delivery channels, all of them ordinary orchestration commands:
//   aside    -> thread.turn.start with dispatchMode "queue" (next turn)
//   steer    -> thread.turn.start with dispatchMode "steer" (this turn)
//   preserve -> no dispatch at all
// Every accepted note also appends an advisor.advice activity, so advice the
// model never received is still visible to the user in the transcript.

import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  resolveAdvisorEnabled,
  type AdvisorSeverity,
  type OrchestrationEvent,
  type OrchestrationThreadActivityTone,
} from "@synara/contracts";
import { makeDrainableWorker, startDrainableWorkerProducers } from "@synara/shared/DrainableWorker";
import { Effect, Layer, Option, Ref, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ADVISOR_ACTIVITY_KIND } from "../advisorEventDigest.ts";
import {
  INITIAL_ADVISOR_PIPELINE_STATE,
  ingestAdvisorActivity,
  resolveAdvisorAction,
  type AdvisorPipelineState,
} from "../advisorPipeline.ts";
import {
  INITIAL_ADVISOR_THREAD_STATE,
  foldAdvisorThreadState,
  type AdvisorThreadState,
} from "../advisorThreadState.ts";
import { AdvisorSession } from "../Services/AdvisorSession.ts";
import { AdvisorReactor, type AdvisorReactorShape } from "../Services/AdvisorReactor.ts";

const ADVISOR_REACTOR_CAPACITY = 256;

// Activity tones are info/error/tool/approval - there is no warning tone, so a
// concern reads as info. Severity is carried in the payload for the UI.
const TONE_BY_SEVERITY: Readonly<Record<AdvisorSeverity, OrchestrationThreadActivityTone>> = {
  nit: "info",
  concern: "info",
  blocker: "error",
};

/**
 * The message the main agent actually reads.
 *
 * Attribution is not decoration. Without it the agent takes advice as a user
 * instruction, which is both wrong about who said it and wrong about how much
 * authority it carries.
 */
export function formatAdvisorDelivery(input: {
  readonly severity: AdvisorSeverity;
  readonly message: string;
}): string {
  return `[advisor · ${input.severity}] ${input.message}`;
}

export const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const advisorSession = yield* AdvisorSession;

  const pipelines = yield* Ref.make(new Map<string, AdvisorPipelineState>());
  const threadStates = yield* Ref.make(new Map<string, AdvisorThreadState>());
  const deliveryCounter = yield* Ref.make(0);

  const nextMarker = (threadId: string) =>
    Ref.updateAndGet(deliveryCounter, (value) => value + 1).pipe(
      Effect.map((value) => `${threadId}:${value}`),
    );

  const readThreadState = (threadId: string) =>
    Ref.get(threadStates).pipe(
      Effect.map((map) => map.get(threadId) ?? INITIAL_ADVISOR_THREAD_STATE),
    );

  const deliver = (input: {
    readonly threadId: ThreadId;
    readonly channel: "aside" | "steer" | "preserve";
    readonly severity: AdvisorSeverity;
    readonly message: string;
  }) =>
    Effect.gen(function* () {
      const marker = yield* nextMarker(input.threadId);
      const createdAt = new Date().toISOString();

      yield* orchestrationEngine
        .dispatch({
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(`advisor:${marker}:activity`),
          threadId: input.threadId,
          activity: {
            id: EventId.makeUnsafe(`advisor:${marker}:advice`),
            tone: TONE_BY_SEVERITY[input.severity],
            kind: ADVISOR_ACTIVITY_KIND,
            summary: input.message,
            payload: { severity: input.severity, channel: input.channel },
            turnId: null,
            createdAt,
          },
          createdAt,
        })
        .pipe(Effect.catchCause(() => Effect.void));

      if (input.channel === "preserve") {
        return;
      }

      // Runtime and interaction mode belong to the thread, not to the advisor.
      // Sending anything else here would silently reconfigure the thread as a
      // side effect of a piece of advice.
      const thread = yield* snapshotQuery
        .getThreadDetailById(input.threadId)
        .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
      if (Option.isNone(thread)) {
        return;
      }

      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`advisor:${marker}:turn`),
          threadId: input.threadId,
          message: {
            messageId: MessageId.makeUnsafe(`advisor:${marker}:message`),
            role: "user",
            text: formatAdvisorDelivery({ severity: input.severity, message: input.message }),
            attachments: [],
          },
          dispatchMode: input.channel === "steer" ? "steer" : "queue",
          dispatchOrigin: "agent",
          runtimeMode: thread.value.runtimeMode,
          interactionMode: thread.value.interactionMode,
          createdAt,
        })
        .pipe(Effect.catchCause(() => Effect.void));
    });

  const evaluateThread = (input: {
    readonly threadId: ThreadId;
    readonly delta: string;
    readonly workInProgress: boolean;
    readonly state: AdvisorPipelineState;
  }) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (settings === null) {
        return input.state;
      }
      const thread = yield* snapshotQuery
        .getThreadDetailById(input.threadId)
        .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
      if (
        !resolveAdvisorEnabled({
          globalEnabled: settings.advisor.enabled,
          threadOverride: Option.isSome(thread) ? thread.value.advisorEnabled : null,
        })
      ) {
        return input.state;
      }
      const cwd = Option.isSome(thread)
        ? (thread.value.workingDirectory ?? thread.value.worktreePath ?? undefined)
        : undefined;

      const verdict = yield* advisorSession.evaluate({
        mainThreadId: input.threadId,
        modelSelection: settings.advisor.modelSelection,
        cwd: cwd ?? undefined,
        delta: input.delta,
        workInProgress: input.workInProgress,
      });
      if (verdict === null) {
        return input.state;
      }

      const threadState = yield* readThreadState(input.threadId);
      const resolved = resolveAdvisorAction({
        state: input.state,
        verdict,
        sourceText: input.delta,
        workInProgress: input.workInProgress,
        // An interim evaluation happens mid-turn; a boundary one happens after
        // the turn settled. That is exactly what "is a turn running" means.
        turnRunning: input.workInProgress,
        turnInterrupting: threadState.turnInterrupting,
        planModeActive: threadState.planModeActive,
      });

      if (resolved.surfaceQuarantineWarning) {
        yield* Effect.logWarning("advisor output quarantined repeatedly", {
          threadId: input.threadId,
        });
      }
      if (resolved.action !== null) {
        yield* deliver({
          threadId: input.threadId,
          channel: resolved.action.channel,
          severity: resolved.action.severity,
          message: resolved.action.message,
        });
      }
      return resolved.state;
    });

  const handleActivity = (
    event: Extract<OrchestrationEvent, { type: "thread.activity-appended" }>,
  ) =>
    Effect.gen(function* () {
      const threadId = event.payload.threadId;
      const state = (yield* Ref.get(pipelines)).get(threadId) ?? INITIAL_ADVISOR_PIPELINE_STATE;
      const ingested = ingestAdvisorActivity({
        state,
        activity: {
          kind: event.payload.activity.kind,
          summary: event.payload.activity.summary,
          payload: event.payload.activity.payload,
        },
      });
      const next =
        ingested.evaluation === null
          ? ingested.state
          : yield* evaluateThread({
              threadId,
              delta: ingested.evaluation.delta,
              workInProgress: ingested.evaluation.workInProgress,
              state: ingested.state,
            });
      yield* Ref.update(pipelines, (map) => new Map(map).set(threadId, next));
    });

  const forgetThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      yield* advisorSession.forget(threadId);
      yield* Ref.update(pipelines, (map) => {
        const nextMap = new Map(map);
        nextMap.delete(threadId);
        return nextMap;
      });
      yield* Ref.update(threadStates, (map) => {
        const nextMap = new Map(map);
        nextMap.delete(threadId);
        return nextMap;
      });
    });

  const trackThreadState = (event: OrchestrationEvent) => {
    const tracked =
      event.type === "thread.turn-interrupt-requested"
        ? ({
            threadId: event.payload.threadId,
            folded: { type: "thread.turn-interrupt-requested" },
          } as const)
        : event.type === "thread.interaction-mode-set"
          ? ({
              threadId: event.payload.threadId,
              folded: {
                type: "thread.interaction-mode-set",
                interactionMode: event.payload.interactionMode,
              },
            } as const)
          : event.type === "thread.activity-appended"
            ? ({
                threadId: event.payload.threadId,
                folded: {
                  type: "thread.activity-appended",
                  activityKind: event.payload.activity.kind,
                },
              } as const)
            : null;
    if (tracked === null) {
      return Effect.void;
    }
    const { threadId, folded } = tracked;
    return Ref.update(threadStates, (map) => {
      const current = map.get(threadId) ?? INITIAL_ADVISOR_THREAD_STATE;
      const next = foldAdvisorThreadState(current, folded);
      return next === current && map.has(threadId) ? map : new Map(map).set(threadId, next);
    });
  };

  const processEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      if (event.type === "thread.deleted" || event.type === "thread.archived") {
        yield* forgetThread(event.payload.threadId);
        return;
      }
      yield* trackThreadState(event);
      if (event.type !== "thread.activity-appended") {
        return;
      }
      // Self-excitation: the advisor's own advice card is an activity like any
      // other, and feeding it back would let the advisor comment on itself.
      if (event.payload.activity.kind === ADVISOR_ACTIVITY_KIND) {
        return;
      }
      yield* handleActivity(event);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug("advisor reactor dropped an event", { type: event.type, cause }),
      ),
    );

  const worker = yield* makeDrainableWorker(processEvent, { capacity: ADVISOR_REACTOR_CAPACITY });

  const start: AdvisorReactorShape["start"] = Effect.fn(() =>
    startDrainableWorkerProducers(
      worker,
      Effect.gen(function* () {
        yield* advisorSession.start();
        yield* Effect.forkScoped(
          Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
            worker.enqueue(event),
          ),
        );
      }),
    ),
  );

  return { start, drain: worker.drain } satisfies AdvisorReactorShape;
});

export const AdvisorReactorLive = Layer.effect(AdvisorReactor, make);
