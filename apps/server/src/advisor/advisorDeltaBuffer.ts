// Accumulates digest lines between advisor evaluations.
//
// Modelled on Oh My Pi's advisor delta (see README acknowledgements). The
// advisor is not asked once per event - it is asked at a turn boundary, and the
// question it gets is "here is everything that happened since I last asked".
// That is the difference between paying per event and paying per turn.
//
// Two things this has to get right:
//
//   - a bound. The delta becomes one prompt, and a turn can run for thousands of
//     steps. Past the cap the oldest lines go, because recent activity is what
//     the advisor is being asked about.
//   - honesty about the bound. Dropping lines silently would let the advisor
//     conclude the model did less than it did; an explicit notice is strictly
//     better than a quietly partial record.

export const ADVISOR_DELTA_MAX_LINES = 200;
export const ADVISOR_DELTA_TRUNCATION_NOTICE = "[earlier activity omitted]";
const IN_PROGRESS_MARKER = "[in progress]";

export interface AdvisorDeltaState {
  readonly lines: readonly string[];
  /** Lines evicted by the cap since the last take; disclosed in the delta. */
  readonly dropped: number;
}

export const INITIAL_ADVISOR_DELTA_STATE: AdvisorDeltaState = { lines: [], dropped: 0 };

export function appendAdvisorDeltaLine(state: AdvisorDeltaState, line: string): AdvisorDeltaState {
  const lines = [...state.lines, line];
  if (lines.length <= ADVISOR_DELTA_MAX_LINES) {
    return { lines, dropped: state.dropped };
  }
  const overflow = lines.length - ADVISOR_DELTA_MAX_LINES;
  return { lines: lines.slice(overflow), dropped: state.dropped + overflow };
}

/**
 * Render the buffer as the block handed to the advisor.
 *
 * `workInProgress` marks a turn that has not settled. The advisor needs it or it
 * critiques a half-written change as though it were the final state - and it is
 * what gates `shouldWithholdAdvice`.
 */
export function buildAdvisorDelta(
  state: AdvisorDeltaState,
  options: { readonly workInProgress: boolean },
): string {
  const parts: string[] = [];
  if (options.workInProgress) {
    parts.push(IN_PROGRESS_MARKER);
  }
  if (state.dropped > 0) {
    parts.push(ADVISOR_DELTA_TRUNCATION_NOTICE);
  }
  parts.push(...state.lines);
  return parts.join("\n");
}

/**
 * Take the pending delta and reset the buffer.
 *
 * A null delta means nothing worth reviewing accumulated, and the advisor must
 * not be invoked at all - evaluating an empty transcript is pure cost.
 */
export function takeAdvisorDelta(
  state: AdvisorDeltaState,
  options: { readonly workInProgress: boolean },
): { readonly delta: string | null; readonly state: AdvisorDeltaState } {
  if (state.lines.length === 0) {
    return { delta: null, state: INITIAL_ADVISOR_DELTA_STATE };
  }
  return { delta: buildAdvisorDelta(state, options), state: INITIAL_ADVISOR_DELTA_STATE };
}
