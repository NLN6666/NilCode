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
    /** Trigger status when the prompt itself pinned the effort rather than the picker. */
    ultrathink: "Ultrathink",
    thinking: (enabled: boolean) => `Thinking ${enabled ? "On" : "Off"}`,
  },

  /** Editor placeholder, resolved against whatever the composer is waiting on. */
  placeholder: {
    approval: "Resolve this approval request to continue",
    pendingAnswer: "Type your answer to continue",
    pendingAnswerWithOptions:
      "Type your own answer, or leave this blank to use the selected option",
    planFollowUp: "Add feedback to refine the plan, or leave this blank to implement it",
    subagent: "Message this subagent while it works",
    liveTurn: "Ask for follow-up changes",
    disconnected: "Ask for follow-up changes or attach images",
    idle: "Ask anything, @tag files/folders, or use / to show available commands",
  },

  /**
   * Secondary line on each built-in slash-command row. Also feeds the menu's ranking, so a
   * translated catalog makes the commands searchable in that language too.
   */
  slashCommands: {
    clear: "Start a fresh thread and clear the current conversation context",
    compact: "Compact the current thread context to free space",
    model: "Switch response model for this thread",
    plan: "Switch this thread into plan mode",
    default: "Switch this thread back to normal chat mode",
    review: "Start a code review for current changes",
    fork: "Fork this thread into local or a new worktree",
    side: "Open a guarded Side from this thread",
    status: "Show context usage and rate-limit status",
    subagents: "Insert a prompt that asks the assistant to delegate work",
    fast: "Turn fast mode on or off for this thread",
    export: "Download this thread as a ZIP archive (thread.json + transcript.md)",
    feedback: "Send feedback to the Synara team",
    automation: "Create a scheduled automation from this prompt",
  },

  commandMenu: {
    files: "Files",
    filesHint: "Type to search for files",

    /** Section headings in the mention (`@`) and slash (`/`) menus. */
    groups: {
      plugins: "Plugins",
      chats: "Chats",
      subagents: "Your agents",
      builtInAgents: "Synara agents",
      models: "Models",
      modes: "Modes",
      local: "Local",
      builtIn: "Built-in",
      provider: "Provider",
      skills: "Skills",
    },

    /**
     * Titles for Synara's own slash commands. Provider-native commands are not listed
     * here: their title is humanized from the command id the provider reports.
     */
    commands: {
      clear: "Clear",
      compact: "Compact Context",
      model: "Model",
      fast: "Fast Mode",
      plan: "Plan Mode",
      default: "Default Mode",
      review: "Code Review",
      fork: "Fork",
      side: "Sidechat",
      status: "Status",
      subagents: "Subagents",
      feedback: "Feedback Synara",
    },

    /**
     * The `@Preview` row. It is a mode switch for the turn being sent, not an object that can
     * be referenced, so the copy describes what the reply will look like. `keywords` never
     * renders — it only feeds ranking, so the row stays reachable in the active language.
     */
    colorPreview: {
      description: "Answer this turn with color themes as previewable swatch cards",
      keywords: "color theme palette swatch preview",
    },

    /** Right-aligned kind label on each row. */
    meta: {
      switchModel: "switch model",
      delegateTask: "delegate task to subagent",
      plugin: "Plugin",
      local: "Local",
      unavailable: "Unavailable",
      mcpServer: "MCP server",
      mcpTool: "MCP tool",
      model: "Model",
    },

    loading: {
      mentions: "Searching mentions...",
      skills: "Loading skills...",
      mcp: "Connecting to MCP servers...",
      commands: "Loading commands...",
    },

    empty: {
      mention: "No matching plugin, chat, or file.",
      skill: "No matching skill.",
      mcp: "No MCP tools are configured for this agent.",
      command: "No matching command.",
    },
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

    /** Short reasons shown in place of the raw fs/Effect stack trace. */
    errors: {
      notFound: "Folder not found.",
      permissionDenied: "Permission denied.",
      notAFolder: "Not a folder.",
      loadFailed: "Unable to load folders.",
      appConnecting: "App is still connecting. Try again in a moment.",
    },
  },

  subagents: {
    expandStrip: "Expand subagent strip",
    collapseStrip: "Collapse subagent strip",
    stopAll: "Stop all subagents",
    stopAllTitle: "Stop all running subagents",
    runInBackground: "Run in background (ctrl+b)",
    stop: "Stop subagent",
  },

  queued: {
    /** Fallback preview title when the queued prompt has no usable first line. */
    defaultTitle: "Queued follow-up",
    codeBlock: "Code block",
    steer: "Steer",
    /** Providers without a native steer have to stop the live turn first, so the
     *  action is labelled for what it actually does rather than for what steering
     *  means on Codex. */
    steerInterrupt: "Send now",
    steerHint: "Send this into the running turn",
    steerInterruptHint: "Stops the current response, then sends this message",
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

    /** Keyed by the request kind the provider reported. */
    prompts: {
      command: "Approve this command?",
      "file-read": "Approve reading this file?",
      "file-change": "Approve this file change?",
      permissions: "Grant these permissions?",
    },

    permissionProfileTitle: "Requested permission profile",

    actions: {
      acceptOnce: { label: "Approve once", description: "Allow just this request" },
      acceptForSession: {
        label: "Always allow this session",
        description: "Don't ask again this session",
      },
      decline: { label: "Decline", description: "Reject and let the agent continue" },
      cancelTurn: { label: "Cancel turn", description: "Stop the current turn" },
    },
  },

  planBanner: {
    ready: "Plan ready",
  },

  /** Collapsible banner listing the turn's active task list. */
  taskBanner: {
    expand: "Expand task banner",
    collapse: "Collapse task banner",
  },

  liveChanges: {
    filesChanged: "Files changed",
    filesChangedCount: (count: number) => `${count} ${count === 1 ? "file" : "files"} changed`,
  },

  voice: {
    record: "Record voice note",
    transcribing: "Transcribing voice note",
    stop: (duration: string) => `Stop voice note (${duration})`,
    cancel: "Cancel voice note",
    send: "Send voice note",
  },

  attachments: {
    readFailed: "Could not read attachment data.",
    readError: "Failed to read attachment.",
    /** Thrown when the OS reports the file vanished — usually a path-escaping problem. */
    pathProblem: (name: string) =>
      `Could not read '${name}'. Paths with spaces or special characters may need a path mention (@"…") instead of a file attachment.`,
    unnamedItem: "item",
    remove: "Remove attachment",
    removeSelections: "Remove selections",
    unknownType: "Unknown type",
    /** Fallback name for an AppSnap capture whose source app did not report one. */
    capturedApp: "Captured app",
    showText: "Show text",
    hideText: "Hide text",
    draftWarningLabel: "Draft attachment may not persist",
    draftWarningDescription: "Draft attachment is kept in memory and may be lost on navigation.",
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
    envLocal: "Local",
    envWorktree: "Worktree",
    envWorktreePending: "New worktree (pending)",
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
    rateLimitReached: "Rate limit reached.",
    rateLimitApproaching: (utilization: string | null) =>
      utilization === null
        ? "Approaching rate limit."
        : `Approaching rate limit (${utilization} used).`,
    /** Appended to either rate-limit sentence; keep the leading space. */
    rateLimitResetsAt: (time: string) => ` Resets at ${time}.`,
    noRateLimitWarning: "No active rate-limit warning for this thread.",
    close: "Close",
  },
};
