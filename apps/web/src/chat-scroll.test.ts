import { describe, expect, it } from "vitest";

import {
  AUTO_FOLLOW_GLIDE_IDLE_WAIT_MS,
  AUTO_FOLLOW_GLIDE_MAX_DURATION_MS,
  AUTO_FOLLOW_GLIDE_MIN_STEP_PX,
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  USER_SCROLL_INTENT_WINDOW_MS,
  computeAutoFollowGlideStep,
  getScrollContainerDistanceFromBottom,
  isScrollContainerNearBottom,
  resolveAutoFollowGlidePhase,
  shouldIgnoreListAtEndReport,
} from "./chat-scroll";

describe("getScrollContainerDistanceFromBottom", () => {
  it("returns the remaining distance when the viewport is above the bottom", () => {
    expect(
      getScrollContainerDistanceFromBottom({
        scrollTop: 520,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(80);
  });

  it("clamps negative distances and non-finite values", () => {
    expect(
      getScrollContainerDistanceFromBottom({
        scrollTop: 620,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(0);
    expect(
      getScrollContainerDistanceFromBottom({
        scrollTop: Number.NaN,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(0);
  });
});
describe("isScrollContainerNearBottom", () => {
  it("returns true when already at bottom", () => {
    expect(
      isScrollContainerNearBottom({
        scrollTop: 600,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(true);
  });

  it("returns true when within the auto-scroll threshold", () => {
    expect(
      isScrollContainerNearBottom({
        scrollTop: 540,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(true);
  });

  it("returns false when the user is meaningfully above the bottom", () => {
    expect(
      isScrollContainerNearBottom({
        scrollTop: 520,
        clientHeight: 400,
        scrollHeight: 1_000,
      }),
    ).toBe(false);
  });

  it("clamps negative thresholds to zero", () => {
    expect(
      isScrollContainerNearBottom(
        {
          scrollTop: 539,
          clientHeight: 400,
          scrollHeight: 1_000,
        },
        -1,
      ),
    ).toBe(false);
  });

  it("falls back to the default threshold for non-finite values", () => {
    expect(
      isScrollContainerNearBottom(
        {
          scrollTop: 540,
          clientHeight: 400,
          scrollHeight: 1_000,
        },
        Number.NaN,
      ),
    ).toBe(true);
    expect(AUTO_SCROLL_BOTTOM_THRESHOLD_PX).toBe(64);
  });
});

describe("shouldIgnoreListAtEndReport", () => {
  it("never discards a report that the viewport reached the end", () => {
    expect(
      shouldIgnoreListAtEndReport({
        isAtEnd: true,
        now: 1_000,
        programmaticScrollUntil: 1_200,
        userScrollIntentUntil: 1_500,
      }),
    ).toBe(false);
  });

  it("discards reflow noise that follows a programmatic scroll", () => {
    expect(
      shouldIgnoreListAtEndReport({
        isAtEnd: false,
        now: 1_000,
        programmaticScrollUntil: 1_200,
        userScrollIntentUntil: 0,
      }),
    ).toBe(true);
  });

  it("keeps a scroll gesture that lands inside the programmatic window", () => {
    expect(
      shouldIgnoreListAtEndReport({
        isAtEnd: false,
        now: 1_000,
        programmaticScrollUntil: 1_200,
        userScrollIntentUntil: 1_500,
      }),
    ).toBe(false);
  });

  it("stops protecting the gesture once its window lapses", () => {
    expect(
      shouldIgnoreListAtEndReport({
        isAtEnd: false,
        now: 1_600,
        programmaticScrollUntil: 1_800,
        userScrollIntentUntil: 1_500,
      }),
    ).toBe(true);
  });

  it("keeps reports once both windows have lapsed", () => {
    expect(
      shouldIgnoreListAtEndReport({
        isAtEnd: false,
        now: 2_000,
        programmaticScrollUntil: 1_200,
        userScrollIntentUntil: 1_500,
      }),
    ).toBe(false);
  });

  it("outlasts the programmatic guard so streaming cannot starve it", () => {
    expect(USER_SCROLL_INTENT_WINDOW_MS).toBeGreaterThan(200);
  });
});

describe("computeAutoFollowGlideStep", () => {
  it("returns zero when there is no distance left to travel", () => {
    expect(computeAutoFollowGlideStep(0, 16.7)).toBe(0);
    expect(computeAutoFollowGlideStep(-40, 16.7)).toBe(0);
    expect(computeAutoFollowGlideStep(Number.NaN, 16.7)).toBe(0);
  });

  it("never overshoots the remaining distance", () => {
    expect(computeAutoFollowGlideStep(5, 16.7)).toBe(5);
    expect(computeAutoFollowGlideStep(2, 1_000)).toBe(2);
  });

  it("eases proportionally to the remaining distance", () => {
    const nearStep = computeAutoFollowGlideStep(100, 16.7);
    const farStep = computeAutoFollowGlideStep(1_000, 16.7);
    expect(farStep).toBeGreaterThan(nearStep);
    expect(farStep).toBeLessThan(1_000);
  });

  it("keeps a minimum step so the asymptotic tail stays bounded", () => {
    expect(computeAutoFollowGlideStep(1_000_000, 16.7)).toBeGreaterThanOrEqual(
      AUTO_FOLLOW_GLIDE_MIN_STEP_PX,
    );
    expect(computeAutoFollowGlideStep(50, 16.7)).toBeGreaterThanOrEqual(
      AUTO_FOLLOW_GLIDE_MIN_STEP_PX,
    );
  });

  it("scales with frame time so slower frames travel farther", () => {
    const oneFrame = computeAutoFollowGlideStep(1_000, 16.7);
    const doubleFrame = computeAutoFollowGlideStep(1_000, 33.4);
    expect(doubleFrame).toBeGreaterThan(oneFrame);
  });

  it("falls back to a reference frame time for invalid deltas", () => {
    expect(computeAutoFollowGlideStep(1_000, Number.NaN)).toBe(
      computeAutoFollowGlideStep(1_000, 16.7),
    );
    expect(computeAutoFollowGlideStep(1_000, 0)).toBe(computeAutoFollowGlideStep(1_000, 16.7));
  });
});

describe("resolveAutoFollowGlidePhase", () => {
  it("keeps moving while there is distance left", () => {
    expect(
      resolveAutoFollowGlidePhase({
        distancePx: 120,
        hasTraveled: true,
        now: 1_100,
        startedAt: 1_000,
      }),
    ).toBe("moving");
  });

  it("waits at the bottom until the appended tail grows the scrollable area", () => {
    expect(
      resolveAutoFollowGlidePhase({
        distancePx: 0,
        hasTraveled: false,
        now: 1_100,
        startedAt: 1_000,
      }),
    ).toBe("waiting");
  });

  it("settles once the traveled glide reaches the bottom", () => {
    expect(
      resolveAutoFollowGlidePhase({
        distancePx: 0,
        hasTraveled: true,
        now: 1_100,
        startedAt: 1_000,
      }),
    ).toBe("settled");
  });

  it("gives up waiting when the transcript change never grows the area", () => {
    expect(
      resolveAutoFollowGlidePhase({
        distancePx: 0,
        hasTraveled: false,
        now: 1_000 + AUTO_FOLLOW_GLIDE_IDLE_WAIT_MS,
        startedAt: 1_000,
      }),
    ).toBe("settled");
  });

  it("hard-stops at the maximum duration even with distance left", () => {
    expect(
      resolveAutoFollowGlidePhase({
        distancePx: 500,
        hasTraveled: true,
        now: 1_000 + AUTO_FOLLOW_GLIDE_MAX_DURATION_MS,
        startedAt: 1_000,
      }),
    ).toBe("settled");
  });
});
