// FILE: advisorSettings.logic.ts
// Purpose: Model choices offered to the advisor, and parsing of the picker value.
// Layer: Settings UI helpers
//
// The advisor is restricted to Codex and Claude because they are the only
// providers with native turn steering. Everywhere else a steer degrades to
// interrupt-and-requeue, which discards the very turn the advisor was trying to
// correct - so "advise mid-turn" would mean "destroy the work" instead.
//
// Provider and model are picked as one value rather than as two controls. The
// contract pairs each provider with its own models, so a mismatched pair is not
// representable; choosing them together means the UI cannot build one.

import { MODEL_OPTIONS_BY_PROVIDER, type AdvisorModelSelection } from "@synara/contracts";

const ADVISOR_PROVIDERS = ["codex", "claudeAgent"] as const;

type AdvisorProvider = (typeof ADVISOR_PROVIDERS)[number];

export interface AdvisorModelOption {
  readonly provider: AdvisorProvider;
  readonly slug: string;
  readonly name: string;
}

export const ADVISOR_MODEL_OPTIONS: ReadonlyArray<AdvisorModelOption> = ADVISOR_PROVIDERS.flatMap(
  (provider) =>
    MODEL_OPTIONS_BY_PROVIDER[provider].map((option) => ({
      provider,
      slug: option.slug,
      name: option.name,
    })),
);

export function advisorModelValue(selection: AdvisorModelSelection): string {
  return `${selection.provider}:${selection.model}`;
}

/** Returns null for any value that is not one of the offered pairs. */
export function parseAdvisorModelValue(value: string): AdvisorModelSelection | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const provider = value.slice(0, separatorIndex);
  const model = value.slice(separatorIndex + 1);
  const match = ADVISOR_MODEL_OPTIONS.find(
    (option) => option.provider === provider && option.slug === model,
  );
  return match === undefined
    ? null
    : ({ provider: match.provider, model: match.slug } as AdvisorModelSelection);
}
