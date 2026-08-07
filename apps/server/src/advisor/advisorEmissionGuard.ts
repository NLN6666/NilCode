// What an advisor is allowed to say, before anything decides where to say it.
//
// Modelled on Oh My Pi's AdvisorEmissionGuard (see README acknowledgements).
// Four filters, in the order they matter:
//
//   - one note per update. This is the rate limit that actually fits the design:
//     it is tied to the advisor being asked, not to wall clock. A time-based
//     cooldown is meaningless inside a slow turn and too coarse inside a fast
//     one.
//   - content-free phrases. "stop", "lgtm", "nothing to add" - the advisor's
//     most common failure mode when it has nothing real to report. They cost the
//     main model attention and carry no reason.
//   - dedupe on normalized text. Normalization collapses punctuation and case so
//     "Stop.", "*Stop*" and "  stop  " share one key; without it the dedupe is
//     bypassed by punctuation alone.
//   - escalation is the one way back through the dedupe. The advisor already
//     said this and the situation got worse, which is worth interrupting for.
//
// State is owned by the caller and cleared whenever the advisor session resets.

import { ADVISOR_SEVERITIES, type AdvisorSeverity } from "@synara/contracts";

export const ADVISOR_DEDUPE_HISTORY_LIMIT = 4096;

/**
 * Notes that assert something without giving a reason. Compared after
 * normalization, so punctuation and casing variants are covered.
 */
const CONTENT_FREE_PHRASES: ReadonlySet<string> = new Set([
  "stop",
  "done",
  "complete",
  "completed",
  "finished",
  "lgtm",
  "ok",
  "okay",
  "fine",
  "good",
  "looks good",
  "looks good to me",
  "no issue",
  "no issues",
  "no issue continue",
  "no issues continue",
  "nothing to add",
  "nothing to report",
  "continue",
  "carry on",
  "proceed",
  "agreed",
]);

export interface AdvisorEmissionState {
  /** Normalized note text to the strongest severity already accepted for it. */
  readonly accepted: ReadonlyMap<string, AdvisorSeverity>;
  readonly acceptedThisUpdate: boolean;
}

export const INITIAL_ADVISOR_EMISSION_STATE: AdvisorEmissionState = {
  accepted: new Map(),
  acceptedThisUpdate: false,
};

/**
 * Collapse a note onto its dedupe key: NFKC, lowercase, every run of
 * non-alphanumerics to a single space, trimmed.
 */
export function normalizeAdviceText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function severityRank(severity: AdvisorSeverity): number {
  return ADVISOR_SEVERITIES.indexOf(severity);
}

export function shouldAcceptAdvisorNote(input: {
  readonly state: AdvisorEmissionState;
  readonly severity: AdvisorSeverity;
  readonly message: string;
}): boolean {
  if (input.state.acceptedThisUpdate) {
    return false;
  }
  const key = normalizeAdviceText(input.message);
  if (key.length === 0 || CONTENT_FREE_PHRASES.has(key)) {
    return false;
  }
  const previous = input.state.accepted.get(key);
  return previous === undefined || severityRank(input.severity) > severityRank(previous);
}

export function acceptAdvisorNote(input: {
  readonly state: AdvisorEmissionState;
  readonly severity: AdvisorSeverity;
  readonly message: string;
}): AdvisorEmissionState {
  const key = normalizeAdviceText(input.message);
  const accepted = new Map(input.state.accepted);
  // Re-insert so the map's insertion order stays a recency order, which is what
  // the eviction below relies on.
  accepted.delete(key);
  accepted.set(key, input.severity);
  while (accepted.size > ADVISOR_DEDUPE_HISTORY_LIMIT) {
    const oldest = accepted.keys().next();
    if (oldest.done === true) {
      break;
    }
    accepted.delete(oldest.value);
  }
  return { accepted, acceptedThisUpdate: true };
}

/** Called when the advisor is asked again; spends a fresh one-note allowance. */
export function beginAdvisorUpdate(state: AdvisorEmissionState): AdvisorEmissionState {
  return { ...state, acceptedThisUpdate: false };
}
