import { describe, expect, it } from "vitest";

import { deriveUsagePace } from "./usagePace";

const FIVE_HOURS = 300;
const WEEK = 10_080;

describe("deriveUsagePace", () => {
  it("returns null without reset timing context", () => {
    expect(deriveUsagePace({ remainingPercent: 85 })).toBeNull();
  });

  it("shows reserve when usage is slower than the elapsed window pace", () => {
    const resetMs = Date.parse("2026-06-09T15:00:00.000Z");
    const periodDurationMs = FIVE_HOURS * 60_000;
    const nowMs = resetMs - Math.round(periodDurationMs * 0.12);
    const pace = deriveUsagePace({
      remainingPercent: 85,
      resetsAt: new Date(resetMs).toISOString(),
      windowDurationMins: FIVE_HOURS,
      nowMs,
    });

    expect(pace?.status).toBe("ahead");
    expect(pace?.expectedRemainingPercent).toBeCloseTo(12);
    expect(pace?.amountText).toContain("73%");
    expect(pace?.etaText?.length).toBeGreaterThan(0);
  });

  it("still shows pace for very early five-hour windows", () => {
    const resetMs = Date.parse("2026-06-09T15:00:00.000Z");
    const periodDurationMs = FIVE_HOURS * 60_000;
    const nowMs = resetMs - Math.round(periodDurationMs * 0.98);
    const pace = deriveUsagePace({
      remainingPercent: 91,
      resetsAt: new Date(resetMs).toISOString(),
      windowDurationMins: FIVE_HOURS,
      nowMs,
    });

    expect(pace?.status).toBe("behind");
    expect(pace?.expectedRemainingPercent).toBe(95);
    expect(pace?.amountText).toContain("4%");
  });

  it("shows deficit and run-out timing when usage is faster than the elapsed window pace", () => {
    const resetMs = Date.parse("2026-06-15T18:00:00.000Z");
    const periodDurationMs = WEEK * 60_000;
    const nowMs = resetMs - Math.round(periodDurationMs * 0.22);
    const pace = deriveUsagePace({
      remainingPercent: 18,
      resetsAt: new Date(resetMs).toISOString(),
      windowDurationMins: WEEK,
      nowMs,
    });

    expect(pace?.status).toBe("behind");
    expect(pace?.expectedRemainingPercent).toBeCloseTo(22);
    expect(pace?.amountText).toContain("4%");
    expect(pace?.etaText).toMatch(/\d/u);
  });

  it("hides tiny rounded reserve or deficit labels", () => {
    const resetMs = Date.parse("2026-06-09T15:00:00.000Z");
    const periodDurationMs = FIVE_HOURS * 60_000;
    const nowMs = resetMs - Math.round(periodDurationMs * 0.5);
    const pace = deriveUsagePace({
      remainingPercent: 49.6,
      resetsAt: new Date(resetMs).toISOString(),
      windowDurationMins: FIVE_HOURS,
      nowMs,
    });

    expect(pace?.amountText).toBeNull();
  });
});
