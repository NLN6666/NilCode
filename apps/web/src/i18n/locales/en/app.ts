// FILE: locales/en/app.ts
// Purpose: English copy for the app shell — window chrome, navigation, toasts, the root
//          connecting/error screens, and the chat landing page.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

import { pluralize } from "@synara/shared/text";

export const app = {
  nav: {
    back: "Back",
    forward: "Forward",
    backWithShortcut: (shortcut: string) => `Back (${shortcut})`,
    forwardWithShortcut: (shortcut: string) => `Forward (${shortcut})`,
  },

  window: {
    minimize: "Minimize",
    close: "Close",
  },

  recentViews: {
    label: "Recent views",
    current: "Current",
    splitView: "Split view",
    pinned: "Pinned",
  },

  toast: {
    dismiss: "Dismiss toast",
    undo: "Undo",
    orViewArchivedIn: "or view archived chats in",
    settings: "Settings",
  },

  /** Background thread-retention sweep, surfaced as a single long-lived toast. */
  maintenance: {
    archivingTitle: "Archiving old chats...",
    preparing: "Preparing background maintenance.",
    archivedOfTotal: (archived: number, total: number) => `${archived} of ${total} chats archived.`,
    archivedCount: (archived: number) => `${archived} ${pluralize(archived, "chat")} archived.`,
    pausedTitle: "Chat maintenance paused",
    pausedDescription: "Old chats will be retried later.",
    archivedTitle: "Old chats archived",
    /** The destination is Settings → Archived, where the sweep's chats can be restored. */
    archivedDescription: (archived: number) =>
      `${archived} old ${pluralize(archived, "chat")} moved to Settings → Archived, where you can restore them.`,
    archivedNone: "No old chats needed archiving.",
  },

  ui: {
    close: "Close",
    remove: "Remove",
    loading: "Loading",
    sidebar: "Sidebar",
    sidebarDescription: "Displays the mobile sidebar.",
    toggleSidebar: "Toggle Sidebar",
  },

  root: {
    connecting: (appName: string) => `Connecting to ${appName} server...`,
    buildLine: (client: string, server: string) => `Client ${client} · Server ${server}`,
    updateClient: "This Synara client needs an update.",
    updateServer: "The Synara server needs an update.",
    reconnect: "Synara needs to reconnect with a matching build.",
    updateClientGuidance: "Update or reload this client, then reconnect.",
    updateServerGuidance: "Update or restart the server, then reload this client.",
    reconnectGuidance:
      "Reload the app. If this repeats, restart Synara so the client and server use matching builds.",
    reloadApp: "Reload app",
    somethingWentWrong: "Something went wrong.",
    tryAgain: "Try again",
    showErrorDetails: "Show error details",
    hideErrorDetails: "Hide error details",
  },

  chat: {
    loadingModels: "Loading models",
    threads: "Threads",
    noActiveThread: "No active thread",
    selectThread: "Select a thread or create a new one to get started.",
    temporary: "Temporary",
    temporaryChat: "Temporary chat",
    temporaryOn: "Temporary chat — deleted when you leave. Click to keep it.",
    temporaryOff: "Make this a temporary chat (deleted when you leave)",
    planModeActive: "Plan mode — click to return to normal build mode",
    plan: "Plan",
    stopGeneration: "Stop generation",
    stopGenerationHint: "Stop the current response. On Mac, press Ctrl+C to interrupt.",
    implementationActions: "Implementation actions",
    implementInNewThread: "Implement in a new thread",
    synaraLogo: "Synara logo",
    whatShouldWeWorkOn: "What should we work on?",
    whatShouldWeDoIn: "What should we do in",
  },

  featureFlags: {
    label: "Feature flags",
    local: "Local feature flags",
    storedLocally: "Stored only in this browser profile.",
  },

  providerUsage: {
    scanning: "Scanning local usage data for the selected provider.",
    noneForProvider: "No local usage data was found yet for the selected provider.",
    none: "No local usage data was found yet.",
    learnMore: "Learn more",
  },
};
