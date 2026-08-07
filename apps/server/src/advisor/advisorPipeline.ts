// The advisor decision pipeline: everything the reactor decides, as pure state.
//
// The five guard modules each answer one question; this composes them into the
// two transitions a reactor actually needs, so that the Effect layer is left
// with nothing but I/O - subscribe, call the model, dispatch. Every branch below
// is therefore reachable in a millisecond-scale unit test with no provider.
//
// Evaluation cadence follows Oh My Pi: the advisor is asked at a turn boundary
// with everything since the last ask, not once per event. Cost is O(turns), not
// O(events), and a half-finished tool call is not enough to judge anything.
//
// One deliberate departure: a long turn also triggers an interim evaluation once
// enough has accumulated. Waiting only for the boundary would leave the advisor
// silent for the whole of a ten-minute turn, which is not "watching live". Those
// evaluations are marked in progress, and `shouldWithholdAdvice` then lets only
// a blocker through - so the advisor gains latency without gaining the right to
// nitpick unfinished work.

import type { AdvisorDeliveryChannel, AdvisorSeverity, AdvisorVerdict } from "@synara/contracts";

import {
  type AdvisorDeltaState,
  INITIAL_ADVISOR_DELTA_STATE,
  appendAdvisorDeltaLine,
  takeAdvisorDelta,
} from "./advisorDeltaBuffer.ts";
import {
  type AdvisorImmunityState,
  INITIAL_ADVISOR_IMMUNITY_STATE,
  isAdvisorInterruptImmune,
  markAdvisorInterruptDelivered,
  resolveAdvisorDeliveryChannel,
  shouldWithholdAdvice,
} from "./advisorDelivery.ts";
import {
  type AdvisorEmissionState,
  INITIAL_ADVISOR_EMISSION_STATE,
  acceptAdvisorNote,
  beginAdvisorUpdate,
  shouldAcceptAdvisorNote,
} from "./advisorEmissionGuard.ts";
import { type AdvisorDigestInput, digestActivity } from "./advisorEventDigest.ts";
import {
  type AdvisorQuarantineState,
  INITIAL_ADVISOR_QUARANTINE_STATE,
  isAdvisorOutputUnsafe,
  recordAdvisorQuarantine,
  recordAdvisorTurnAccepted,
  shouldSurfaceAdvisorQuarantine,
} from "./advisorQuarantine.ts";

/** Buffered lines that force an interim evaluation before the turn settles. */
export const ADVISOR_INTERIM_EVALUATION_LINES = 50;

/** Activity kind marking a settled primary turn; Synara has no such domain event. */
const TURN_BOUNDARY_ACTIVITY_KIND = "turn.completed";

export interface AdvisorPipelineState {
  readonly delta: AdvisorDeltaState;
  readonly emission: AdvisorEmissionState;
  readonly immunity: AdvisorImmunityState;
  readonly quarantine: AdvisorQuarantineState;
  readonly completedTurns: number;
}

export const INITIAL_ADVISOR_PIPELINE_STATE: AdvisorPipelineState = {
  delta: INITIAL_ADVISOR_DELTA_STATE,
  emission: INITIAL_ADVISOR_EMISSION_STATE,
  immunity: INITIAL_ADVISOR_IMMUNITY_STATE,
  quarantine: INITIAL_ADVISOR_QUARANTINE_STATE,
  completedTurns: 0,
};

export interface AdvisorEvaluationRequest {
  readonly delta: string;
  readonly workInProgress: boolean;
}

export interface AdvisorAction {
  readonly channel: AdvisorDeliveryChannel;
  readonly severity: AdvisorSeverity;
  readonly message: string;
}

/**
 * Fold one activity into the pipeline.
 *
 * Returns a non-null `evaluation` exactly when the advisor should be asked.
 */
