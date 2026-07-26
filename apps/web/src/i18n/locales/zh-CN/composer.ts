// FILE: locales/zh-CN/composer.ts
// Purpose: Simplified Chinese copy for the chat composer.

import type { Messages } from "../en";

export const composer: Messages["composer"] = {
  extras: {
    menu: "输入区更多操作",
    addImage: "添加图片",
    planMode: "计划模式",
    fast: "快速",
    default: "默认",
  },

  modelPicker: {
    ariaLabel: "更换模型与推理强度",
    tooltip: "更换模型",
  },

  commandMenu: {
    files: "文件",
    filesHint: "输入以搜索文件",
  },

  directory: {
    goUp: "回到上级目录",
    useThisFolder: "使用此文件夹",
    matchesDeeper: "更深层的匹配",
    awaitingHomeDir: "正在等待服务器返回主目录…",
    loading: "正在加载本地文件…",
    searching: "正在搜索嵌套文件…",
    noMatches: "没有匹配项。",
    empty: "这里没有文件或文件夹。",
    topMatches: "只显示最匹配的结果。继续输入以缩小范围。",
  },

  subagents: {
    stopAll: "停止所有子智能体",
    stopAllTitle: "停止所有运行中的子智能体",
    runInBackground: "转到后台运行（ctrl+b）",
    stop: "停止子智能体",
  },

  queued: {
    steer: "介入",
    delete: "删除排队的后续消息",
    menu: "排队消息的操作",
    edit: "编辑排队的提示词",
    deletePrompt: "删除排队的提示词",
  },

  pendingInput: {
    previousQuestion: "上一个问题",
    nextQuestion: "下一个问题",
    progress: (index, total) => `第 ${index} / ${total} 个`,
    selectMultiple: "可多选。",
    cancel: "取消",
  },

  pendingApproval: {
    reviewToContinue: "查看这个请求后才能继续。",
  },

  planBanner: {
    ready: "计划已就绪",
  },

  attachments: {
    readFailed: "无法读取附件数据。",
    readError: "读取附件失败。",
    pathProblem: (name) =>
      `无法读取「${name}」。含空格或特殊字符的路径可能需要用路径提及（@"…"）而不是文件附件。`,
    unnamedItem: "该项",
  },

  status: {
    title: "会话状态",
    description: "当前输入区的运行时设置与本地会话状态。",
    model: "模型",
    fastMode: "快速模式",
    on: "开",
    off: "关",
    reasoning: "推理强度",
    defaultEffort: "默认",
    mode: "模式",
    planMode: "计划",
    defaultMode: "默认",
    environment: "环境",
    branch: "分支",
    unknown: "未知",
    contextWindow: "上下文窗口",
    contextWindowHint: "当前会话最近一次上报的用量。",
    sessionWindows: (current, next) => `当前会话：${current}。下一轮：${next}。`,
    used: "已用",
    remaining: "剩余",
    window: "窗口",
    cost: "费用",
    costUnavailable: "不可用",
    noContextUsage: "这个会话还没有上报上下文用量。",
    rateLimits: "速率限制",
    noRateLimitWarning: "这个会话当前没有速率限制警告。",
    close: "关闭",
  },
};
