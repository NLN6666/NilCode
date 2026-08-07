// The two facts about a thread the delivery guard needs that the activity
// stream alone does not carry.
//
// `turnRunning` is deliberately absent: the pipeline already knows it. An
// interim evaluation happens mid-turn and a boundary evaluation happens after
// one settles, so `workInProgress` answers the same question without a second
// source of truth that could disagree with it.
//
// Both flags are folded from domain events rather than read from a snapshot,
// which means a thread that entered plan mode before this process started is
// seen as being in default mode until it changes again.

export interface AdvisorThreadState {
  readonly turnInterrupting: boolean;
  readonly planModeActive: boolean;
}

export const INITIAL_ADVISOR_THREAD_STATE: AdvisorThreadState = {
  turnInterrupting: false,
  planModeActive: false,
};

export type AdvisorThreadStateEvent =
  | { readonly type: "thread.turn-interrupt-requested" }
  | { readonly type: "thread.interaction-mode-set"; readonly interactionMode: string }
  | { readonly type: "thread.activity-appended"; readonly activityKind: string };

function withChange(
  state: AdvisorThreadState,
  change: Partial<AdvisorThreadState>,
): AdvisorThreadState {
  const next = { ...state, ...change };
  return next.turnInterrupting === state.turnInterrupting &&
    next.planModeActive === state.planModeActive
    ? state
    : next;
}

export function foldAdvisorThreadState(
  state: AdvisorThreadState,
  event: AdvisorThreadStateEvent,
): AdvisorThreadState {
  switch (event.type) {
    case "thread.turn-interrupt-requested":
      return withChange(state, { turnInterrupting: true });
    case "thread.interaction-mode-set":
      return withChange(state, { planModeActive: event.interactionMode === "plan" });
    case "thread.activity-appended":
      // A settled turn ends the interrupt window, whether or not the interrupt
      // is what settled it. Plan mode is unaffected: it outlives the turn.
      return event.activityKind === "turn.completed"
        ? withChange(state, { turnInterrupting: false })
        : state;
  }
}
