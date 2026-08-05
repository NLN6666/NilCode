// FILE: locales/en/dialogs.ts
// Purpose: English copy for the standalone app dialogs — profile, project creation, feedback,
//          shortcuts, what's new, sharing, worktree hand-off, AppSnap onboarding, and rename.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const dialogs = {
  profile: {
    title: "Edit profile",
    editAvatar: "Edit avatar",
    remove: "Remove",
    replacePhoto: "Replace photo",
    uploadPhoto: "Upload photo",
    processing: "Processing…",
    useColor: (color: string) => `Use ${color}`,
    colorsApplyHint: "Colors apply when no photo is set.",
    displayName: "Display name",
    namePlaceholder: "Your name",
    username: "Username",
    cancel: "Cancel",
    save: "Save",
    imageFailed: "Could not process that image.",
  },

  createProject: {
    title: "Create project",
    pathLabel: "Project folder path",
    pathPlaceholder: "/path/to/project",
    sourceFolder: "Source folder",
    space: "Space",
    newSpace: "New space",
    cancel: "Cancel",
    creating: "Creating…",
    submit: "Create project",
    files: "Files",
    dropFolderNotFile: "Drop a folder, not a file.",
    pathUnreadable: "Could not read the folder's path. Use browse or type it instead.",
    serverUnavailable: "The app server is unavailable.",
    pickerFailed: "Unable to open the folder picker.",
    typePathHint: "Type a folder path, or drop a folder above.",
    addFailed: "An error occurred while adding the project.",
    openingPicker: "Opening the folder picker…",
    dropHere: "Drop a folder here, or browse",
    projectAdded: "Project added",
    repositoryInvalid:
      "Enter a GitHub repository as owner/repository or a GitHub.com repository URL.",
    serverTooOldForGitHub: "Update the Synara server before adding a project from GitHub.",
    chooseParentFolder: "Choose the parent folder where the repository should be cloned.",
    invalidDirectoryName:
      "Choose a valid folder name without slashes, reserved device names, or a trailing dot.",
    validatingRepository: "Validating repository",
    githubCloneCancelled: "GitHub clone cancelled. You can retry safely.",
    creationCancelled: "Project creation cancelled.",
    cancelClone: "Cancel clone",
    cloning: "Cloning…",
    cloneAndAdd: "Clone and add",
    sourceFolderOption: "Folder",
    sourceGitHubOption: "GitHub",
    sourceLabel: "Project source",
    githubUnavailableHint: "Update the Synara server to add GitHub projects.",
    whatYouNeed: "What you need",
    requirementRepositoryTitle: "Repository",
    requirementRepositoryBody: {
      prefix: "Paste an ",
      suffix: " name or its GitHub URL.",
    },
    requirementDestinationTitle: "Destination",
    requirementDestinationBody:
      "Choose the parent folder where Synara should create the checkout.",
    requirementPrivateTitle: "Private access",
    requirementPrivateBody: {
      prefix: "Public repositories work immediately. For private repositories, run ",
      suffix: " or configure Git credentials.",
    },
    repositoryPlaceholder: "owner/repository or GitHub URL",
    cloneIntoLabel: "Clone into",
    parentFolderPlaceholder: "/parent/folder",
    browse: "Browse",
    folderNameLabel: "Folder name",
    directoryNamePlaceholder: "repository",
    finalLocation: (path: string) => `Final location: ${path}`,
  },

  feedback: {
    title: "Share feedback",
    category: "Feedback category",
    detailsPlaceholder: "Share details (required)",
    detailsLabel: "Feedback details",
    diagnosticsHint:
      "Diagnostics include app version, OS, provider/model, modes, and session state — never prompts, messages, paths, or logs.",
    sending: "Sending…",
    submit: "Submit",
    sent: "Feedback sent",
    sentHint: "Thanks for helping make Synara better.",
    failed: "Could not send feedback",
    failedHint: "An unexpected delivery error occurred.",
  },

  shortcuts: {
    title: "Keyboard shortcuts",
    description: "Reflects the bindings active in your current context.",
    searchPlaceholder: "Search shortcuts...",
    searchLabel: "Search shortcuts",
    noMatches: (query: string) => `No shortcuts match “${query}”.`,
  },

  whatsNew: {
    title: "What’s new?",
    viewChangelog: "View changelog",
    gotIt: "Got it",
    back: "Back to What's new",
    changelogTitle: "Complete changelog",
    changelogDescription: "Every curated release, newest first.",
    dismiss: "Dismiss What's new",
    popoutTitle: (version: string) => `What's new in v${version}`,
    popoutHint: "Find out what’s new",
    noReleaseNotes: "No release notes yet — check back after the next update.",
    version: (version: string) => `Version ${version}`,
  },

  releaseHistory: {
    title: "Release history",
    description: "Every curated release, newest first.",
    close: "Close",
  },

  share: {
    title: "Share your activity",
    copy: "Copy",
    copyStatCard: "Copy stat card",
    save: "Save",
    saveStatCard: "Save stat card",
    savedPng: "Saved PNG to your downloads.",
    renderFailed: "Could not render the image.",
    copyUnavailable: "Image copy unavailable. Use Save instead.",
    copiedToClipboard: "Copied image to clipboard.",
    copiedForPost: "Image copied to clipboard — paste it into your post.",
    composerOpened: "Composer opened. Use Save to attach the image.",
    composerOpenedNoCopy: "Composer opened. Image copy unavailable; use Save to attach.",
  },

  worktreeHandoff: {
    title: "Hand off to worktree",
    description:
      "Create a detached worktree from the current branch to continue working in parallel.",
    nameLabel: "Worktree name",
    namePlaceholder: "synara/feature-name",
    cancel: "Cancel",
    handOff: "Hand off",
    handingOff: "Handing off...",
  },

  appSnapWelcome: {
    title: "Synara AppSnaps are live!",
    description:
      "Press both Option keys (⌥ ⌥) to snap any app’s window into the task you’re working in.",
    notNow: "Not now",
    setUp: "Set up AppSnap",
  },

  rename: {
    cancel: "Cancel",
    save: "Save",
    saving: "Saving...",
    threadTitle: "Rename chat",
    threadDescription: "Keep it short and recognizable.",
  },

  splash: {
    retry: "Retry",
  },

  projectHoverCard: {
    editProject: "Edit project",
  },
};
