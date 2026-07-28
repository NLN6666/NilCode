// FILE: locales/zh-CN/settingsNav.ts
// Purpose: Simplified Chinese copy for the settings navigation taxonomy.
//
// "AppSnap", "MCP" and "Synara" stay in English: they are product feature names, not prose.
// Translating them would break the link between the UI and every doc, release note, and support
// thread.

import type { SettingsNav } from "../en/settingsNav";

export const settingsNav: SettingsNav = {
  navAriaLabel: "设置分区",
  backToApp: "返回应用",
  searchPlaceholder: "搜索设置…",
  searchAriaLabel: "搜索设置",
  searchResultsAriaLabel: "设置搜索结果",
  noResults: "没有匹配的设置。",

  groups: {
    personal: "个人",
    integrations: "集成",
    coding: "编码",
    system: "系统",
    archived: "已归档",
  },

  sections: {
    general: {
      label: "常规",
      description: "为新会话、导航和环境面板选择默认设置。",
    },
    profile: {
      label: "个人资料",
      description: "你的本地活动、连续记录和可分享的统计卡片。",
    },
    appearance: {
      label: "外观",
      description: "自定义主题、排版、密度和时间格式。",
    },
    notifications: {
      label: "通知",
      description: "选择 Synara 在工作完成或需要关注时如何通知你。",
    },
    behavior: {
      label: "会话行为",
      description: "控制实时响应、后续追问、审查默认值和安全确认。",
    },
    shortcuts: {
      label: "键盘快捷键",
      description: "搜索并自定义快捷键，按生效范围分组。",
    },
    usage: {
      label: "用量与限额",
      description: "查看每个已登录提供商的剩余配额和积分。",
    },
    appsnap: {
      label: "AppSnap",
      description: "将其他应用的最前窗口直接截取到任务中。",
    },
    mcpServers: {
      label: "MCP 服务器",
      description: "启用或禁用 Codex 与 Claude 代理所使用的 MCP 服务器。",
    },
    integrations: {
      label: "MCP 连接",
      description: "为 Codex、Claude 及其他本地代理授予受限的 Synara 任务访问权限。",
    },
    providers: {
      label: "代理提供商",
      description: "选择可见的编码代理并管理其已安装的 CLI 工具。",
    },
    models: {
      label: "模型与编写",
      description: "选择用于 Git 编写的模型，并添加自定义模型标识。",
    },
    skills: {
      label: "代理技能",
      description: "查看在所有已配置提供商中发现的可复用工作流。",
    },
    worktrees: {
      label: "托管工作树",
      description: "查看和清理 Synara 创建的隔离工作区。",
    },
    advanced: {
      label: "系统工具",
      description: "管理会话、恢复工具、底层按键绑定和版本详情。",
    },
    archived: {
      label: "已归档会话",
      description: "查找并恢复此前归档的会话。",
    },
  },
};
