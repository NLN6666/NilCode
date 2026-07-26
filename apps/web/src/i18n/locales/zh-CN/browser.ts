// FILE: locales/zh-CN/browser.ts
// Purpose: Simplified Chinese copy for the in-app browser panel.

import type { Messages } from "../en";

export const browser: Messages["browser"] = {
  restoringRuntime: "正在恢复浏览器",
  sleeping: "浏览器已休眠",
  restoringCached: "正在恢复缓存的浏览器",
  untitledTab: "无标题",

  nav: {
    goBack: "后退",
    goForward: "前进",
    reload: "重新加载",
    addressPlaceholder: "搜索或输入网址",
  },

  actions: {
    annotate: "标注页面",
    copyScreenshot: "复制截图",
    copyLink: "复制链接",
    menu: "浏览器操作",
    newTab: "新建标签页",
    captureScreenshot: "截取页面",
    openExternally: "在外部打开",
    closePanel: "关闭浏览器面板",
    closeTab: "关闭标签页",
  },

  status: {
    unavailable: "浏览器不可用。",
    starting: "正在启动浏览器…",
    noTabs: "没有打开的标签页",
    restoringTab: "正在恢复标签页…",
  },

  toast: {
    screenshotCopied: "已复制浏览器截图",
    linkCopied: "已复制链接",
  },

  localServers: {
    title: "本地",
    refresh: "刷新本地服务",
    scanning: "正在扫描本地服务",
    checkingPorts: "正在检查 localhost 端口",
    none: "没有本地服务",
    tryAnother: "试试其他网址",
  },

  annotation: {
    tools: {
      pen: "自由绘制",
      rect: "绘制矩形",
      arrow: "绘制箭头",
      text: "添加文字标签",
      mosaic: "马赛克遮盖",
    },
    useInk: (color) => `使用 ${color} 墨色`,
    textLabel: "标注文字",
    textPlaceholder: "输入标签",
    undo: "撤销",
    undoHint: "撤销（Ctrl/Cmd+Z）",
    redo: "重做",
    redoHint: "重做（Ctrl/Cmd+U 或 Ctrl/Cmd+Shift+Z）",
    clear: "清除",
    clearAll: "清除所有标记",
    clearAllHint: "清除所有标记（可撤销）",
    cancel: "取消",
    confirmDiscard: "确定丢弃标记？",
    addToChat: "添加到对话",
  },
};
