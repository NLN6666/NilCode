// Guard rules for advisor advice.
//
// The advisor speaks by injecting a steer into the main model's live turn, so
// every rule here exists to keep that power from becoming noise or a feedback
// loop. Four gates shape it:
//
//   - self-excitation: steering the thread's own turn produces no activity
//     (see `turn.steered` in providerRuntimeActivityProjection.ts, which returns
//     [] when target === "turn"), so the steer itself cannot loop. What can loop
//     is the activity the advisor appends to make its advice visible - feed that
//     back and the advisor comments on its own words, forever. The cut is by
//     activity kind, which keeps it structural rather than a text heuristic.
//   - turn boundary: advice that lands after the turn settles has nothing left
//     to steer and surfaces as an unprompted message with no context.
//   - cooldown: wall-clock spacing between two pieces of advice. It deliberately
//     survives a turn reset - a turn that ends and restarts within seconds must
//     not hand the advisor a way to fire back-to-back.
//   - per-turn ceiling: bounds advisor noise independently of turn duration.
//     Without it a slow turn earns unlimited interruptions. Unlike the cooldown
//     this one does reset, because a new turn is new work.
//   - dedupe: a bounded memory of recent advice. Bounded, not total, so a
//     concern that stayed unaddressed for a whole turn can eventually be raised
//     again. The memory survives turn resets, because repeating the same advice
//     at the top of every turn is exactly the nagging this rule prevents.
//
// State is owned by the caller (AdvisorReactor) and never expires on a timer.

/**
 * Activity kind carrying the advisor's own advice.
 *
 * `OrchestrationThreadActivity.kind` is a free string (existing values look like
 * `task.progress`, `turn.steered`), so adding one costs no schema compatibility
 * - unlike `tone`, which is a literal union and is therefore left as "info".
 */
export const ADVISOR_ACTIVITY_KIND = "advisor.advice";

export const ADVISOR_MIN_INTERVAL_MS = 20_000;
export const ADVISOR_MAX_ADVICE_PER_TURN = 3;
export const ADVISOR_DEDUPE_WINDOW = 5;

export interface AdvisorGuardState {
  /** Wall clock of the last emitted advice; 0 means the advisor has never spoken. */
  readonly lastAdviceAtMs: number;
  readonly advicesThisTurn: number;
  /** Normalized recent advice, oldest first, capped at ADVISOR_DEDUPE_WINDOW. */
  readonly recentAdvice: readonly string[];
}

export const INITIAL_ADVISOR_GUARD_STATE: AdvisorGuardState = {
  lastAdviceAtMs: 0,
  advicesThisTurn: 0,
  recentAdvice: [],
};

/**
 * Whether an activity should reach the advisor at all.
 *
 * Everything the main model does feeds through - including its reaction to advice
 * already given, which is how the advisor learns whether it was heeded.
 */
export function shouldFeedActivityToAdvisor(input: { readonly kind: string }): boolean {
  return input.kind !== ADVISOR_ACTIVITY_KIND;
}

export function shouldEmitAdvice(input: {
  readonly state: AdvisorGuardState;
  readonly nowMs: number;
  readonly message: string;
  readonly turnRunning: boolean;
}): boolean {
  if (!input.turnRunning) {
    return false;
  }
  // Emptiness is checked on the raw message rather than the normalized form:
  // whether a message is worth sending must not depend on the dedupe strategy.
  if (input.message.trim().length === 0) {
    return false;
  }
  if (input.state.advicesThisTurn >= ADVISOR_MAX_ADVICE_PER_TURN) {
    return false;
  }
  const hasSpoken = input.state.lastAdviceAtMs > 0;
  if (hasSpoken && input.nowMs - input.state.lastAdviceAtMs < ADVISOR_MIN_INTERVAL_MS) {
    return false;
  }
  return !input.state.recentAdvice.includes(normalizeAdviceText(input.message));
}

export function advanceAdvisorGuard(input: {
  readonly state: AdvisorGuardState;
  readonly nowMs: number;
  readonly message: string;
}): AdvisorGuardState {
  return {
    lastAdviceAtMs: input.nowMs,
    advicesThisTurn: input.state.advicesThisTurn + 1,
    recentAdvice: [...input.state.recentAdvice, normalizeAdviceText(input.message)].slice(
      -ADVISOR_DEDUPE_WINDOW,
    ),
  };
}

/** Called at a turn boundary. Only the per-turn allowance resets; see the header. */
export function resetAdvisorGuardForTurn(state: AdvisorGuardState): AdvisorGuardState {
  return { ...state, advicesThisTurn: 0 };
}

/**
 * Collapse an advice message to the form the dedupe window compares on.
 *
 * Two messages that normalize to the same string are treated as the advisor
 * repeating itself, and the later one is dropped.
 *
 * Deliberately conservative: whitespace and case only. It will not catch a model
 * rephrasing the same point ("check for an existing helper" vs "see if a helper
 * already exists"), and that is the intended trade-off, because the two failure
 * modes cost very different amounts:
 *
 *   - a false "duplicate" discards a piece of advice permanently; the user never
 *     sees it, and nothing downstream can recover it.
 *   - a false "distinct" costs one redundant message, and the cooldown plus the
 *     per-turn ceiling already bound how often that can happen.
 *
 * Given that asymmetry, catching rephrasings is not worth the risk of silencing
 * genuine advice. Semantic dedupe would need embeddings and is out of scope.
 */
export function normalizeAdviceText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
