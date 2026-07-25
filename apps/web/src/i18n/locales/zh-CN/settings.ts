// FILE: locales/zh-CN/settings.ts
// Purpose: Simplified Chinese copy for the settings screen.
//
// The `: Settings` annotation is the safety net for this whole migration: omit a key, misspell
// one, or add a stray one and `bun typecheck` fails instead of silently falling back to English.

import type { Settings } from "../en/settings";

export const settings: Settings = {
  general: {
    coreDefaults: {
      title: "核心默认",
      language: {
        title: "语言",
        description: "选择 Synara 界面的显示语言。",
        ariaLabel: "语言",
        resetLabel: "语言",
      },
      defaultProvider: {
        title: "默认提供商",
        description: "选择用于新对话的提供商。",
        ariaLabel: "默认提供商",
        resetLabel: "默认提供商",
      },
      newThreads: {
        title: "新建会话",
        description: "选择新创建草稿会话的默认工作区模式。",
        ariaLabel: "默认会话模式",
        resetLabel: "新建会话",
        local: "本地",
        worktree: "新建工作树",
      },
    },
    sidebarOrganization: {
      title: "侧边栏组织",
      projectOrder: {
        title: "项目排序",
        description: "控制项目在主侧边栏中的排列方式。",
        ariaLabel: "项目排序",
        resetLabel: "项目排序",
      },
      threadOrder: {
        title: "会话排序",
        description: "控制会话在主侧边栏各项目内的排列方式。",
        ariaLabel: "会话排序",
        resetLabel: "会话排序",
      },
    },
  },
};
