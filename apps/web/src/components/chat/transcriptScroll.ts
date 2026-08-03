import { type LegendListRef } from "@legendapp/list/react";
import { type RefObject } from "react";

/**
 * The element that actually scrolls the transcript, resolved through the list
 * handle. Module-level and taking the ref object (never a `.current` read at the
 * call site) so React Compiler infers the ref itself as the dependency instead of
 * an undeclarable `ref.current` — see the note on MessagesTimeline's imperative
 * list helpers.
 */
export function getTranscriptScrollContainer(
  listRef: RefObject<LegendListRef | null>,
): HTMLElement | null {
  const node: unknown = listRef.current?.getScrollableNode?.();
  return node instanceof HTMLElement ? node : null;
}

/**
 * Put the viewport at the transcript's live edge, in this frame.
 *
 * Deliberately a direct `scrollTop` write instead of LegendList's
 * `scrollToEnd()`, which is a *request* rather than an action: it parks in
 * `state.pendingScrollToEnd`, waits for a LegendList commit to drain it, and then
 * waits again in `runWhenReady` for the list to stop settling — firing
 * unconditionally once its 800ms timeout expires. A scroll that lands up to a
 * second after it was asked for has outlived the condition that justified it: by
 * then the reader may have scrolled into scrollback, or the growth that triggered
 * it may have been non-message chrome that must never re-stick the viewport. The
 * queue also sits outside every ownership guard the transcript maintains, so a
 * caller cannot revoke a request it already made. Writing `scrollTop` keeps the
 * decision and its effect in the same frame, which makes the caller's ownership
 * check the one that decides. Accuracy while the list is still settling comes
 * from re-pinning on a bounded schedule, not from waiting inside the list.
 */
export function pinTranscriptToEnd(container: HTMLElement): void {
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
}

/** How long the just-sent message takes to glide up to its anchored position. */
export const ANCHOR_SLIDE_DURATION_MS = 320;

/**
 * Where the anchored message sits, measured from the viewport top, this far into
 * its slide. The animation is expressed in the message's own visible offset —
 * not in scrollTop — because that is the thing the reader watches move, and it
 * stays correct while the transcript's scroll geometry changes underneath it
 * (the list reserving end space, rows above settling from estimated to measured
 * heights). The caller converts the offset back into a scroll position against
 * freshly measured layout each frame.
 *
 * Cubic ease-out: quick departure, soft arrival, and — unlike an exponential
 * approach — it lands exactly at `toPx` at a known time instead of trailing off
 * asymptotically.
 */
export function anchorSlideOffsetPx(input: {
  readonly fromPx: number;
  readonly toPx: number;
  readonly elapsedMs: number;
  readonly durationMs?: number;
}): number {
  const durationMs = input.durationMs ?? ANCHOR_SLIDE_DURATION_MS;
  if (!(durationMs > 0) || input.elapsedMs >= durationMs) {
    return input.toPx;
  }
  const progress = Math.max(0, input.elapsedMs) / durationMs;
  const eased = 1 - (1 - progress) ** 3;
  return input.fromPx + (input.toPx - input.fromPx) * eased;
}
