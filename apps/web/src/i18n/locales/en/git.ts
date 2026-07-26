// FILE: locales/en/git.ts
// Purpose: English copy for source control — the git actions menu and its quick action, the
//          branch toolbar and branch selector, and the source-control side panel.
//
// The decision helpers in GitActionsControl.logic.ts take this group as an optional argument
// that defaults to English, so their unit tests keep asserting plain English while the running
// app always passes the active catalog.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const git = {
  /** Button and menu labels for the git actions themselves. */
  actions: {
    commit: "Commit",
    push: "Push",
    pull: "Pull",
    createPr: "Create PR",
    viewPr: "View PR",
    commitPush: "Commit & push",
    commitPushPr: "Commit, push & PR",
    pushCreatePr: "Push & create PR",
    syncBranch: "Sync branch",
    createBranch: "Create Branch",
    initializeGit: "Initialize Git",
    initializing: "Initializing...",
    commitAndPush: "Commit and Push",
    menu: "Git actions",
    menuOptions: "Git action options",
    commitOnNewBranch: "Commit on new branch",
    checkoutFeatureBranch: "Checkout feature branch & continue",
    abort: "Abort",
    cancel: "Cancel",
    done: "Done",
    edit: "Edit",
  },

  /** Why an action is unavailable — shown as the disabled menu item's hint. */
  hints: {
    busy: "Git action in progress.",
    noStatus: "Git status is unavailable.",
    unavailable: "This action is currently unavailable.",
    cleanWorktree: "Worktree is clean. Make changes before committing.",
    commitUnavailable: "Commit is currently unavailable.",
    detachedPush: "Detached HEAD: checkout a branch before pushing.",
    uncommittedPush: "Commit or stash local changes before pushing.",
    behindPush: "Branch is behind upstream. Pull/rebase before pushing.",
    addOriginPush: 'Add an "origin" remote before pushing.',
    noCommitsPush: "No local commits to push.",
    pushUnavailable: "Push is currently unavailable.",
    detachedCommitPush: "Detached HEAD: checkout a branch before committing and pushing.",
    behindCommitPush: "Branch is behind upstream. Pull/rebase before committing and pushing.",
    addOriginCommitPush: 'Add an "origin" remote before committing and pushing.',
    nothingToPush: "No local changes or commits to push.",
    commitPushUnavailable: "Commit & push is currently unavailable.",
    viewPrUnavailable: "View PR is currently unavailable.",
    detachedPr: "Detached HEAD: checkout a branch before creating a PR.",
    commitBeforePr: "Commit local changes before creating a PR.",
    addOriginPr: 'Add an "origin" remote before creating a PR.',
    noCommitsPr: "No local commits to include in a PR.",
    behindPr: "Branch is behind upstream. Pull/rebase before creating a PR.",
    createPrUnavailable: "Create PR is currently unavailable.",
    createBranchFirst: "Create and checkout a branch before pushing or opening a PR.",
    branchUpToDate: "Branch is up to date. No action needed.",
    detachedPull: "Detached HEAD: checkout a branch before pulling.",
    noUpstreamPull: "Current branch has no upstream to pull from.",
    alreadyUpToDate: "Branch is already up to date.",
    diverged: "Branch has diverged from upstream. Rebase/merge first.",
    addOriginPushOrPr: 'Add an "origin" remote before pushing or creating a PR.',
    noBranchChangesForPr: "No branch changes to include in a PR.",
    commitAndPushBlocked: "Commit and Push unavailable; open Git actions menu",
    commitAndPushBlockedLong: "Commit and Push unavailable. Open for more Git actions.",
  },

  /** Stage titles for the long-running action's progress toast. */
  progress: {
    preparingFeatureBranch: "Preparing feature branch...",
    pushing: "Pushing...",
    pushingTo: (target: string) => `Pushing to ${target}...`,
    creatingPr: "Creating PR...",
    committing: "Committing...",
    generatingCommitMessage: "Generating commit message...",
    running: "Running git action...",
    waiting: "Waiting for Git...",
  },

  /** Result summary shown once an action finishes. */
  result: {
    createdPr: (suffix: string) => `Created PR${suffix}`,
    openedPr: (suffix: string) => `Opened PR${suffix}`,
    pushed: (commit: string, branch: string) => `Pushed${commit}${branch}`,
    pushedToBranch: (branch: string) => ` to ${branch}`,
    committed: (sha: string) => `Committed ${sha}`,
    committedChanges: "Committed changes",
    done: "Done",
  },

  toast: {
    linkUnavailable: "Link opening is unavailable.",
    noOpenPr: "No open PR found.",
    prLinkFailed: "Unable to open PR link",
    genericError: "An error occurred.",
    syncing: "Syncing with remote...",
    synced: "Remote synced",
    alreadySynced: "Already up to date",
    syncedFrom: (branch: string, upstream: string) => `Updated ${branch} from ${upstream}`,
    upstreamFallback: "upstream",
    alreadySyncedDetail: (branch: string) => `${branch} is already synchronized.`,
    syncFailed: "Sync failed",
    createPrUnavailable: "Create PR unavailable",
    actionFailed: "Action failed",
    branchNameConfirmed: "Branch name confirmed.",
    creatingBranch: "Creating branch...",
    branchCreated: "Branch created and checked out.",
    createBranchFailed: "Failed to create branch",
    editorUnavailable: "Editor opening is unavailable.",
    openFileFailed: "Unable to open file",
    keepingBranch: (branch: string) => `Keeping ${branch}`,
    switchedToBranch: (branch: string) => `Switched to ${branch}`,
  },

  commitDialog: {
    title: "Commit changes",
    description: "Review and confirm your commit. Leave the message blank to auto-generate one.",
    messageLabel: "Commit message (optional)",
    messagePlaceholder: "Leave empty to auto-generate",
    branch: "Branch",
    defaultBranchWarning: "Warning: default branch",
    files: "Files",
    excluded: "Excluded",
    detachedHead: "(detached HEAD)",
    detachedHint: "Detached HEAD: create and checkout a branch to enable push and PR actions.",
    behindUpstream: "Behind upstream. Pull/rebase first.",
    refreshing: "Refreshing git status...",
    noFiles: "none",
    fileCount: (selected: number, total: number) => `(${selected} of ${total})`,
  },

  createBranchDialog: {
    title: "Create Branch",
    description:
      "Create and switch to a branch from the current HEAD. Future commits, pushes, and PRs will use it.",
    nameLabel: "Branch name",
    namePlaceholder: "feature/my-change",
    duplicate: "A branch with this name already exists.",
    createAndSwitch: "Create and switch",
  },

  /** Confirmation shown before running an action straight on the default branch. */
  defaultBranchDialog: {
    runOnDefault: "Run action on default branch?",
    createFeatureBranch: "Create feature branch & continue",
    continue: "Continue",
    onBranchSuffix: (branch: string) =>
      ` on "${branch}". You can continue on this branch or create a feature branch and run the same action there.`,
    commitPushTitle: "Commit & push to default branch?",
    commitPushDescription: (suffix: string) => `This action will commit and push changes${suffix}`,
    commitPushContinue: (branch: string) => `Commit & push to ${branch}`,
    pushTitle: "Push to default branch?",
    pushDescription: (suffix: string) => `This action will push local commits${suffix}`,
    pushContinue: (branch: string) => `Push to ${branch}`,
    featureBranchCommitPrTitle: "Create feature branch, commit & PR?",
    featureBranchCommitPrDescription: (branch: string) =>
      `Pull requests can't be opened from "${branch}" into itself. This action will create a feature branch, commit your changes there, push it, and create the PR.`,
    featureBranchPrTitle: "Create feature branch & PR?",
    featureBranchPrDescription: (branch: string) =>
      `Pull requests can't be opened from "${branch}" into itself. This action will create a feature branch from your current commits, push it, and create the PR.`,
  },

  /** Branch picker in the thread toolbar, plus its stash recovery flows. */
  branchSelector: {
    selectBranch: "Select branch",
    createAndCheckout: "Create and checkout new branch...",
    checkoutPullRequest: "Checkout Pull Request",
    uncommitted: "Uncommitted:",
    searchPlaceholder: "Search branches...",
    noneFound: "No branches found.",
    detachedHead: "Detached HEAD",
    unresolvedConflicts: "Unresolved conflicts in the repository.",
    nativeApiUnavailable: "Native API is unavailable.",
    checkoutFailed: "Failed to checkout branch.",
    createFailed: "Failed to create branch.",
    indexLocked: "Git index is locked.",
    removeLockRetry: "Remove lock & retry",
    indexUnwritable: "Git index could not be written.",
    indexUnwritableDetail:
      "Git could not update the repository index. Retry after any current Git operation finishes.",
    retryStashSwitch: "Retry stash & switch",
    uncommittedBlockCheckout: "Uncommitted changes block checkout.",
    stashAndSwitch: "Stash & Switch",
    stashKeptTitle: "Changes saved, but not reapplied.",
    stashKeptDetail:
      "Synara switched branches and kept your changes in a stash because they could not be restored onto this branch cleanly.",
    discardStash: "Discard stash",
    cannotSwitch: "Cannot switch branches.",
    cannotSwitchDetail:
      "Some conflicting files are not covered by git stash, such as ignored files. Move or remove them before switching.",
    stashSwitchFailed: "Failed to stash and switch.",
    discardStashTitle: "Discard saved stash?",
    discardStashDescription:
      "This will permanently drop the stash entry that preserved your uncommitted changes.",
    loadingStash: "Loading stash details...",
    branch: "Branch",
    worktree: "Worktree",
    stash: "Stash",
    name: "Name",
    changedFilesCount: (count: number) => `Changed files (${count})`,
    noStashFileNames: "Git did not report changed file names for this stash.",
    createAndSwitch: "Create and switch",
    keepStash: "Keep stash",
    discarding: "Discarding...",
    cancel: "Cancel",
    branchNameLabel: "Branch name",
    branchNamePlaceholder: "feature/my-change",
    duplicate: "A branch with this name already exists.",
    createBranchTitle: "Create Branch",
    currentHead: "the current HEAD",
    createBranchFrom: (base: string) => `Create and switch to a new branch from ${base}.`,
    fromBranch: (branch: string) => `From ${branch}`,
    createAndCheckoutNamed: (query: string) => `Create and checkout "${query}"`,
    uncommittedFiles: (count: string, unit: string) => `${count} ${unit}`,
    indexLockedDetail: (lockFile: string) =>
      `${lockFile} already exists. Close any running Git operation, remove the stale lock file if none is running, then retry.`,
    uncommittedFew: (names: string, verb: string) =>
      `${names} ${verb} uncommitted changes. Commit or stash before switching.`,
    uncommittedMany: (names: string, remaining: number, unit: string) =>
      `${names} and ${remaining} other ${unit} have uncommitted changes. Commit or stash before switching.`,
    genericError: "An error occurred.",
  },

  /** Thread toolbar strip that carries the worktree hand-off and permission chips. */
  toolbar: {
    continueIn: "Continue in",
    newWorktree: "New worktree",
    handOffToNewWorktree: "Hand off to new worktree",
    handOffToLocal: "Hand off to local",
    rateLimitsRemaining: "Rate limits remaining",
    fullAccess: "Full access",
    defaultPermissions: "Default permissions",
    fullAccessHint: "Full access — click to change permissions",
    defaultPermissionsHint: "Default permissions — click to change permissions",
  },

  /** Source-control side panel in the chat dock. */
  panel: {
    unavailable: "Source control is unavailable for this thread.",
    title: "Source control",
    close: "Close source control",
    refresh: "Refresh changes",
    loading: "Loading changes...",
    noChanges: "No changes in the working tree.",
    staged: "Staged",
    noStaged: "No staged changes.",
    unstageFile: "Unstage file",
    unstageAll: "Unstage all",
    changes: "Changes",
    noUnstaged: "No unstaged changes.",
    stageFile: "Stage file",
    stageAll: "Stage all",
    selectFile: "Select a file to view its diff.",
  },
};
