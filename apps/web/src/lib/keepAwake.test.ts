import { describe, expect, it } from "vitest";
import { localizedKeepAwakeModeOptions } from "./keepAwake";

describe("keepAwake mode options", () => {
  it("exposes the three modes in stable option order", () => {
    expect(localizedKeepAwakeModeOptions().map((option) => option.value)).toEqual([
      "always",
      "agent",
      "off",
    ]);
  });
});
