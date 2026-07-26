// FILE: locales/zh-CN/chat.ts
// Purpose: Simplified Chinese copy for the chat surface.
//
// "token" and "Side" stay in English: the first is the standard term in Chinese ML writing, the
// second names a specific split-view pane in this product.

import type { Chat } from "../en/chat";

export const chat: Chat = {
  timeline: {
    preparingWorktree: "正在准备工作树…",
    editMessage: "编辑消息",
    editAndResend: "编辑并重新发送",
    revertToMessage: "回退到这条消息",
    undo: "撤销",
    workingFor: "已运行",
    thinking: "思考中",
    emptyConversation: "发送一条消息开始对话。",
    cancel: "取消",
    send: "发送",
  },

  contextWindow: {
    title: "上下文窗口",
    unknown: "未知",
    currentSession: (window) => `当前会话：${window}`,
    nextTurn: (window) => `下一轮：${window}`,
    contextUsed: "上下文已使用",
    tokensUsedSoFar: "token 已使用",
    modelWindow: (tokens) => `模型窗口：${tokens} token`,
    totalProcessed: (tokens) => `累计处理：${tokens} token`,
    autoCompacts: "需要时会自动压缩上下文。",
    sessionCost: (cost) => `会话费用：${cost}`,
  },

  header: {
    chatHistory: "对话历史",
    noChatsInProject: "此项目还没有对话",
    newEditorRailItem: "新建编辑器栏项目",
    newChat: "新建对话",
    newTerminal: "新建终端",
    terminal: "终端",
    toggleDiffPanel: "切换差异面板",
    closeSelectedSide: "关闭选中的 Side",
    handOff: "交接",
    handoffTo: (provider) => `交接给 ${provider}`,
  },
};
