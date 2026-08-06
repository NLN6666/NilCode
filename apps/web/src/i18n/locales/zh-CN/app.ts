// FILE: locales/zh-CN/app.ts
// Purpose: Simplified Chinese copy for the app shell.

import type { Messages } from "../en";

export const app: Messages["app"] = {
  nav: {
    back: "后退",
    forward: "前进",
    backWithShortcut: (shortcut) => `后退（${shortcut}）`,
    forwardWithShortcut: (shortcut) => `前进（${shortcut}）`,
  },

  window: {
    minimize: "最小化",
    close: "关闭",
  },

  recentViews: {
    label: "最近的视图",
    current: "当前",
    splitView: "分屏视图",
    pinned: "已置顶",
  },

  toast: {
    dismiss: "关闭提示",
    undo: "撤销",
    orViewArchivedIn: "或在这里查看已归档的对话：",
    settings: "设置",
  },

  maintenance: {
    archivingTitle: "正在归档旧会话…",
    preparing: "正在准备后台维护。",
    archivedOfTotal: (archived, total) => `已归档 ${archived} / ${total} 个会话。`,
    archivedCount: (archived) => `已归档 ${archived} 个会话。`,
    pausedTitle: "会话维护已暂停",
    pausedDescription: "稍后会重试处理这些旧会话。",
    archivedTitle: "旧会话已归档",
    archivedDescription: (archived) =>
      `${archived} 个旧会话已移至「设置 → 已归档会话」，可以在那里还原。`,
    archivedNone: "没有需要归档的旧会话。",
  },

  ui: {
    close: "关闭",
    remove: "移除",
    loading: "加载中",
    sidebar: "侧边栏",
    sidebarDescription: "显示移动端侧边栏。",
    toggleSidebar: "切换侧边栏",
  },

  root: {
    connecting: (appName) => `正在连接 ${appName} 服务…`,
    buildLine: (client, server) => `客户端 ${client} · 服务端 ${server}`,
    updateClient: "这个 Synara 客户端需要更新。",
    updateServer: "Synara 服务端需要更新。",
    reconnect: "Synara 需要以匹配的构建版本重新连接。",
    updateClientGuidance: "更新或重新加载客户端，然后重新连接。",
    updateServerGuidance: "更新或重启服务端，然后重新加载客户端。",
    reconnectGuidance:
      "重新加载应用。如果反复出现，请重启 Synara，让客户端与服务端使用匹配的构建版本。",
    reloadApp: "重新加载应用",
    somethingWentWrong: "出了点问题。",
    tryAgain: "重试",
    showErrorDetails: "显示错误详情",
    hideErrorDetails: "隐藏错误详情",
  },

  chat: {
    loadingModels: "正在加载模型",
    threads: "会话",
    noActiveThread: "没有活动会话",
    selectThread: "选择一个会话，或新建一个开始。",
    temporary: "临时",
    temporaryChat: "临时对话",
    temporaryOn: "临时对话 —— 离开后即删除。点击以保留。",
    temporaryOff: "把它设为临时对话（离开后删除）",
    planModeActive: "计划模式 —— 点击返回普通构建模式",
    plan: "计划",
    stopGeneration: "停止生成",
    stopGenerationHint: "停止当前回复。在 Mac 上可按 Ctrl+C 中断。",
    implementationActions: "实现操作",
    implementInNewThread: "在新会话中实现",
    synaraLogo: "Synara 标志",
    whatShouldWeWorkOn: "我们来做点什么？",
    whatShouldWeDoIn: "在这里做点什么：",
  },

  featureFlags: {
    label: "功能开关",
    local: "本地功能开关",
    storedLocally: "仅保存在这个浏览器配置中。",
  },

  providerUsage: {
    scanning: "正在扫描所选提供商的本地用量数据。",
    noneForProvider: "还没有找到所选提供商的本地用量数据。",
    none: "还没有找到本地用量数据。",
    learnMore: "了解更多",
  },
};
