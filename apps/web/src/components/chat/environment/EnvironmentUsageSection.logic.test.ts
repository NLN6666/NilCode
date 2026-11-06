import type { ServerProviderUsageSnapshot } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { t } from "~/i18n";
import { deriveProviderUsageDisplayRows } from "~/lib/providerUsageDisplay";

import { resolveEnvironmentProviderUsageSummary } from "./EnvironmentUsageSection.logic";

function snapshot(input: Partial<ServerProviderUsageSnapshot> = {}): ServerProviderUsageSnapshot {
  return {
    provider: "codex",
    updatedAt: "2026-08-30T12:00:00.000Z",
    limits: [],
    usageLines: [],
    source: "test",
    status: "ok",
    ...input,
  };
}

describe("resolveEnvironmentProviderUsageSummary", () => {
  it("keeps both the five-hour and weekly limits in compact display order", () => {
    const providerSnapshot = snapshot({
      limits: [
        { window: "Weekly", usedPercent: 18, windowDurationMins: 10_080 },
        { window: "5h", usedPercent: 5, windowDurationMins: 300 },
      ],
    });
    const rows = deriveProviderUsageDisplayRows([
      {
        provider: providerSnapshot.provider,
        updatedAt: providerSnapshot.updatedAt,
        limits: providerSnapshot.limits,
      },
    ]);

    const summary = resolveEnvironmentProviderUsageSummary(
      {
        providerName: "Codex",
        rows,
        snapshot: providerSnapshot,
        hasUsageLines: false,
      },
      t,
    );

    expect(summary.rows.map((row) => [row.label, row.remainingLabel])).toEqual([
      ["5h", "95%"],
      ["Weekly", "82%"],
    ]);
    expect(summary.ariaLabel).toContain("Codex");
    expect(summary.ariaLabel).toContain("95%");
    expect(summary.ariaLabel).toContain("82%");
  });

  it("keeps each provider usage state distinct when there are no limit rows", () => {
    const statuses = ["needs-auth", "unsupported", "error", "ok"] as const;
    const summaries = statuses.map((status) =>
      resolveEnvironmentProviderUsageSummary(
        {
          providerName: "Codex",
          rows: [],
          snapshot: snapshot({ status }),
          hasUsageLines: false,
        },
        t,
      ),
    );

    expect(summaries.every((summary) => summary.statusLabel.length > 0)).toBe(true);
    expect(new Set(summaries.map((summary) => summary.statusLabel)).size).toBe(statuses.length);
    expect(summaries.every((summary) => summary.ariaLabel.includes("Codex"))).toBe(true);
  });

  it("falls back to No data when the batch has no snapshot for the provider", () => {
    const summary = resolveEnvironmentProviderUsageSummary(
      {
        providerName: "Claude",
        rows: [],
        snapshot: undefined,
        hasUsageLines: false,
      },
      t,
    );

    const emptySnapshotSummary = resolveEnvironmentProviderUsageSummary(
      {
        providerName: "Claude",
        rows: [],
        snapshot: snapshot({ status: "ok" }),
        hasUsageLines: false,
      },
      t,
    );
    expect(summary.statusLabel).toBe(emptySnapshotSummary.statusLabel);
    expect(summary.ariaLabel).toContain("Claude");
  });

  it("reports connected when an ok provider only exposes usage text", () => {
    const providerSnapshot = snapshot({
      usageLines: [{ label: "Limits", value: "Remaining limits stay in the provider CLI." }],
    });

    const summary = resolveEnvironmentProviderUsageSummary(
      {
        providerName: "Droid",
        rows: [],
        snapshot: providerSnapshot,
        hasUsageLines: true,
      },
      t,
    );

    expect(summary.statusLabel).not.toBe(
      resolveEnvironmentProviderUsageSummary(
        {
          providerName: "Droid",
          rows: [],
          snapshot: providerSnapshot,
          hasUsageLines: false,
        },
        t,
      ).statusLabel,
    );
    expect(summary.ariaLabel).toContain("Droid");
  });
});
