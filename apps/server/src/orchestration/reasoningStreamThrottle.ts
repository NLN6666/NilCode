// Write throttle for streaming reasoning traces.
//
// Every streamed reasoning update is a persisted `thread.activity.append`, so the
// stream has to be rate limited on the server. Both gates must pass before an
// update is dispatched:
//
//   - time: at least REASONING_STREAM_MIN_INTERVAL_MS since the last dispatch.
//     A char-only gate would fire back-to-back on a fast model.
//   - growth: at least REASONING_STREAM_MIN_CHARS of new text since the last
//     dispatch. A time-only gate would ship near-empty updates on a slow model.
//
// Dispatches per reasoning item are bounded by `maxReasoningStreamDispatches`
// below. `chars` is itself capped by MAX_BUFFERED_REASONING_SUMMARY_CHARS in the
// ingestion layer, which is what makes the bound independent of turn duration -
// so the throttle state must never expire on a timer (see the cache that holds
// it in ProviderRuntimeIngestion.ts).

export const REASONING_STREAM_MIN_INTERVAL_MS = 250;
export const REASONING_STREAM_MIN_CHARS = 240;

export interface ReasoningStreamThrottleState {
  readonly lastDispatchedAtMs: number;
  readonly lastDispatchedChars: number;
}

// Zeroed rather than "unset" so the first update that reaches the char minimum
// goes out immediately instead of waiting a full interval.
export const INITIAL_REASONING_STREAM_THROTTLE_STATE: ReasoningStreamThrottleState = {
  lastDispatchedAtMs: 0,
  lastDispatchedChars: 0,
};

export function shouldDispatchReasoningStream(input: {
  readonly state: ReasoningStreamThrottleState;
  readonly nowMs: number;
  readonly chars: number;
}): boolean {
  return (
    input.chars - input.state.lastDispatchedChars >= REASONING_STREAM_MIN_CHARS &&
    input.nowMs - input.state.lastDispatchedAtMs >= REASONING_STREAM_MIN_INTERVAL_MS
  );
}

export function advanceReasoningStreamThrottle(input: {
  readonly nowMs: number;
  readonly chars: number;
}): ReasoningStreamThrottleState {
  return {
    lastDispatchedAtMs: input.nowMs,
    lastDispatchedChars: input.chars,
  };
}

/**
 * Upper bound on streamed dispatches for a reasoning item of `chars` characters
 * produced over `elapsedMs`. Used by the write-amplification regression test.
 *
 * Character term: every dispatch consumes at least REASONING_STREAM_MIN_CHARS of
 * growth, so it counts dispatches directly - no off-by-one slack.
 *
 * Time term: dispatches are separated by at least the interval, but the throttle
 * starts from a zeroed watermark, so the first one can land at elapsed 0. That is
 * the `+ 1`; the term counts intervals, not dispatches.
 *
 * At the MAX_BUFFERED_REASONING_SUMMARY_CHARS ceiling of 8000 characters the
 * character term caps a single reasoning item at 33 streamed writes, regardless
 * of how long the turn runs.
 */
export function maxReasoningStreamDispatches(input: {
  readonly chars: number;
  readonly elapsedMs: number;
}): number {
  return Math.min(
    Math.floor(input.chars / REASONING_STREAM_MIN_CHARS),
    Math.floor(input.elapsedMs / REASONING_STREAM_MIN_INTERVAL_MS) + 1,
  );
}
