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
