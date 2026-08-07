// Projects one thread activity onto the single line the advisor session is fed.
//
// The advisor gets one line per activity for a whole turn, so this module is the
// only thing standing between a busy turn and a blown advisor context. Two jobs:
//
//   - drop what cannot inform a judgement. Housekeeping activity (context window
//     bookkeeping, rate-limit chatter, compaction) says nothing about whether the
//     model is on track, and every line spent on it is context unavailable to
//     real work. Errors are never dropped - a failure is the strongest drift
//     signal there is.
//   - bound what survives. A single activity carries a payload that the runtime
//     projection already capped at 16,000 characters, which is far past what one
//     line of advisor context is worth.
//
// Input is a structural subset of OrchestrationThreadActivity rather than the
// contract type, so this stays a pure string function with no schema dependency.

export const ADVISOR_DIGEST_MAX_CHARS = 200;

const TRUNCATION_MARKER = "…";

const HOUSEKEEPING_KINDS: ReadonlySet<string> = new Set([
  "context-window.configured",
  "context-window.updated",
  "context-compaction",
  "account.rate-limits.updated",
  "account.rate-limited",
]);

export interface AdvisorDigestInput {
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
}

/** Returns null when the activity is not worth a line of advisor context. */
export function digestActivity(activity: AdvisorDigestInput): string | null {
  if (HOUSEKEEPING_KINDS.has(activity.kind)) {
    return null;
  }
  const summary = activity.summary.trim();
  if (summary.length === 0) {
    return null;
  }
  const detail = readDetail(activity.payload);
  const line =
    detail === null ? `[${activity.kind}] ${summary}` : `[${activity.kind}] ${summary} — ${detail}`;
  return truncateLine(line);
}

/**
 * Activity payloads are `Schema.Json`, so `detail` is whatever the projection
 * put there. Anything that is not readable text is dropped rather than
 * stringified - a serialized object costs the same context as prose and tells
 * the advisor far less.
 */
function readDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const detail = (payload as { readonly detail?: unknown }).detail;
  if (typeof detail !== "string") {
    return null;
  }
  const trimmed = detail.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function truncateLine(line: string): string {
  if (line.length <= ADVISOR_DIGEST_MAX_CHARS) {
    return line;
  }
  return `${line.slice(0, ADVISOR_DIGEST_MAX_CHARS - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}
