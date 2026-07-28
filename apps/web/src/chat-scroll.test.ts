import { describe, expect, it } from "vitest";

import {
  ANIMATED_AUTO_FOLLOW_MEASURE_WAIT_MS,
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  USER_SCROLL_INTENT_WINDOW_MS,
  getScrollContainerDistanceFromBottom,
  isScrollContainerNearBottom,
  shouldDelayAnimatedAutoFollowScroll,
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

describe("shouldDelayAnimatedAutoFollowScroll", () => {
  it("never delays unanimated re-sticks", () => {
    expect(
      shouldDelayAnimatedAutoFollowScroll({
        animated: false,
        tailSizeKnown: false,
        tailLaidOut: false,
        now: 1_000,
        waitDeadline: 1_500,
      }),
    ).toBe(false);
  });

  it("launches the glide once the tail is measured and in the DOM", () => {
    expect(
      shouldDelayAnimatedAutoFollowScroll({
        animated: true,
        tailSizeKnown: true,
        tailLaidOut: true,
        now: 1_000,
        waitDeadline: 1_500,
      }),
    ).toBe(false);
  });

  it("waits while the appended tail row is still an estimate", () => {
    expect(
      shouldDelayAnimatedAutoFollowScroll({
        animated: true,
        tailSizeKnown: false,
        tailLaidOut: true,
        now: 1_000,
        waitDeadline: 1_500,
      }),
    ).toBe(true);
  });

  it("waits while the grown content has not reached the DOM", () => {
    expect(
      shouldDelayAnimatedAutoFollowScroll({
        animated: true,
        tailSizeKnown: true,
        tailLaidOut: false,
        now: 1_000,
        waitDeadline: 1_500,
      }),
    ).toBe(true);
  });

  it("gives up once the wait deadline passes", () => {
    expect(
      shouldDelayAnimatedAutoFollowScroll({
        animated: true,
        tailSizeKnown: false,
        tailLaidOut: false,
        now: 1_000 + ANIMATED_AUTO_FOLLOW_MEASURE_WAIT_MS,
        waitDeadline: 1_000 + ANIMATED_AUTO_FOLLOW_MEASURE_WAIT_MS,
      }),
    ).toBe(false);
  });
});
