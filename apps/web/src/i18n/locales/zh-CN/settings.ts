// FILE: locales/zh-CN/settings.ts
// Purpose: Simplified Chinese copy for the settings screen.
//
// The `: Settings` annotation is the safety net for this whole migration: omit a key, misspell
// one, or add a stray one and `bun typecheck` fails instead of silently falling back to English.

import type { Settings } from "../en/settings";

export const settings: Settings = {
  controls: {
    resetTooltip: "重置为默认值",
    resetAriaLabel: (label) => `将${label}重置为默认值`,
  },
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
        options: {
          updated_at: "最近活动",
          created_at: "最近添加",
          manual: "手动排序",
        },
      },
      threadOrder: {
        title: "会话排序",
        description: "控制会话在主侧边栏各项目内的排列方式。",
        ariaLabel: "会话排序",
        resetLabel: "会话排序",
        options: {
          updated_at: "最近活动",
          created_at: "最新优先",
        },
      },
    },
    sidebarSections: {
      title: "侧边栏板块",
      chats: {
        title: "对话",
        description: "在侧边栏底部显示独立的对话列表（不属于任何项目的对话）。",
        resetLabel: "对话板块",
        ariaLabel: "在侧边栏中显示对话板块",
      },
      studio: {
        title: "Studio",
        description: "在侧边栏切换器中显示 Studio 标签页。",
        resetLabel: "Studio 板块",
        ariaLabel: "在侧边栏中显示 Studio 板块",
      },
    },
    environmentPanel: {
      title: "环境面板",
      defaultOpen: {
        title: "默认展开",
        description:
          "在普通会话中自动展开对话的环境面板。关闭后面板保持收起，直到你手动展开。你最后一次的展开/收起操作也会更新此偏好。",
        resetLabel: "环境面板默认展开",
        ariaLabel: "在普通会话中默认展开环境面板",
      },
      usage: {
        title: "用量",
        description: "在对话的环境面板中显示提供商用量行。",
        resetLabel: "用量板块",
        ariaLabel: "在环境面板中显示用量板块",
      },
      repository: {
        title: "仓库",
        description:
          "在对话的环境面板中显示 GitHub 仓库链接。Git 区块（更改、工作树、分支、提交与推送）始终可见。",
        resetLabel: "仓库板块",
        ariaLabel: "在环境面板中显示仓库板块",
      },
      pullRequest: {
        title: "拉取请求",
        description: "在对话的环境面板中显示当前分支的开放拉取请求（CI 检查与评审评论）。",
        resetLabel: "拉取请求板块",
        ariaLabel: "在环境面板中显示拉取请求板块",
      },
      editor: {
        title: "编辑器",
        description:
          "在对话的环境面板中显示编辑器板块（应用内编辑器视图与「在编辑器中打开」选择器）。",
        resetLabel: "编辑器板块",
        ariaLabel: "在环境面板中显示编辑器板块",
      },
      recap: {
        title: "摘要",
        description: "在环境面板中显示自动生成的对话摘要。",
        resetLabel: "摘要板块",
        ariaLabel: "在环境面板中显示摘要板块",
      },
      pinned: {
        title: "置顶消息",
        description: "在环境面板中显示置顶消息清单。",
        resetLabel: "置顶消息板块",
        ariaLabel: "在环境面板中显示置顶消息板块",
      },
      markers: {
        title: "文本标记",
        description: "在环境面板中显示已高亮和已加下划线的对话文本。",
        resetLabel: "文本标记板块",
        ariaLabel: "在环境面板中显示文本标记板块",
      },
      instructions: {
        title: "项目指令",
        description: "在环境面板中显示项目级指令。",
        resetLabel: "项目指令板块",
        ariaLabel: "在环境面板中显示项目指令板块",
      },
      notepad: {
        title: "记事本",
        description: "在环境面板中显示每个会话独立的记事本。",
        resetLabel: "记事本板块",
        ariaLabel: "在环境面板中显示记事本板块",
      },
    },
  },
};
