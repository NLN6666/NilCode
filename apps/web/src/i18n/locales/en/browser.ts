// FILE: locales/en/browser.ts
// Purpose: English copy for the in-app browser panel — chrome controls, the local-server home
//          screen, runtime status pills, and the screenshot annotation overlay.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const browser = {
  restoringRuntime: "Restoring browser",
  sleeping: "Browser is sleeping",
  restoringCached: "Restoring cached browser",
  untitledTab: "Untitled",
  /** Pill shown while an agent drives this thread's browser through the CDP endpoint. */
  agentControl: "Agent controlled",

  nav: {
    goBack: "Go back",
    goForward: "Go forward",
    reload: "Reload",
    addressPlaceholder: "Search or enter a URL",
  },

  actions: {
    pickElement: "Pick an element",
    stopPickElement: "Stop picking an element",
    /** Tooltip only: the shortcut belongs on hover, not in the accessible name. */
    stopPickElementHint: "Stop picking an element (Esc)",
    annotate: "Annotate the page",
    copyScreenshot: "Copy screenshot",
    copyLink: "Copy link",
    menu: "Browser actions",
    newTab: "New tab",
    captureScreenshot: "Capture screenshot",
    openExternally: "Open externally",
    closePanel: "Close browser panel",
    closeTab: "Close tab",
  },

  /** Runtime status pill in the tab strip, plus the two full-panel placeholders. */
  status: {
    unavailable: "Browser is unavailable.",
    starting: "Starting browser...",
    noTabs: "No tabs open",
    restoringTab: "Restoring tab...",
  },

  toast: {
    screenshotCopied: "Browser screenshot copied",
    linkCopied: "Link copied",
  },

  /** Local-server launcher shown instead of about:blank. */
  localServers: {
    title: "Local",
    refresh: "Refresh local servers",
    scanning: "Scanning local servers",
    checkingPorts: "Checking localhost ports",
    none: "No local servers",
    tryAnother: "Try another browser URL",
  },

  annotation: {
    tools: {
      pen: "Draw freehand",
      rect: "Draw a rectangle",
      arrow: "Draw an arrow",
      text: "Add a text label",
      mosaic: "Pixelate an area",
    },
    /** `color` is a raw hex swatch value, so it stays verbatim in every language. */
    useInk: (color: string) => `Use ${color} ink`,
    textLabel: "Annotation text",
    textPlaceholder: "Type a label",
    undo: "Undo",
    undoHint: "Undo (Ctrl/Cmd+Z)",
    redo: "Redo",
    redoHint: "Redo (Ctrl/Cmd+U or Ctrl/Cmd+Shift+Z)",
    clear: "Clear",
    clearAll: "Clear all marks",
    clearAllHint: "Clear all marks (undoable)",
    cancel: "Cancel",
    confirmDiscard: "Discard marks?",
    addToChat: "Add to chat",
  },
};
