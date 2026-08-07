import { describe, expect, it } from "vitest";

import { advisorOverrideValue, parseAdvisorOverrideValue } from "./advisorOverride.logic";

describe("advisorOverrideValue", () => {
  // null and undefined are the same state - "this thread has no opinion" - and
  // both must land on the option that tracks the global default.
  it.each([null, undefined])("maps %o to the follow-the-default option", (override) => {
    expect(advisorOverrideValue(override)).toBe("default");
  });

  it("maps an explicit opt-in", () => {
    expect(advisorOverrideValue(true)).toBe("on");
  });

  it("maps an explicit opt-out", () => {
    expect(advisorOverrideValue(false)).toBe("off");
  });
});

describe("parseAdvisorOverrideValue", () => {
  // Clearing the override must send null, not omit the field: an absent field
  // in thread.meta.update means "leave it alone", so a thread could never go
  // back to following the default.
  it("turns the default option back into a cleared override", () => {
    expect(parseAdvisorOverrideValue("default")).toEqual({ advisorEnabled: null });
  });

  it("turns the on option into an opt-in", () => {
    expect(parseAdvisorOverrideValue("on")).toEqual({ advisorEnabled: true });
  });

  it("turns the off option into an opt-out", () => {
    expect(parseAdvisorOverrideValue("off")).toEqual({ advisorEnabled: false });
  });

  it("rejects a value that is not one of the options", () => {
    expect(parseAdvisorOverrideValue("maybe")).toBeNull();
  });

  it("round-trips every state", () => {
    for (const override of [null, true, false] as const) {
      expect(parseAdvisorOverrideValue(advisorOverrideValue(override))).toEqual({
        advisorEnabled: override,
      });
    }
  });
});
