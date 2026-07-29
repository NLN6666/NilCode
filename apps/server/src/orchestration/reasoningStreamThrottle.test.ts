import { describe, expect, it } from "vitest";

import {
  advanceReasoningStreamThrottle,
  INITIAL_REASONING_STREAM_THROTTLE_STATE,
  maxReasoningStreamDispatches,
  REASONING_STREAM_MIN_CHARS,
  REASONING_STREAM_MIN_INTERVAL_MS,
  type ReasoningStreamThrottleState,
  shouldDispatchReasoningStream,
} from "./reasoningStreamThrottle.ts";

describe("reasoningStreamThrottle", () => {
  it("dispatches the first update as soon as it reaches the character minimum", () => {
    expect(
      shouldDispatchReasoningStream({
        state: INITIAL_REASONING_STREAM_THROTTLE_STATE,
        nowMs: 1_000,
        chars: REASONING_STREAM_MIN_CHARS,
      }),
    ).toBe(true);
  });

  it("holds back until enough new characters have accumulated", () => {
    expect(
      shouldDispatchReasoningStream({
        state: INITIAL_REASONING_STREAM_THROTTLE_STATE,
        nowMs: 10_000,
        chars: REASONING_STREAM_MIN_CHARS - 1,
      }),
    ).toBe(false);
  });

  it("suppresses every append inside the same time window", () => {
    const state = advanceReasoningStreamThrottle({ nowMs: 1_000, chars: 300 });
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
    const state = advanceReasoningStreamThrottle({ nowMs: 1_000, chars: 300 });
    expect(
      shouldDispatchReasoningStream({
        state,
        nowMs: 60_000,
        chars: 300 + REASONING_STREAM_MIN_CHARS - 1,
      }),
    ).toBe(false);
  });

  // Write-amplification regression: a reasoning trace of N characters delivered as
  // per-token deltas must collapse into a handful of persisted activity writes.
  it.each([
    { totalChars: 800, expectedMax: 3 },
    { totalChars: 2_400, expectedMax: 10 },
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
        state = advanceReasoningStreamThrottle({ nowMs, chars });
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
