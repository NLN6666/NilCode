import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ADVISOR_SEVERITIES,
  AdvisorServerSettings,
  AdvisorVerdict,
  DEFAULT_ADVISOR_SETTINGS,
} from "./advisor";

const decodeSettings = Schema.decodeUnknownSync(AdvisorServerSettings);
const decodeVerdict = Schema.decodeUnknownSync(AdvisorVerdict);

describe("AdvisorServerSettings", () => {
  // Advisor mode is opt-in: it spends a second model's tokens on every turn, so
  // an install that never configures it must never start paying for it.
  it("defaults to disabled", () => {
    expect(decodeSettings({}).enabled).toBe(false);
    expect(DEFAULT_ADVISOR_SETTINGS.enabled).toBe(false);
  });

  it("defaults to a usable model selection", () => {
    expect(decodeSettings({}).modelSelection.provider).toBe("codex");
  });

  it("accepts a codex advisor", () => {
    const parsed = decodeSettings({
      enabled: true,
      modelSelection: { provider: "codex", model: "gpt-5.5" },
    });

    expect(parsed.modelSelection.provider).toBe("codex");
  });

  it("accepts a claude advisor", () => {
    const parsed = decodeSettings({
      enabled: true,
      modelSelection: { provider: "claudeAgent", model: "claude-sonnet-5" },
    });

    expect(parsed.modelSelection.provider).toBe("claudeAgent");
  });

  // Only Codex and Claude support native turn steering. On every other provider
  // a steer is turned into "interrupt the turn and requeue" by the decider,
  // which is destructive rather than advisory. Encoding that in the schema makes
  // the unsupported configuration unrepresentable instead of a runtime check.
  it.each(["cursor", "antigravity", "grok", "droid", "kilo", "opencode", "pi"])(
    "rejects %s, which cannot steer a live turn",
    (provider) => {
      expect(() =>
        decodeSettings({ enabled: true, modelSelection: { provider, model: "whatever" } }),
      ).toThrow();
    },
  );
});

describe("AdvisorVerdict", () => {
  // Silence is a first-class outcome. An advisor forced to say something on
  // every evaluation becomes noise and burns its per-turn allowance.
  it("accepts silence", () => {
    const parsed = decodeVerdict({ verdict: "silent" });

    expect(parsed.verdict).toBe("silent");
  });

  it.each(ADVISOR_SEVERITIES)("accepts %s advice carrying a message", (severity) => {
    const parsed = decodeVerdict({
      verdict: "advise",
      severity,
      message: "this duplicates the helper in shared/text",
    });

    if (parsed.verdict !== "advise") {
      throw new Error("Expected advise verdict");
    }
    expect(parsed.severity).toBe(severity);
    expect(parsed.message).toBe("this duplicates the helper in shared/text");
  });

  // Advice with nothing to say must fail decoding rather than fall back to
  // silence: a lenient parse would let the model bypass the guard rules by
  // emitting malformed output.
  it("rejects advice without a message", () => {
    expect(() => decodeVerdict({ verdict: "advise", severity: "nit" })).toThrow();
  });

  it("rejects advice whose message is blank", () => {
    expect(() => decodeVerdict({ verdict: "advise", severity: "nit", message: "   " })).toThrow();
  });

  // Severity decides whether the note may interrupt a live turn, so an
  // unlabelled note cannot be routed at all.
  it("rejects advice without a severity", () => {
    expect(() => decodeVerdict({ verdict: "advise", message: "something" })).toThrow();
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      decodeVerdict({ verdict: "advise", severity: "critical", message: "something" }),
    ).toThrow();
  });

  it("rejects an unknown verdict", () => {
    expect(() => decodeVerdict({ verdict: "interrupt", message: "stop" })).toThrow();
  });

  // The order is load-bearing: a repeated note is only let through when it
  // escalates, which is a comparison on this array's indices.
  it("orders severities weakest to strongest", () => {
    expect(ADVISOR_SEVERITIES).toEqual(["nit", "concern", "blocker"]);
  });
});
