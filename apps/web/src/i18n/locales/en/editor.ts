// FILE: locales/en/editor.ts
// Purpose: English copy for the editor workspace, the terminal chrome, the PDF viewer, and the
//          file/image preview panes.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const editor = {
  workspace: {
    activityBar: "Editor activity bar",
    files: "Files",
    hideFiles: "Hide files sidebar",
    diff: "Diff",
    hideDiff: "Hide diff sidebar",
    searchFiles: "Search files",
    hideSearch: "Hide search sidebar",
    changedFiles: "Changed files",
    loadingChangedFiles: "Loading changed files...",
    noFilesInDiff: "No files in this diff.",
    home: "Home",
    workspaceLabel: "Workspace",
    noWorkspace: "No workspace",
    switchProject: "Switch project",
    hideChatPanel: "Hide chat panel",
    showChatPanel: "Show chat panel",
    switchToChatView: "Switch to chat view",
    chat: "Chat",
    resizeChatPanel: "Resize chat panel",
    dragToResizeChatPanel: "Drag to resize chat panel",
  },

  filePreview: {
    loading: "Loading file...",
    noWorkspaceAttached: "No workspace is attached to this chat.",
    selectFromExplorer: "Select a file from the explorer.",
    commentOnLine: (line: number) => `Comment on line ${line}`,
    comment: "Comment",
  },

  image: {
    openFailed: "Couldn’t open this image",
    openFailedHint: "The file may have moved or be unavailable.",
    download: "Download",
    downloadImage: "Download image",
  },

  pdf: {
    loading: "Loading PDF...",
    previousPage: "Previous page",
    nextPage: "Next page",
    currentPage: "Current page",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    fitWidth: "Fit width",
    fitPage: "Fit page",
    renderFailed: (page: number) => `Could not render page ${page}`,
  },

  terminal: {
    label: "Terminal",
    chat: "Chat",
    error: "Error",
    scrollToBottom: "Scroll to bottom",
    newTab: "New terminal tab",
    moveToOwnTab: "Move to its own terminal tab",
    splitRight: "Split right",
    splitDown: "Split down",
    closeTab: "Close active terminal tab",
    search: {
      placeholder: "Find",
      noResults: "No results",
      matchCase: "Match case",
      previous: "Previous match (Shift+Enter)",
      next: "Next match (Enter)",
      close: "Close search (Esc)",
    },
  },
};
