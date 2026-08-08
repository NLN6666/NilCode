import type { AdvisorModelSelection, ThreadId } from "@synara/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  AdvisorInference,
  type AdvisorInferenceInput,
  type AdvisorInferenceShape,
} from "../Services/AdvisorInference.ts";
import { AdvisorSession, type AdvisorSessionShape } from "../Services/AdvisorSession.ts";
import { AdvisorSessionLive } from "./AdvisorSession.ts";

const MAIN_THREAD = "thread-1" as ThreadId;
const CODEX_MODEL = { provider: "codex", model: "gpt-5.1-codex" } as const;

interface Harness {
  /** Every prompt the advisor sent, in order. */
  readonly calls: ReadonlyArray<AdvisorInferenceInput>;
}

/** `replies` is consumed one per evaluation; `null` means the run failed. */
async function withAdvisor<A>(
  replies: ReadonlyArray<string | null>,
  body: (input: {
    readonly advisor: AdvisorSessionShape;
    readonly harness: Harness;
  }) => Effect.Effect<A>,
): Promise<A> {
  const calls: Array<AdvisorInferenceInput> = [];
  let replyIndex = 0;

  const inference: AdvisorInferenceShape = {
    run: (input) => {
      calls.push(input);
      const reply = replies[replyIndex] ?? null;
      replyIndex += 1;
      return Effect.succeed(reply);
    },
  };

  return Effect.runPromise(
    Effect.gen(function* () {
      const advisor = yield* AdvisorSession;
      return yield* body({ advisor, harness: { calls } });
    }).pipe(
      Effect.provide(Layer.provide(AdvisorSessionLive, Layer.succeed(AdvisorInference, inference))),
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
      ['{"verdict":"advise","severity":"concern","message":"reuse the helper"}'],
      ({ advisor }) => evaluate(advisor, "[tool.updated] wrote a.ts"),
    );

    expect(verdict).toEqual({
      verdict: "advise",
      severity: "concern",
      message: "reuse the helper",
    });
  });

  it("parses a silent verdict", async () => {
    const verdict = await withAdvisor(['{"verdict":"silent"}'], ({ advisor }) =>
      evaluate(advisor, "x"),
    );

    expect(verdict).toEqual({ verdict: "silent" });
  });

  it("sends the delta under review", async () => {
    const calls = await withAdvisor(['{"verdict":"silent"}'], ({ advisor, harness }) =>
      evaluate(advisor, "[tool.updated] wrote a.ts").pipe(Effect.as(harness.calls)),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain("[tool.updated] wrote a.ts");
  });

  // Statelessness is the whole point of the rewrite: there is no session to
  // prime, so the instructions have to ride along every single time.
  it("carries its instructions on every evaluation", async () => {
    const calls = await withAdvisor(
      ['{"verdict":"silent"}', '{"verdict":"silent"}'],
      ({ advisor, harness }) =>
        evaluate(advisor, "first").pipe(
          Effect.andThen(evaluate(advisor, "second")),
          Effect.as(harness.calls),
        ),
    );

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.prompt).toContain("You are an advisor");
    }
  });

  it("puts what the user asked for in the prompt", async () => {
    const calls = await withAdvisor(['{"verdict":"silent"}'], ({ advisor, harness }) =>
      advisor
        .evaluate({
          mainThreadId: MAIN_THREAD,
          modelSelection: CODEX_MODEL,
          delta: "[tool.updated] wrote a.ts",
          request: "[user]\nadd rate limiting",
          workInProgress: false,
        })
        .pipe(Effect.as(harness.calls)),
    );

    expect(calls[0]?.prompt).toContain("add rate limiting");
  });

  it("forwards the working directory and CLI paths to the runtime", async () => {
    const providerOptions = { codex: { binaryPath: "C:\\tools\\codex.exe" } };
    const calls = await withAdvisor(['{"verdict":"silent"}'], ({ advisor, harness }) =>
      advisor
        .evaluate({
          mainThreadId: MAIN_THREAD,
          modelSelection: CODEX_MODEL,
          cwd: "/repo",
          providerOptions: providerOptions as never,
          delta: "x",
          workInProgress: false,
        })
        .pipe(Effect.as(harness.calls)),
    );

    expect(calls[0]?.cwd).toBe("/repo");
    expect(calls[0]?.providerOptions).toEqual(providerOptions);
  });

  it("returns null when the advisor answers with prose", async () => {
    const verdict = await withAdvisor(["I think this looks fine overall."], ({ advisor }) =>
      evaluate(advisor, "x"),
    );

    expect(verdict).toBeNull();
  });

  it("returns null when the runtime could not answer", async () => {
    const verdict = await withAdvisor([null], ({ advisor }) => evaluate(advisor, "x"));

    expect(verdict).toBeNull();
  });

  // The old shadow session switched itself off for good after three failures.
  // Nothing is remembered now, so a fixed configuration recovers by itself.
  it("keeps asking after a failure", async () => {
    const verdict = await withAdvisor([null, null, null, '{"verdict":"silent"}'], ({ advisor }) =>
      evaluate(advisor, "a").pipe(
        Effect.andThen(evaluate(advisor, "b")),
        Effect.andThen(evaluate(advisor, "c")),
        Effect.andThen(evaluate(advisor, "d")),
      ),
    );

    expect(verdict).toEqual({ verdict: "silent" });
  });
});
