import { ProviderKind } from "@synara/contracts";
import type { AdvisorVerdict, OrchestrationCommand, OrchestrationEvent } from "@synara/contracts";
import { Effect, Layer, Option, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ADVISOR_ACTIVITY_KIND } from "../advisorEventDigest.ts";
import { AdvisorSession } from "../Services/AdvisorSession.ts";
import { AdvisorReactor } from "../Services/AdvisorReactor.ts";
import { AdvisorReactorLive, formatAdvisorDelivery } from "./AdvisorReactor.ts";

const THREAD_ID = "thread-1";

function activityEvent(kind: string, summary: string): OrchestrationEvent {
  return {
    type: "thread.activity-appended",
    sequence: 1,
    eventId: "event-1",
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: "2026-01-01T00:00:00Z",
    commandId: null,
    payload: {
      threadId: THREAD_ID,
      activity: {
        id: "activity-1",
        tone: "info",
        kind,
        summary,
        payload: {},
        turnId: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
  } as unknown as OrchestrationEvent;
}

function messageEvent(input: {
  readonly role: string;
  readonly text: string;
  readonly messageId?: string;
  readonly dispatchOrigin?: string;
}): OrchestrationEvent {
  return {
    type: "thread.message-sent",
    sequence: 1,
    eventId: "event-1",
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: "2026-01-01T00:00:00Z",
    commandId: null,
    payload: {
      threadId: THREAD_ID,
      messageId: input.messageId ?? "message-1",
      role: input.role,
      text: input.text,
      dispatchOrigin: input.dispatchOrigin,
      turnId: null,
      streaming: false,
      source: "native",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  } as unknown as OrchestrationEvent;
}

interface Evaluation {
  readonly delta: string;
  readonly request: string | null;
  readonly workInProgress: boolean;
}

interface Recorder {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly evaluations: ReadonlyArray<Evaluation>;
}

async function withReactor<A>(
  options: {
    readonly verdicts: ReadonlyArray<AdvisorVerdict | null>;
    readonly advisorEnabled?: boolean;
    readonly threadOverride?: boolean | null;
  },
  body: (input: {
    readonly emit: (event: OrchestrationEvent) => Effect.Effect<void>;
    readonly recorder: Recorder;
    readonly settle: Effect.Effect<void>;
  }) => Effect.Effect<A>,
): Promise<A> {
  const commands: Array<OrchestrationCommand> = [];
  const evaluations: Array<Evaluation> = [];
  let verdictIndex = 0;

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<OrchestrationEvent>();

        const engine = {
          dispatch: (command: OrchestrationCommand) => {
            commands.push(command);
            return Effect.succeed({ sequence: commands.length });
          },
          get streamDomainEvents() {
            return Stream.fromQueue(events);
          },
        } as unknown as import("../../orchestration/Services/OrchestrationEngine.ts").OrchestrationEngineShape;

        const snapshotQuery = {
          getThreadDetailById: () =>
            Effect.succeed(
              Option.some({
                id: THREAD_ID,
                runtimeMode: "full-access",
                interactionMode: "default",
                workingDirectory: "/repo",
                advisorEnabled: options.threadOverride ?? null,
                worktreePath: null,
              }),
            ),
        } as unknown as import("../../orchestration/Services/ProjectionSnapshotQuery.ts").ProjectionSnapshotQueryShape;

        const settings = {
          getSettings: Effect.succeed({
            advisor: {
              enabled: options.advisorEnabled ?? true,
              modelSelection: { provider: "codex", model: "gpt-5.1-codex" },
            },
            // The reactor resolves CLI paths out of these for the advisor's
            // inference process; every provider key has to exist, as it does
            // in a decoded ServerSettings.
            providers: Object.fromEntries(ProviderKind.literals.map((provider) => [provider, {}])),
          }),
        } as unknown as import("../../serverSettings.ts").ServerSettingsShape;

        const advisorSession = {
          start: () => Effect.void,
          forget: () => Effect.void,
          evaluate: (input: {
            readonly delta: string;
            readonly request?: string | null;
            readonly workInProgress: boolean;
          }) => {
            evaluations.push({
              delta: input.delta,
              request: input.request ?? null,
              workInProgress: input.workInProgress,
            });
            const verdict = options.verdicts[verdictIndex] ?? null;
            verdictIndex += 1;
            return Effect.succeed(verdict);
          },
        } as unknown as import("../Services/AdvisorSession.ts").AdvisorSessionShape;

        return yield* Effect.gen(function* () {
          const reactor = yield* AdvisorReactor;
          yield* reactor.start();
          // The producer fiber picks events off the queue asynchronously, so a
          // bare drain can settle before the event has even been admitted.
          const settle = Effect.gen(function* () {
            for (let attempt = 0; attempt < 40; attempt += 1) {
              yield* Effect.sleep(5);
              yield* reactor.drain;
              if ((yield* Queue.size(events)) === 0) {
                return;
              }
            }
          });
          return yield* body({
            emit: (event) => Queue.offer(events, event).pipe(Effect.asVoid),
            recorder: { commands, evaluations },
            settle,
          });
        }).pipe(
          Effect.provide(
            Layer.provide(
              AdvisorReactorLive,
              Layer.mergeAll(
                Layer.succeed(OrchestrationEngineService, engine),
                Layer.succeed(ProjectionSnapshotQuery, snapshotQuery),
                Layer.succeed(ServerSettingsService, settings),
                Layer.succeed(AdvisorSession, advisorSession),
              ),
            ),
          ),
        );
      }),
    ),
  );
}

