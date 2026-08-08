// FILE: composerTraits.optionIds.test.ts
// Purpose: Pins the provider option field each trait value is written to. Both the
//          composer traits menu and Settings -> default models depend on this mapping;
//          a wrong field is silent - the provider simply never reads the value.
// Layer: Chat composer state helper tests

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { composerContextWindowOptionId, composerEffortOptionId } from "./composerTraits";

const ALL_PROVIDERS = Object.keys(PROVIDER_DISPLAY_NAMES) as ProviderKind[];

describe("composerEffortOptionId", () => {
  it("maps each provider to the field its option schema declares", () => {
    expect(composerEffortOptionId("codex")).toBe("reasoningEffort");
    expect(composerEffortOptionId("claudeAgent")).toBe("effort");
    expect(composerEffortOptionId("pi")).toBe("thinkingLevel");
    expect(composerEffortOptionId("kilo")).toBe("variant");
    expect(composerEffortOptionId("opencode")).toBe("variant");
    expect(composerEffortOptionId("cursor")).toBe("reasoningEffort");
    expect(composerEffortOptionId("antigravity")).toBe("reasoningEffort");
    expect(composerEffortOptionId("grok")).toBe("reasoningEffort");
    expect(composerEffortOptionId("droid")).toBe("reasoningEffort");
  });

  // Runtime discovery can name the control itself; it outranks the static mapping.
  it("prefers a discovered descriptor id over the static mapping", () => {
    expect(composerEffortOptionId("codex", "customEffort")).toBe("customEffort");
    expect(composerEffortOptionId("claudeAgent", "customEffort")).toBe("customEffort");
  });

  it("never returns a blank field for any provider", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(composerEffortOptionId(provider).length).toBeGreaterThan(0);
    }
  });
});

describe("composerContextWindowOptionId", () => {
  // Claude's window control is auto-compaction, a different field from the legacy
  // `contextWindow` the others fall back to.
  it("sends Claude to autoCompactWindow and everyone else to contextWindow", () => {
    expect(composerContextWindowOptionId("claudeAgent")).toBe("autoCompactWindow");
    expect(composerContextWindowOptionId("codex")).toBe("contextWindow");
    expect(composerContextWindowOptionId("grok")).toBe("contextWindow");
  });

  it("prefers a discovered descriptor id over the static fallback", () => {
    expect(composerContextWindowOptionId("claudeAgent", "windowSize")).toBe("windowSize");
  });
});
