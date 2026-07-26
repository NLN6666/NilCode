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

  workflow: {
    openThread: "打开会话",
    prompt: "提示词",
    recent: "最近",
    resume: "恢复工作流",
    dismiss: "关闭工作流面板",
    pause: "暂停工作流",
    pauseHint: "暂停工作流（恢复时会从缓存重放已完成的智能体）",
    stop: "停止工作流",
    noAgents: "还没有智能体",
    saved: "已保存",
    copyScriptPath: "复制脚本路径和运行 ID",
  },

  toolCall: {
    noPayload: "这次工具调用没有详细内容。",
    arguments: "参数",
    files: "文件",
    diff: "差异",
    edits: "编辑",
    before: "修改前",
    after: "修改后",
    writtenContent: "写入的内容",
    exitCode: (code) => `退出码 ${code}`,
    truncated: "已截断",
    output: "输出",
    stdout: "标准输出",
    stderr: "标准错误",
  },

  traits: {
    fastMode: "快速模式",
    thinking: "思考",
    onDefault: "开（默认）",
    off: "关",
    context: "上下文",
    variant: "变体",
    effort: "推理强度",
    ultrathinkLocked: "从提示词中移除 Ultrathink 后才能修改推理强度。",
    speed: "速度",
    default: "默认",
    fast: "快速",
    trigger: "修改推理强度、上下文与速度",
    options: "选项",
  },

  panes: {
    comingSoon: (label) => `${label}面板即将推出。`,
    loadingBrowser: "正在加载浏览器…",
    loadingPullRequest: "正在加载 Pull Request…",
    terminalSleeping: "终端已休眠，正在恢复。",
    loadingTerminal: "正在加载终端…",
    loadingGit: "正在加载 Git…",
    loadingExplorer: "正在加载资源管理器…",
    loadingFile: "正在加载文件…",
    loadingDiffViewer: "正在加载差异查看器…",
    selectFileFromTree: "从文件树中选择一个文件查看。",
    clickFileToPreview: "在对话中点击一个文件，即可在这里预览。",
    addPanel: "添加面板",
    collapsePanel: "折叠面板",
  },

  split: {
    selectChat: "选择一个对话",
    chooseChat: "选择对话",
    chooseChatHint: "选择在当前分屏中显示哪个对话。",
    cancel: "取消",
  },

  explorer: {
    loadingDirectory: "正在加载目录…",
    noWorkspace: "没有工作区。",
    searchPlaceholder: "搜索文件…",
    searchLabel: "搜索文件",
    noMatches: "没有匹配的文件。",
    topMatches: "只显示最匹配的结果。细化搜索条件以缩小范围。",
    searchHint: "按名称或路径搜索文件。",
  },

  activity: {
    back: "返回",
    prompt: "提示词",
    result: "结果",
    agents: "智能体",
    activity: "活动",
    open: "打开",
  },

  work: {
    summary: "摘要",
    rawCall: "原始调用",
    latest: "最新",
    moreToolUses: (count) => `另有 ${count} 次工具调用`,
    openThread: "打开会话",
    edited: "编辑了",
  },

  filePreview: {
    filePath: "文件路径",
    shownPartially: "仅显示部分内容",
    markdownView: "Markdown 视图",
    source: "源码",
    sourceHint: "源码视图 —— 选中文本可在对话中引用精确的行",
    moreActions: "更多操作",
    referenceInChat: "在对话中引用",
    askWhyChanged: "询问为什么改动",
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
