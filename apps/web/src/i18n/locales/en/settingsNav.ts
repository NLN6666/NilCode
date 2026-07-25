// FILE: locales/en/settingsNav.ts
// Purpose: English copy for the settings navigation taxonomy.
//
// `satisfies Record<SettingsSectionId, …>` makes a newly added section a compile error here
// rather than an untranslated label at runtime.

import type { SettingsNavGroupId, SettingsSectionId } from "../../../settingsNavigation";

type NavSectionCopy = {
  label: string;
  description: string;
};

export const settingsNav = {
  navAriaLabel: "Settings sections",
  backToApp: "Back to app",
  searchPlaceholder: "Search settings...",
  searchAriaLabel: "Search settings",
  searchResultsAriaLabel: "Settings search results",
  noResults: "No matching settings.",

  groups: {
    app: "App",
    synara: "Synara",
  } satisfies Record<SettingsNavGroupId, string>,

  sections: {
    general: {
      label: "General",
      description: "Default provider, thread mode, and sidebar organization.",
    },
    profile: {
      label: "Profile",
      description: "Your local activity, streaks, and a shareable stats card.",
    },
    appearance: {
      label: "Appearance",
      description: "Theme, typography, and timestamp formatting.",
    },
    notifications: {
      label: "Notifications",
      description: "In-app toasts and desktop alerts.",
    },
    behavior: {
      label: "Behavior",
      description: "Streaming, diff handling, and destructive confirmations.",
    },
    appsnap: {
      label: "AppSnap",
      description: "Snap another app's window straight into a task with one key chord.",
    },
    shortcuts: {
      label: "Keyboard Shortcuts",
      description: "Every keyboard shortcut available in Synara, grouped by context.",
    },
    worktrees: {
      label: "Worktrees",
      description: "Review and clean up the worktrees created by Synara.",
    },
    archived: {
      label: "Archived",
      description: "View and restore archived threads.",
    },
    models: {
      label: "Models",
      description: "Git writing defaults and custom model slugs.",
    },
    providers: {
      label: "Providers",
      description: "Choose visible providers, review CLI installs, and update provider tools.",
    },
    skills: {
      label: "Skills",
      description: "Every skill found across providers, with toggles to control availability.",
    },
    usage: {
      label: "Usage",
      description: "Remaining quota and credits for each signed-in provider.",
    },
    mcpServers: {
      label: "MCP Servers",
      description: "Enable or disable the MCP servers your Codex and Claude agents use.",
    },
    integrations: {
      label: "Integrations",
      description: "Pair local MCP clients with scoped, revocable access to Synara tasks.",
    },
    advanced: {
      label: "Advanced",
      description: "Keybindings, recovery, and version info.",
    },
  } satisfies Record<SettingsSectionId, NavSectionCopy>,
};

export type SettingsNav = typeof settingsNav;
