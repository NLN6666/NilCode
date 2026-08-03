import { describe, expect, it } from "vitest";

import { ANCHOR_SLIDE_DURATION_MS, anchorSlideOffsetPx } from "./transcriptScroll";

describe("anchorSlideOffsetPx", () => {
  const glide = (elapsedMs: number) => anchorSlideOffsetPx({ fromPx: 900, toPx: 20, elapsedMs });

  it("starts at the sent message's original offset and lands exactly on the anchor", () => {
    expect(glide(0)).toBe(900);
    expect(glide(ANCHOR_SLIDE_DURATION_MS)).toBe(20);
  });

  it("moves in one direction only, so the message never bounces on its way up", () => {
    let previous = glide(0);
    for (let elapsedMs = 8; elapsedMs <= ANCHOR_SLIDE_DURATION_MS; elapsedMs += 8) {
      const next = glide(elapsedMs);
      expect(next).toBeLessThanOrEqual(previous);
      expect(next).toBeGreaterThanOrEqual(20);
      previous = next;
    }
    expect(previous).toBe(20);
  });

  it("eases out: it covers more ground early than late", () => {
    const firstHalf = glide(0) - glide(ANCHOR_SLIDE_DURATION_MS / 2);
    const secondHalf = glide(ANCHOR_SLIDE_DURATION_MS / 2) - glide(ANCHOR_SLIDE_DURATION_MS);
    expect(firstHalf).toBeGreaterThan(secondHalf);
    expect(glide(ANCHOR_SLIDE_DURATION_MS / 2)).toBeCloseTo(900 - 880 * (1 - 0.5 ** 3), 6);
  });

  it("holds the anchor once the slide is over instead of drifting past it", () => {
    expect(glide(ANCHOR_SLIDE_DURATION_MS + 1)).toBe(20);
    expect(glide(5_000)).toBe(20);
  });

  it("ignores a negative elapsed time and a zero duration rather than jumping", () => {
    expect(glide(-50)).toBe(900);
    expect(anchorSlideOffsetPx({ fromPx: 900, toPx: 20, elapsedMs: 0, durationMs: 0 })).toBe(20);
  });
});
