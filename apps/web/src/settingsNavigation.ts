// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the main sidebar and the settings screen.
// Layer: Route/UI support
// Exports: section ids, nav items, and search normalization helper

export const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "notifications",
  "behavior",
  "appsnap",
  "shortcuts",
  "worktrees",
  "archived",
  "models",
  "providers",
  "skills",
  "usage",
  "mcpServers",
  "integrations",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "app" | "synara";

/**
 * Deep-link scroll targets inside settings panels. Each id is shared by its DOM owner and callers
 * that navigate with `?target=…`; the settings route resolves every target after the active panel
 * mounts.
 */
export const SETTINGS_TARGETS = {
  providerUpdates: "provider-updates",
  environmentPanel: "environment-panel",
} as const;

/**
 * Structure only. Labels and descriptions live in the i18n catalogs under `settingsNav`, keyed by
 * these same ids, so the taxonomy has one shape and one translation source.
 */
export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  /** Basename of a SVG under `/central-icons-reversed`. */
  icon: string;
};

export const SETTINGS_NAV_GROUP_IDS = [
  "app",
  "synara",
] as const satisfies readonly SettingsNavGroupId[];

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: "general", group: "app", icon: "settings-gear-4" },
  { id: "profile", group: "app", icon: "user" },
  { id: "appearance", group: "app", icon: "color-palette" },
  { id: "notifications", group: "app", icon: "bell" },
  { id: "behavior", group: "app", icon: "settings-slider-hor" },
  { id: "appsnap", group: "app", icon: "screen-capture" },
  { id: "shortcuts", group: "app", icon: "shortcut" },
  { id: "worktrees", group: "app", icon: "branch-simple" },
  { id: "archived", group: "app", icon: "archive" },
  { id: "models", group: "synara", icon: "brain" },
  { id: "providers", group: "synara", icon: "puzzle" },
  { id: "skills", group: "synara", icon: "building-blocks" },
  { id: "usage", group: "synara", icon: "gauge" },
  // Sits immediately before Integrations so the two MCP pages are neighbours. The icon is
  // deliberately not `plugin-1` (Integrations owns that) — the pages point in opposite
  // directions and must be distinguishable at a glance.
  { id: "mcpServers", group: "synara", icon: "api-connection" },
  { id: "integrations", group: "synara", icon: "plugin-1" },
  { id: "advanced", group: "synara", icon: "toolbox" },
] as const;

/**
 * Stable DOM id for a settings row, derived from its (string) title. Shared by the row that
 * renders the anchor and by the search index that deep-links to it via `?target=…`, so the
 * two can't drift. Panels stay mounted and render null while inactive, so the slug only needs
 * to be unique within a section.
 */
export function settingRowAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  return SETTINGS_SECTION_IDS.find((candidate) => candidate === value) ?? "general";
}
