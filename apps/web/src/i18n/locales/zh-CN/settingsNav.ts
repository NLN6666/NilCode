// FILE: locales/zh-CN/settingsNav.ts
// Purpose: Simplified Chinese copy for the settings navigation taxonomy.
//
// "AppSnap" and "Synara" stay in English: they are product feature names, not prose. Translating
// them would break the link between the UI and every doc, release note, and support thread.

import type { SettingsNav } from "../en/settingsNav";

export const settingsNav: SettingsNav = {
  navAriaLabel: "设置分区",
  backToApp: "返回应用",
  searchPlaceholder: "搜索设置…",
  searchAriaLabel: "搜索设置",
  searchResultsAriaLabel: "设置搜索结果",
  noResults: "没有匹配的设置。",

  groups: {
    app: "应用",
    synara: "Synara",
  },

  sections: {
    general: {
      label: "常规",
      description: "默认提供商、会话模式和侧边栏组织。",
    },
    profile: {
      label: "个人资料",
      description: "你的本地活动、连续记录和可分享的统计卡片。",
    },
    appearance: {
      label: "外观",
      description: "主题、排版和时间戳格式。",
    },
    notifications: {
      label: "通知",
      description: "应用内提示和桌面通知。",
    },
    behavior: {
      label: "行为",
      description: "流式输出、差异处理和破坏性操作确认。",
    },
    appsnap: {
      label: "AppSnap",
      description: "一键将其他应用的窗口截取到任务中。",
    },
    shortcuts: {
      label: "键盘快捷键",
      description: "Synara 中所有可用的键盘快捷键，按上下文分组。",
    },
    worktrees: {
      label: "工作树",
      description: "查看和清理 Synara 创建的工作树。",
    },
    archived: {
      label: "已归档",
      description: "查看和恢复已归档的会话。",
    },
    models: {
      label: "模型",
      description: "Git 编写默认值和自定义模型标识。",
    },
    providers: {
      label: "提供商",
      description: "选择可见的提供商、查看 CLI 安装和更新提供商工具。",
    },
    skills: {
      label: "技能",
      description: "所有提供商中发现的技能，可通过开关控制可用性。",
    },
    usage: {
      label: "用量",
      description: "每个已登录提供商的剩余配额和积分。",
    },
    mcpServers: {
      label: "MCP 服务器",
      description: "启用或禁用 Codex 与 Claude 代理所使用的 MCP 服务器。",
    },
    integrations: {
      label: "集成",
      description: "为本地 MCP 客户端配对可限定范围、可撤销的 Synara 任务访问权限。",
    },
    advanced: {
      label: "高级",
      description: "按键绑定、恢复工具和版本信息。",
    },
  },
};
