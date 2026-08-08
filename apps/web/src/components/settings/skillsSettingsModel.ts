// FILE: skillsSettingsModel.ts
// Purpose: Groups duplicate skill copies for Settings -> Skills so shared names render once.
// Layer: Settings UI logic
// Exports: origin metadata, canonical skill grouping, section ordering, and bulk toggle helpers.

import type { ProviderKind, ProviderSkillDescriptor } from "@synara/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@synara/contracts";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";

export interface SkillOriginInfo {
  readonly label: string;
  readonly provider: ProviderKind | null;
}

export interface SettingsSkillSource {
  readonly skill: ProviderSkillDescriptor;
  readonly origin: string;
  readonly originInfo: SkillOriginInfo;
}

export interface SettingsSkillGroup {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly primarySkill: ProviderSkillDescriptor;
  readonly providers: ReadonlyArray<ProviderKind>;
  readonly sources: ReadonlyArray<SettingsSkillSource>;
  readonly section: string;
}

export interface SettingsSkillSection {
  readonly key: string;
  readonly title: string;
  readonly groups: ReadonlyArray<SettingsSkillGroup>;
}

/** Aggregate switch state for a range of skill rows (the whole panel, or one section). */
export type SkillToggleState = "all" | "none" | "partial";

const SHARED_SKILLS_SECTION = "shared";
const PERSONAL_ORIGIN = "personal";
export const ORIGIN_SECTION_ORDER = [
  "synara",
  "codex",
  "claude",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
  "agents",
  "project",
] as const;
/**
 * Structural subset of the `settings.skills` catalog group. The panel passes `m.settings.skills`
 * straight through, so adding a label here is a compile error in every locale — the same safety
 * net the catalogs themselves provide. Provider names are product nouns and stay untranslated.
 */
export interface SettingsSkillLabels {
  readonly sharedSkills: string;
  readonly fromOrigin: (label: string) => string;
  readonly noDescription: string;
  readonly origins: {
    readonly shared: string;
    readonly project: string;
    readonly personal: string;
  };
}

/** Provider behind an origin scope, independent of any display copy. */
function originProvider(scope: string | undefined): ProviderKind | null {
  switch (scope) {
    case "codex":
      return "codex";
    case "claude":
      return "claudeAgent";
    case "cursor":
      return "cursor";
    case "antigravity":
      return "antigravity";
    case "grok":
      return "grok";
    case "droid":
      return "droid";
    case "kilo":
      return "kilo";
    case "opencode":
      return "opencode";
    case "pi":
      return "pi";
    default:
      return null;
  }
}

export function skillOriginInfo(
  scope: string | undefined,
  labels: SettingsSkillLabels["origins"],
): SkillOriginInfo {
  const provider = originProvider(scope);
  if (provider) {
    return { label: PROVIDER_DISPLAY_NAMES[provider], provider };
  }
  switch (scope) {
    case "synara":
      return { label: "Synara", provider: null };
    case "agents":
      return { label: labels.shared, provider: null };
    case "project":
      return { label: labels.project, provider: null };
    default:
      return { label: scope ?? labels.personal, provider: null };
  }
}

export function providersForSkillOrigin(origin: string): ProviderKind[] {
  const provider = originProvider(origin);
  return provider ? [provider] : [];
}

export function settingsSkillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function skillDisplayName(skill: ProviderSkillDescriptor): string {
  return skill.interface?.displayName ?? skill.name;
}

export function providerDisplayName(provider: ProviderKind): string {
  return PROVIDER_DISPLAY_NAMES[provider];
}

export function sortProviderStack(providers: ReadonlyArray<ProviderKind>): ProviderKind[] {
  return providers.toSorted(
    (left, right) => DEFAULT_PROVIDER_ORDER.indexOf(left) - DEFAULT_PROVIDER_ORDER.indexOf(right),
  );
}

function originRank(origin: string): number {
  const index = (ORIGIN_SECTION_ORDER as readonly string[]).indexOf(origin);
  return index >= 0 ? index : ORIGIN_SECTION_ORDER.length;
}

function sourceSortKey(source: SettingsSkillSource): string {
  return `${originRank(source.origin).toString().padStart(2, "0")}\u0000${source.skill.path}`;
}

