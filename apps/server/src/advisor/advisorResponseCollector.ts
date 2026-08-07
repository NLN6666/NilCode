// Reassembles the advisor's reply from its shadow session's runtime events.
//
// The shadow session is deliberately excluded from runtime ingestion, so there
// is no projection to read the reply out of - the events are all there is. This
// fold is the whole reader, kept pure so the wire handling can be tested
// without a live provider.
//
// Only completed assistant messages count. Reasoning is the model's private
// trace and must never be folded in: an advisor that thinks out loud about
// {"verdict":"advise"} before deciding to stay silent would otherwise be parsed
// as having spoken.

export type AdvisorResponseOutcome = "pending" | "completed" | "failed";

export interface AdvisorResponseState {
  readonly text: string;
  readonly outcome: AdvisorResponseOutcome;
}

export const EMPTY_ADVISOR_RESPONSE: AdvisorResponseState = { text: "", outcome: "pending" };

/** Structural subset of ProviderRuntimeEvent - keeps this module schema-free. */
export interface AdvisorResponseEventInput {
  readonly type: string;
  readonly payload?: unknown;
}

const FAILURE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "turn.aborted",
  "runtime.error",
  "session.exited",
]);

function assistantDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as { readonly itemType?: unknown; readonly detail?: unknown };
  if (record.itemType !== "assistant_message" || typeof record.detail !== "string") {
    return null;
  }
  const detail = record.detail.trim();
  return detail.length > 0 ? detail : null;
}

export function foldAdvisorResponseEvent(
  state: AdvisorResponseState,
  event: AdvisorResponseEventInput,
): AdvisorResponseState {
  // The stream is shared, so a late event can arrive after the caller has
  // stopped reading. A settled response is final.
  if (state.outcome !== "pending") {
    return state;
  }
  if (event.type === "turn.completed") {
    return { ...state, outcome: "completed" };
  }
  if (FAILURE_EVENT_TYPES.has(event.type)) {
    return { ...state, outcome: "failed" };
  }
  if (event.type !== "item.completed") {
    return state;
  }
  const detail = assistantDetail(event.payload);
  if (detail === null) {
    return state;
  }
  return { ...state, text: state.text.length > 0 ? `${state.text}\n${detail}` : detail };
}
