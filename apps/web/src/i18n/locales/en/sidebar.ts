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
  },

  sort: {
    projects: "Sort projects",
    threads: "Sort threads",
    chats: "Sort chats",
  },

  help: {
    menu: "Help",
    whatsNew: "What’s new",
    keyboardShortcuts: "Keyboard shortcuts",
    sendFeedback: "Send feedback",
    docs: "Docs",
  },

  /** The Studio/Projects segmented control, and the list headings under each. */
  views: {
    threads: "Projects",
    studio: "Studio",
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
    windowsPathsUnsupported: "Windows paths are not supported on this platform.",
    noMatchingFolders: "No matching folders.",
    /** Split around the typed folder name, which renders highlighted between the two halves. */
    createFolderPrefix: "Press Enter to create",
    createFolderSuffix: "and add it as a project.",
    groupSuggested: "Suggested",
    groupProjects: "Projects",
    groupConfigure: "Configure",
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
