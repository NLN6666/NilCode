import { describe, expect, it } from "vitest";

import { RESTART_BASE_DELAY_MS, RESTART_MAX_DELAY_MS, restartDelayMs } from "./daemonRestart";

describe("restartDelayMs", () => {
  it("uses the base delay for the first failure", () => {
    expect(restartDelayMs(1)).toBe(RESTART_BASE_DELAY_MS);
  });

  it("doubles with each consecutive failure", () => {
    expect(restartDelayMs(2)).toBe(RESTART_BASE_DELAY_MS * 2);
    expect(restartDelayMs(3)).toBe(RESTART_BASE_DELAY_MS * 4);
    expect(restartDelayMs(4)).toBe(RESTART_BASE_DELAY_MS * 8);
  });

  it("saturates at the ceiling instead of overflowing", () => {
    expect(restartDelayMs(100)).toBe(RESTART_MAX_DELAY_MS);
    expect(restartDelayMs(1_000)).toBe(RESTART_MAX_DELAY_MS);
    expect(Number.isFinite(restartDelayMs(1_000))).toBe(true);
  });

  it("never exceeds the ceiling at any failure count", () => {
    for (let failures = 1; failures <= 64; failures += 1) {
      expect(restartDelayMs(failures)).toBeLessThanOrEqual(RESTART_MAX_DELAY_MS);
    }
  });

  it("treats zero or negative counts as the base delay", () => {
    expect(restartDelayMs(0)).toBe(RESTART_BASE_DELAY_MS);
    expect(restartDelayMs(-5)).toBe(RESTART_BASE_DELAY_MS);
  });

  it("floors fractional counts rather than producing a fractional delay", () => {
    expect(restartDelayMs(2.9)).toBe(RESTART_BASE_DELAY_MS * 2);
  });
});
