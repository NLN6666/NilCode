import { describe, expect, it } from "vitest";

import {
  advanceReasoningStreamThrottle,
  INITIAL_REASONING_STREAM_THROTTLE_STATE,
  maxReasoningStreamDispatches,
  REASONING_STREAM_MAX_DISPATCHES,
  REASONING_STREAM_MIN_CHARS,
  REASONING_STREAM_MIN_INTERVAL_MS,
  type ReasoningStreamThrottleState,
  shouldDispatchReasoningStream,
} from "./reasoningStreamThrottle.ts";

const firstDispatch = (nowMs: number, chars: number): ReasoningStreamThrottleState =>
  advanceReasoningStreamThrottle({
    state: INITIAL_REASONING_STREAM_THROTTLE_STATE,
    nowMs,
    chars,
  });

describe("reasoningStreamThrottle", () => {
  // The regression that made live reasoning invisible: a trace shorter than the
  // growth gate streamed zero times and only appeared once the turn settled.
  it("dispatches the first update on any readable text", () => {
    expect(
      shouldDispatchReasoningStream({
        state: INITIAL_REASONING_STREAM_THROTTLE_STATE,
        nowMs: 1_000,
        chars: 1,
      }),
    ).toBe(true);
  });

  it("never dispatches an empty trace", () => {
    expect(
      shouldDispatchReasoningStream({
        state: INITIAL_REASONING_STREAM_THROTTLE_STATE,
        nowMs: 1_000,
        chars: 0,
      }),
    ).toBe(false);
  });

  it("holds back later updates until enough new characters have accumulated", () => {
    const state = firstDispatch(1_000, 40);
    expect(
      shouldDispatchReasoningStream({
        state,
        nowMs: 10_000,
        chars: 40 + REASONING_STREAM_MIN_CHARS - 1,
      }),
    ).toBe(false);
    expect(
      shouldDispatchReasoningStream({
        state,
        nowMs: 10_000,
        chars: 40 + REASONING_STREAM_MIN_CHARS,
      }),
    ).toBe(true);
  });

  it("suppresses every append inside the same time window", () => {
    const state = firstDispatch(1_000, 300);
    // Plenty of new text, but the window has not elapsed.
    for (let offsetMs = 0; offsetMs < REASONING_STREAM_MIN_INTERVAL_MS; offsetMs += 10) {
      expect(
        shouldDispatchReasoningStream({
          state,
          nowMs: 1_000 + offsetMs,
          chars: 300 + REASONING_STREAM_MIN_CHARS * 4,
        }),
      ).toBe(false);
    }
    expect(
      shouldDispatchReasoningStream({
        state,
        nowMs: 1_000 + REASONING_STREAM_MIN_INTERVAL_MS,
        chars: 300 + REASONING_STREAM_MIN_CHARS,
      }),
    ).toBe(true);
  });

  it("requires both gates: a long pause alone does not dispatch a near-empty update", () => {
    const state = firstDispatch(1_000, 300);
    expect(
      shouldDispatchReasoningStream({
        state,
        nowMs: 60_000,
        chars: 300 + REASONING_STREAM_MIN_CHARS - 1,
      }),
    ).toBe(false);
  });

  // The ceiling is what keeps write amplification independent of turn duration,
  // now that the growth gate is small enough for the trace to visibly stream.
  it("stops streaming once the per-item ceiling is spent", () => {
    let state = INITIAL_REASONING_STREAM_THROTTLE_STATE;
    let chars = 0;
    let nowMs = 0;
    for (let index = 0; index < REASONING_STREAM_MAX_DISPATCHES; index += 1) {
      chars += REASONING_STREAM_MIN_CHARS;
      nowMs += REASONING_STREAM_MIN_INTERVAL_MS;
      expect(shouldDispatchReasoningStream({ state, nowMs, chars })).toBe(true);
      state = advanceReasoningStreamThrottle({ state, nowMs, chars });
    }
    expect(state.dispatches).toBe(REASONING_STREAM_MAX_DISPATCHES);
    expect(
      shouldDispatchReasoningStream({
        state,
        nowMs: nowMs + 10 * REASONING_STREAM_MIN_INTERVAL_MS,
        chars: chars + 10 * REASONING_STREAM_MIN_CHARS,
      }),
    ).toBe(false);
  });

  // Write-amplification regression: a reasoning trace of N characters delivered as
  // per-token deltas must collapse into a bounded number of persisted activity
  // writes, and a longer trace must not scale past the ceiling.
  it.each([
    { totalChars: 800, expectedMax: 27 },
    { totalChars: 2_400, expectedMax: REASONING_STREAM_MAX_DISPATCHES },
  ])("bounds dispatches for a $totalChars-character trace", ({ totalChars, expectedMax }) => {
    // Per-token cadence: 10 characters every 100ms.
    const deltaChars = 10;
    const msPerDelta = 100;
    const deltas = totalChars / deltaChars;
    let state: ReasoningStreamThrottleState = INITIAL_REASONING_STREAM_THROTTLE_STATE;
    let dispatches = 0;
    for (let index = 1; index <= deltas; index += 1) {
      const chars = index * deltaChars;
      const nowMs = index * msPerDelta;
      if (shouldDispatchReasoningStream({ state, nowMs, chars })) {
        dispatches += 1;
        state = advanceReasoningStreamThrottle({ state, nowMs, chars });
      }
    }

    expect(dispatches).toBeGreaterThan(0);
    expect(dispatches).toBeLessThanOrEqual(
      maxReasoningStreamDispatches({ chars: totalChars, elapsedMs: deltas * msPerDelta }),
    );
    // Far below the `deltas` per-token writes the naive path would produce.
    expect(dispatches).toBeLessThanOrEqual(expectedMax);
  });
});
