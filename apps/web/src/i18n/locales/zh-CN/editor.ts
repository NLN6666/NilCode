// FILE: locales/zh-CN/editor.ts
// Purpose: Simplified Chinese copy for the editor workspace, terminal, PDF viewer, and previews.

import type { Messages } from "../en";

export const editor: Messages["editor"] = {
  workspace: {
    activityBar: "编辑器活动栏",
    files: "文件",
    hideFiles: "隐藏文件侧边栏",
    diff: "差异",
    hideDiff: "隐藏差异侧边栏",
    searchFiles: "搜索文件",
    hideSearch: "隐藏搜索侧边栏",
    changedFiles: "改动的文件",
    loadingChangedFiles: "正在加载改动的文件…",
    noFilesInDiff: "这个差异里没有文件。",
    home: "首页",
    workspaceLabel: "工作区",
    noWorkspace: "没有工作区",
    switchProject: "切换项目",
    hideChatPanel: "隐藏对话面板",
    showChatPanel: "显示对话面板",
    switchToChatView: "切换到对话视图",
    chat: "对话",
    resizeChatPanel: "调整对话面板宽度",
    dragToResizeChatPanel: "拖动以调整对话面板宽度",
  },

  filePreview: {
    loading: "正在加载文件…",
    noWorkspaceAttached: "这个对话没有关联工作区。",
    selectFromExplorer: "从资源管理器中选择一个文件。",
    commentOnLine: (line) => `批注第 ${line} 行`,
    comment: "批注",
  },

  image: {
    openFailed: "无法打开这张图片",
    openFailedHint: "文件可能已被移动或不可用。",
    download: "下载",
    downloadImage: "下载图片",
  },

  pdf: {
    loading: "正在加载 PDF…",
    previousPage: "上一页",
    nextPage: "下一页",
    currentPage: "当前页",
    zoomOut: "缩小",
    zoomIn: "放大",
    fitWidth: "适合宽度",
    fitPage: "适合整页",
    renderFailed: (page) => `无法渲染第 ${page} 页`,
  },

  terminal: {
    label: "终端",
    chat: "对话",
    error: "错误",
    scrollToBottom: "滚动到底部",
    newTab: "新建终端标签页",
    moveToOwnTab: "移到独立的终端标签页",
    splitRight: "向右拆分",
    splitDown: "向下拆分",
    closeTab: "关闭当前终端标签页",
    search: {
      placeholder: "查找",
      noResults: "没有结果",
      matchCase: "区分大小写",
      previous: "上一个匹配（Shift+Enter）",
      next: "下一个匹配（Enter）",
      close: "关闭搜索（Esc）",
    },
  },
};
