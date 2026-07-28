import { describe, expect, it, vi } from "vitest";

import { previewUrlForPort, waitForPreviewReady } from "./previewReadiness";

function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    delay: async (ms: number) => {
      current += ms;
    },
  };
}

describe("previewUrlForPort", () => {
  it("builds a localhost URL", () => {
    expect(previewUrlForPort(5299)).toBe("http://localhost:5299");
  });
});

describe("waitForPreviewReady", () => {
  it("resolves as soon as the server answers", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      waitForPreviewReady("http://localhost:5299", {
        probe,
        now: clock.now,
        delay: clock.delay,
        pollIntervalMs: 100,
        timeoutMs: 5_000,
      }),
    ).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("gives up at the deadline instead of polling forever", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(false);

    await expect(
      waitForPreviewReady("http://localhost:5299", {
        probe,
        now: clock.now,
        delay: clock.delay,
        pollIntervalMs: 100,
        timeoutMs: 250,
      }),
    ).resolves.toBe(false);
    // Probes at t=0 and t=100; at t=200 the next poll would overshoot 250.
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("stops when the caller aborts", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const probe = vi.fn().mockImplementation(async () => {
      controller.abort();
      return false;
    });

    await expect(
      waitForPreviewReady("http://localhost:5299", {
        probe,
        signal: controller.signal,
        now: clock.now,
        delay: clock.delay,
        pollIntervalMs: 100,
        timeoutMs: 5_000,
      }),
    ).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("does not probe at all when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = vi.fn();

    await expect(
      waitForPreviewReady("http://localhost:5299", { probe, signal: controller.signal }),
    ).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
