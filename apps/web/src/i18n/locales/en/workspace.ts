// FILE: locales/en/workspace.ts
// Purpose: English copy for workspace-level surfaces that are not the chat itself — the kanban
//          board and the spaces switcher with its dialogs.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const workspace = {
  kanban: {
    columns: {
      draft: "Draft",
      inProgress: "In Progress",
      done: "Done",
    },
    fallbackDraftTitle: "New thread",
    terminal: "Terminal",
    pinned: "Pinned",
    forkedThread: "Forked thread",
    starting: "Starting…",
    workedFor: (elapsed: string) => `Worked for ${elapsed}`,
    dropToSend: "Drop to send",
    newTask: "New task",
    noCards: "No cards",
    showMore: (count: number) => `Show ${count} more`,
    backToAllProjects: "Back to all projects",
    emptyBoard: "Nothing on the board yet",
    emptyBoardHint:
      "Drafted prompts, running turns, and completed chats will show up here automatically.",
    chooseProject: "Choose the project for this task",
    taskOptions: "Task options",
    planMode: "Plan mode",
    local: "Local",
    worktree: "Worktree",
    /** New-task dialog. */
    newTaskDescription:
      "Draft a prompt and place it in the board's Draft column. Drag it to In Progress to send it.",
    promptPlaceholder: "Describe the task, @tag files/folders, paste images, or use / for skills",
    attachImages: "Attach images",
    sendAsDraft: "Send as draft",
    createTask: "Create task",
    creating: "Creating...",
    optimizing: "Optimizing...",
    imagesOnly: "Only images can be attached to new tasks.",
    oneFileRejected: "That file was not added.",
    filesRejected: (count: number) => `${count} files were not added.`,
    localFoldersUnavailable: "Local folders unavailable",
  },

  spaces: {
    label: "Spaces",
    nameLabel: "Space name",
    newSpace: "New space",
    editSpace: "Edit space…",
    /** The Void group is not a space, so its menu entry names the fields instead. */
    editVoidSpace: "Edit name and icon…",
    deleteSpace: "Delete space",
    /** Create/edit dialog. */
    createTitle: "New space",
    editTitle: "Edit space",
    editVoidTitle: "Edit unfiled group",
    createDescription:
      "Group projects into a focused work context. Projects you add while a space is open land in it.",
    editDescription:
      "Rename this space or give it a different icon. Its projects stay where they are.",
    editVoidDescription:
      "Name the group that holds projects you haven't filed into a space. This is a local preference — the projects in it stay where they are.",
    name: "Name",
    namePlaceholder: "Work",
    voidNamePlaceholder: "Unfiled",
    icon: "Icon",
    nameRequired: "Enter a name.",
    // Deliberately not "a space with this name": the taken name may be Void's, which is not a
    // space, and either way the user's next move is the same.
    nameDuplicate: "That name is already taken.",
    saveFailed: "Unable to save the space.",
    cancel: "Cancel",
    saving: "Saving…",
    createSpace: "Create space",
    save: "Save",
    /** Move-projects dialog. */
    moveTitle: (space: string) => `Move projects to ${space}`,
    moveFallbackSpace: "space",
    moveDescription: "Choose existing projects. Their chats and pinned state move with them.",
    searchProjects: "Search projects",
    noProjects: "No projects yet.",
    allAlreadyHere: (space: string) => `Every project is already in ${space}.`,
    thisSpace: "this space",
    noMatchingProjects: "No matching projects.",
    moveFailed: "Unable to move the selected projects.",
    movePartialFailure: (count: number, space: string) =>
      `${count} could not be moved. Projects processed before the failure remain in ${space}. Try again.`,
    targetSpaceFallback: "the target space",
    moving: "Moving…",
    moveProjects: "Move projects",
    moveCount: (count: number) => `Move ${count} project${count === 1 ? "" : "s"}`,
  },
};
