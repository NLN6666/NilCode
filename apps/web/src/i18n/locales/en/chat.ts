// FILE: locales/en/chat.ts
// Purpose: English copy for the chat surface — the message timeline, its context-window meter,
//          and the chat header rail.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.
//
// Entries that embed a value are functions rather than templates with a placeholder, because
// the text around the value moves in translation (a Chinese colon is full-width, and units
// follow the number instead of preceding the noun).

import { pluralize } from "@synara/shared/text";

export const chat = {
  timeline: {
    preparingWorktree: "Preparing worktree...",
    editMessage: "Edit message",
    editAndResend: "Edit and resend",
    revertToMessage: "Revert to this message",
    undo: "Undo",
    /** Followed by the running elapsed clock, e.g. "Working for 1m 4s". */
    workingFor: "Working for",
    thinking: "Thinking",
    emptyConversation: "Send a message to start the conversation.",
    cancel: "Cancel",
    send: "Send",
  },

  contextWindow: {
    title: "Context window",
    unknown: "Unknown",
    currentSession: (window: string) => `Current session: ${window}`,
    nextTurn: (window: string) => `Next turn: ${window}`,
    /** Trails the used/total token pair, e.g. "12k / 200k context used". */
    contextUsed: "context used",
    /** Trails a bare token count when no window size is known. */
    tokensUsedSoFar: "tokens used so far",
    modelWindow: (tokens: string) => `Model window: ${tokens} tokens`,
    /** Shown only when the session compacts below the model's full window. */
    compactsAt: (tokens: string) => `Compacts at: ${tokens} tokens`,
    totalProcessed: (tokens: string) => `Total processed: ${tokens} tokens`,
    autoCompacts: "Automatically compacts its context when needed.",
    sessionCost: (cost: string) => `Session cost: ${cost}`,
  },

  /** Workflow run card in the composer stack. */
  workflow: {
    openThread: "Open thread",
    prompt: "Prompt",
    recent: "Recent",
    resume: "Resume workflow",
    dismiss: "Dismiss workflow panel",
    pause: "Pause workflow",
    pauseHint: "Pause workflow (resume replays completed agents from cache)",
    stop: "Stop workflow",
    noAgents: "No agents yet",
    saved: "Saved",
    copyScriptPath: "Copy script path and run id",
  },

  /** Expanded tool-call payload dialog. */
  toolCall: {
    noPayload: "No detailed payload was available for this tool call.",
    arguments: "Arguments",
    files: "Files",
    diff: "Diff",
    edits: "Edits",
    before: "Before",
    after: "After",
    writtenContent: "Written Content",
    /** Live activity metadata shown while a tool call is still running. */
    liveActivity: "Activity",
    liveStatus: "Status",
    liveStarted: "Started",
    liveLastActivity: "Last activity",
    liveElapsed: "Elapsed",
    liveProgress: "Progress",
    liveDetail: "Detail",
    exitCode: (code: number) => `Exit code ${code}`,
    truncated: "Truncated",
    output: "Output",
    stdout: "Stdout",
    stderr: "Stderr",
  },

  /** Effort / context / speed picker in the composer toolbar. */
  traits: {
    fastMode: "Fast mode",
    thinking: "Thinking",
    onDefault: "On (default)",
    off: "Off",
    context: "Context",
    variant: "Variant",
    effort: "Effort",
    ultrathinkLocked: "Remove Ultrathink from the prompt to change effort.",
    speed: "Speed",
    default: "Default",
    fast: "Fast",
    trigger: "Change effort, context, and speed",
    options: "Options",
  },

  /** Right-dock panes and split-surface placeholders. */
  panes: {
    comingSoon: (label: string) => `${label} panel is coming soon.`,
    loadingBrowser: "Loading browser...",
    loadingPullRequest: "Loading pull request...",
    terminalSleeping: "Terminal is sleeping. Restoring shortly.",
    loadingTerminal: "Loading terminal...",
    loadingGit: "Loading Git...",
    loadingExplorer: "Loading explorer...",
    loadingFile: "Loading file...",
    loadingSidechat: "Loading side chat...",
    loadingDiffViewer: "Loading diff viewer...",
    selectFileFromTree: "Select a file from the tree to view it.",
    clickFileToPreview: "Click a file in the chat to preview it here.",
    /** Dock tab + add-menu names, keyed by pane kind. `fallback` covers stale persisted kinds. */
    kinds: {
      browser: "Browser",
      diff: "Diff",
      explorer: "Explorer",
      file: "File",
      terminal: "Terminal",
      sidechat: "Side chats",
      git: "Git",
      pullRequest: "Pull request",
      fallback: "Panel",
    },

    /**
     * Empty-dock launcher names. These read as workspace tools rather than dock
     * tabs, so a kind may present differently here than in `kinds`; any kind
     * absent from this map falls back to its `kinds` label.
     */
    launchers: {
      diff: "Review",
      explorer: "Files",
      sidechat: "Side chats",
      git: "Source control",
    },

    closePane: (label: string) => `Close ${label}`,
    addPanel: "Add panel",
    collapsePanel: "Collapse panel",

    /** The terminal stacked under the browser preview in the same dock pane. */
    serviceTerminal: {
      title: "Terminal",
      expand: "Expand terminal",
      collapse: "Collapse terminal",
      resize: "Resize terminal",
      /** Shown on the collapsed bar when exactly one action's service is alive. */
      running: (scriptName: string) => `${scriptName} running`,
      runningCount: (count: number) => `${count} services running`,
    },
  },

  split: {
    selectChat: "Select a chat",
    chooseChat: "Choose Chat",
    chooseChatHint: "Pick which chat should appear in the focused split pane.",
    cancel: "Cancel",
  },

  /** Workspace file explorer in the dock. */
  explorer: {
    loadingDirectory: "Loading directory...",
    noWorkspace: "No workspace.",
    searchPlaceholder: "Search files...",
    searchLabel: "Search files",
    noMatches: "No matching files.",
    topMatches: "Showing the top matches. Refine the search to narrow them down.",
    searchHint: "Search files by name or path.",
  },

  /** Subagent activity detail view. */
  activity: {
    back: "Back",
    prompt: "Prompt",
    result: "Result",
    agents: "Agents",
    activity: "Activity",
    open: "Open",
    /** Count of compacted updates behind one activity row. */
    updates: (count: number) => `${count} ${pluralize(count, "update")}`,
    /** Same count joined to the latest line; the separator differs per script. */
    updatesWithPreview: (count: number, preview: string) =>
      `${count} ${pluralize(count, "update")} - ${preview}`,

    /** Row headings. `agentActivity.logic` returns these as keys so it stays locale-free. */
    titles: {
      reasoning: "Reasoning",
      reasoningTrace: "Reasoning trace",
      agentTask: "Agent task",
      activity: "Activity",
    },

    /** Per-subagent metadata and conversation preview inside the detail view. */
    subagent: {
      section: "Agents",
      model: "Model",
      role: "Role",
      status: "Status",
      effort: "Effort",
      background: "Background",
      backgroundOn: "Yes",
      showConversation: "Show conversation",
      hideConversation: "Hide conversation",
      openFullConversation: "Open full conversation",
      /** Why the open button is disabled: the child thread was never resolved. */
      noThread: "This agent has no conversation to open.",
      noMessages: "No messages yet.",
      earlierMessages: (count: number) => `+${count} earlier ${pluralize(count, "message")}`,
      roles: {
        user: "You",
        assistant: "Agent",
        system: "System",
      },
    },
  },

  /** Rows inside the work timeline. */
  work: {
    summary: "Summary",
    rawCall: "Raw call",
    latest: "Latest",
    moreToolUses: (count: number) => `+${count} more tool uses`,
    openThread: "Open thread",
    edited: "Edited",
    files: (count: number) => `${count} ${pluralize(count, "file")}`,
    collapseDetails: "Collapse details",
  },

  /** Header above a previewed workspace file. */
  filePreview: {
    filePath: "File path",
    shownPartially: "Shown partially",
    markdownView: "Markdown view",
    source: "Source",
    sourceHint: "Source view — select text to reference exact lines in chat",
    moreActions: "More actions",
    referenceInChat: "Reference in chat",
    askWhyChanged: "Ask why this changed",
  },

  /** Chat environment side panel and its collapsible sections. */
  environment: {
    title: "Environment",
    toggle: "Toggle environment panel",
    panelSections: "Panel sections",
    recap: "Recap",
    changes: "Changes",
    repository: "Repository",
    editor: "Editor",
    editorView: "Editor view",
    notepad: "Notepad",
    notepadPlaceholder: "Type here",
    projectInstructions: "Project instructions",
    projectInstructionsPlaceholder: "Architecture notes, conventions, repo links",
    markers: "Markers",
    pinned: "Pinned",
    output: "Output",
    usage: "Usage",
    automations: "Automations",
    paused: "Paused",
    localServers: "Local Servers",
    refreshLocalServers: "Refresh local servers",
    refresh: "Refresh",
    scanningPorts: "Scanning local ports",
    scanFailed: "Couldn't scan local ports",
    noServers: "No servers running",
    noServersHint: "Local dev servers will appear here.",
  },

  /** Message-level affordances in the transcript. */
  message: {
    copy: "Copy message",
    copyTooltip: "Copy to clipboard",
    scrollToBottom: "Scroll to bottom",
    navigation: "Message navigation",
    showInTextField: "Show in text field",
    sentFromAnotherThread: "Sent by Synara from another thread",
    openSourceThread: "Open source thread",
    dismissError: "Dismiss error",
    unblockThread: "Unblock thread",
    unblockingThread: "Unblocking…",
    dismissProviderStatus: "Dismiss provider status",
    dismissRateLimitStatus: "Dismiss rate limit status",
    openThread: "Open thread",
    open: "Open",
  },

  /** Floating toolbar shown over a transcript text selection. */
  selection: {
    label: "Selection actions",
    highlight: "Highlight",
    underline: "Underline",
    addToChat: "Add to chat",
  },

  /** Expanded image lightbox and generated-image affordances. */
  image: {
    preview: "Expanded image preview",
    close: "Close image preview",
    previous: "Previous image",
    next: "Next image",
    expand: "Expand",
    expandGenerated: "Expand generated image",
    download: "Download",
    downloadGenerated: "Download generated image",
  },

  /** Inline "comment on this line" box in the file viewer. */
  lineComment: {
    localComment: "Local comment",
    commentOn: (line: string) => `Comment on ${line}`,
    /**
     * Display-only line range. The `<file_comments>` prompt block keeps its own
     * English form (see `serializeFileCommentRange`) because it is parsed back out
     * by FILE_COMMENT_HEADER_PATTERN — never feed this into the prompt.
     */
    range: (startLine: number, endLine: number) =>
      startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`,
    placeholder: "Request change",
    cancel: "Cancel",
    submit: "Comment",
  },

  tasks: {
    completed: (done: number, total: number) => `${done} out of ${total} tasks completed`,
    openSidebar: "Open tasks sidebar",
  },

  openIn: {
    group: "Open in editor",
    open: "Open",
    options: "Editor options",
    noEditors: "No installed editors found",
  },

  hydration: {
    loading: "Loading conversation",
    failed: "This conversation didn't load.",
    retry: "Try again",
  },

  modelPicker: {
    loading: "Loading models",
    comingSoon: "Coming soon",
    change: "Change model",
  },

  emptyState: {
    logo: "Synara logo",
    letsBuild: "Let's build",
  },

  plan: {
    badge: "Plan",
    downloadToPlanFolder: "Download to .plan folder",
    exportMarkdown: "Export markdown file",
  },

  /** The advisor's note card in the transcript. */
  advisor: {
    label: "Advisor",
    severity: {
      nit: "nit",
      concern: "concern",
      blocker: "blocker",
    },
    /** How far the note got: the agent was interrupted, will see it next turn, or never received it. */
    channel: {
      steer: "Interrupted this turn",
      aside: "Queued for the next turn",
      preserve: "Not sent to the agent",
    },
  },

  /** Color-theme preview cards rendered from ```theme / ```html theme fences. */
  themePreview: {
    label: "Color theme",
    htmlTitle: "Theme preview",
    adopt: "Adopt",
    adoptSent: "Sent",
    adoptFailed: "Could not send. Try again.",
    copyAll: "Copy all",
    copied: "Copied",
    copyHex: (hex: string) => `Copy ${hex}`,
    expand: "Expand preview",
    collapse: "Collapse preview",
    /** Sentences of the message sent to the agent when a palette is adopted. */
    adoptionNamedHeading: (name: string) => `Confirmed color theme "${name}":`,
    adoptionHeading: "Confirmed color theme:",
    adoptionRequest: "Please apply it to the project.",
  },

  header: {
    chatHistory: "Chat history",
    noChatsInProject: "No chats in this project yet",
    newEditorRailItem: "New editor rail item",
    newChat: "New chat",
    newTerminal: "New terminal",
    terminal: "Terminal",
    toggleDiffPanel: "Toggle diff panel",
    toggleRightSidebar: "Toggle right sidebar",
    closeSelectedSide: "Close selected Side",
    handOff: "Hand off",
    handoffTo: (provider: string) => `Handoff to ${provider}`,
  },
};

export type Chat = typeof chat;
