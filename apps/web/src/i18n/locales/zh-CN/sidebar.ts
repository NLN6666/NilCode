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
    customize: "自定义",
    customizeSidebar: "自定义侧边栏",
    done: "完成",
    hideItem: (label) => `从侧边栏隐藏${label}`,
    showItem: (label) => `在侧边栏显示${label}`,
    reorderItem: (label) => `调整${label}的顺序`,
  },

  sort: {
    projects: "项目排序",
    threads: "会话排序",
    chats: "对话排序",
  },

  help: {
    menu: "帮助",
    whatsNew: "更新内容",
    versionFallback: (version) => `版本 ${version}`,
    fullChangelog: "完整更新日志",
    keyboardShortcuts: "键位绑定",
    sendFeedback: "发送反馈",
    docs: "文档",
  },

  views: {
    threads: "项目",
    groups: "工作组",
  },
  rail: {
    home: "主页",
    spaces: "空间",
    shortcuts: "快捷入口",
    backToSpaces: "返回空间",
    noThreads: "还没有会话",
    newTerminal: "新建终端会话",
    newTerminalShortcut: (shortcut) => `新建终端会话（${shortcut}）`,
    newTerminalFor: (project) => `在${project}中新建终端会话`,
    newThreadFor: (project) => `在${project}中新建会话`,
    newThreadShortcut: (shortcut) => `新建会话（${shortcut}）`,
    viewPullRequestsFor: (project) => `查看${project}的拉取请求`,
  },

  surfacePicker: {
    ariaLabel: "切换侧边栏界面",
    threads: { title: "Synara", description: "构建、调试与交付" },
    groups: { title: "工作组", description: "跨仓库协同工作" },
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
    showSubagents: (count: number) => `展开 ${count} 个子代理`,
    hideSubagents: (count: number) => `收起 ${count} 个子代理`,
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
    editProject: "编辑项目",
    changePath: "更改项目路径…",
    useSharedBrowser: "共享一个浏览器",
    useSeparateBrowsers: "每个会话独立浏览器",
    shareBrowserFailed: "无法让该项目共享浏览器",
    separateBrowsersFailed: "无法让每个会话使用独立浏览器",
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
    threadId: "会话 ID",
    sessionId: "会话 ID",
    importClaudePlaceholder: "粘贴 Claude 会话 ID",
    importCursorPlaceholder: "粘贴 Cursor 会话 ID",
    importDroidPlaceholder: "粘贴 Droid 会话 ID",
    importOpenCodePlaceholder: "粘贴 OpenCode 会话 ID",
    importOmpPlaceholder: "粘贴 Oh My Pi 会话 ID",
    importCodexPlaceholder: "粘贴 Codex 会话 ID",
    importHint: {
      codex: "Codex 会根据会话 ID 恢复已保存的会话。",
      claudeAgent: "Claude 会根据会话 ID 恢复已保存的会话。",
      cursor: "Cursor 会根据会话 ID 恢复已保存的会话。",
      droid: "Droid 会根据会话 ID 恢复已保存的会话。",
      opencode: "OpenCode 会根据会话 ID 恢复已保存的会话。",
      omp: "Oh My Pi 会根据会话 ID 恢复已保存的会话。",
    },
    importing: "正在导入…",
    import: "导入",
    importFailed: "导入会话失败。",
    importProjects: "导入项目",
    importProjectsPlaceholder: "从以下来源导入项目…",
    importSources: {
      "claude-code": "从 Claude Code 导入",
      codex: "从 Codex 导入",
      all: "从 Claude Code 和 Codex 导入",
    },
    noImportSource: "没有匹配的导入来源。",
    backToCommands: "返回命令列表",
    projectPathPlaceholder: "输入项目路径（例如 ~/projects/my-app）",
    searchPlaceholder: "搜索对话或运行命令",
    enterFolderPath: "请输入文件夹路径。",
    relativePathsUnsupported: "不支持相对路径。请使用绝对路径或以 ~/ 开头的路径。",
    addFailed: "添加项目失败。",
    createAndAdd: "创建并添加",
    add: "添加",
    windowsPathsUnsupported: "此平台不支持 Windows 路径。",
    noMatchingFolders: "没有匹配的文件夹。",
    createFolderPrefix: "按 Enter 创建",
    createFolderSuffix: "并将其添加为项目。",
    addingProject: "正在添加项目……",
    browseHint: "输入路径，按 ↑↓ 浏览文件夹。",
    highlightedFolderHint: (modifier: string) => `按 Enter 打开 · ${modifier}+Enter 添加`,
    goUpHint: "按 Enter 返回上级",
    addProjectHint: "按 Enter 添加项目",
    groupSuggested: "推荐",
    groupThreads: "会话",
    groupRecent: "最近的对话",
    groupActions: "操作",
    groupQuickActions: "快捷操作",
    groupSettings: "设置",
    groupProjects: "项目",
    groupConfigure: "配置",
    groupDarkThemes: "深色主题",
    groupLightThemes: "浅色主题",
    darkColorTheme: "深色配色主题",
    lightColorTheme: "浅色配色主题",
    untitledThread: "未命名会话",
    untitledProject: "未命名项目",
    match: {
      chatHits: (count) => `${count} 处对话命中`,
      chatMatch: "对话命中",
      projectMatch: "项目命中",
    },
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
