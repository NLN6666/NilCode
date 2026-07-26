// FILE: locales/en/settings.ts
// Purpose: English copy for the settings screen. Also defines the key structure every other locale must match.
//
// Deliberately NOT `as const`: literal types would force translations to equal the English
// string. Plain inference gives each entry type `string`, so other locales are constrained by
// structure while free in value.
//
// On/off rows carry the exact four keys `renderBooleanSettingRow` needs, so a call site is just
// `renderBooleanSettingRow({ settingKey: "…", ...m.settings.general.sidebarSections.chats })`.

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
};

export type Settings = typeof settings;
