// FILE: locales/en/sidebar.ts
// Purpose: English copy for the main sidebar — primary actions, sort menus, the help menu,
//          project and thread rows, and the project context menu.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const sidebar = {
  actions: {
    search: "Search",
    newThread: "New thread",
    newStudioChat: "New studio chat",
    addProject: "Add project",
    kanban: "Kanban",
    pullRequests: "Pull requests",
    automations: "Automations",
    settings: "Settings",
    openNewChatHome: "Open new chat home",
    showMore: "Show more",
    showLess: "Show less",
    cancel: "Cancel",
    customize: "Customize",
    customizeSidebar: "Customize sidebar",
    done: "Done",
    hideItem: (label: string) => `Hide ${label} from the sidebar`,
    showItem: (label: string) => `Show ${label} in the sidebar`,
    reorderItem: (label: string) => `Reorder ${label}`,
  },

  sort: {
    projects: "Sort projects",
    threads: "Sort threads",
    chats: "Sort chats",
  },

  help: {
    menu: "Help",
    whatsNew: "What’s new",
    versionFallback: (version: string) => `Version ${version}`,
    fullChangelog: "Full changelog",
    keyboardShortcuts: "Keybindings",
    sendFeedback: "Send feedback",
    docs: "Docs",
  },

  /** The Studio/Projects segmented control, and the list headings under each. */
  views: {
    threads: "Projects",
    studio: "Studio",
  },
  rail: {
    home: "Home",
    spaces: "Spaces",
    shortcuts: "Shortcuts",
    backToSpaces: "Back to spaces",
    noThreads: "No threads yet",
    newTerminal: "New terminal thread",
    newTerminalShortcut: (shortcut: string) => `New terminal thread (${shortcut})`,
    newTerminalFor: (project: string) => `Create new terminal thread in ${project}`,
    newThreadFor: (project: string) => `Create new thread in ${project}`,
    newThreadShortcut: (shortcut: string) => `New thread (${shortcut})`,
    viewPullRequestsFor: (project: string) => `View pull requests for ${project}`,
  },

  /** App-switcher pill that swaps the sidebar's top-level surface. */
  surfacePicker: {
    ariaLabel: "Switch sidebar surface",
    threads: { title: "Synara", description: "Build, debug, and ship" },
    studio: { title: "Studio", description: "Open-ended agent work" },
  },

  projects: {
    loading: "Loading projects",
    loadingEllipsis: "Loading projects...",
  },

  chats: {
    title: "Chats",
    empty: "No chats yet",
  },

  thread: {
    archive: "Archive thread",
    pinned: "Pinned",
    temporary: "Temporary chat",
    pendingApproval: "Pending approval",
    pendingBadge: "Pending",
    showSubagents: (count: number) => `Show ${count} subagent${count === 1 ? "" : "s"}`,
    hideSubagents: (count: number) => `Hide ${count} subagent${count === 1 ? "" : "s"}`,
  },

  space: {
    noProjects: "No projects yet",
    moveProjectsHere: "Move projects here",
    toggleThreadSidebar: "Toggle thread sidebar",
  },

  // Right-click menu on a project row. "Void" is the product's name for "no space", not a
  // description of one, so it stays in English alongside Studio and AppSnap.
  projectMenu: {
    openInFinder: "Open in Finder",
    openInKanban: "Open in Kanban",
    copyPath: "Copy Path",
    stopDev: "Stop dev",
    startDev: "Start dev",
    openDevServer: "Open dev server",
    moveToSpace: "Move to space",
    voidSpace: "Void",
    newSpace: "New space…",
    editName: "Edit name",
    editProject: "Edit project",
    changePath: "Change project path…",
    // Toggle: every thread in the project drives one browser, or each keeps its own.
    useSharedBrowser: "Share one browser",
    useSeparateBrowsers: "Use a browser per thread",
    shareBrowserFailed: "Unable to share this project's browser",
    separateBrowsersFailed: "Unable to give each thread its own browser",
    archiveThreads: "Archive threads",
    deleteThreads: "Delete threads",
    remove: "Remove",
  },

  devServer: {
    running: "Dev server running",
    startTitle: "Start dev",
    commandLabel: "Command",
    commandPlaceholder: "e.g. npm run dev",
    commandHint: "Enter a command to run.",
  },

  renameProject: {
    title: "Rename project",
    description: "Keep it short and recognizable.",
  },

  // Cmd-K palette: search, project browsing, and provider thread import.
  searchPalette: {
    importTitle: "Import thread from provider",
    importDescription: "Create a local app thread and resume it from an existing provider id.",
    providerLabel: "Provider",
    noImportProviders: "No connected providers expose chat import in this build.",
    threadId: "Thread ID",
    sessionId: "Session ID",
    importClaudePlaceholder: "Paste a Claude session id",
    importCursorPlaceholder: "Paste a Cursor session id",
    importOpenCodePlaceholder: "Paste an OpenCode session id",
    importOmpPlaceholder: "Paste an Oh My Pi session id",
    importCodexPlaceholder: "Paste a Codex thread id",
    importHint: {
      codex: "Codex resumes a persisted thread by thread id.",
      claudeAgent: "Claude resumes a persisted session by session id.",
      cursor: "Cursor resumes a persisted session by session id.",
      opencode: "OpenCode resumes a persisted session by session id.",
      omp: "Oh My Pi resumes a persisted session by session id.",
    },
    importing: "Importing...",
    import: "Import",
    importFailed: "Failed to import thread.",
    importProjects: "Import projects",
    importProjectsPlaceholder: "Import projects from…",
    importSources: {
      "claude-code": "From Claude Code",
      codex: "From Codex",
      all: "From Claude Code and Codex",
    },
    noImportSource: "No matching import source.",
    backToCommands: "Back to commands",
    projectPathPlaceholder: "Enter project path (e.g. ~/projects/my-app)",
    searchPlaceholder: "Search chats or run a command",
    enterFolderPath: "Enter a folder path.",
    relativePathsUnsupported: "Relative paths are not supported. Use an absolute path or start with ~/.",
    addFailed: "Failed to add project.",
    createAndAdd: "Create & Add",
    add: "Add",
    windowsPathsUnsupported: "Windows paths are not supported on this platform.",
    noMatchingFolders: "No matching folders.",
    /** Split around the typed folder name, which renders highlighted between the two halves. */
    createFolderPrefix: "Press Enter to create",
    createFolderSuffix: "and add it as a project.",
    addingProject: "Adding project...",
    browseHint: "Type a path, ↑↓ to navigate folders.",
    highlightedFolderHint: (modifier: string) => `Enter to open · ${modifier}+Enter to add`,
    goUpHint: "Enter to go up",
    addProjectHint: "Enter to add project",
    groupSuggested: "Suggested",
    groupThreads: "Threads",
    groupRecent: "Recent chats",
    groupActions: "Actions",
    groupQuickActions: "Quick actions",
    groupSettings: "Settings",
    groupProjects: "Projects",
    groupConfigure: "Configure",
    groupDarkThemes: "Dark themes",
    groupLightThemes: "Light themes",
    darkColorTheme: "Dark color theme",
    lightColorTheme: "Light color theme",
    untitledThread: "Untitled thread",
    untitledProject: "Untitled project",
    match: {
      chatHits: (count: number) => `${count} chat hits`,
      chatMatch: "Chat match",
      projectMatch: "Project match",
    },
    noMatches: "No matches.",
    hint: "Jump to threads, projects, actions, or appearance.",
    hintEnter: "Enter to open",
  },

  planSidebar: {
    title: "Plan",
    close: "Close plan sidebar",
    steps: "Steps",
    emptyTitle: "No active plan yet.",
    emptyDescription: "Plans will appear here when generated.",
  },

  /** Shown when the app is running under Rosetta translation instead of a native arm64 build. */
  intelBuildWarning: "Intel build on Apple Silicon",
};

export type Sidebar = typeof sidebar;
