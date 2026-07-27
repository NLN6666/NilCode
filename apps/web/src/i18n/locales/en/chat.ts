// FILE: locales/en/chat.ts
// Purpose: English copy for the chat surface — the message timeline, its context-window meter,
//          and the chat header rail.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.
//
// Entries that embed a value are functions rather than templates with a placeholder, because
// the text around the value moves in translation (a Chinese colon is full-width, and units
// follow the number instead of preceding the noun).

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
    loadingDiffViewer: "Loading diff viewer...",
    selectFileFromTree: "Select a file from the tree to view it.",
    clickFileToPreview: "Click a file in the chat to preview it here.",
    addPanel: "Add panel",
    collapsePanel: "Collapse panel",
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
  },

  /** Rows inside the work timeline. */
  work: {
    summary: "Summary",
    rawCall: "Raw call",
    latest: "Latest",
    moreToolUses: (count: number) => `+${count} more tool uses`,
    openThread: "Open thread",
    edited: "Edited",
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

  header: {
    chatHistory: "Chat history",
    noChatsInProject: "No chats in this project yet",
    newEditorRailItem: "New editor rail item",
    newChat: "New chat",
    newTerminal: "New terminal",
    terminal: "Terminal",
    toggleDiffPanel: "Toggle diff panel",
    closeSelectedSide: "Close selected Side",
    handOff: "Hand off",
    handoffTo: (provider: string) => `Handoff to ${provider}`,
  },
};

export type Chat = typeof chat;
