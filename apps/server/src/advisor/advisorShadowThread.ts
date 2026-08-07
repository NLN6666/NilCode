// Identity of the advisor's shadow provider session.
//
// The advisor needs a live provider session, but it does not own a thread and
// must never appear as one. ProviderService keys sessions by ThreadId
// (`startSession(threadId, ...)`) and does not verify that the thread exists -
// the id is a routing and lifecycle key. `ThreadId` is a branded
// TrimmedNonEmptyString with no format constraint, so a derived id is a legal
// key that no real thread can collide with.
//
// The prefix is the isolation boundary. Provider events carry the session's
// thread id, and every one of them reaches ProviderRuntimeIngestion, which would
// journal them and project them against a thread that does not exist - very
// likely tripping runtimeJournalPoisonGate. `isAdvisorShadowThreadId` is what
// lets ingestion drop them at the door.

import { ThreadId } from "@synara/contracts";

export const ADVISOR_SHADOW_THREAD_PREFIX = "advisor:";

/** Session key for the advisor watching `mainThreadId`. Idempotent. */
export function advisorShadowThreadId(mainThreadId: ThreadId): ThreadId {
  if (isAdvisorShadowThreadId(mainThreadId)) {
    return mainThreadId;
  }
  return ThreadId.makeUnsafe(`${ADVISOR_SHADOW_THREAD_PREFIX}${mainThreadId}`);
}

/**
 * Whether an id belongs to an advisor shadow session.
 *
 * Anchored at the start: an ordinary id that merely contains the prefix is a
 * real thread and its events must keep flowing.
 */
export function isAdvisorShadowThreadId(threadId: string): boolean {
  return threadId.startsWith(ADVISOR_SHADOW_THREAD_PREFIX);
}

/** The watched thread behind a shadow id, or null if this is not one. */
export function mainThreadIdFromAdvisorShadow(threadId: string): ThreadId | null {
  if (!isAdvisorShadowThreadId(threadId)) {
    return null;
  }
  const mainThreadId = threadId.slice(ADVISOR_SHADOW_THREAD_PREFIX.length);
  return mainThreadId.length === 0 ? null : ThreadId.makeUnsafe(mainThreadId);
}
