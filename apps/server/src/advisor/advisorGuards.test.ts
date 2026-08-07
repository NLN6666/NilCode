import { describe, expect, it } from "vitest";

import {
  ADVISOR_ACTIVITY_KIND,
  ADVISOR_DEDUPE_WINDOW,
  ADVISOR_MAX_ADVICE_PER_TURN,
  ADVISOR_MIN_INTERVAL_MS,
  advanceAdvisorGuard,
  type AdvisorGuardState,
  INITIAL_ADVISOR_GUARD_STATE,
  normalizeAdviceText,
  resetAdvisorGuardForTurn,
  shouldEmitAdvice,
  shouldFeedActivityToAdvisor,
} from "./advisorGuards.ts";

const emit = (state: AdvisorGuardState, nowMs: number, message: string): AdvisorGuardState =>
  advanceAdvisorGuard({ state, nowMs, message });

describe("shouldFeedActivityToAdvisor", () => {
  // The self-excitation cut.
  //
  // Steering the thread's own turn produces no activity at all
  // (providerRuntimeActivityProjection.ts: `turn.steered` returns [] when
  // target === "turn"), so the steer itself cannot loop. What does loop is the
  // activity the advisor appends to make its advice visible: feed that back and
  // the advisor comments on its own words forever.
  it("drops the activity carrying the advisor's own advice", () => {
    expect(shouldFeedActivityToAdvisor({ kind: ADVISOR_ACTIVITY_KIND })).toBe(false);
  });

  // Everything the main model does must reach the advisor - including the model's
  // reaction to advice already given, which is how the advisor learns whether it
  // was heeded.
  it("feeds ordinary main-model activity", () => {
    for (const kind of ["tool.updated", "task.progress", "turn.completed", "runtime.error"]) {
      expect(shouldFeedActivityToAdvisor({ kind })).toBe(true);
    }
  });
});

describe("shouldEmitAdvice", () => {
  it("lets the first advice of a turn through", () => {
    expect(
      shouldEmitAdvice({
        state: INITIAL_ADVISOR_GUARD_STATE,
        nowMs: 1_000,
        message: "you are rebuilding something that already exists",
        turnRunning: true,
      }),
    ).toBe(true);
  });

  // Turn boundary: advice that lands after the turn settles has nothing left to
  // steer, and would surface as an unprompted message with no context.
  it("stays silent once the turn is no longer running", () => {
    expect(
      shouldEmitAdvice({
        state: INITIAL_ADVISOR_GUARD_STATE,
        nowMs: 1_000,
        message: "you are rebuilding something that already exists",
        turnRunning: false,
      }),
    ).toBe(false);
  });

  it("never emits an empty message", () => {
    expect(
      shouldEmitAdvice({
        state: INITIAL_ADVISOR_GUARD_STATE,
        nowMs: 1_000,
        message: "   ",
        turnRunning: true,
      }),
    ).toBe(false);
  });

  it("suppresses a second advice inside the cooldown window", () => {
    const state = emit(INITIAL_ADVISOR_GUARD_STATE, 1_000, "first");
    for (let offsetMs = 0; offsetMs < ADVISOR_MIN_INTERVAL_MS; offsetMs += 1_000) {
      expect(
        shouldEmitAdvice({
          state,
          nowMs: 1_000 + offsetMs,
          message: "a different concern entirely",
          turnRunning: true,
        }),
      ).toBe(false);
    }
    expect(
      shouldEmitAdvice({
        state,
        nowMs: 1_000 + ADVISOR_MIN_INTERVAL_MS,
        message: "a different concern entirely",
        turnRunning: true,
      }),
    ).toBe(true);
  });

  // The per-turn ceiling is what bounds advisor noise independently of how long
  // the turn runs. Without it a slow turn earns unlimited interruptions.
  it("stops emitting once the per-turn ceiling is spent", () => {
    let state = INITIAL_ADVISOR_GUARD_STATE;
    let nowMs = 0;
    for (let index = 0; index < ADVISOR_MAX_ADVICE_PER_TURN; index += 1) {
      nowMs += ADVISOR_MIN_INTERVAL_MS;
      expect(
        shouldEmitAdvice({ state, nowMs, message: `concern ${index}`, turnRunning: true }),
      ).toBe(true);
      state = emit(state, nowMs, `concern ${index}`);
    }
    expect(
      shouldEmitAdvice({
        state,
        nowMs: nowMs + 10 * ADVISOR_MIN_INTERVAL_MS,
        message: "one more concern",
        turnRunning: true,
      }),
    ).toBe(false);
  });

  it("drops advice repeating something said recently", () => {
    const state = emit(INITIAL_ADVISOR_GUARD_STATE, 1_000, "check the existing helper first");
    expect(
      shouldEmitAdvice({
        state,
        nowMs: 1_000 + ADVISOR_MIN_INTERVAL_MS,
        message: "check the existing helper first",
        turnRunning: true,
      }),
    ).toBe(false);
  });

  // Dedupe remembers a bounded window, otherwise the advisor could never return
  // to a concern that stayed unaddressed for the whole turn.
  //
  // The window (ADVISOR_DEDUPE_WINDOW) is deliberately wider than a single
  // turn's allowance (ADVISOR_MAX_ADVICE_PER_TURN), so filling it necessarily
  // spans turns - hence the reset on every iteration. Without it this test
  // would hit the per-turn ceiling and prove nothing about dedupe.
  it("forgets advice that fell out of the dedupe window", () => {
    let state = INITIAL_ADVISOR_GUARD_STATE;
    let nowMs = 1_000;
    state = emit(state, nowMs, "the original concern");
    for (let index = 0; index < ADVISOR_DEDUPE_WINDOW; index += 1) {
      nowMs += ADVISOR_MIN_INTERVAL_MS;
      state = resetAdvisorGuardForTurn(emit(state, nowMs, `filler ${index}`));
    }
    expect(state.recentAdvice).toHaveLength(ADVISOR_DEDUPE_WINDOW);
    expect(
      shouldEmitAdvice({
        state,
        nowMs: nowMs + ADVISOR_MIN_INTERVAL_MS,
        message: "the original concern",
        turnRunning: true,
      }),
    ).toBe(true);
  });
});

