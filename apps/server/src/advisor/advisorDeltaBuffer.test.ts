import { describe, expect, it } from "vitest";

import {
  ADVISOR_DELTA_MAX_LINES,
  ADVISOR_DELTA_TRUNCATION_NOTICE,
  appendAdvisorDeltaLine,
  buildAdvisorDelta,
  INITIAL_ADVISOR_DELTA_STATE,
  takeAdvisorDelta,
} from "./advisorDeltaBuffer.ts";

const append = (state: typeof INITIAL_ADVISOR_DELTA_STATE, ...lines: string[]) =>
  lines.reduce((current, line) => appendAdvisorDeltaLine(current, line), state);

describe("appendAdvisorDeltaLine", () => {
  it("accumulates lines in order", () => {
    const state = append(
      INITIAL_ADVISOR_DELTA_STATE,
      "[tool.updated] Read a.ts",
      "[turn.completed] done",
    );

    expect(state.lines).toEqual(["[tool.updated] Read a.ts", "[turn.completed] done"]);
  });

  // A turn that runs for thousands of steps must not be able to grow the delta
  // without bound - the delta becomes one prompt to the advisor model.
  it("drops the oldest lines past the cap", () => {
    let state = INITIAL_ADVISOR_DELTA_STATE;
    for (let index = 0; index < ADVISOR_DELTA_MAX_LINES + 5; index += 1) {
      state = appendAdvisorDeltaLine(state, `line ${index}`);
    }

    expect(state.lines).toHaveLength(ADVISOR_DELTA_MAX_LINES);
    expect(state.lines[0]).toBe("line 5");
    expect(state.dropped).toBe(5);
  });
});

describe("buildAdvisorDelta", () => {
  it("renders accumulated lines as one block", () => {
    const state = append(INITIAL_ADVISOR_DELTA_STATE, "first", "second");

    expect(buildAdvisorDelta(state, { workInProgress: false })).toBe("first\nsecond");
  });

  // The advisor must know the work is unfinished, otherwise it critiques a
  // half-written function as if it were the final state.
  it("marks a delta whose turn is still going", () => {
    const state = append(INITIAL_ADVISOR_DELTA_STATE, "first");

    expect(buildAdvisorDelta(state, { workInProgress: true })).toContain("[in progress]");
  });

  it("does not mark a settled delta", () => {
    const state = append(INITIAL_ADVISOR_DELTA_STATE, "first");

    expect(buildAdvisorDelta(state, { workInProgress: false })).not.toContain("[in progress]");
  });

  // Silently dropping lines would let the advisor conclude the model did less
  // than it did, which is worse than telling it the record is partial.
  it("discloses that lines were dropped", () => {
    let state = INITIAL_ADVISOR_DELTA_STATE;
    for (let index = 0; index < ADVISOR_DELTA_MAX_LINES + 3; index += 1) {
      state = appendAdvisorDeltaLine(state, `line ${index}`);
    }

    expect(buildAdvisorDelta(state, { workInProgress: false })).toContain(
      ADVISOR_DELTA_TRUNCATION_NOTICE,
    );
  });
});

describe("takeAdvisorDelta", () => {
  it("returns the delta and clears the buffer", () => {
    const state = append(INITIAL_ADVISOR_DELTA_STATE, "first", "second");

    const taken = takeAdvisorDelta(state, { workInProgress: false });

    expect(taken.delta).toBe("first\nsecond");
    expect(taken.state.lines).toEqual([]);
    expect(taken.state.dropped).toBe(0);
  });

  // An empty delta means nothing happened worth reviewing, so the advisor must
  // not be invoked at all - an evaluation on an empty transcript is pure cost.
  it("returns null when nothing accumulated", () => {
    const taken = takeAdvisorDelta(INITIAL_ADVISOR_DELTA_STATE, { workInProgress: false });

    expect(taken.delta).toBeNull();
  });
});
