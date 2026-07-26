// FILE: locales/en/diff.ts
// Purpose: English copy for the diff panel — its source and view menus, the changed-file list,
//          the review file tree, and every empty/loading state in between.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const diff = {
  options: {
    menu: "Diff options",
    viewMenu: "Diff view options",
    chooseSource: "Choose diff source",
    chooseTurn: "Choose turn diff",
    source: "Source",
    sourceHeading: "Diff source",
    view: "View",
    stackedDiff: "Stacked diff",
    splitDiff: "Split diff",
    stacked: "Stacked",
    split: "Split",
    ignoreWhitespace: "Ignore whitespace-only changes",
    wrapLongLines: "Wrap long lines",
  },

  /** Repo diff scopes, mirroring RepoDiffScope in repoDiffScopeStore. */
  scopes: {
    workingTree: "Working tree",
    unstaged: "Unstaged",
    staged: "Staged",
    branch: "Branch",
  },

  turnDiff: "Turn diff",

  turns: {
    heading: "Turns",
    all: "All turns",
    last: "Last turn",
    turn: (number: string) => `Turn ${number}`,
    showMore: (count: number) => `Show ${count} more`,
  },

  actions: {
    copyDiff: "Copy diff",
    copiedDiff: "Copied diff",
    expandAll: "Expand all files",
    collapseAll: "Collapse all files",
    hideFileTree: "Hide file tree",
    showFileTree: "Show file tree",
    closeFileView: "Close file view",
    jumpToFile: "Jump to file",
    fileActions: "File actions",
    referenceInChat: "Reference in chat",
    askWhyChanged: "Ask why this changed",
    copyPath: "Copy path",
  },

  fileTree: {
    label: "Review files",
    loading: "Loading changed files...",
    filterPlaceholder: "Filter files...",
    filterLabel: "Filter files",
  },

  empty: {
    noFiles: "No files in this diff.",
    noMatches: "No matching files.",
    selectThread: "Select a thread to inspect turn diffs.",
    notARepo: "Turn diffs are unavailable because this project is not a git repository.",
    checkingRepo: "Checking git repository...",
    worktreePreparing:
      "This chat environment is still being prepared. Diffs will be available once the worktree is ready.",
    loadingCheckpoint: "Loading checkpoint diff...",
    loadingScope: (scope: string) => `Loading ${scope} diff...`,
    noChangesInSource: "No changes in the selected diff source.",
    noTurnDiffs: "No turn diffs are available yet.",
    noNetChanges: "No net changes in this selection.",
    noRepoDiff: "No repo diff is available right now.",
  },

  errors: {
    repoCheckFailed: "Failed to check git repository.",
    repoDiffFailed: "Failed to load repo diff.",
  },
};