export function ingestAdvisorActivity(input: {
  readonly state: AdvisorPipelineState;
  readonly activity: AdvisorDigestInput;
}): {
  readonly state: AdvisorPipelineState;
  readonly evaluation: AdvisorEvaluationRequest | null;
} {
  const { state, activity } = input;
  const isBoundary = activity.kind === TURN_BOUNDARY_ACTIVITY_KIND;
  // The boundary marker is a signal, not content. The advisor is being asked
  // about what the model did, not about the fact that a turn ended - and
  // `workInProgress: false` already carries "this is the complete picture".
  // Folding it in would also make an idle turn look like it had activity.
  const line = isBoundary ? null : digestActivity(activity);
  const delta = line === null ? state.delta : appendAdvisorDeltaLine(state.delta, line);
  const completedTurns = isBoundary ? state.completedTurns + 1 : state.completedTurns;

  const workInProgress = !isBoundary;
  const shouldEvaluate = isBoundary || delta.lines.length >= ADVISOR_INTERIM_EVALUATION_LINES;
  if (!shouldEvaluate) {
    return { state: { ...state, delta, completedTurns }, evaluation: null };
  }

  // A null delta means nothing worth reviewing accumulated; asking the advisor
  // to read an empty transcript is pure cost.
  const taken = takeAdvisorDelta(delta, { workInProgress });
  if (taken.delta === null) {
    return { state: { ...state, delta: taken.state, completedTurns }, evaluation: null };
  }
  return {
    state: {
      ...state,
      delta: taken.state,
      // Each ask spends a fresh one-note allowance.
      emission: beginAdvisorUpdate(state.emission),
      completedTurns,
    },
    evaluation: { delta: taken.delta, workInProgress },
  };
}

/**
 * Turn an advisor verdict into a delivery, applying every guard in order.
 *
 * A null action means the note was dropped - quarantined, withheld, or refused
 * by the emission guard. The state still advances, because those refusals are
 * exactly what the counters exist to remember.
 */
export function resolveAdvisorAction(input: {
  readonly state: AdvisorPipelineState;
  readonly verdict: AdvisorVerdict;
  readonly sourceText: string;
  readonly workInProgress: boolean;
  readonly turnRunning: boolean;
  readonly turnInterrupting: boolean;
  readonly planModeActive: boolean;
}): {
  readonly state: AdvisorPipelineState;
  readonly action: AdvisorAction | null;
  readonly quarantined: boolean;
  readonly surfaceQuarantineWarning: boolean;
} {
  const { state, verdict } = input;
  const silent = {
    state,
    action: null,
    quarantined: false,
    surfaceQuarantineWarning: false,
  } as const;

  if (verdict.verdict === "silent") {
    return {
      ...silent,
      state: { ...state, quarantine: recordAdvisorTurnAccepted(state.quarantine) },
    };
  }

  // Safety first: unsafe output is discarded whole, before any guard that could
  // let part of it through.
  if (isAdvisorOutputUnsafe({ message: verdict.message, sourceText: input.sourceText })) {
    const quarantine = recordAdvisorQuarantine(state.quarantine);
    return {
      state: { ...state, quarantine },
      action: null,
      quarantined: true,
      surfaceQuarantineWarning: shouldSurfaceAdvisorQuarantine(quarantine),
    };
  }

  const accepted = { ...state, quarantine: recordAdvisorTurnAccepted(state.quarantine) };

  if (shouldWithholdAdvice({ severity: verdict.severity, workInProgress: input.workInProgress })) {
    return { ...silent, state: accepted };
  }

  if (
    !shouldAcceptAdvisorNote({
      state: accepted.emission,
      severity: verdict.severity,
      message: verdict.message,
    })
  ) {
    return { ...silent, state: accepted };
  }

  const channel = resolveAdvisorDeliveryChannel({
    severity: verdict.severity,
    turnRunning: input.turnRunning,
    turnInterrupting: input.turnInterrupting,
    planModeActive: input.planModeActive,
    interruptImmune: isAdvisorInterruptImmune(accepted.immunity, accepted.completedTurns),
  });

  return {
    state: {
      ...accepted,
      emission: acceptAdvisorNote({
        state: accepted.emission,
        severity: verdict.severity,
        message: verdict.message,
      }),
      // Only a delivered interrupt starts the immunity window - an aside or a
      // preserved card did not consume the model's attention.
      immunity:
        channel === "steer"
          ? markAdvisorInterruptDelivered(accepted.completedTurns)
          : accepted.immunity,
    },
    action: { channel, severity: verdict.severity, message: verdict.message },
    quarantined: false,
    surfaceQuarantineWarning: false,
  };
}
