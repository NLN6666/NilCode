// FILE: advisorSettings.logic.ts
// Purpose: Model and reasoning-level choices offered to the advisor, and parsing
//          of the picker values.
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

import {
  CLAUDE_CODE_EFFORT_OPTIONS,
  MODEL_OPTIONS_BY_PROVIDER,
  type AdvisorModelSelection,
  type ClaudeCodeEffort,
  type EffortOption,
} from "@synara/contracts";

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

/**
 * Reasoning levels the advisor may run at: the plain API-effort ladder only.
 *
 * `prompt-prefix` levels (ultrathink) and `provider-setting` levels (ultracode)
 * are filtered out. Both steer the model into deeper autonomous work - ultracode
 * pushes it to orchestrate workflows and spawn subagents - while the advisor is
 * a read-only observer with no tools at all, so they buy nothing and bill for it.
 * Keying the filter on `controlSource` rather than on a list of names means any
 * mode level added later is excluded by default instead of having to be
 * remembered here.
 */
export function advisorEffortOptions(
  selection: AdvisorModelSelection,
): ReadonlyArray<EffortOption> {
  const model = MODEL_OPTIONS_BY_PROVIDER[selection.provider].find(
    (option) => option.slug === selection.model,
  );
  // MODEL_OPTIONS_BY_PROVIDER carries no type annotation, so inline capability
  // objects infer as literals that have dropped the optional controlSource.
  // Widening here restores the field the filter reads.
  const levels: ReadonlyArray<EffortOption> = model?.capabilities.reasoningEffortLevels ?? [];
  return levels.filter(
    (level) => level.controlSource === undefined || level.controlSource === "api-effort",
  );
}

/** The level explicitly stored on the selection, if the user has ever picked one. */
function explicitAdvisorEffort(selection: AdvisorModelSelection): string | undefined {
  return selection.provider === "codex"
    ? selection.options?.reasoningEffort
    : selection.options?.effort;
}

/** The stored level, falling back to whatever the model marks as its default. */
export function advisorEffortValue(selection: AdvisorModelSelection): string {
  const explicit = explicitAdvisorEffort(selection);
  if (explicit !== undefined) {
    return explicit;
  }
  return advisorEffortOptions(selection).find((level) => level.isDefault)?.value ?? "";
}

function isClaudeEffort(value: string): value is ClaudeCodeEffort {
  return (CLAUDE_CODE_EFFORT_OPTIONS as ReadonlyArray<string>).includes(value);
}

/**
 * Stores `effort` on the selection under whichever field the provider's option
 * schema uses. A value the provider cannot represent is dropped rather than
 * written, so the patch can never be rejected after the UI already looked saved.
 */
export function withAdvisorEffort(
  selection: AdvisorModelSelection,
  effort: string,
): AdvisorModelSelection {
  if (!advisorEffortOptions(selection).some((level) => level.value === effort)) {
    return selection;
  }
  if (selection.provider === "codex") {
    return { ...selection, options: { ...selection.options, reasoningEffort: effort } };
  }
  return isClaudeEffort(effort)
    ? { ...selection, options: { ...selection.options, effort } }
    : selection;
}

/**
 * Returns null for any value that is not one of the offered pairs.
 *
 * Passing the current selection carries an explicitly chosen reasoning level
 * across the switch. Ladders differ per model, so a level the new model does not
 * offer is dropped instead of being sent as a value the provider would reject.
 */
export function parseAdvisorModelValue(
  value: string,
  current?: AdvisorModelSelection,
): AdvisorModelSelection | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const provider = value.slice(0, separatorIndex);
  const model = value.slice(separatorIndex + 1);
  const match = ADVISOR_MODEL_OPTIONS.find(
    (option) => option.provider === provider && option.slug === model,
  );
  if (match === undefined) {
    return null;
  }
  const next = { provider: match.provider, model: match.slug } as AdvisorModelSelection;
  const carried = current === undefined ? undefined : explicitAdvisorEffort(current);
  return carried === undefined ? next : withAdvisorEffort(next, carried);
}
