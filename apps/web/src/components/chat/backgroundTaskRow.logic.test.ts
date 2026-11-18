import { describe, expect, it } from "vitest";

import { describeBackgroundTaskStatus } from "./backgroundTaskRow.logic";

const task = (
  status: "running" | "finished" | "failed" | "stopped",
  overrides: { completedAt?: string | null; exitCode?: number | null } = {},
) => ({
  status,
  startedAt: "2026-10-10T00:09:57.000Z",
  completedAt:
    overrides.completedAt !== undefined
      ? overrides.completedAt
      : status === "running"
        ? null
        : "2026-10-10T00:10:17.000Z",
  exitCode: overrides.exitCode ?? null,
});

describe("describeBackgroundTaskStatus", () => {
  it("walks one row through its lifecycle", () => {
    const running = describeBackgroundTaskStatus(task("running"), "2026-10-10T00:10:09.000Z");
    expect(running.status).toBe("running");
    expect(running.elapsed).toContain("12");

    const finished = describeBackgroundTaskStatus(task("finished"), "2026-10-10T00:11:00.000Z");
    expect(finished.status).toBe("finished");
    expect(finished.elapsed).toContain("20");

    const failed = describeBackgroundTaskStatus(
      task("failed", { exitCode: 1 }),
      "2026-10-10T00:11:00.000Z",
    );
    expect(failed.status).toBe("failed");
    expect(failed.label).toContain("1");
    expect(describeBackgroundTaskStatus(task("failed"), "2026-10-10T00:11:00.000Z").status).toBe(
      "failed",
    );
    expect(describeBackgroundTaskStatus(task("stopped"), "2026-10-10T00:11:00.000Z").status).toBe(
      "stopped",
    );
  });
});
