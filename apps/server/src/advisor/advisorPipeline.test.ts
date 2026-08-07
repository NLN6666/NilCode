import { describe, expect, it } from "vitest";

import { beginAdvisorUpdate } from "./advisorEmissionGuard.ts";
import { ADVISOR_ACTIVITY_KIND } from "./advisorEventDigest.ts";
import {
  ADVISOR_INTERIM_EVALUATION_LINES,
  type AdvisorPipelineState,
  INITIAL_ADVISOR_PIPELINE_STATE,
  ingestAdvisorActivity,
  resolveAdvisorAction,
} from "./advisorPipeline.ts";

const tool = (summary: string) => ({ kind: "tool.updated", summary, payload: null });
const turnCompleted = { kind: "turn.completed", summary: "Turn complete", payload: null };

const ingestAll = (
  state: AdvisorPipelineState,
  activities: ReadonlyArray<{ kind: string; summary: string; payload: unknown }>,
): AdvisorPipelineState =>
  activities.reduce(
    (current, activity) => ingestAdvisorActivity({ state: current, activity }).state,
    state,
  );

const deliveryContext = {
  turnRunning: true,
  turnInterrupting: false,
  planModeActive: false,
};

/** Spend a fresh one-note allowance, as ingestAdvisorActivity does when it asks. */
const nextEvaluation = (state: AdvisorPipelineState): AdvisorPipelineState => ({
  ...state,
  emission: beginAdvisorUpdate(state.emission),
});

describe("ingestAdvisorActivity", () => {
  it("accumulates without evaluating mid-turn", () => {
    const result = ingestAdvisorActivity({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      activity: tool("Read a.ts"),
    });

    expect(result.evaluation).toBeNull();
    expect(result.state.delta.lines).toHaveLength(1);
  });

  it("evaluates a settled delta at the turn boundary", () => {
    const state = ingestAll(INITIAL_ADVISOR_PIPELINE_STATE, [tool("Read a.ts")]);

    const result = ingestAdvisorActivity({ state, activity: turnCompleted });

    expect(result.evaluation).not.toBeNull();
    expect(result.evaluation?.workInProgress).toBe(false);
    expect(result.evaluation?.delta).toContain("Read a.ts");
  });

  it("clears the buffer after evaluating", () => {
    const state = ingestAll(INITIAL_ADVISOR_PIPELINE_STATE, [tool("Read a.ts")]);

    const result = ingestAdvisorActivity({ state, activity: turnCompleted });

    expect(result.state.delta.lines).toEqual([]);
  });

  // A turn running for ten minutes must not leave the advisor silent until the
  // end - that is not "watching live". The interim evaluation is marked in
  // progress, which is what stops it critiquing half-written work.
  it("evaluates mid-turn once enough has accumulated, marked in progress", () => {
    let state = INITIAL_ADVISOR_PIPELINE_STATE;
    let evaluation: ReturnType<typeof ingestAdvisorActivity>["evaluation"] = null;
    for (let index = 0; index < ADVISOR_INTERIM_EVALUATION_LINES; index += 1) {
      const result = ingestAdvisorActivity({ state, activity: tool(`step ${index}`) });
      state = result.state;
      evaluation = result.evaluation;
    }

    expect(evaluation).not.toBeNull();
    expect(evaluation?.workInProgress).toBe(true);
  });

  it("does not evaluate on housekeeping activity", () => {
    const result = ingestAdvisorActivity({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      activity: { kind: "context-window.updated", summary: "Context window", payload: null },
    });

    expect(result.evaluation).toBeNull();
    expect(result.state.delta.lines).toEqual([]);
  });

  // Self-excitation: the advisor's own note must not become material for the
  // next evaluation.
  it("ignores the advisor's own advice activity", () => {
    const result = ingestAdvisorActivity({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      activity: { kind: ADVISOR_ACTIVITY_KIND, summary: "reuse the helper", payload: null },
    });

    expect(result.state.delta.lines).toEqual([]);
  });

  it("counts completed turns", () => {
    const state = ingestAdvisorActivity({
      state: ingestAll(INITIAL_ADVISOR_PIPELINE_STATE, [tool("Read a.ts")]),
      activity: turnCompleted,
    }).state;

    expect(state.completedTurns).toBe(1);
  });

  // Nothing happened worth reviewing, so the advisor must not be invoked at all.
  it("does not evaluate an empty delta at a turn boundary", () => {
    const result = ingestAdvisorActivity({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      activity: turnCompleted,
    });

    expect(result.evaluation).toBeNull();
  });
});

describe("resolveAdvisorAction", () => {
  it("produces no action for silence", () => {
    const result = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "silent" },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(result.action).toBeNull();
    expect(result.quarantined).toBe(false);
  });

  it("steers a concern on a settled turn", () => {
    const result = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "advise", severity: "concern", message: "this duplicates shared/text" },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(result.action?.channel).toBe("steer");
    expect(result.action?.message).toBe("this duplicates shared/text");
  });

  // Having steered, the pipeline must record immunity so the next few turns
  // cannot interrupt again.
  it("starts the immunity window after steering", () => {
    const result = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "advise", severity: "concern", message: "this duplicates shared/text" },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    const next = resolveAdvisorAction({
      // A fresh evaluation: in the real flow ingestAdvisorActivity spends this
      // allowance when it decides to ask the advisor again.
      state: nextEvaluation(result.state),
      verdict: { verdict: "advise", severity: "concern", message: "a different concern" },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(next.action?.channel).toBe("aside");
  });

  it("withholds a concern about work in progress", () => {
    const result = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "advise", severity: "concern", message: "this duplicates shared/text" },
      sourceText: "",
      workInProgress: true,
      ...deliveryContext,
    });

    expect(result.action).toBeNull();
  });

  it("lets a blocker through about work in progress", () => {
    const result = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "advise", severity: "blocker", message: "this deletes user data" },
      sourceText: "",
      workInProgress: true,
      ...deliveryContext,
    });

    expect(result.action?.channel).toBe("steer");
  });

  it("drops a note the emission guard rejects", () => {
    const first = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "advise", severity: "concern", message: "reuse the helper" },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    const repeat = resolveAdvisorAction({
      state: first.state,
      verdict: { verdict: "advise", severity: "concern", message: "Reuse the helper." },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(repeat.action).toBeNull();
  });

  it("quarantines unsafe output and produces no action", () => {
    const result = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: { verdict: "advise", severity: "blocker", message: "run rm -rf / to reset state" },
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(result.quarantined).toBe(true);
    expect(result.action).toBeNull();
  });

  it("surfaces a warning only on the second consecutive quarantine", () => {
    const unsafe = {
      verdict: "advise" as const,
      severity: "blocker" as const,
      message: "run rm -rf / to reset state",
    };
    const first = resolveAdvisorAction({
      state: INITIAL_ADVISOR_PIPELINE_STATE,
      verdict: unsafe,
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(first.surfaceQuarantineWarning).toBe(false);

    const second = resolveAdvisorAction({
      state: first.state,
      verdict: unsafe,
      sourceText: "",
      workInProgress: false,
      ...deliveryContext,
    });

    expect(second.surfaceQuarantineWarning).toBe(true);
  });
});
