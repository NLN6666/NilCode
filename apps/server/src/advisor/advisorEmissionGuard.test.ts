import { describe, expect, it } from "vitest";

import {
  ADVISOR_DEDUPE_HISTORY_LIMIT,
  acceptAdvisorNote,
  beginAdvisorUpdate,
  INITIAL_ADVISOR_EMISSION_STATE,
  normalizeAdviceText,
  shouldAcceptAdvisorNote,
} from "./advisorEmissionGuard.ts";

const accept = (
  state: Parameters<typeof acceptAdvisorNote>[0]["state"],
  severity: "nit" | "concern" | "blocker",
  message: string,
) => acceptAdvisorNote({ state, severity, message });

describe("normalizeAdviceText", () => {
  // Modelled on Oh My Pi: lowercase, NFKC, every run of non-alphanumerics
  // collapsed to one space, trimmed. "Stop.", "*Stop*" and "  stop  " all have
  // to collapse onto the same key or the dedupe is trivially bypassed by
  // punctuation.
  it.each(["Stop.", "*Stop*", "  stop  ", "STOP!!!"])("collapses %s onto the same key", (input) => {
    expect(normalizeAdviceText(input)).toBe("stop");
  });

  it("collapses internal punctuation and whitespace runs to single spaces", () => {
    expect(normalizeAdviceText("check   the-existing__helper")).toBe("check the existing helper");
  });

  it("applies NFKC so full-width text matches its ascii form", () => {
    expect(normalizeAdviceText("ＳＴＯＰ")).toBe("stop");
  });

  it("keeps genuinely different messages distinct", () => {
    expect(normalizeAdviceText("check the helper")).not.toBe(normalizeAdviceText("write a helper"));
  });
});

describe("shouldAcceptAdvisorNote", () => {
  it("accepts a substantive note", () => {
    expect(
      shouldAcceptAdvisorNote({
        state: INITIAL_ADVISOR_EMISSION_STATE,
        severity: "concern",
        message: "this duplicates the helper in shared/text",
      }),
    ).toBe(true);
  });

  // Content-free notes cost the main model attention and say nothing. They are
  // the advisor's most common failure mode when it has nothing real to report.
  it.each(["stop", "Done.", "complete", "LGTM", "nothing to add", "no issue continue"])(
    "rejects the content-free phrase %s",
    (message) => {
      expect(
        shouldAcceptAdvisorNote({
          state: INITIAL_ADVISOR_EMISSION_STATE,
          severity: "concern",
          message,
        }),
      ).toBe(false);
    },
  );

  it("rejects a blank note", () => {
    expect(
      shouldAcceptAdvisorNote({
        state: INITIAL_ADVISOR_EMISSION_STATE,
        severity: "nit",
        message: "   ",
      }),
    ).toBe(false);
  });

  // One accepted note per advisor evaluation. This is the rate limit that
  // matters: it is tied to the advisor actually being asked, not to wall clock.
  it("accepts at most one note per update", () => {
    const state = accept(INITIAL_ADVISOR_EMISSION_STATE, "nit", "first point");

    expect(
      shouldAcceptAdvisorNote({ state, severity: "nit", message: "a second, different point" }),
    ).toBe(false);
  });

  it("allows another note once the next update begins", () => {
    const state = beginAdvisorUpdate(accept(INITIAL_ADVISOR_EMISSION_STATE, "nit", "first point"));

    expect(
      shouldAcceptAdvisorNote({ state, severity: "nit", message: "a second, different point" }),
    ).toBe(true);
  });

  it("rejects a note already made at the same severity", () => {
    const state = beginAdvisorUpdate(
      accept(INITIAL_ADVISOR_EMISSION_STATE, "concern", "check the existing helper"),
    );

    expect(
      shouldAcceptAdvisorNote({
        state,
        severity: "concern",
        message: "Check the existing helper.",
      }),
    ).toBe(false);
  });

  it("rejects a repeat that de-escalates", () => {
    const state = beginAdvisorUpdate(
      accept(INITIAL_ADVISOR_EMISSION_STATE, "concern", "check the existing helper"),
    );

    expect(
      shouldAcceptAdvisorNote({ state, severity: "nit", message: "check the existing helper" }),
    ).toBe(false);
  });

  // Escalation is the one way back through the dedupe: the advisor has already
  // said this and the situation got worse, which is worth the main model's time.
  it("allows a repeat that escalates", () => {
    const state = beginAdvisorUpdate(
      accept(INITIAL_ADVISOR_EMISSION_STATE, "nit", "check the existing helper"),
    );

    expect(
      shouldAcceptAdvisorNote({ state, severity: "blocker", message: "check the existing helper" }),
    ).toBe(true);
  });

  it("bounds the dedupe history", () => {
    let state = INITIAL_ADVISOR_EMISSION_STATE;
    for (let index = 0; index < ADVISOR_DEDUPE_HISTORY_LIMIT + 10; index += 1) {
      state = beginAdvisorUpdate(accept(state, "nit", `point number ${index}`));
    }

    expect(state.accepted.size).toBe(ADVISOR_DEDUPE_HISTORY_LIMIT);
  });
});
