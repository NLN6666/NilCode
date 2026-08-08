import { MODEL_OPTIONS_BY_PROVIDER } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  ADVISOR_MODEL_OPTIONS,
  advisorEffortOptions,
  advisorEffortValue,
  advisorModelValue,
  parseAdvisorModelValue,
  withAdvisorEffort,
} from "./advisorSettings.logic";

const CLAUDE_SLUG =
  ADVISOR_MODEL_OPTIONS.find((option) => option.provider === "claudeAgent")?.slug ?? "";

describe("ADVISOR_MODEL_OPTIONS", () => {
  // Only Codex and Claude support native turn steering. On every other
  // provider a steer degrades to interrupt-and-requeue, which throws away the
  // turn the advisor was trying to correct.
  it("offers only providers that can be steered", () => {
    const providers = new Set(ADVISOR_MODEL_OPTIONS.map((option) => option.provider));

    expect(providers).toEqual(new Set(["codex", "claudeAgent"]));
  });

  it("offers models from both providers", () => {
    expect(ADVISOR_MODEL_OPTIONS.some((option) => option.provider === "codex")).toBe(true);
    expect(ADVISOR_MODEL_OPTIONS.some((option) => option.provider === "claudeAgent")).toBe(true);
  });

  it("gives every option a display name", () => {
    expect(ADVISOR_MODEL_OPTIONS.every((option) => option.name.length > 0)).toBe(true);
  });
});

describe("advisorModelValue", () => {
  it("round-trips a selection through its select value", () => {
    const selection = { provider: "codex", model: "gpt-5.5" } as const;

    expect(parseAdvisorModelValue(advisorModelValue(selection))).toEqual(selection);
  });
});

describe("parseAdvisorModelValue", () => {
  it("parses a Claude selection", () => {
    const claude = ADVISOR_MODEL_OPTIONS.find((option) => option.provider === "claudeAgent");

    expect(parseAdvisorModelValue(`claudeAgent:${claude?.slug ?? ""}`)).toEqual({
      provider: "claudeAgent",
      model: claude?.slug,
    });
  });

  // The contract pairs a provider with that provider's models, so a mismatched
  // pair is not a value the server can even represent. Rejecting it here keeps
  // the failure in the picker instead of in a rejected settings patch.
  it("rejects a model that belongs to the other provider", () => {
    const claude = ADVISOR_MODEL_OPTIONS.find((option) => option.provider === "claudeAgent");

    expect(parseAdvisorModelValue(`codex:${claude?.slug ?? ""}`)).toBeNull();
  });

  it("rejects a provider the advisor does not support", () => {
    expect(parseAdvisorModelValue("cursor:gpt-5.5")).toBeNull();
  });

  it("rejects an unknown model", () => {
    expect(parseAdvisorModelValue("codex:not-a-model")).toBeNull();
  });

  it.each(["", "codex", "codex:", ":gpt-5.5"])("rejects malformed value %o", (value) => {
    expect(parseAdvisorModelValue(value)).toBeNull();
  });

  // Claude slugs contain no colon today, but a model named "a:b" must not be
  // truncated into a different, valid-looking model.
  it("splits on the first colon only", () => {
    expect(parseAdvisorModelValue("codex:gpt:5.5")).toBeNull();
  });

  it("carries an explicitly chosen level across a model switch", () => {
    expect(
      parseAdvisorModelValue(`claudeAgent:${CLAUDE_SLUG}`, {
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "xhigh" },
      }),
    ).toEqual({ provider: "claudeAgent", model: CLAUDE_SLUG, options: { effort: "xhigh" } });
  });

  // Codex has no "max" rung. Carrying it over would write a value the provider
  // rejects, so the level is dropped and the new model falls back to its default.
  it("drops a level the new model does not offer", () => {
    expect(
      parseAdvisorModelValue("codex:gpt-5.5", {
        provider: "claudeAgent",
        model: CLAUDE_SLUG,
        options: { effort: "max" },
      }),
    ).toEqual({ provider: "codex", model: "gpt-5.5" });
  });

  // Switching models must not silently convert "follow the model default" into
  // a pinned level, or every switch would freeze the previous model's default.
  it("does not pin a default that was never chosen", () => {
    expect(
      parseAdvisorModelValue("codex:gpt-5.5", { provider: "codex", model: "gpt-5.4" }),
    ).toEqual({ provider: "codex", model: "gpt-5.5" });
  });
});

