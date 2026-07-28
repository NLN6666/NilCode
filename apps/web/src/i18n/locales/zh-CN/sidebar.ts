// FILE: locales/zh-CN/sidebar.ts
// Purpose: Simplified Chinese copy for the main sidebar.
//
// "Studio" and "Void" stay in English: both are product concept names (a workspace tab and the
// no-space bucket), not descriptions, so translating them would break the link to the docs.

import type { Sidebar } from "../en/sidebar";

export const sidebar: Sidebar = {
  actions: {
    search: "搜索",
    newThread: "新建会话",
    newStudioChat: "新建 Studio 对话",
    addProject: "添加项目",
    kanban: "看板",
    pullRequests: "拉取请求",
    automations: "自动化",
    settings: "设置",
    openNewChatHome: "打开新对话主页",
    showMore: "显示更多",
    showLess: "收起",
    cancel: "取消",
  },

  sort: {
    projects: "项目排序",
    threads: "会话排序",
    chats: "对话排序",
  },

  help: {
    menu: "帮助",
    whatsNew: "更新内容",
    keyboardShortcuts: "键盘快捷键",
    sendFeedback: "发送反馈",
    docs: "文档",
  },

  views: {
    threads: "项目",
    studio: "工作室",
  },

  projects: {
    loading: "正在加载项目",
    loadingEllipsis: "正在加载项目…",
  },

  chats: {
    title: "对话",
    empty: "还没有对话",
  },

  thread: {
    archive: "归档会话",
    pinned: "已置顶",
    temporary: "临时对话",
    pendingApproval: "等待审批",
    pendingBadge: "待处理",
  },

  space: {
    noProjects: "还没有项目",
    moveProjectsHere: "将项目移动到这里",
    toggleThreadSidebar: "切换会话侧边栏",
  },

  projectMenu: {
    openInFinder: "在 Finder 中打开",
    openInKanban: "在看板中打开",
    copyPath: "复制路径",
    stopDev: "停止开发服务",
    startDev: "启动开发服务",
    openDevServer: "打开开发服务器",
    moveToSpace: "移动到空间",
    voidSpace: "Void",
    newSpace: "新建空间…",
    editName: "编辑名称",
    archiveThreads: "归档会话",
    deleteThreads: "删除会话",
    remove: "移除",
  },

  devServer: {
    running: "开发服务器运行中",
    startTitle: "启动开发服务",
    commandLabel: "命令",
    commandPlaceholder: "例如 npm run dev",
    commandHint: "请输入要运行的命令。",
  },

  renameProject: {
    title: "重命名项目",
    description: "保持简短、易于识别。",
  },

  searchPalette: {
    importTitle: "从提供商导入会话",
    importDescription: "创建一个本地应用会话，并从已有的提供商 id 恢复它。",
    providerLabel: "提供商",
    noImportProviders: "此版本中没有已连接的提供商支持对话导入。",
    windowsPathsUnsupported: "此平台不支持 Windows 路径。",
    noMatchingFolders: "没有匹配的文件夹。",
    createFolderPrefix: "按 Enter 创建",
    createFolderSuffix: "并将其添加为项目。",
    groupSuggested: "推荐",
    groupProjects: "项目",
    groupConfigure: "配置",
    noMatches: "没有匹配项。",
    hint: "跳转到会话、项目、操作或外观设置。",
    hintEnter: "按 Enter 打开",
  },

  planSidebar: {
    title: "计划",
    close: "关闭计划侧边栏",
    steps: "步骤",
    emptyTitle: "还没有进行中的计划。",
    emptyDescription: "生成计划后会显示在这里。",
  },

  intelBuildWarning: "正在 Apple Silicon 上运行 Intel 版本",
};
