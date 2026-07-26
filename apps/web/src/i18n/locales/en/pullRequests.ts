// FILE: locales/en/pullRequests.ts
// Purpose: English copy for the pull request surfaces — the list route, the detail panel and its
//          tabs, the checkout dialog, the gh-CLI unavailable state, and the environment PR section.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const pullRequests = {
  title: "Pull requests",
  notFound: "Pull request not found",
  notFoundDetail: "The selected pull request could not be loaded.",
  staleData: "Could not refresh pull request details. Showing saved data.",
  loading: "Loading pull request...",
  selectOne: "Select a pull request to open it here.",

  tabs: {
    label: "Pull request detail tabs",
    summary: "Summary",
    timeline: "Timeline",
    code: "Code",
  },

  actions: {
    openExternal: "Open in external browser",
    moreActions: "More actions",
    copyLink: "Copy link",
    close: "Close pull request",
    reopen: "Reopen pull request",
    readyForReview: "Ready for review",
    convertToDraft: "Convert to draft",
    merge: "Merge",
    merging: "Merging…",
    mergeBlocked: "Resolve merge conflicts before merging",
    closePanel: "Close pull request panel",
    closeLabel: "Close",
    cancel: "Cancel",
    retry: "Retry",
    refresh: "Refresh",
    refreshList: "Refresh pull requests",
    refreshBusy: "Wait for the pull request action to finish",
    searchPlaceholder: "Search pull requests",
    fixFindings: "Fix findings",
    preparingFindings: "Preparing findings…",
    resolveConflicts: "Resolve conflicts",
    preparingConflicts: "Preparing conflicts…",
    reply: "Reply",
  },

  /** Confirmation shown before a destructive or irreversible PR action. */
  confirm: {
    mergeTitle: "Merge pull request?",
    closeTitle: "Close pull request?",
    merge: "Merge",
    close: "Close",
    mergeDescription: (number: number, method: string) =>
      `This will merge #${number} using ${method}.`,
    closeDescription: (number: number) => `This will close #${number} without merging it.`,
  },

  status: {
    draft: "Draft",
    readyForReview: "Ready for review",
    mergedOnGitHub: "Merged on GitHub",
    closedOnGitHub: "Closed on GitHub",
  },

  toast: {
    merged: "Pull request merged",
    markedReady: "Marked ready for review",
    convertedToDraft: "Converted to draft",
    closed: "Pull request closed",
    reopened: "Pull request reopened",
    actionFailed: "Pull request action failed",
    cliFailed: "GitHub CLI action failed.",
    draftThreadFailed: "Could not create a draft thread for this pull request.",
    threadPrepFailed: "The PR thread could not be prepared.",
    findingsFailed: "Could not prepare findings",
    conflictPrepFailed: "Could not prepare conflict resolution",
    linkCopied: "Pull request link copied",
    linkCopyFailed: "Could not copy pull request link",
    clipboardFailed: "Clipboard access failed.",
    pinFailed: "Could not update pull request pin",
    pinFailedDetail: "The pin could not be saved.",
    refreshFailed: "Could not refresh pull requests",
    refreshFailedDetail: "The pull request list could not be refreshed.",
    commandCopyFailed: "Could not copy command",
  },

  summary: {
    branch: "Branch",
    merge: "Merge",
    conflictsWith: "Conflicts with",
    reviewers: "Reviewers",
    noReviewers: "None",
    comments: "Comments",
    noComments: "No comments",
    checks: "Checks",
    noChecks: "No checks reported.",
    description: "Description",
    noDescription: "_No description provided._",
    editDescription: "edit PR description",
    partialComments:
      "Some unresolved review comments could not be loaded. Check GitHub for the complete review.",
    moreComments: "More unresolved review comments may be available on GitHub.",
    severity: (level: string) => `${level} Severity`,
    noReviewBody: "_No review body._",
    fileCount: (count: number) => `${count} files`,
  },

  code: {
    truncated: "Diff exceeded 8 MiB and was truncated.",
    loading: "Loading pull request diff…",
  },

  composer: {
    accountHint: "Commenting as your GitHub account",
    placeholder: "Leave a comment",
    post: "Post comment",
  },

  filters: {
    byProject: "Filter by project",
    triggerLabel: (project: string) => `Filter pull requests by project: ${project}`,
    project: "Project",
    allProjects: "All projects",
    all: "All",
    reviewing: "Reviewing",
    authored: "Authored",
    open: "Open",
    closed: "Closed",
    merged: "Merged",
  },

  list: {
    firstMatches: (count: number, unit: string) =>
      `Showing the first 50 matching pull requests for ${count} ${unit}.`,
    reposUnavailable: (count: number, unit: string) =>
      `${count} project ${unit} unavailable. Healthy repositories are still shown.`,
    repository: "repository",
    repositories: "repositories",
    repositoryWas: "repository was",
    repositoriesWere: "repositories were",
    backgroundRefreshFailed:
      "The latest background refresh failed. Showing the last available pull requests.",
    reviewRequestsOpenOnly: "Review requests only apply to open pull requests",
    empty: "No pull requests found",
    emptyReviewHint: "Select Open to see pull requests currently awaiting your review.",
    emptyFilterHint: "Try another involvement, state, project, or search filter.",
  },

  /** Shown when the gh CLI is missing, signed out, or the request itself failed. */
  unavailable: {
    cliRequired: "GitHub CLI is required",
    signIn: "Sign in to GitHub CLI",
    generic: "Pull requests are unavailable",
    cliRequiredDetail:
      "Synara reads GitHub data only through the gh CLI. Install it, then reopen this view.",
    signInDetail: "Authenticate the GitHub CLI in a terminal, then retry.",
    genericDetail: "The pull request request failed.",
    installInstructions: "Install instructions",
    checkConnection: "Check your connection and try again.",
    copyToClipboard: "Copy to clipboard",
    copied: "Copied",
    copy: "Copy",
  },

  /** Checkout-a-PR dialog reachable from the branch picker. */
  checkoutDialog: {
    title: "Checkout Pull Request",
    description:
      "Resolve a GitHub pull request, then create the draft thread in the main repo or in a dedicated worktree.",
    label: "Pull request",
    referencePlaceholder: "https://github.com/owner/repo/pull/42 or #42",
    hint: "Paste a GitHub pull request URL or enter 123 / #123.",
    invalid: "Use a GitHub pull request URL, 123, or #123.",
    resolving: "Resolving pull request...",
    resolveFailed: "Failed to resolve pull request.",
    prepareFailed: "Failed to prepare pull request thread.",
    cancel: "Cancel",
    local: "Local",
    preparingLocal: "Preparing local...",
    worktree: "Worktree",
    preparingWorktree: "Preparing worktree...",
  },

  /** Collapsible PR block inside the chat environment panel. */
  environment: {
    label: "Pull request",
    openFileChanges: "Open pull request file changes",
    resolveConflictsHint:
      "Drafts a prompt in the composer asking the agent to resolve the merge conflicts — review it, then send",
    loadFailed: "Couldn't load PR data",
    retryHint: "Retry loading checks and review comments",
    loadingChecks: "Loading checks…",
    noChecks: "No checks reported for this PR.",
    loadingComments: "Loading comments…",
    commentsUnavailable: "Comments unavailable",
    commentsHidden: "Review comments may be hidden by the bounded preview. Open the PR on GitHub.",
    noUnresolvedComments: "No unresolved review comments.",
    moreComments: "More review comments may be available on GitHub.",
    draftAllCommentsHint: "Draft one prompt containing all visible review comments",
    fix: "Fix",
    commentsLoadFailed: (reason: string) => `Couldn't load review comments: ${reason}`,
  },
};
