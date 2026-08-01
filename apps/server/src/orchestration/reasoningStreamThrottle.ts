// Write throttle for streaming reasoning traces.
//
// Every streamed reasoning update is a persisted `thread.activity.append`, so the
// stream has to be rate limited on the server. Three gates shape it:
//
//   - first update: exempt from growth and interval. It does not add text to a
//     visible row, it is what makes the row appear at all. Holding it to a
//     sustained-growth threshold meant every trace shorter than that threshold
//     streamed zero times and only materialised once the turn settled - short
//     traces are the common case, so live reasoning was effectively dead.
//   - time: at least REASONING_STREAM_MIN_INTERVAL_MS since the last dispatch.
//     A char-only gate would fire back-to-back on a fast model.
//   - growth: at least REASONING_STREAM_MIN_CHARS of new text since the last
//     dispatch. A time-only gate would ship near-empty updates on a slow model.
//
// REASONING_STREAM_MAX_DISPATCHES is the hard ceiling per reasoning item. It is
// what keeps write amplification independent of turn duration, so the growth gate
// is free to be small enough that the trace visibly streams. Past the ceiling the
// row stops updating and the authoritative `item.completed` still delivers the
// full text, exactly as it does for a trace that never streamed at all.
//
// The throttle state must never expire on a timer, or a long-running item would
// silently earn extra dispatches; lifetime is owned by
// `clearReasoningStreamThrottles` (see the cache in ProviderRuntimeIngestion.ts).

export const REASONING_STREAM_MIN_INTERVAL_MS = 250;
export const REASONING_STREAM_MIN_CHARS = 24;
export const REASONING_STREAM_MAX_DISPATCHES = 32;

export interface ReasoningStreamThrottleState {
  readonly lastDispatchedAtMs: number;
  readonly lastDispatchedChars: number;
  /** Dispatches already spent on this reasoning item. */
  readonly dispatches: number;
}

export const INITIAL_REASONING_STREAM_THROTTLE_STATE: ReasoningStreamThrottleState = {
  lastDispatchedAtMs: 0,
  lastDispatchedChars: 0,
  dispatches: 0,
};

export function shouldDispatchReasoningStream(input: {
  readonly state: ReasoningStreamThrottleState;
  readonly nowMs: number;
  readonly chars: number;
}): boolean {
  if (input.state.dispatches >= REASONING_STREAM_MAX_DISPATCHES) {
    return false;
  }
  // Callers only reach here with readable text, so any text at all is enough to
  // put the row on screen while the model is still thinking.
  if (input.state.dispatches === 0) {
    return input.chars > 0;
  }
  return (
    input.chars - input.state.lastDispatchedChars >= REASONING_STREAM_MIN_CHARS &&
    input.nowMs - input.state.lastDispatchedAtMs >= REASONING_STREAM_MIN_INTERVAL_MS
  );
}

export function advanceReasoningStreamThrottle(input: {
  readonly state: ReasoningStreamThrottleState;
  readonly nowMs: number;
  readonly chars: number;
}): ReasoningStreamThrottleState {
  return {
    lastDispatchedAtMs: input.nowMs,
    lastDispatchedChars: input.chars,
    dispatches: input.state.dispatches + 1,
  };
}

/**
 * Upper bound on streamed dispatches for a reasoning item of `chars` characters
 * produced over `elapsedMs`. Used by the write-amplification regression test.
 *
 * Ceiling term: REASONING_STREAM_MAX_DISPATCHES, and the only term that does not
 * grow with the trace - it is what bounds a pathologically long reasoning item.
 *
 * Character term: the first dispatch is free, every later one consumes at least
 * REASONING_STREAM_MIN_CHARS of growth.
 *
 * Time term: dispatches are separated by at least the interval, but the first one
 * can land at elapsed 0. That is the `+ 1`; the term counts intervals, not
 * dispatches.
 */
export function maxReasoningStreamDispatches(input: {
  readonly chars: number;
  readonly elapsedMs: number;
}): number {
  if (input.chars <= 0) {
    return 0;
  }
  return Math.min(
    REASONING_STREAM_MAX_DISPATCHES,
    Math.floor((input.chars - 1) / REASONING_STREAM_MIN_CHARS) + 1,
    Math.floor(input.elapsedMs / REASONING_STREAM_MIN_INTERVAL_MS) + 1,
  );
}
