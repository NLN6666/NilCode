import { describe, expect, it } from "vitest";

import {
  INITIAL_ADVISOR_THREAD_STATE,
  foldAdvisorThreadState,
  type AdvisorThreadStateEvent,
} from "./advisorThreadState.ts";

function fold(events: ReadonlyArray<AdvisorThreadStateEvent>) {
  return events.reduce(foldAdvisorThreadState, INITIAL_ADVISOR_THREAD_STATE);
}

const turnCompleted: AdvisorThreadStateEvent = {
  type: "thread.activity-appended",
  activityKind: "turn.completed",
};

describe("foldAdvisorThreadState", () => {
  it("starts with nothing in flight", () => {
    expect(INITIAL_ADVISOR_THREAD_STATE).toEqual({
      turnInterrupting: false,
      planModeActive: false,
    });
  });

  // Steering a turn that is already being torn down races the teardown: the
  // advice would land on a turn that no longer exists.
  it("marks the turn as interrupting once an interrupt is requested", () => {
    expect(fold([{ type: "thread.turn-interrupt-requested" }]).turnInterrupting).toBe(true);
  });

  it("clears the interrupting flag when the turn settles", () => {
    expect(
      fold([{ type: "thread.turn-interrupt-requested" }, turnCompleted]).turnInterrupting,
    ).toBe(false);
  });

  it("ignores other activities while an interrupt is in flight", () => {
    const state = fold([
      { type: "thread.turn-interrupt-requested" },
      { type: "thread.activity-appended", activityKind: "tool.updated" },
    ]);

    expect(state.turnInterrupting).toBe(true);
  });

  it("tracks plan mode", () => {
    expect(
      fold([{ type: "thread.interaction-mode-set", interactionMode: "plan" }]).planModeActive,
    ).toBe(true);
  });

  it("clears plan mode when the thread returns to default", () => {
    const state = fold([
      { type: "thread.interaction-mode-set", interactionMode: "plan" },
      { type: "thread.interaction-mode-set", interactionMode: "default" },
    ]);

    expect(state.planModeActive).toBe(false);
  });

  // Plan mode outlives a turn: the user is still reviewing a plan after the
  // turn that produced it has settled.
  it("keeps plan mode across turn boundaries", () => {
    const state = fold([
      { type: "thread.interaction-mode-set", interactionMode: "plan" },
      turnCompleted,
    ]);

    expect(state.planModeActive).toBe(true);
  });

  it("returns the same state when nothing changed", () => {
    const state = fold([{ type: "thread.activity-appended", activityKind: "tool.updated" }]);

    expect(state).toBe(INITIAL_ADVISOR_THREAD_STATE);
  });
});
