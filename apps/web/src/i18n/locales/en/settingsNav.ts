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
    personal: "Personal",
    integrations: "Integrations",
    coding: "Coding",
    system: "System",
    archived: "Archived",
  } satisfies Record<SettingsNavGroupId, string>,

  sections: {
    general: {
      label: "General",
      description: "Choose defaults for new chats, navigation, and the Environment panel.",
    },
    profile: {
      label: "Profile",
      description: "Your local activity, streaks, and a shareable stats card.",
    },
    appearance: {
      label: "Appearance",
      description: "Customize the theme, typography, density, and time format.",
    },
    notifications: {
      label: "Notifications",
      description: "Choose how Synara tells you when work finishes or needs attention.",
    },
    behavior: {
      label: "Chat behavior",
      description: "Control live responses, follow-ups, review defaults, and safety confirmations.",
    },
    shortcuts: {
      label: "Keyboard shortcuts",
      description: "Search and customize shortcuts, grouped by where they work.",
    },
    usage: {
      label: "Usage & limits",
      description: "See remaining quota and credits for every signed-in provider.",
    },
    appsnap: {
      label: "AppSnap",
      description: "Capture another app's frontmost window directly into a task.",
    },
    mcpServers: {
      label: "MCP Servers",
      description: "Enable or disable the MCP servers your Codex and Claude agents use.",
    },
    integrations: {
      label: "MCP connections",
      description: "Give Codex, Claude, and other local agents scoped access to Synara tasks.",
    },
    providers: {
      label: "Agent providers",
      description: "Choose visible coding agents and manage their installed CLI tools.",
    },
    models: {
      label: "Models & writing",
      description: "Choose the model used for Git writing and add custom model slugs.",
    },
    skills: {
      label: "Agent skills",
      description: "Review reusable workflows discovered across all configured providers.",
    },
    worktrees: {
      label: "Managed worktrees",
      description: "Review and clean up isolated workspaces created by Synara.",
    },
    advanced: {
      label: "System tools",
      description: "Manage sessions, recovery tools, low-level keybindings, and version details.",
    },
    archived: {
      label: "Archived threads",
      description: "Find and restore threads you previously archived.",
    },
  } satisfies Record<SettingsSectionId, NavSectionCopy>,
};

export type SettingsNav = typeof settingsNav;
