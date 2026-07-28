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

// The post-send glide eases toward the *live* bottom re-read every frame instead
// of a target precomputed once: the virtualized list's estimated content height
// oscillates while freshly appended rows get measured, and a fixed-target smooth
// scroll first overshoots the inflated estimate and then gets clamped back when
// the measurement lands — the visible send bounce.
export const AUTO_FOLLOW_GLIDE_TIME_CONSTANT_MS = 90;
export const AUTO_FOLLOW_GLIDE_MIN_STEP_PX = 12;
export const AUTO_FOLLOW_GLIDE_SETTLE_EPSILON_PX = 1;
// How long the glide keeps polling for downward travel before giving up when a
// transcript change never grows the scrollable area.
export const AUTO_FOLLOW_GLIDE_IDLE_WAIT_MS = 500;
// Absolute bound so a pathological layout loop cannot hold the glide forever.
export const AUTO_FOLLOW_GLIDE_MAX_DURATION_MS = 1500;

const REFERENCE_FRAME_DT_MS = 16.7;
// A heavy commit can delay the first glide frame by far more than a frame;
// clamping to ~2 frames keeps that first step from swallowing the whole travel.
const MAX_GLIDE_FRAME_DT_MS = 34;

/**
 * Distance to travel this frame. Exponential ease-out against the remaining
 * distance keeps the motion continuous when the target moves mid-glide; the
 * minimum step (scaled by frame time) bounds the asymptotic tail.
 */
export function computeAutoFollowGlideStep(distancePx: number, frameDtMs: number): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0) return 0;
  const dt =
    Number.isFinite(frameDtMs) && frameDtMs > 0
      ? Math.min(frameDtMs, MAX_GLIDE_FRAME_DT_MS)
      : REFERENCE_FRAME_DT_MS;
  const fraction = 1 - Math.exp(-dt / AUTO_FOLLOW_GLIDE_TIME_CONSTANT_MS);
  const minStep = AUTO_FOLLOW_GLIDE_MIN_STEP_PX * (dt / REFERENCE_FRAME_DT_MS);
  return Math.min(distancePx, Math.max(minStep, distancePx * fraction));
}

export type AutoFollowGlidePhase = "waiting" | "moving" | "settled";

interface AutoFollowGlidePhaseInput {
  distancePx: number;
  /** The glide already moved the viewport at least once. */
  hasTraveled: boolean;
  now: number;
  startedAt: number;
}

export function resolveAutoFollowGlidePhase(
  input: AutoFollowGlidePhaseInput,
): AutoFollowGlidePhase {
  const elapsed = input.now - input.startedAt;
  if (elapsed >= AUTO_FOLLOW_GLIDE_MAX_DURATION_MS) return "settled";
  if (input.distancePx > AUTO_FOLLOW_GLIDE_SETTLE_EPSILON_PX) return "moving";
  if (input.hasTraveled) return "settled";
  return elapsed >= AUTO_FOLLOW_GLIDE_IDLE_WAIT_MS ? "settled" : "waiting";
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
