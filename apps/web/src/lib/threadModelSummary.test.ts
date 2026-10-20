import { describe, expect, it } from "vitest";
import type { ProviderModelDescriptor } from "@synara/contracts";

import { composer } from "~/i18n/locales/en/composer";
import { resolveThreadModelSummary } from "./threadModelSummary";
import { formatThreadModelSummaryLabel } from "./threadModelSummary";

// The real English copy: the summary must read exactly as the composer trigger does.
const STATUS_LABELS = composer.modelPicker;

describe("resolveThreadModelSummary", () => {
  it("returns null without a selection", () => {
    expect(resolveThreadModelSummary(null, STATUS_LABELS)).toBeNull();
    expect(resolveThreadModelSummary(undefined, STATUS_LABELS)).toBeNull();
  });
  const runtimeModel: ProviderModelDescriptor = {
    slug: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    supportedReasoningEfforts: [
      { value: "medium", label: "Medium" },
      { value: "xhigh", label: "Extra High" },
    ],
    defaultReasoningEffort: "medium",
    supportsFastMode: true,
  };

  it("shows effort and Fast for a runtime-discovered model outside the static catalog", () => {
    const summary = resolveThreadModelSummary(
      {
        provider: "codex",
        model: "gpt-6.1-sol",
        options: { reasoningEffort: "xhigh", fastMode: true },
      },
      STATUS_LABELS,
      runtimeModel,
    );

    expect(summary).toMatchObject({ statusLabel: "Extra High", fastMode: true });
  });

  it("uses the runtime default effort when no override is stored", () => {
    expect(
      resolveThreadModelSummary(
        { provider: "codex", model: "gpt-6.1-sol" },
        STATUS_LABELS,
        runtimeModel,
      ),
    ).toMatchObject({ statusLabel: "Medium", fastMode: false });
  });

  it("respects runtime Fast support instead of the static catalog", () => {
    expect(
      resolveThreadModelSummary(
        { provider: "codex", model: "gpt-5.5", options: { fastMode: true } },
        STATUS_LABELS,
        { ...runtimeModel, slug: "gpt-5.5", supportsFastMode: false },
      ),
    ).toMatchObject({ fastMode: false });
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

describe("formatThreadModelSummaryLabel", () => {
  it("joins model and effort without repeating the provider name", () => {
    const claude = resolveThreadModelSummary(
      {
        provider: "claudeAgent",
        model: "claude-opus-5.5",
        options: { effort: "medium" },
      },
      STATUS_LABELS,
    );
    expect(claude).not.toBeNull();
    const label = formatThreadModelSummaryLabel(claude!);
    expect(label).toContain(claude!.modelLabel);
    expect(label).toContain("Medium");
    expect(label).toBe(`${claude!.modelLabel} · Medium`);
    expect(label.startsWith("Claude ·")).toBe(false);
  });

  it("renders the model alone when there is no effort label", () => {
    expect(
      formatThreadModelSummaryLabel({
        provider: "codex",
        modelLabel: "GPT-5 Codex",
        statusLabel: null,
        fastMode: false,
      }),
    ).toBe("GPT-5 Codex");
  });
});