describe("resetAdvisorGuardForTurn", () => {
  // The turn is the natural budget boundary: a new turn is new work and deserves
  // a fresh allowance.
  it("restores the per-turn allowance", () => {
    let state = INITIAL_ADVISOR_GUARD_STATE;
    let nowMs = 0;
    for (let index = 0; index < ADVISOR_MAX_ADVICE_PER_TURN; index += 1) {
      nowMs += ADVISOR_MIN_INTERVAL_MS;
      state = emit(state, nowMs, `concern ${index}`);
    }

    const next = resetAdvisorGuardForTurn(state);

    expect(next.advicesThisTurn).toBe(0);
    expect(
      shouldEmitAdvice({
        state: next,
        nowMs: nowMs + ADVISOR_MIN_INTERVAL_MS,
        message: "a fresh concern",
        turnRunning: true,
      }),
    ).toBe(true);
  });

  // Dedupe memory deliberately survives the reset: repeating the same advice on
  // every turn is exactly the nagging the dedupe rule exists to prevent.
  it("keeps the dedupe memory across the turn boundary", () => {
    const state = emit(INITIAL_ADVISOR_GUARD_STATE, 1_000, "check the existing helper first");

    const next = resetAdvisorGuardForTurn(state);

    expect(
      shouldEmitAdvice({
        state: next,
        nowMs: 1_000 + ADVISOR_MIN_INTERVAL_MS,
        message: "check the existing helper first",
        turnRunning: true,
      }),
    ).toBe(false);
  });

  // The cooldown is wall-clock, not per-turn: a turn that ends and restarts
  // within seconds must not hand the advisor a way to fire back-to-back.
  it("keeps the cooldown across the turn boundary", () => {
    const state = emit(INITIAL_ADVISOR_GUARD_STATE, 1_000, "first");

    const next = resetAdvisorGuardForTurn(state);

    expect(
      shouldEmitAdvice({
        state: next,
        nowMs: 1_000 + ADVISOR_MIN_INTERVAL_MS - 1,
        message: "a different concern entirely",
        turnRunning: true,
      }),
    ).toBe(false);
  });
});

describe("normalizeAdviceText", () => {
  it("treats messages differing only in surrounding whitespace as the same", () => {
    expect(normalizeAdviceText("  check the helper  ")).toBe(
      normalizeAdviceText("check the helper"),
    );
  });

  it("treats messages differing only in case as the same", () => {
    expect(normalizeAdviceText("Check The Helper")).toBe(normalizeAdviceText("check the helper"));
  });

  it("treats messages differing only in internal whitespace as the same", () => {
    expect(normalizeAdviceText("check   the\nhelper")).toBe(
      normalizeAdviceText("check the helper"),
    );
  });

  it("keeps genuinely different messages distinct", () => {
    expect(normalizeAdviceText("check the helper")).not.toBe(normalizeAdviceText("write a helper"));
  });
});