/** Feed one content activity, then a boundary, which is what triggers an ask. */
const oneTurn = (input: {
  readonly emit: (event: OrchestrationEvent) => Effect.Effect<void>;
  readonly settle: Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    yield* input.emit(activityEvent("tool.completed", "Ran a command"));
    yield* input.emit(activityEvent("turn.completed", "Turn completed"));
    yield* input.settle;
  });

describe("formatAdvisorDelivery", () => {
  // Without attribution the agent reads advice as a user instruction - wrong
  // about who said it and wrong about how much authority it carries.
  it("marks the message as advisor output and names the severity", () => {
    const text = formatAdvisorDelivery({ severity: "concern", message: "reuse the helper" });

    expect(text).toContain("advisor");
    expect(text).toContain("concern");
    expect(text).toContain("reuse the helper");
  });
});

describe("AdvisorReactor", () => {
  it("asks the advisor once a turn settles", async () => {
    const recorder = await withReactor({ verdicts: [{ verdict: "silent" }] }, (input) =>
      oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    expect(recorder.evaluations).toHaveLength(1);
    expect(recorder.evaluations[0]?.delta).toContain("Ran a command");
    expect(recorder.evaluations[0]?.workInProgress).toBe(false);
  });

  it("dispatches nothing when the advisor stays silent", async () => {
    const recorder = await withReactor({ verdicts: [{ verdict: "silent" }] }, (input) =>
      oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    expect(recorder.commands).toEqual([]);
  });

  // A settled turn plus a non-blocker is the aside path: the note waits for the
  // next turn rather than restarting a turn that already finished.
  it("queues a nit as an aside", async () => {
    const recorder = await withReactor(
      { verdicts: [{ verdict: "advise", severity: "nit", message: "simpler with map" }] },
      (input) => oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    const turn = recorder.commands.find((command) => command.type === "thread.turn.start");
    expect(turn).toBeDefined();
    expect(turn && "dispatchMode" in turn ? turn.dispatchMode : null).toBe("queue");
  });

  it("interrupts the thread for a blocker", async () => {
    const recorder = await withReactor(
      { verdicts: [{ verdict: "advise", severity: "blocker", message: "this deletes the repo" }] },
      (input) => oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    const turn = recorder.commands.find((command) => command.type === "thread.turn.start");
    expect(turn && "dispatchMode" in turn ? turn.dispatchMode : null).toBe("steer");
  });

  // Advice the model never received still has to be visible, or the user sees
  // the advisor do nothing and concludes it is broken.
  it("records every delivered note as an activity", async () => {
    const recorder = await withReactor(
      { verdicts: [{ verdict: "advise", severity: "nit", message: "simpler with map" }] },
      (input) => oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    const appended = recorder.commands.find((command) => command.type === "thread.activity.append");
    expect(appended && "activity" in appended ? appended.activity.kind : null).toBe(
      ADVISOR_ACTIVITY_KIND,
    );
  });

  it("does not ask the advisor when the feature is off", async () => {
    const recorder = await withReactor(
      { verdicts: [{ verdict: "silent" }], advisorEnabled: false },
      (input) => oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    expect(recorder.evaluations).toEqual([]);
    expect(recorder.commands).toEqual([]);
  });

  // A thread's own choice beats the global default in both directions, which is
  // the whole point of an override.
  it("respects a thread that opted out while the default is on", async () => {
    const recorder = await withReactor(
      { verdicts: [{ verdict: "silent" }], advisorEnabled: true, threadOverride: false },
      (input) => oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    expect(recorder.evaluations).toEqual([]);
  });

  it("respects a thread that opted in while the default is off", async () => {
    const recorder = await withReactor(
      { verdicts: [{ verdict: "silent" }], advisorEnabled: false, threadOverride: true },
      (input) => oneTurn(input).pipe(Effect.as(input.recorder)),
    );

    expect(recorder.evaluations).toHaveLength(1);
  });

  // The advice card is an activity like any other. Feeding it back would let
  // the advisor comment on its own last note, forever.
  it("ignores its own advice activity", async () => {
    const recorder = await withReactor({ verdicts: [{ verdict: "silent" }] }, (input) =>
      Effect.gen(function* () {
        yield* input.emit(activityEvent(ADVISOR_ACTIVITY_KIND, "reuse the helper"));
        yield* input.emit(activityEvent("turn.completed", "Turn completed"));
        yield* input.settle;
        return input.recorder;
      }),
    );

    expect(recorder.evaluations).toEqual([]);
  });

  // Activities carry only the agent's side of the conversation. Without the
  // request the advisor is asked to judge drift with nothing to judge against.
  it("gives the advisor what the user asked for", async () => {
    const recorder = await withReactor({ verdicts: [{ verdict: "silent" }] }, (input) =>
      Effect.gen(function* () {
        yield* input.emit(messageEvent({ role: "user", text: "add rate limiting" }));
        yield* oneTurn(input);
        return input.recorder;
      }),
    );

    expect(recorder.evaluations[0]?.request).toContain("add rate limiting");
  });

  // The advisor's own note comes back as a role "user" message. Reading it as
  // the request would let the advisor redefine the task it is checking.
  it("does not mistake its own advice for the request", async () => {
    const recorder = await withReactor({ verdicts: [{ verdict: "silent" }] }, (input) =>
      Effect.gen(function* () {
        yield* input.emit(
          messageEvent({
            role: "user",
            text: "[advisor · nit] simpler with map",
            dispatchOrigin: "agent",
          }),
        );
        yield* oneTurn(input);
        return input.recorder;
      }),
    );

    expect(recorder.evaluations[0]?.request).toBeNull();
  });

  it("does not mistake the agent's own replies for the request", async () => {
    const recorder = await withReactor({ verdicts: [{ verdict: "silent" }] }, (input) =>
      Effect.gen(function* () {
        yield* input.emit(
          messageEvent({ role: "assistant", text: "I will start with the router" }),
        );
        yield* oneTurn(input);
        return input.recorder;
      }),
    );

    expect(recorder.evaluations[0]?.request).toBeNull();
  });
});
