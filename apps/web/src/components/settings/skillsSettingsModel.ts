// FILE: skillsSettingsModel.ts
// Purpose: Groups duplicate skill copies for Settings -> Skills so shared names render once,
//          and resolves which providers each skill actually reaches so toggles can be scoped
//          per provider.
// Layer: Settings UI logic
// Exports: origin metadata, canonical skill grouping, section ordering, and per-provider
//          toggle helpers.

import type {
  DisabledSkillsByProvider,
  ProviderKind,
  ProviderSkillDescriptor,
} from "@synara/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@synara/contracts";
import { providersForSkillOrigin, skillNameKey } from "@synara/shared/skillOrigins";
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
  /** Providers that actually load this skill — the set its toggles govern. */
  readonly providers: ReadonlyArray<ProviderKind>;
  readonly sources: ReadonlyArray<SettingsSkillSource>;
  readonly section: string;
}

export interface SettingsSkillSection {
  readonly key: string;
  readonly title: string;
  readonly groups: ReadonlyArray<SettingsSkillGroup>;
}

/** Aggregate switch state for a range of skill/provider pairs (a row, a section, the panel). */
export type SkillToggleState = "all" | "none" | "partial";

/** One skill scoped to the providers a switch governs. A per-provider switch passes one. */
export interface SkillToggleTarget {
  readonly key: string;
  readonly providers: ReadonlyArray<ProviderKind>;
}

const SHARED_SKILLS_SECTION = "shared";
const PERSONAL_ORIGIN = "personal";
export const ORIGIN_SECTION_ORDER = [
  "synara",
  "codex",
  "claude",
  "cursor",
  "grok",
  "factory",
  "opencode",
  "pi",
  "devin",
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

/**
 * Provider that owns an origin folder on disk, used only for labelling the section. This is
 * not the set of providers that read the folder — several agents read `~/.claude/skills`, but
 * only Claude owns it. Use {@link providersForSkillOrigin} for reach.
 */
const ORIGIN_OWNER_PROVIDER: Readonly<Record<string, ProviderKind>> = {
  codex: "codex",
  claude: "claudeAgent",
  cursor: "cursor",
  grok: "grok",
  // Factory Droid's folder is `~/.factory/skills`; discovery names the origin after the
  // directory, so the owner lookup has to bridge `factory` back to the `droid` kind.
  factory: "droid",
  opencode: "opencode",
  pi: "pi",
  devin: "devin",
  antigravity: "antigravity",
};

export function skillOriginInfo(
  scope: string | undefined,
  labels: SettingsSkillLabels["origins"],
): SkillOriginInfo {
  const owner = scope ? ORIGIN_OWNER_PROVIDER[scope] : undefined;
  if (owner) {
    return { label: PROVIDER_DISPLAY_NAMES[owner], provider: owner };
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

export function settingsSkillNameKey(name: string): string {
  return skillNameKey(name);
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

/** Groups reduced to the skill/provider pairs their row switch governs. */
export function toggleTargetsForGroups(
  groups: ReadonlyArray<SettingsSkillGroup>,
): SkillToggleTarget[] {
  return groups.map((group) => ({ key: group.key, providers: group.providers }));
}

export function isSkillDisabledForProvider(
  disabled: DisabledSkillsByProvider,
  provider: ProviderKind,
  key: string,
): boolean {
  const normalized = settingsSkillNameKey(key);
  return disabled[provider].some((name) => settingsSkillNameKey(name) === normalized);
}

/**
 * Switch state across every skill/provider pair in `targets`. `partial` is what puts the
 * panel, section, and row switches into their indeterminate rendering. An empty range
 * reports `"all"`, but the panel hides those switches rather than showing an inert control.
 */
export function skillToggleState(
  targets: ReadonlyArray<SkillToggleTarget>,
  disabled: DisabledSkillsByProvider,
): SkillToggleState {
  let pairs = 0;
  let disabledPairs = 0;
  for (const target of targets) {
    for (const provider of target.providers) {
      pairs += 1;
      if (isSkillDisabledForProvider(disabled, provider, target.key)) {
        disabledPairs += 1;
      }
    }
  }
  if (pairs === 0 || disabledPairs === 0) {
    return "all";
  }
  return disabledPairs === pairs ? "none" : "partial";
}

/**
 * Next `settings.skills.disabled` map after toggling `targets` as a batch. Only the
 * providers named in `targets` are rewritten; the rest are returned untouched so a toggle
 * in one provider's row never disturbs another's opt-outs.
 *
 * Names outside `targets` survive verbatim — including entries for skills no longer in the
 * catalog, so an opt-out outlives uninstalling and reinstalling the provider that shipped
 * the skill.
 */
export function nextDisabledSkills(
  current: DisabledSkillsByProvider,
  targets: ReadonlyArray<SkillToggleTarget>,
  enabled: boolean,
): DisabledSkillsByProvider {
  const keysByProvider = new Map<ProviderKind, Set<string>>();
  for (const target of targets) {
    const normalized = settingsSkillNameKey(target.key);
    for (const provider of target.providers) {
      const keys = keysByProvider.get(provider) ?? new Set<string>();
      keys.add(normalized);
      keysByProvider.set(provider, keys);
    }
  }

  const next: Record<ProviderKind, readonly string[]> = { ...current };
  for (const [provider, keys] of keysByProvider) {
    const names = new Set(current[provider].map((name) => settingsSkillNameKey(name)));
    for (const key of keys) {
      if (enabled) {
        names.delete(key);
      } else {
        names.add(key);
      }
    }
    next[provider] = [...names].toSorted();
  }
  return next;
}
