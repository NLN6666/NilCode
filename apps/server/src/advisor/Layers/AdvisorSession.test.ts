import type { AdvisorModelSelection, ProviderRuntimeEvent, ThreadId } from "@synara/contracts";
import { Effect, Layer, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { AdvisorSession, type AdvisorSessionShape } from "../Services/AdvisorSession.ts";
import { advisorShadowThreadId } from "../advisorShadowThread.ts";
import { ADVISOR_MAX_CONSECUTIVE_FAILURES, AdvisorSessionLive } from "./AdvisorSession.ts";

const MAIN_THREAD = "thread-1" as ThreadId;
const SHADOW = advisorShadowThreadId(MAIN_THREAD);
const CODEX_MODEL = { provider: "codex", model: "gpt-5.1-codex" } as const;

/** One scripted advisor reply: the events its shadow turn will emit. */
type Reply = ReadonlyArray<{ readonly type: string; readonly payload?: unknown }>;

function say(text: string): Reply {
  return [
    { type: "item.completed", payload: { itemType: "assistant_message", detail: text } },
    { type: "turn.completed" },
  ];
}

interface Harness {
  readonly startedSessions: ReadonlyArray<{ readonly model: string | undefined }>;
  readonly prompts: ReadonlyArray<string>;
  readonly stopped: ReadonlyArray<string>;
}

async function withAdvisor<A>(
  options: { readonly replies: ReadonlyArray<Reply>; readonly failSendTurn?: boolean },
  body: (input: {
    readonly advisor: AdvisorSessionShape;
    readonly harness: Harness;
  }) => Effect.Effect<A>,
): Promise<A> {
  const startedSessions: Array<{ readonly model: string | undefined }> = [];
  const prompts: Array<string> = [];
  const stopped: Array<string> = [];
  let replyIndex = 0;

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ProviderRuntimeEvent>();
        const providerService = {
          startSession: (threadId: ThreadId, input: { readonly modelSelection?: unknown }) => {
            const selection = input.modelSelection as { readonly model?: string } | undefined;
            startedSessions.push({ model: selection?.model });
            return Effect.succeed({ threadId } as never);
          },
          sendTurn: (input: { readonly threadId: ThreadId; readonly input?: string }) => {
            prompts.push(input.input ?? "");
            if (options.failSendTurn === true) {
              return Effect.die(new Error("send failed"));
            }
            const reply = options.replies[replyIndex] ?? [];
            replyIndex += 1;
            return Effect.forEach(reply, (event) =>
              Queue.offer(queue, {
                ...event,
                threadId: input.threadId,
              } as unknown as ProviderRuntimeEvent),
            ).pipe(Effect.as({ threadId: input.threadId, turnId: "turn-1" } as never));
          },
          stopSession: (input: { readonly threadId: ThreadId }) => {
            stopped.push(input.threadId);
            return Effect.void;
          },
          get streamEvents() {
            return Stream.fromQueue(queue);
          },
        } as unknown as ProviderServiceShape;

        return yield* Effect.gen(function* () {
          const advisor = yield* AdvisorSession;
          yield* advisor.start();
          return yield* body({ advisor, harness: { startedSessions, prompts, stopped } });
        }).pipe(
          Effect.provide(
            Layer.provide(AdvisorSessionLive, Layer.succeed(ProviderService, providerService)),
          ),
        );
      }),
    ),
  );
}

const evaluate = (
  advisor: AdvisorSessionShape,
  delta: string,
  modelSelection: AdvisorModelSelection = CODEX_MODEL,
) =>
  advisor.evaluate({
    mainThreadId: MAIN_THREAD,
    modelSelection,
    delta,
    workInProgress: false,
  });

