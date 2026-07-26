// FILE: locales/en/chat.ts
// Purpose: English copy for the chat surface — the message timeline, its context-window meter,
//          and the chat header rail.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.
//
// Entries that embed a value are functions rather than templates with a placeholder, because
// the text around the value moves in translation (a Chinese colon is full-width, and units
// follow the number instead of preceding the noun).

export const chat = {
  timeline: {
    preparingWorktree: "Preparing worktree...",
    editMessage: "Edit message",
    editAndResend: "Edit and resend",
    revertToMessage: "Revert to this message",
    undo: "Undo",
    /** Followed by the running elapsed clock, e.g. "Working for 1m 4s". */
    workingFor: "Working for",
    thinking: "Thinking",
    emptyConversation: "Send a message to start the conversation.",
    cancel: "Cancel",
    send: "Send",
  },

  contextWindow: {
    title: "Context window",
    unknown: "Unknown",
    currentSession: (window: string) => `Current session: ${window}`,
    nextTurn: (window: string) => `Next turn: ${window}`,
    /** Trails the used/total token pair, e.g. "12k / 200k context used". */
    contextUsed: "context used",
    /** Trails a bare token count when no window size is known. */
    tokensUsedSoFar: "tokens used so far",
    modelWindow: (tokens: string) => `Model window: ${tokens} tokens`,
    totalProcessed: (tokens: string) => `Total processed: ${tokens} tokens`,
    autoCompacts: "Automatically compacts its context when needed.",
    sessionCost: (cost: string) => `Session cost: ${cost}`,
  },

  header: {
    chatHistory: "Chat history",
    noChatsInProject: "No chats in this project yet",
    newEditorRailItem: "New editor rail item",
    newChat: "New chat",
    newTerminal: "New terminal",
    terminal: "Terminal",
    toggleDiffPanel: "Toggle diff panel",
    closeSelectedSide: "Close selected Side",
    handOff: "Hand off",
    handoffTo: (provider: string) => `Handoff to ${provider}`,
  },
};

export type Chat = typeof chat;