describe("advisorEffortOptions", () => {
  it("offers the plain reasoning ladder for a Codex model", () => {
    expect(
      advisorEffortOptions({ provider: "codex", model: "gpt-5.5" }).map((l) => l.value),
    ).toEqual(["low", "medium", "high", "xhigh"]);
  });

  // ultrathink and ultracode push the model into deeper autonomous work -
  // ultracode into orchestrating workflows and spawning subagents. The advisor
  // is read-only with no tools, so those rungs only spend tokens.
  it("never offers a level that steers the model into autonomous work", () => {
    for (const option of ADVISOR_MODEL_OPTIONS) {
      const levels = advisorEffortOptions({ provider: option.provider, model: option.slug });

      expect(
        levels.every((l) => l.controlSource === undefined || l.controlSource === "api-effort"),
      ).toBe(true);
      expect(levels.map((l) => l.value)).not.toContain("ultrathink");
      expect(levels.map((l) => l.value)).not.toContain("ultracode");
    }
  });

  // Guards the guard above: if no advisor model shipped a mode level any more,
  // the exclusion test would pass while asserting nothing.
  it("has something to exclude", () => {
    const withModeLevels = ADVISOR_MODEL_OPTIONS.filter((option) =>
      MODEL_OPTIONS_BY_PROVIDER[option.provider]
        .find((model) => model.slug === option.slug)
        ?.capabilities.reasoningEffortLevels.some((l) => l.value === "ultracode"),
    );

    expect(withModeLevels.length).toBeGreaterThan(0);
  });

  it("returns nothing for a model outside the catalog", () => {
    expect(advisorEffortOptions({ provider: "codex", model: "not-a-model" })).toEqual([]);
  });
});

describe("advisorEffortValue", () => {
  it("falls back to the level the model marks as default", () => {
    expect(advisorEffortValue({ provider: "codex", model: "gpt-5.5" })).toBe("medium");
  });

  it("prefers a stored Codex level", () => {
    expect(
      advisorEffortValue({
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "xhigh" },
      }),
    ).toBe("xhigh");
  });

  it("reads Claude's effort field", () => {
    expect(
      advisorEffortValue({
        provider: "claudeAgent",
        model: CLAUDE_SLUG,
        options: { effort: "max" },
      }),
    ).toBe("max");
  });
});

describe("withAdvisorEffort", () => {
  it("stores a Codex level under reasoningEffort", () => {
    expect(withAdvisorEffort({ provider: "codex", model: "gpt-5.5" }, "xhigh")).toEqual({
      provider: "codex",
      model: "gpt-5.5",
      options: { reasoningEffort: "xhigh" },
    });
  });

  it("stores a Claude level under effort", () => {
    expect(withAdvisorEffort({ provider: "claudeAgent", model: CLAUDE_SLUG }, "max")).toEqual({
      provider: "claudeAgent",
      model: CLAUDE_SLUG,
      options: { effort: "max" },
    });
  });

  it("keeps unrelated options", () => {
    expect(
      withAdvisorEffort(
        { provider: "codex", model: "gpt-5.5", options: { fastMode: true } },
        "high",
      ),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.5",
      options: { fastMode: true, reasoningEffort: "high" },
    });
  });

  it("returns the selection unchanged for a level the model does not offer", () => {
    const selection = { provider: "codex", model: "gpt-5.5" } as const;

    expect(withAdvisorEffort(selection, "ultracode")).toBe(selection);
    expect(withAdvisorEffort(selection, "max")).toBe(selection);
  });
});
