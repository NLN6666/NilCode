// Keeps the standing "what was asked" that the advisor judges the work against.
//
// The delta buffer answers "what did the agent just do": it is emptied at every
// evaluation and capped by line count. A request has the opposite lifetime - it
// is stated once and stays relevant for every turn that follows, and it is the
// one thing that must never be evicted to make room for tool chatter. So it is
// tracked apart from the delta and rendered as its own block in the prompt.
//
// Without it the advisor was structurally unable to answer two of the three
// questions the system prompt asks of it - whether the agent is drifting from
// what was asked, and whether it is rebuilding something already ruled out -
// because the digest only ever carried the agent's side of the conversation.
//
// Following Oh My Pi, whose advisor is handed constraint context alongside the
// transcript delta rather than the transcript alone.

/** Per message. A request longer than this is stated at the top, not the end. */
export const ADVISOR_REQUEST_MAX_CHARS = 1_200;

/**
 * How many recent user messages ride along.
 *
 * More than one because "continue", "yes, do that" and "now the other one" are
 * ordinary turns, and on their own they say nothing about the goal.
 */
export const ADVISOR_REQUEST_WINDOW = 3;

const TRUNCATION_MARKER = "…";
const ENTRY_MARKER = "[user]";

export interface AdvisorRequestEntry {
  readonly messageId: string;
  readonly text: string;
}

export interface AdvisorRequestState {
  /** Oldest first, newest last. */
  readonly entries: readonly AdvisorRequestEntry[];
}

export const INITIAL_ADVISOR_REQUEST_STATE: AdvisorRequestState = { entries: [] };

export interface AdvisorRequestInput {
  readonly messageId: string;
  readonly role: string;
  readonly text: string;
  readonly dispatchOrigin: string | undefined;
}

/**
 * Fold one sent message into the request window, ignoring what is not a request.
 *
 * Two exclusions matter. Assistant and system messages are the agent's own
 * output, which the digest already covers - and assistant messages are re-sent
 * once per stream delta, so admitting them would rewrite the goal hundreds of
 * times a turn. Agent-dispatched messages are the advisor's own notes coming
 * back around: they arrive with role "user" because that is how the model
 * receives them, and reading them as the goal would let the advisor redefine
 * the task it is meant to be checking against.
 */
export function recordAdvisorRequest(
  state: AdvisorRequestState,
  input: AdvisorRequestInput,
): AdvisorRequestState {
  if (input.role !== "user" || input.dispatchOrigin === "agent") {
    return state;
  }
  const text = truncate(input.text.trim());
  if (text.length === 0) {
    return state;
  }

  // Same id again is an edit or a re-send of one message, not a second request.
  const existing = state.entries.findIndex((entry) => entry.messageId === input.messageId);
  if (existing !== -1) {
    if (state.entries[existing]?.text === text) {
      return state;
    }
    const entries = [...state.entries];
    entries[existing] = { messageId: input.messageId, text };
    return { entries };
  }

  const entries = [...state.entries, { messageId: input.messageId, text }];
  return {
    entries:
      entries.length <= ADVISOR_REQUEST_WINDOW
        ? entries
        : entries.slice(entries.length - ADVISOR_REQUEST_WINDOW),
  };
}

/**
 * Render the window as the block handed to the advisor.
 *
 * Every entry is marked rather than only the newest, so a request spanning
 * several lines cannot be read as two.
 */
export function buildAdvisorRequestContext(state: AdvisorRequestState): string | null {
  if (state.entries.length === 0) {
    return null;
  }
  return state.entries.map((entry) => `${ENTRY_MARKER}\n${entry.text}`).join("\n");
}

function truncate(text: string): string {
  if (text.length <= ADVISOR_REQUEST_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, ADVISOR_REQUEST_MAX_CHARS - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}
