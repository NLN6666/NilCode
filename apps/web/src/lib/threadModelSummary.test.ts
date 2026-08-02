import { describe, expect, it } from "vitest";

import { composer } from "~/i18n/locales/en/composer";
import { resolveThreadModelSummary } from "./threadModelSummary";

// The real English copy: the summary must read exactly as the composer trigger does.
const STATUS_LABELS = composer.modelPicker;

describe("resolveThreadModelSummary", () => {
  it("returns null without a selection", () => {
    expect(resolveThreadModelSummary(null, STATUS_LABELS)).toBeNull();
    expect(resolveThreadModelSummary(undefined, STATUS_LABELS)).toBeNull();
  });

  it("summarizes a codex selection with its reasoning effort", () => {
    const summary = resolveThreadModelSummary(
      {
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "high" },
      },
      STATUS_LABELS,
    );

    expect(summary?.provider).toBe("codex");
    expect(summary?.modelLabel.length).toBeGreaterThan(0);
    expect(summary?.statusLabel?.toLowerCase()).toBe("high");
  });

  it("falls back to the model's default effort when none is stored", () => {
    const withEffort = resolveThreadModelSummary(
      {
        provider: "codex",
        model: "gpt-5.5",
        options: { reasoningEffort: "low" },
      },
      STATUS_LABELS,
    );
    const withoutOptions = resolveThreadModelSummary(
      { provider: "codex", model: "gpt-5.5" },
      STATUS_LABELS,
    );

    expect(withEffort?.statusLabel?.toLowerCase()).toBe("low");
    expect(withoutOptions?.statusLabel).not.toBeNull();
    expect(withoutOptions?.statusLabel).not.toBe(withEffort?.statusLabel);
  });

  it("summarizes a claude selection", () => {
    const summary = resolveThreadModelSummary(
      {
        provider: "claudeAgent",
        model: "claude-sonnet-5",
        options: { effort: "high" },
      },
      STATUS_LABELS,
    );

    expect(summary?.provider).toBe("claudeAgent");
    expect(summary?.modelLabel.length).toBeGreaterThan(0);
    expect(summary?.fastMode).toBe(false);
  });
});
