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

  /** Composer-attachment refusals surfaced by the panel (screenshot capture and annotation). */
  attachments: {
    limit: (max: number) => `You can attach up to ${max} references per message.`,
    screenshotTooLarge: (name: string, limit: string) =>
      `'${name}' exceeds the ${limit} attachment limit.`,
    annotatedScreenshotTooLarge: (limit: string) =>
      `The annotated screenshot exceeds the ${limit} attachment limit.`,
  },

  /**
   * Project-level browser sharing. Offered here as well as in the sidebar project menu so it is
   * reachable while actually using the browser, which is where the difference is felt.
   */
  sharing: {
    shareOne: "Share one browser across this project",
    perThread: "Use a separate browser per thread",
    shareFailed: "Unable to share this project's browser",
    isolateFailed: "Unable to give each thread its own browser",
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
    /**
     * Annotation failure copy. `browserAnnotationActionErrorKey` classifies a raw error into
     * one of these keys so the logic module stays locale-free.
     */
    errors: {
      notVisible: "Bring the browser tab into view before annotating.",
      stillLoading: "This page is still loading. Try annotating again in a moment.",
      tabUnavailable: "This browser tab isn't available for annotation.",
      alreadyActive: "Annotation mode is already active.",
      cancelFailed: "Couldn't close annotation mode. Try again.",
      syncFailed: "Couldn't refresh annotation markers.",
      startFailed: "Couldn't start annotation mode. Try again.",
      draftFull: "This draft can't accept another browser annotation.",
    },
  },
};
