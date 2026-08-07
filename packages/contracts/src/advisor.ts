import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { DEFAULT_MODEL_BY_PROVIDER } from "./model";
import { ClaudeModelSelection, CodexModelSelection } from "./orchestration";

/**
 * Providers an advisor may run on.
 *
 * Deliberately narrower than `ModelSelection`. Only Codex and Claude report
 * `supportsNativeTurnSteering`; on every other provider the decider turns a
 * steer into "interrupt the running turn and requeue", which is destructive
 * rather than advisory. Narrowing the schema makes that configuration
 * unrepresentable instead of something a runtime check has to catch.
 */
export const AdvisorModelSelection = Schema.Union([CodexModelSelection, ClaudeModelSelection]);
export type AdvisorModelSelection = typeof AdvisorModelSelection.Type;

export const AdvisorServerSettings = Schema.Struct({
  // Opt-in: advisor mode spends a second model's tokens on every turn, so an
  // install that never configures it must never start paying for it.
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  modelSelection: AdvisorModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_MODEL_BY_PROVIDER.codex,
    })),
  ),
});
export type AdvisorServerSettings = typeof AdvisorServerSettings.Type;

export const DEFAULT_ADVISOR_SETTINGS: AdvisorServerSettings = Schema.decodeSync(
  AdvisorServerSettings,
)({});

/**
 * How much of the main model's attention a note is worth.
 *
 * Modelled on Oh My Pi's advisor (see README acknowledgements). Without a
 * severity axis the only choices are "interrupt for everything" and "interrupt
 * for nothing", and the vast majority of advice does not deserve an interrupt.
 *
 * Ordered weakest to strongest; the order is load-bearing, since a repeated note
 * is only allowed through when it escalates.
 */
export const ADVISOR_SEVERITIES = ["nit", "concern", "blocker"] as const;

export const AdvisorSeverity = Schema.Literals(ADVISOR_SEVERITIES);
export type AdvisorSeverity = typeof AdvisorSeverity.Type;

/**
 * Where an accepted note is delivered.
 *
 * Maps onto Synara's existing dispatch modes rather than inventing a channel:
 *   - aside    -> dispatchMode "queue", folded in at the next turn boundary
 *   - steer    -> dispatchMode "steer", interrupts the live turn
 *   - preserve -> no dispatch at all; recorded as a visible activity card only
 */
export const AdvisorDeliveryChannel = Schema.Literals(["aside", "steer", "preserve"]);
export type AdvisorDeliveryChannel = typeof AdvisorDeliveryChannel.Type;

/**
 * The only shape an advisor evaluation may return.
 *
 * Silence is first-class: an advisor forced to say something on every evaluation
 * becomes noise and burns its allowance. Advice must carry a non-empty message
 * and a severity, and output that does not fit this shape is discarded rather
 * than salvaged - a lenient parse would let the model bypass the guard rules by
 * emitting free text.
 */
export const AdvisorVerdict = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal("silent") }),
  Schema.Struct({
    verdict: Schema.Literal("advise"),
    severity: AdvisorSeverity,
    message: TrimmedNonEmptyString,
  }),
]);
export type AdvisorVerdict = typeof AdvisorVerdict.Type;