function sectionTitle(section: string, labels: SettingsSkillLabels): string {
  if (section === SHARED_SKILLS_SECTION) {
    return labels.sharedSkills;
  }
  return labels.fromOrigin(skillOriginInfo(section, labels.origins).label);
}

function sectionRank(section: string): number {
  if (section === SHARED_SKILLS_SECTION) {
    return -1;
  }
  return originRank(section);
}

// Creates one canonical row per normalized skill name. Duplicate provider copies
// stay visible as sources instead of letting the first origin hide the rest.
export function buildSettingsSkillGroups(
  skills: ReadonlyArray<ProviderSkillDescriptor>,
  labels: SettingsSkillLabels,
): SettingsSkillGroup[] {
  const groups = new Map<string, SettingsSkillSource[]>();
  for (const skill of skills) {
    const key = settingsSkillNameKey(skill.name);
    const origin = skill.scope ?? PERSONAL_ORIGIN;
    const source: SettingsSkillSource = {
      skill,
      origin,
      originInfo: skillOriginInfo(origin, labels.origins),
    };
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }

  return [...groups.entries()]
    .map(([key, unsortedSources]): SettingsSkillGroup | null => {
      const sources = unsortedSources.toSorted((left, right) =>
        sourceSortKey(left).localeCompare(sourceSortKey(right)),
      );
      const primarySkill = sources[0]?.skill;
      if (!primarySkill) {
        return null;
      }
      const providers = sortProviderStack(
        sources
          .flatMap((source) => providersForSkillOrigin(source.origin))
          .filter((provider, index, all) => all.indexOf(provider) === index),
      );
      const section =
        sources.length > 1 ? SHARED_SKILLS_SECTION : (sources[0]?.origin ?? PERSONAL_ORIGIN);
      const description =
        primarySkill.interface?.shortDescription ??
        primarySkill.description ??
        labels.noDescription;
      return {
        key,
        displayName: skillDisplayName(primarySkill),
        description,
        primarySkill,
        providers,
        sources,
        section,
      } satisfies SettingsSkillGroup;
    })
    .filter((group): group is SettingsSkillGroup => group !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function buildSettingsSkillSections(
  skills: ReadonlyArray<ProviderSkillDescriptor>,
  labels: SettingsSkillLabels,
): SettingsSkillSection[] {
  const sections = new Map<string, SettingsSkillGroup[]>();
  for (const group of buildSettingsSkillGroups(skills, labels)) {
    sections.set(group.section, [...(sections.get(group.section) ?? []), group]);
  }

  return [...sections.entries()]
    .map(([key, groups]) => ({
      key,
      title: sectionTitle(key, labels),
      groups,
    }))
    .sort((left, right) => sectionRank(left.key) - sectionRank(right.key));
}

/**
 * Switch state for a range of skill rows. `partial` is what puts the panel header and
 * section header switches into their indeterminate rendering. An empty range reports
 * `"all"`, but the panel hides those switches rather than showing an inert control.
 */
export function skillToggleState(
  keys: ReadonlyArray<string>,
  disabledKeys: ReadonlySet<string>,
): SkillToggleState {
  if (keys.length === 0) {
    return "all";
  }
  const disabledCount = keys.filter((key) => disabledKeys.has(settingsSkillNameKey(key))).length;
  if (disabledCount === 0) {
    return "all";
  }
  return disabledCount === keys.length ? "none" : "partial";
}

/**
 * Next `settings.skills.disabled` list after toggling `keys` as a batch. Names outside
 * `keys` survive verbatim — including entries for skills no longer in the catalog, so an
 * opt-out outlives uninstalling and reinstalling the provider that shipped the skill.
 */
export function nextDisabledSkillNames(
  currentDisabled: ReadonlyArray<string>,
  keys: ReadonlyArray<string>,
  enabled: boolean,
): string[] {
  const next = new Set(currentDisabled.map((name) => settingsSkillNameKey(name)));
  for (const key of keys) {
    const normalized = settingsSkillNameKey(key);
    if (enabled) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }
  }
  return [...next].toSorted();
}
