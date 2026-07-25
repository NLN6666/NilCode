// FILE: locales/en/settings.ts
// Purpose: English copy for the settings screen. Also defines the key structure every other locale must match.
//
// Deliberately NOT `as const`: literal types would force translations to equal the English
// string. Plain inference gives each entry type `string`, so other locales are constrained by
// structure while free in value.

export const settings = {
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
      },
      threadOrder: {
        title: "Thread order",
        description: "Controls how threads are arranged inside each project in the main sidebar.",
        ariaLabel: "Thread sort order",
        resetLabel: "thread order",
      },
    },
  },
};

export type Settings = typeof settings;
