// Where an accepted advisor note is delivered, and when it may interrupt.
//
// Modelled on Oh My Pi's resolveAdvisorDeliveryChannel and advisor.immuneTurns
// (see README acknowledgements).
//
// The severity axis exists so that most advice never interrupts. Without it the
// only options are "interrupt for everything" and "interrupt for nothing", and
// the vast majority of advice is not worth cutting into a running turn.
//
// The guards below all encode the same principle: the advisor may redirect work
// the model chose to do, but it may never override what the *user* chose. Plan
// mode, a user interrupt, and an idle thread are all user-owned states, so a
// note that lands in one of them becomes a visible card instead of an action.

import type { AdvisorDeliveryChannel, AdvisorSeverity } from "@synara/contracts";

/** Primary turns that must complete after an interrupt before another may land. */
export const ADVISOR_IMMUNE_TURNS = 3;

export interface AdvisorDeliveryContext {
  readonly severity: AdvisorSeverity;
  readonly turnRunning: boolean;
  readonly turnInterrupting: boolean;
  readonly planModeActive: boolean;
  readonly interruptImmune: boolean;
}

export interface AdvisorImmunityState {
  /** Completed-turn count at which the last interrupt landed; null if never. */
  readonly immuneFromCompletedTurns: number | null;
}

export const INITIAL_ADVISOR_IMMUNITY_STATE: AdvisorImmunityState = {
  immuneFromCompletedTurns: null,
};

export function resolveAdvisorDeliveryChannel(
  context: AdvisorDeliveryContext,
): AdvisorDeliveryChannel {
  // Plan mode is the user deciding what happens next. Steering would start work
  // they have not approved.
  if (context.planModeActive) {
    return "preserve";
  }
  // An interrupt in flight is an explicit instruction to stop. The advisor must
  // not undo it by immediately driving a new turn.
  if (context.turnInterrupting) {
    return "preserve";
  }
  if (context.severity === "nit") {
    return "aside";
  }
  // Immunity breaks the tug-of-war: having just interrupted, give the model room
  // to react rather than interrupting its reaction.
  if (context.interruptImmune) {
    return "aside";
  }
  // With no turn running there is nothing to redirect - a steer would start a
  // turn the user never asked for. Only a blocker earns that.
  if (!context.turnRunning && context.severity !== "blocker") {
    return "preserve";
  }
  return "steer";
}

export function markAdvisorInterruptDelivered(completedTurns: number): AdvisorImmunityState {
  return { immuneFromCompletedTurns: completedTurns };
}

export function isAdvisorInterruptImmune(
  state: AdvisorImmunityState,
  completedTurns: number,
): boolean {
  if (state.immuneFromCompletedTurns === null) {
    return false;
  }
  return completedTurns < state.immuneFromCompletedTurns + ADVISOR_IMMUNE_TURNS;
}

/**
 * Whether to drop a note outright because it judges unfinished work.
 *
 * Advice about half-done work is usually about something the model was already
 * about to do; acting on it wastes a turn and reads as micromanagement. Only a
 * blocker is worth raising that early.
 */
export function shouldWithholdAdvice(input: {
  readonly severity: AdvisorSeverity;
  readonly workInProgress: boolean;
}): boolean {
  return input.workInProgress && input.severity !== "blocker";
}