describe("AdvisorSession", () => {
  it("returns the verdict the advisor replied with", async () => {
    const verdict = await withAdvisor(
      { replies: [say('{"verdict":"advise","severity":"concern","message":"reuse the helper"}')] },
      ({ advisor }) => evaluate(advisor, "[tool.updated] wrote a.ts"),
    );

    expect(verdict).toEqual({
      verdict: "advise",
      severity: "concern",
      message: "reuse the helper",
    });
  });

  it("parses a silent verdict", async () => {
    const verdict = await withAdvisor({ replies: [say('{"verdict":"silent"}')] }, ({ advisor }) =>
      evaluate(advisor, "x"),
    );

    expect(verdict).toEqual({ verdict: "silent" });
  });

  // The session persists, so the instructions only need to be sent once. Re-
  // sending them every turn would grow the advisor's context without adding
  // anything it does not already have.
  it("primes the session with its instructions once", async () => {
    const harness = await withAdvisor(
      { replies: [say('{"verdict":"silent"}'), say('{"verdict":"silent"}')] },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          yield* evaluate(advisor, "first");
          yield* evaluate(advisor, "second");
          return harness;
        }),
    );

    expect(harness.prompts).toHaveLength(2);
    expect(harness.prompts[0]).toContain("You are an advisor");
    expect(harness.prompts[1]).not.toContain("You are an advisor");
    expect(harness.prompts[1]).toContain("second");
  });

  it("reuses one shadow session across evaluations", async () => {
    const harness = await withAdvisor(
      { replies: [say('{"verdict":"silent"}'), say('{"verdict":"silent"}')] },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          yield* evaluate(advisor, "first");
          yield* evaluate(advisor, "second");
          return harness;
        }),
    );

    expect(harness.startedSessions).toHaveLength(1);
  });

  // The reasoning level travels in modelSelection.options. A session key that
  // ignored options would reuse the running shadow session, and the level the
  // user just picked would never reach the provider.
  it("starts a fresh shadow session when the reasoning level changes", async () => {
    const harness = await withAdvisor(
      { replies: [say('{"verdict":"silent"}'), say('{"verdict":"silent"}')] },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          yield* evaluate(advisor, "first");
          yield* evaluate(advisor, "second", {
            ...CODEX_MODEL,
            options: { reasoningEffort: "xhigh" },
          });
          return harness;
        }),
    );

    expect(harness.stopped).toEqual([SHADOW]);
    expect(harness.startedSessions).toHaveLength(2);
  });

  // Key equality must track the option values, not the order the fields happen
  // to be written in, or an unrelated settings round-trip would churn sessions.
  it("reuses the session when the same options arrive in a different field order", async () => {
    const harness = await withAdvisor(
      { replies: [say('{"verdict":"silent"}'), say('{"verdict":"silent"}')] },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          yield* evaluate(advisor, "first", {
            ...CODEX_MODEL,
            options: { reasoningEffort: "high", fastMode: true },
          });
          yield* evaluate(advisor, "second", {
            ...CODEX_MODEL,
            options: { fastMode: true, reasoningEffort: "high" },
          });
          return harness;
        }),
    );

    expect(harness.startedSessions).toHaveLength(1);
  });

  // Prose is a failed turn, not a note: every guard downstream keys off the
  // verdict fields, so unparseable output must not reach them.
  it("returns null when the advisor answers with prose", async () => {
    const verdict = await withAdvisor({ replies: [say("Looks good to me!")] }, ({ advisor }) =>
      evaluate(advisor, "x"),
    );

    expect(verdict).toBeNull();
  });

  it("returns null when the turn cannot be sent", async () => {
    const verdict = await withAdvisor({ replies: [], failSendTurn: true }, ({ advisor }) =>
      evaluate(advisor, "x"),
    );

    expect(verdict).toBeNull();
  });

  // A model that cannot answer in the required shape will not start doing so
  // on the next turn, and each attempt costs a full round trip.
  it("stops asking after consecutive failures", async () => {
    const harness = await withAdvisor(
      { replies: Array.from({ length: 6 }, () => say("no json here")) },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          for (let index = 0; index < ADVISOR_MAX_CONSECUTIVE_FAILURES + 2; index += 1) {
            yield* evaluate(advisor, `delta ${index}`);
          }
          return harness;
        }),
    );

    expect(harness.prompts).toHaveLength(ADVISOR_MAX_CONSECUTIVE_FAILURES);
  });

  it("keeps asking when a failure is followed by a good answer", async () => {
    const harness = await withAdvisor(
      {
        replies: [
          say("no json here"),
          say('{"verdict":"silent"}'),
          say("no json here"),
          say('{"verdict":"silent"}'),
        ],
      },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          for (let index = 0; index < 4; index += 1) {
            yield* evaluate(advisor, `delta ${index}`);
          }
          return harness;
        }),
    );

    expect(harness.prompts).toHaveLength(4);
  });

  it("forgets the shadow session for a thread", async () => {
    const harness = await withAdvisor(
      { replies: [say('{"verdict":"silent"}'), say('{"verdict":"silent"}')] },
      ({ advisor, harness }) =>
        Effect.gen(function* () {
          yield* evaluate(advisor, "first");
          yield* advisor.forget(MAIN_THREAD);
          yield* evaluate(advisor, "second");
          return harness;
        }),
    );

    expect(harness.stopped).toEqual([SHADOW]);
    expect(harness.startedSessions).toHaveLength(2);
  });
});
