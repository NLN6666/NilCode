// FILE: locales/en/settings.ts
// Purpose: English copy for the settings screen. Also defines the key structure every other locale must match.
//
// Deliberately NOT `as const`: literal types would force translations to equal the English
// string. Plain inference gives each entry type `string`, so other locales are constrained by
// structure while free in value.
//
// On/off rows carry the exact four keys `renderBooleanSettingRow` needs, so a call site is just
// `renderBooleanSettingRow({ settingKey: "…", ...m.settings.general.sidebarSections.chats })`.
//
// This file is long because it is pure data — one group per settings tab, navigated by key rather
// than read top to bottom. Splitting it would only move the keys somewhere else.

import { pluralize } from "@synara/shared/text";

export const settings = {
  controls: {
    resetTooltip: "Reset to default",
    /** A function, not a template with a placeholder: word order around `label` differs per language. */
    resetAriaLabel: (label: string) => `Reset ${label} to default`,
  },
  general: {
    coreDefaults: {
      title: "Core defaults",
      language: {
        title: "Language",
        description: "Choose the display language for the Synara interface.",
        ariaLabel: "Language",
        resetLabel: "language",
      },
      defaultProvider: {
        title: "Default provider",
        description: "Choose the provider used for new chats.",
        ariaLabel: "Default provider",
        resetLabel: "default provider",
      },
      newThreads: {
        title: "New threads",
        description: "Pick the default workspace mode for newly created draft threads.",
        ariaLabel: "Default thread mode",
        resetLabel: "new threads",
        local: "Local",
        worktree: "New worktree",
      },
    },
    sidebarOrganization: {
      title: "Sidebar organization",
      projectOrder: {
        title: "Project order",
        description: "Controls how projects are arranged in the main sidebar.",
        ariaLabel: "Project sort order",
        resetLabel: "project order",
        options: {
          updated_at: "Recently active",
          created_at: "Recently added",
          manual: "Manual order",
        },
      },
      threadOrder: {
        title: "Thread order",
        description: "Controls how threads are arranged inside each project in the main sidebar.",
        ariaLabel: "Thread sort order",
        resetLabel: "thread order",
        options: {
          updated_at: "Recently active",
          created_at: "Newest first",
        },
      },
    },
    sidebarSections: {
      title: "Sidebar sections",
      chats: {
        title: "Chats",
        description:
          "Show the standalone Chats list in the sidebar footer (chats not tied to a project).",
        resetLabel: "chats section",
        ariaLabel: "Show the Chats section in the sidebar",
      },
      studio: {
        title: "Studio",
        description: "Show the Studio tab in the sidebar switcher.",
        resetLabel: "studio section",
        ariaLabel: "Show the Studio section in the sidebar",
      },
    },
    environmentPanel: {
      title: "Environment panel",
      defaultOpen: {
        title: "Open by default",
        description:
          "Open the chat Environment panel automatically on normal threads. When off, the panel stays closed until you open it. Your last open/close also updates this preference.",
        resetLabel: "environment panel default open",
        ariaLabel: "Open the Environment panel by default on normal threads",
      },
      usage: {
        title: "Usage",
        description: "Show the provider usage row in the chat Environment panel.",
        resetLabel: "usage section",
        ariaLabel: "Show the Usage section in the Environment panel",
      },
      repository: {
        title: "Repository",
        description:
          "Show the GitHub repository link in the chat Environment panel. The git block (Changes, Worktree, branch, Commit and Push) always stays visible.",
        resetLabel: "repository section",
        ariaLabel: "Show the Repository section in the Environment panel",
      },
      pullRequest: {
        title: "Pull request",
        description:
          "Show the open pull request (CI checks and review comments) for the current branch in the chat Environment panel.",
        resetLabel: "pull request section",
        ariaLabel: "Show the Pull request section in the Environment panel",
      },
      editor: {
        title: "Editor",
        description:
          "Show the Editor section (in-app editor view and Open in editor picker) in the chat Environment panel.",
        resetLabel: "editor section",
        ariaLabel: "Show the Editor section in the Environment panel",
      },
      recap: {
        title: "Recap",
        description: "Show the auto-generated chat recap in the Environment panel.",
        resetLabel: "recap section",
        ariaLabel: "Show the Recap section in the Environment panel",
      },
      pinned: {
        title: "Pinned messages",
        description: "Show the pinned-messages checklist in the Environment panel.",
        resetLabel: "pinned messages section",
        ariaLabel: "Show the Pinned messages section in the Environment panel",
      },
      markers: {
        title: "Text markers",
        description: "Show highlighted and underlined transcript text in the Environment panel.",
        resetLabel: "text markers section",
        ariaLabel: "Show the Text markers section in the Environment panel",
      },
      instructions: {
        title: "Project instructions",
        description: "Show project-level instructions in the Environment panel.",
        resetLabel: "project instructions section",
        ariaLabel: "Show the Project instructions section in the Environment panel",
      },
      notepad: {
        title: "Notepad",
        description: "Show the per-thread notepad in the Environment panel.",
        resetLabel: "notepad section",
        ariaLabel: "Show the Notepad section in the Environment panel",
      },
    },
  },
  appearance: {
    themeAndTypography: "Theme and typography",
    theme: {
      title: "Theme",
      description: "Choose how Synara looks across the app.",
      ariaLabel: "Theme preference",
      resetLabel: "theme",
      options: { light: "Light", dark: "Dark", system: "System" },
    },
    systemUiFont: {
      title: "Use system UI font",
      description:
        "Ignore the theme's custom UI font and render the interface with the native system font (SF Pro on macOS).",
      ariaLabel: "Use system UI font",
      resetLabel: "system UI font",
    },
    uiDensity: {
      title: "UI density",
      description:
        "Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size.",
      ariaLabel: "UI density",
      resetLabel: "UI density",
      options: { compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" },
    },
    baseFontSize: {
      title: "Base font size",
      description:
        "Adjust the app text base in pixels. Chat and UI typography scale proportionally from this value.",
      ariaLabel: "Base font size in pixels",
      resetLabel: "base font size",
    },
    terminalFontSize: {
      title: "Terminal font size",
      description: "Adjust terminal text independently from the app and chat font size.",
      ariaLabel: "Terminal font size in pixels",
      resetLabel: "terminal font size",
    },
    terminalFont: {
      title: "Terminal font",
      description:
        "Type any monospace font installed on this device (e.g. Fira Code). Leave empty for the default. Fonts that aren't installed fall back to the system monospace.",
      ariaLabel: "Terminal font family",
      resetLabel: "terminal font",
      placeholder: "Default (JetBrains Mono)",
      noSuggestions: "No matching suggested fonts.",
    },
    timeAndReading: "Time and reading",
    timeFormat: {
      title: "Time format",
      description: "System default follows your browser or OS clock preference.",
      resetLabel: "time format",
      options: { locale: "System default", "12-hour": "12-hour", "24-hour": "24-hour" },
    },
    restoreDefaults: "Restore defaults",
  },
  behavior: {
    runtimeBehavior: "Runtime behavior",
    assistantOutput: {
      title: "Assistant output",
      description: "Show token-by-token output while a response is in progress.",
      resetLabel: "assistant output",
      ariaLabel: "Stream assistant messages",
    },
    diffLineWrapping: {
      title: "Diff line wrapping",
      description:
        "Set the default wrap state when the diff panel opens. The in-panel wrap toggle only affects the current diff session.",
      resetLabel: "diff line wrapping",
      ariaLabel: "Wrap diff lines by default",
    },
    safetyConfirmations: "Safety confirmations",
    deleteConfirmation: {
      title: "Delete confirmation",
      description: "Ask before deleting a thread and its chat history.",
      resetLabel: "delete confirmation",
      ariaLabel: "Confirm thread deletion",
    },
    archiveConfirmation: {
      title: "Archive confirmation",
      description: "Ask before archiving a thread.",
      resetLabel: "archive confirmation",
      ariaLabel: "Confirm thread archive",
    },
    terminalCloseConfirmation: {
      title: "Terminal close confirmation",
      description: "Ask before closing a terminal tab and clearing its history.",
      resetLabel: "terminal close confirmation",
      ariaLabel: "Confirm terminal tab close",
    },
  },
  advanced: {
    session: {
      title: "Session",
      thisBrowser: {
        title: "This browser",
        description:
          "Revoke this browser session and close every live Synara connection it owns. A fresh pairing link is required to reconnect.",
      },
      authenticatedAs: (role: string) => `Authenticated as ${role}.`,
      signOut: "Sign out",
      signingOut: "Signing out...",
      signOutConfirm:
        "Sign out this browser?\n\nIts session and every live connection opened with it will be revoked.",
      signOutFailedTitle: "Sign out failed",
      signOutFailedDescription: "Unable to revoke this session.",
    },
    developerTools: {
      title: "Developer tools",
      keybindings: {
        title: "Keybindings",
        description:
          "Open the persisted `keybindings.json` file to edit advanced bindings directly.",
      },
      resolvingPath: "Resolving keybindings path...",
      opensInEditor: "Opens in your preferred editor.",
      openFile: "Open file",
      opening: "Opening...",
      noEditors: "No available editors found.",
      openFailed: "Unable to open keybindings file.",
      recovery: {
        title: "Recovery tools",
        description:
          "Rebuild local project indexes without clearing existing chats when the local state gets out of sync.",
      },
      recoveryVisible: "Visible because projects exist but no chat history is currently available.",
      recoveryHidden: "Shown automatically only when recovery actions are relevant.",
      repairState: "Repair state",
      repairing: "Repairing...",
      whatThisDoes: "What this does",
      whatThisDoesBody:
        "Rebuilds local project indexes and refreshes project snapshots. Existing chats stay in place.",
      repairConfirm: [
        "Repair local state?",
        "This rebuilds local project indexes and refreshes project snapshots.",
        "It keeps existing chats in place, but it may take a moment.",
      ].join("\n"),
      repairedTitle: "Local state repaired",
      repairedDescription: "Project indexes were rebuilt without clearing existing chats.",
      repairFailedTitle: "Repair failed",
      repairFailedDescription: "Unable to repair local state.",
    },
    about: {
      title: "About",
      version: { title: "Version", description: "Current application version." },
      releaseHistory: {
        title: "Release history",
        description:
          "A running log of every update, newest first. Same notes the post-update dialog shows, kept here so you can revisit them any time.",
      },
      viewReleaseHistory: "View release history",
    },
  },
  skills: {
    portable: "Portable skills",
    folder: {
      title: "Synara skills folder",
      description:
        "Skills placed here are available on every provider. When a provider already ships its own copy of a skill, that copy is used; otherwise Synara's copy is the fallback.",
    },
    scanning: "Scanning…",
    enabledCount: (enabled: number, total: number) =>
      `${enabled} of ${total} ${pluralize(total, "skill")} enabled`,
    sectionTitle: "Skills",
    discoveryFailed: {
      title: "Skill discovery failed",
      description:
        "Synara could not scan the skill folders. Retry after checking that the server is running.",
    },
    noneFound: {
      title: "No skills found",
      description:
        "Add a skill folder containing a SKILL.md to the Synara skills folder above, or install skills for any supported provider.",
    },
    providerCopies: (count: number, names: string) =>
      `Provider ${pluralize(count, "copy", "copies")}: ${names}`,
    enableSkill: (name: string) => `Enable the ${name} skill`,
    // Consumed as `SettingsSkillLabels` by skillsSettingsModel, which groups and titles the list.
    sharedSkills: "Shared skills",
    fromOrigin: (label: string) => `From ${label}`,
    noDescription: "No description.",
    origins: { shared: "Shared (.agents)", project: "Project", personal: "Personal" },
  },
  agentMcp: {
    sectionTitle: "MCP servers",
    overview: {
      title: "Agent MCP servers",
      description:
        "Servers your local Codex and Claude agents can call. Turning one off edits that agent's own config file; Synara never starts these servers itself.",
    },
    refresh: "Refresh",
    refreshing: "Refreshing...",
    loading: "Loading MCP servers...",
    readFailedTitle: "Could not read the agent configs",
    readFailedDescription: "Reading the local agent configuration failed.",
    sourceTitle: (provider: string) => `${provider} MCP servers`,
    parseError: (message: string) =>
      `This file could not be parsed, so its servers cannot be changed: ${message}`,
    notConfigured: "Not configured",
    noServers: "No servers",
    empty: {
      codex: "No MCP servers are declared in this Codex config.",
      claudeAgent: "No MCP servers are declared in this Claude config.",
    },
    unavailable: {
      codex: "No Codex configuration was found on this machine.",
      claudeAgent: "No Claude configuration was found on this machine.",
    },
    noCommand: "(no command)",
    updateFailedTitle: "Could not update the MCP server",
    updateFailedDescription: "The config file was not changed.",
  },
  worktrees: {
    loading: "Loading managed worktrees...",
    loadFailed: "Unable to load worktrees.",
    empty: "No app-managed worktrees found yet.",
    worktree: "Worktree",
    conversations: "Conversations",
    noLinkedConversations: "No conversations linked to this worktree.",
    delete: "Delete",
    linkedWarning: "Linked conversations exist. Deleting will ask for confirmation.",
    verifyFailedTitle: "Could not verify linked conversations",
    verifyFailedDescription: "Retry once the app reconnects to the server.",
    deleteConfirm: (name: string, activeCount: number, archivedCount: number) =>
      [
        `Delete worktree "${name}"?`,
        "",
        `${activeCount} active and ${archivedCount} archived ${pluralize(activeCount + archivedCount, "conversation is", "conversations are")} linked to this worktree.`,
        archivedCount > 0
          ? "Archived conversations will be deleted first."
          : "Deleting it can break reopening those chats in the same workspace.",
        "",
        "Delete the worktree anyway?",
      ].join("\n"),
    deleteConfirmUnlinked: (name: string) =>
      [`Delete worktree "${name}"?`, "This removes the Git worktree from disk."].join("\n"),
    deletedTitle: "Worktree deleted",
    deletedDescription: (name: string) => `${name} was removed.`,
    deletedWithArchived: (name: string, archivedCount: number) =>
      `${name} was removed and ${archivedCount} archived ${pluralize(archivedCount, "conversation")} were deleted.`,
    deleteFailedTitle: "Could not delete worktree",
    deleteFailedDescription: "Unable to delete the worktree.",
  },
  archived: {
    emptyTitle: "No archived threads",
    emptyDescription: "Archived threads will appear here and can be restored to the sidebar.",
    unknownProject: "Unknown project",
    archivedAt: (relative: string) => `Archived ${relative}`,
    restore: "Restore",
    delete: "Delete",
    restoredTitle: "Thread restored",
    restoredDescription: "The thread has been moved back to the sidebar.",
    restoreFailedTitle: "Could not restore thread",
    restoreFailedDescription: "Unable to restore the thread.",
    deleteConfirm: (title: string) =>
      `Permanently delete "${title}"?\n\nThis will remove the thread and its conversation history forever.`,
    deletedTitle: "Thread deleted",
    deletedDescription: "The archived thread has been permanently removed.",
    deleteFailedTitle: "Could not delete thread",
    deleteFailedDescription: "Unable to delete the thread.",
  },
  shortcuts: {
    searchPlaceholder: "Search shortcuts...",
    searchAriaLabel: "Search shortcuts",
    command: "Command",
    keybinding: "Keybinding",
    noMatches: (query: string) => `No shortcuts match “${query}”.`,
  },
  providerUsage: {
    title: "Provider usage",
    refresh: "Refresh",
    loading: "Loading provider usage…",
    footnote:
      "Usage is read locally from each provider CLI's stored credentials and fetched directly from the provider. OAuth providers may refresh short-lived tokens through their official token endpoint; if a provider shows “Not signed in”, re-authenticate with its CLI.",
  },
  appSnapShortcut: {
    recordAriaLabel: "Record AppSnap shortcut",
    pressTwoKeys: "Press two keys…",
    save: "Save",
    reset: "Reset",
    nowPressOther: "Now press the other key…",
    holdModifier: "Hold a modifier, then press one other key. Esc cancels.",
    checking: "Checking macOS and other apps…",
    available: "Available — save to apply.",
    checkBeforeSaving: "Check a new combination before saving.",
    availableReserved: "Available and reserved",
    current: "Current shortcut",
    conflictCommand: (label: string) => `Synara already uses this for “${label}”.`,
    requiresDesktop: "Requires the Synara desktop app on macOS.",
    checkFailed: "Could not check this shortcut.",
    unsupportedKey: "That key isn't supported — try another.",
    holdModifierFirst: "Hold ⌘, ⌃, ⌥ or ⇧ first, then press the other key.",
    holdOnlyOne: "Hold only one modifier.",
    savedTitle: "AppSnap shortcut saved",
    savedEnabled: "The shortcut is reserved while AppSnap is enabled.",
    savedDisabled: "The shortcut will be reserved when you enable AppSnap.",
    savedUnavailableTitle: "AppSnap shortcut saved, but unavailable",
  },
};

export type Settings = typeof settings;
