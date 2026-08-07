import { describe, expect, it } from "vitest";

import {
  ADVISOR_MODEL_OPTIONS,
  advisorModelValue,
  parseAdvisorModelValue,
} from "./advisorSettings.logic";

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
});
