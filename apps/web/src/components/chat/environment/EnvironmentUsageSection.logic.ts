// FILE: EnvironmentUsageSection.logic.ts
// Purpose: Pure compact-summary decisions for provider rows in the Environment panel.

import type { ServerProviderUsageSnapshot } from "@synara/contracts";
import type { ProviderUsageDisplayRow } from "~/lib/providerUsageDisplay";
import type { Messages } from "~/i18n/locales/en";

export interface EnvironmentProviderUsageSummary {
  readonly rows: ReadonlyArray<ProviderUsageDisplayRow>;
  readonly statusLabel: string;
  readonly ariaLabel: string;
}

function providerUsageStatusLabel(
  snapshot: ServerProviderUsageSnapshot | undefined,
  hasUsageLines: boolean,
  copy: Messages["chat"]["usageStatus"],
): string {
  switch (snapshot?.status) {
    case "needs-auth":
      return copy.signIn;
    case "unsupported":
      return copy.unsupported;
    case "error":
      return copy.unavailable;
    default:
      return hasUsageLines ? copy.connected : copy.noData;
  }
}

export function resolveEnvironmentProviderUsageSummary(input: {
  readonly copy: Messages["chat"]["usageStatus"];
  readonly providerName: string;
  readonly rows: ReadonlyArray<ProviderUsageDisplayRow>;
  /** Live batch snapshot when available; the row renders without one (local/thread fallbacks). */
  readonly snapshot: ServerProviderUsageSnapshot | undefined;
  readonly hasUsageLines: boolean;
}): EnvironmentProviderUsageSummary {
  const statusLabel = providerUsageStatusLabel(input.snapshot, input.hasUsageLines, input.copy);
  const rowSummary = input.rows
    .map((row) => input.copy.remaining(row.label, row.remainingLabel))
    .join(", ");

  return {
    rows: input.rows,
    statusLabel,
    ariaLabel: input.copy.summary(input.providerName, rowSummary || statusLabel),
  };
}
