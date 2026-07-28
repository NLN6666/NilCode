// FILE: locales/zh-CN/dialogs.ts
// Purpose: Simplified Chinese copy for the standalone app dialogs.

import type { Messages } from "../en";

export const dialogs: Messages["dialogs"] = {
  profile: {
    title: "编辑资料",
    editAvatar: "编辑头像",
    remove: "移除",
    replacePhoto: "更换照片",
    uploadPhoto: "上传照片",
    processing: "正在处理…",
    useColor: (color) => `使用 ${color}`,
    colorsApplyHint: "没有设置照片时才会应用颜色。",
    displayName: "显示名称",
    namePlaceholder: "你的名字",
    username: "用户名",
    cancel: "取消",
    save: "保存",
    imageFailed: "无法处理这张图片。",
  },

  createProject: {
    title: "创建项目",
    pathLabel: "项目文件夹路径",
    pathPlaceholder: "/path/to/project",
    sourceFolder: "源文件夹",
    space: "空间",
    newSpace: "新建空间",
    cancel: "取消",
    creating: "正在创建…",
    submit: "创建项目",
    files: "文件",
    dropFolderNotFile: "请拖入文件夹，而不是文件。",
    pathUnreadable: "无法读取该文件夹的路径。请改用浏览或手动输入。",
    serverUnavailable: "应用服务不可用。",
    pickerFailed: "无法打开文件夹选择器。",
    typePathHint: "输入一个文件夹路径，或把文件夹拖到上方。",
    addFailed: "添加项目时出错。",
    openingPicker: "正在打开文件夹选择器…",
    dropHere: "把文件夹拖到这里，或点击浏览",
  },

  feedback: {
    title: "反馈",
    category: "反馈类别",
    detailsPlaceholder: "写下详情（必填）",
    detailsLabel: "反馈详情",
    diagnosticsHint:
      "诊断信息包含应用版本、操作系统、提供商/模型、运行模式和会话状态 —— 不会包含提示词、消息、路径或日志。",
    sending: "正在发送…",
    submit: "提交",
    sent: "反馈已发送",
    sentHint: "感谢你帮助 Synara 变得更好。",
    failed: "无法发送反馈",
    failedHint: "发送时发生了意外错误。",
  },

  shortcuts: {
    title: "键盘快捷键",
    description: "显示当前情境下生效的按键绑定。",
    searchPlaceholder: "搜索快捷键…",
    searchLabel: "搜索快捷键",
    noMatches: (query) => `没有匹配「${query}」的快捷键。`,
  },

  whatsNew: {
    title: "有什么新变化？",
    viewChangelog: "查看更新日志",
    gotIt: "知道了",
    back: "返回「新变化」",
    changelogTitle: "完整更新日志",
    changelogDescription: "所有精选版本，从新到旧。",
    dismiss: "关闭「新变化」",
    popoutTitle: (version) => `v${version} 有什么新变化`,
    popoutHint: "看看有什么新变化",
    noReleaseNotes: "还没有发布说明 —— 下次更新后再来看看。",
    version: (version) => `版本 ${version}`,
  },

  releaseHistory: {
    title: "发布历史",
    description: "所有精选版本，从新到旧。",
    close: "关闭",
  },

  share: {
    title: "分享你的动态",
    copy: "复制",
    copyStatCard: "复制统计卡片",
    save: "保存",
    saveStatCard: "保存统计卡片",
    savedPng: "已把 PNG 保存到下载目录。",
    renderFailed: "无法渲染图片。",
    copyUnavailable: "无法复制图片。请改用「保存」。",
    copiedToClipboard: "已复制图片到剪贴板。",
    copiedForPost: "图片已复制到剪贴板 —— 粘贴到你的帖子里即可。",
    composerOpened: "已打开发布框。用「保存」来附加图片。",
    composerOpenedNoCopy: "已打开发布框。无法复制图片，请用「保存」来附加。",
  },

  worktreeHandoff: {
    title: "移交到工作树",
    description: "从当前分支创建一个独立的工作树，以便并行继续工作。",
    nameLabel: "工作树名称",
    namePlaceholder: "synara/feature-name",
    cancel: "取消",
    handOff: "移交",
    handingOff: "正在移交…",
  },

  appSnapWelcome: {
    title: "Synara AppSnap 上线了！",
    description: "按下两个 Option 键（⌥ ⌥），把任意应用的窗口截取到你正在处理的任务中。",
    notNow: "暂不",
    setUp: "设置 AppSnap",
  },

  rename: {
    cancel: "取消",
    save: "保存",
    saving: "正在保存…",
    threadTitle: "重命名对话",
    threadDescription: "起一个简短好认的名字。",
  },

  splash: {
    retry: "重试",
  },

  projectHoverCard: {
    editProject: "编辑项目",
  },
};
