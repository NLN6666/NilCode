import { describe, expect, it } from "vitest";

import {
  ADVISOR_ACTIVITY_KIND,
  ADVISOR_DIGEST_MAX_CHARS,
  type AdvisorDigestInput,
  digestActivity,
} from "./advisorEventDigest.ts";

const activity = (overrides: Partial<AdvisorDigestInput> = {}): AdvisorDigestInput => ({
  kind: "tool.updated",
  summary: "Read src/index.ts",
  payload: null,
  ...overrides,
});

describe("digestActivity", () => {
  it("renders an activity as a single line carrying its kind and summary", () => {
    const line = digestActivity(activity());

    expect(line).toBe("[tool.updated] Read src/index.ts");
  });

  // The advisor watches for drift, and a failure is the strongest drift signal
  // there is. Errors must never be filtered as noise.
  it("keeps error activity", () => {
    const line = digestActivity(
      activity({ kind: "runtime.error", summary: "ENOENT: no such file" }),
    );

    expect(line).toBe("[runtime.error] ENOENT: no such file");
  });

  it("folds a payload detail into the same line", () => {
    const line = digestActivity(
      activity({ summary: "Bash", payload: { detail: "bun run test --filter server" } }),
    );

    expect(line).toBe("[tool.updated] Bash — bun run test --filter server");
  });

  it("omits the separator when the payload carries no detail", () => {
    expect(digestActivity(activity({ payload: { other: "value" } }))).toBe(
      "[tool.updated] Read src/index.ts",
    );
  });

  it("ignores a non-string detail rather than rendering it", () => {
    expect(digestActivity(activity({ payload: { detail: { nested: true } } }))).toBe(
      "[tool.updated] Read src/index.ts",
    );
  });

  // The advisor session is fed one line per activity for a whole turn, so an
  // unbounded line is how the context silently blows up.
  it("truncates a line that exceeds the per-activity budget", () => {
    const line = digestActivity(activity({ payload: { detail: "x".repeat(10_000) } }));

    expect(line).not.toBeNull();
    expect(line?.length).toBe(ADVISOR_DIGEST_MAX_CHARS);
  });

  it("marks a truncated line so the advisor knows content was cut", () => {
    const line = digestActivity(activity({ payload: { detail: "x".repeat(10_000) } }));

    expect(line?.endsWith("…")).toBe(true);
  });

  // Housekeeping activity says nothing about whether the model is on track, and
  // every line spent on it is context the advisor cannot spend on real work.
  it.each([
    "context-window.configured",
    "context-window.updated",
    "context-compaction",
    "account.rate-limits.updated",
    "account.rate-limited",
  ])("drops housekeeping activity: %s", (kind) => {
    expect(digestActivity(activity({ kind }))).toBeNull();
  });

  it("drops an activity whose summary is blank", () => {
    expect(digestActivity(activity({ summary: "   " }))).toBeNull();
  });

  // The self-excitation cut.
  //
  // Steering the thread's own turn produces no activity at all
  // (providerRuntimeActivityProjection.ts: `turn.steered` returns [] when
  // target === "turn"), so a steer cannot loop. What does loop is the activity
  // the advisor appends to make its own advice visible: feed that back and the
  // advisor comments on its own words forever.
  it("drops the activity carrying the advisor's own advice", () => {
    expect(digestActivity(activity({ kind: ADVISOR_ACTIVITY_KIND }))).toBeNull();
  });

  // The model's reaction to advice must still feed through - that is how the
  // advisor learns whether it was heeded.
  it("keeps activity the model produced after being advised", () => {
    expect(digestActivity(activity({ kind: "tool.updated", summary: "Edit shared/text.ts" }))).toBe(
      "[tool.updated] Edit shared/text.ts",
    );
  });
});
