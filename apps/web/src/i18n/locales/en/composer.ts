// FILE: locales/en/composer.ts
// Purpose: English copy for the chat composer — its extras menu, pickers, the local directory
//          browser, the queued/subagent strips, and the /status dialog.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const composer = {
  extras: {
    menu: "Composer extras",
    addImage: "Add image",
    planMode: "Plan mode",
    fast: "Fast",
    default: "Default",
  },

  modelPicker: {
    ariaLabel: "Change model and reasoning",
    tooltip: "Change model",
  },

  commandMenu: {
    files: "Files",
    filesHint: "Type to search for files",
  },

  /** Local file/folder browser opened from the composer. */
  directory: {
    goUp: "Go up one directory",
    useThisFolder: "Use this folder",
    matchesDeeper: "Matches deeper",
    awaitingHomeDir: "Waiting for home directory from server…",
    loading: "Loading local files…",
    searching: "Searching nested files…",
    noMatches: "No matches.",
    empty: "No files or folders here.",
    topMatches: "Showing top matches. Keep typing to narrow.",
  },

  subagents: {
    stopAll: "Stop all subagents",
    stopAllTitle: "Stop all running subagents",
    runInBackground: "Run in background (ctrl+b)",
    stop: "Stop subagent",
  },

  queued: {
    steer: "Steer",
    delete: "Delete queued follow-up",
    menu: "Queued follow-up actions",
    edit: "Edit queued prompt",
    deletePrompt: "Delete queued prompt",
  },

  pendingInput: {
    previousQuestion: "Previous question",
    nextQuestion: "Next question",
    progress: (index: number, total: number) => `${index} of ${total}`,
    selectMultiple: "Select one or more.",
    cancel: "Cancel",
  },

  pendingApproval: {
    reviewToContinue: "Review the request to continue.",
  },

  planBanner: {
    ready: "Plan ready",
  },

  attachments: {
    readFailed: "Could not read attachment data.",
    readError: "Failed to read attachment.",
    /** Thrown when the OS reports the file vanished — usually a path-escaping problem. */
    pathProblem: (name: string) =>
      `Could not read '${name}'. Paths with spaces or special characters may need a path mention (@"…") instead of a file attachment.`,
    unnamedItem: "item",
  },

  /** The `/status` dialog: a read-only snapshot of the active thread's runtime. */
  status: {
    title: "Session Status",
    description: "Runtime controls and local thread state for the active composer.",
    model: "Model",
    fastMode: "Fast Mode",
    on: "On",
    off: "Off",
    reasoning: "Reasoning",
    defaultEffort: "Default",
    mode: "Mode",
    planMode: "Plan",
    defaultMode: "Default",
    environment: "Environment",
    branch: "Branch",
    unknown: "Unknown",
    contextWindow: "Context Window",
    contextWindowHint: "Latest usage reported by the active thread.",
    sessionWindows: (current: string, next: string) =>
      `Current session: ${current}. Next turn: ${next}.`,
    used: "Used",
    remaining: "Remaining",
    window: "Window",
    cost: "Cost",
    costUnavailable: "Not available",
    noContextUsage: "Context usage has not been reported yet for this thread.",
    rateLimits: "Rate Limits",
    noRateLimitWarning: "No active rate-limit warning for this thread.",
    close: "Close",
  },
};
