export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;

// How long a real scroll gesture keeps ownership of the viewport. Must outlast the
// programmatic-scroll guard window so a mid-stream scroll away from the tail is never
// mistaken for reflow noise.
export const USER_SCROLL_INTENT_WINDOW_MS = 600;

interface ScrollPosition {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function getScrollContainerDistanceFromBottom(position: ScrollPosition): number {
  const { scrollTop, clientHeight, scrollHeight } = position;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return 0;
  }

  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function isScrollContainerNearBottom(
  position: ScrollPosition,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;

  return getScrollContainerDistanceFromBottom(position) <= threshold;
}

// How long the animated post-send auto-follow may wait for the freshly
// appended tail rows to reach the DOM. The list measures new rows in its own
// state before it flushes the grown content height, so a glide issued in that
// gap gets clamped to the stale bottom: it no-ops and a later unanimated snap
// does the real travel — the visible send flick. The deadline bounds
// degenerate cases (e.g. a transcript change that never grows the scrollable
// area), where gliding immediately is still the best behavior left.
export const ANIMATED_AUTO_FOLLOW_MEASURE_WAIT_MS = 500;

interface AnimatedAutoFollowDelayInput {
  animated: boolean;
  /** The list has a real measured size for the tail row (not an estimate). */
  tailSizeKnown: boolean;
  /** The DOM gained downward travel since the auto-follow was scheduled. */
  tailLaidOut: boolean;
  now: number;
  waitDeadline: number;
}

export function shouldDelayAnimatedAutoFollowScroll(input: AnimatedAutoFollowDelayInput): boolean {
  if (!input.animated) return false;
  if (input.now >= input.waitDeadline) return false;
  return !(input.tailSizeKnown && input.tailLaidOut);
}

interface AtEndReportGuardInput {
  isAtEnd: boolean;
  now: number;
  programmaticScrollUntil: number;
  userScrollIntentUntil: number;
}

/**
 * An explicit scroll-to-end makes the list report `isAtEnd: false` for a frame or two
 * while it reflows, so those reports are normally discarded. A real scroll gesture must
 * outrank that guard: streaming output re-arms the programmatic window continuously, so
 * without this the transcript would never notice the user had scrolled away.
 */
export function shouldIgnoreListAtEndReport(input: AtEndReportGuardInput): boolean {
  if (input.isAtEnd) return false;
  if (input.now < input.userScrollIntentUntil) return false;
  return input.now < input.programmaticScrollUntil;
}
