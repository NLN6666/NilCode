import type { DaemonSnapshot } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  daemonInputAvailability,
  daemonMetaParts,
  daemonTone,
  isDaemonAlive,
  sortDaemons,
} from "./daemonPresentation";

const snapshot = (overrides: Partial<DaemonSnapshot>): DaemonSnapshot =>
  ({ name: "mc", id: "d1", state: "running", ...overrides }) as DaemonSnapshot;

describe("daemonTone", () => {
  it("treats a clean or user-requested exit as neutral, not an error", () => {
    // Painting a service the user just stopped in red reads as a report of their own
    // action failing.
    expect(daemonTone(snapshot({ state: "exited" }))).toBe("neutral");
  });

  it("flags a non-zero exit that nothing recovered", () => {
    expect(daemonTone(snapshot({ state: "failed" }))).toBe("danger");
  });

  it("separates coming-up from up", () => {
    expect(daemonTone(snapshot({ state: "starting" }))).toBe("pending");
    expect(daemonTone(snapshot({ state: "restarting" }))).toBe("pending");
    expect(daemonTone(snapshot({ state: "ready" }))).toBe("healthy");
  });
});

describe("isDaemonAlive", () => {
  it("counts restarting as not alive, because nothing is running during the backoff", () => {
    expect(isDaemonAlive(snapshot({ state: "restarting" }))).toBe(false);
    expect(isDaemonAlive(snapshot({ state: "starting" }))).toBe(true);
  });
});

describe("daemonMetaParts", () => {
  it("leads with the unmet readiness conditions while starting", () => {
    const parts = daemonMetaParts(
      snapshot({ state: "starting", readyPending: ["log", "port"], pid: 7 }),
    );

    expect(parts[0]).toContain("log");
    expect(parts[0]).toContain("port");
    expect(parts.some((part) => part.includes("7"))).toBe(true);
  });

  it("swaps the pid for the exit code once the process is gone", () => {
    const parts = daemonMetaParts(snapshot({ state: "failed", pid: null, exitCode: 1 }));

    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("1");
  });

  it("mentions restarts only once there have been some", () => {
    const noRestarts = daemonMetaParts(snapshot({ pid: 9, restartCount: 0 }));
    expect(noRestarts).toHaveLength(1);
    expect(noRestarts[0]).toContain("9");
    const restarted = daemonMetaParts(snapshot({ pid: 9, restartCount: 3 }));
    expect(restarted).toHaveLength(2);
    expect(restarted.some((part) => part.includes("9"))).toBe(true);
    expect(restarted.some((part) => part.includes("3"))).toBe(true);
  });

  it("says nothing rather than printing empty facts", () => {
    expect(daemonMetaParts(snapshot({ state: "exited", pid: null }))).toEqual([]);
  });
});

describe("daemonInputAvailability", () => {
  it("allows input to a live supervised daemon", () => {
    expect(daemonInputAvailability(snapshot({ state: "running" }))).toEqual({ enabled: true });
  });

  it("blames detachment before liveness, because that one can never resolve", () => {
    // A detached daemon's stdio is redirected into the log file; there is no stdin left
    // no matter how healthy the process is.
    expect(daemonInputAvailability(snapshot({ state: "running", detached: true }))).toEqual({
      enabled: false,
      reason: "detached",
    });
  });

  it("explains a dead service rather than showing a dead input box", () => {
    expect(daemonInputAvailability(snapshot({ state: "exited" }))).toEqual({
      enabled: false,
      reason: "notRunning",
    });
  });
});

describe("sortDaemons", () => {
  it("puts live services first, then orders by name", () => {
    const ordered = sortDaemons([
      snapshot({ name: "zeta", state: "exited" }),
      snapshot({ name: "beta", state: "running" }),
      snapshot({ name: "alpha", state: "failed" }),
      snapshot({ name: "aardvark", state: "ready" }),
    ]);

    expect(ordered.map((daemon) => daemon.name)).toEqual(["aardvark", "beta", "alpha", "zeta"]);
  });
});
