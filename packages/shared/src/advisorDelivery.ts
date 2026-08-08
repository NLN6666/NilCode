// The id convention that lets the transcript recognise its own advisor turns.
//
// Delivering a note means dispatching a real turn, so the note becomes an
// ordinary role "user" message in the thread - that is how the model receives
// it. The transcript must not render it as one: the same sentence already
// appears as an advisor card, and a user bubble attributes the advisor's words
// to the person.
//
// `dispatchOrigin: "agent"` cannot carry that distinction, because automation
// runs and agent-gateway tools dispatch under the same origin. The id can: the
// server mints it, so a prefix here is a fact about who created the turn rather
// than a guess about its content. Both sides go through this module so the
// writer and the reader cannot drift apart.

export const ADVISOR_DELIVERY_ID_PREFIX = "advisor:";

/**
 * Mint one id for a piece of advisor delivery.
 *
 * `marker` makes the id unique per note; `part` distinguishes the command, the
 * activity and the message that a single delivery creates.
 */
export function advisorDeliveryId(marker: string, part: string): string {
  return `${ADVISOR_DELIVERY_ID_PREFIX}${marker}:${part}`;
}

/** Whether a message in the transcript is the advisor's own delivered note. */
export function isAdvisorDeliveredMessageId(messageId: string): boolean {
  return messageId.startsWith(ADVISOR_DELIVERY_ID_PREFIX);
}
