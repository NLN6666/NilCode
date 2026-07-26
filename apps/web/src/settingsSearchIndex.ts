// FILE: settingsSearchIndex.ts
// Purpose: Declarative, searchable index of settings rows/sections so the sidebar can
//          surface matches by title/description the same way the editor file search does.
// Layer: Route/UI support
// Exports: entry type, the index, and the ranking helper

import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import { settingRowAnchorId, type SettingsSectionId } from "./settingsNavigation";

/**
 * One searchable settings result. `title` usually matches a string SettingsRow heading so
 * the default anchor can be derived; `target: null` marks panel-only or conditional rows.
 */
export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  keywords: string;
  target?: string | null;
  /**
   * Set once the row renders its title from the i18n catalog. A translated title is useless as
   * an anchor source — `settingRowAnchorId` keeps only `[a-z0-9]`, so every Chinese title
   * slugs to the same empty id — so the anchor comes from this entry's locale-independent
   * `id` instead. Rows opt in by passing the same id as `anchorKey` to `SettingsRow`.
   * Every entry gains this flag as panels migrate, at which point it becomes the default.
   */
  localizedTitle?: true;
}

/** DOM id a result deep-links to, or null for panel-level entries with no anchored row. */
export function settingsSearchEntryTarget(entry: SettingsSearchEntry): string | null {
  if (entry.target !== undefined) return entry.target;
  return settingRowAnchorId(entry.localizedTitle ? entry.id : entry.title);
}

// Mirrors row titles/descriptions rendered in settings panels. Panels stay mounted but render
// null while inactive, so the sidebar cannot read every row at runtime; keep this list in sync
// when rows are added, renamed, hidden conditionally, or represented as panel-level results.
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  // ── General ────────────────────────────────────────────────────────────────
  {
    id: "general:language",
    section: "general",
    title: "Language",
    keywords:
      "Choose the display language for the Synara interface. locale i18n english chinese 语言 中文 简体中文",
    localizedTitle: true,
  },
  {
    id: "general:default-provider",
    section: "general",
    title: "Default provider",
    keywords: "Choose the provider used for new chats. agent codex claude 默认提供商 新对话",
    localizedTitle: true,
  },
  {
    id: "general:new-threads",
    section: "general",
    title: "New threads",
    keywords:
      "Pick the default workspace mode for newly created draft threads. local worktree environment 新建会话 本地 工作树",
    localizedTitle: true,
  },
  {
    id: "general:project-order",
    section: "general",
    title: "Project order",
    keywords:
      "Controls how projects are arranged in the main sidebar. sort updated created manual 项目排序 侧边栏",
    localizedTitle: true,
  },
  {
    id: "general:thread-order",
    section: "general",
    title: "Thread order",
    keywords:
      "Controls how threads are arranged inside each project in the main sidebar. sort updated created 会话排序 侧边栏",
    localizedTitle: true,
  },
  {
    id: "general:chats-section",
    section: "general",
    title: "Chats",
    keywords:
      "Show the standalone Chats list in the sidebar footer chats not tied to a project. sidebar section 对话 侧边栏板块",
    localizedTitle: true,
  },
  {
    id: "general:studio-section",
    section: "general",
    title: "Studio",
    keywords:
      "Show the Studio tab in the sidebar switcher. sidebar section content outbox 侧边栏板块",
    localizedTitle: true,
  },
  {
    id: "general:environment-default-open",
    section: "general",
    title: "Open by default",
    keywords:
      "Open the chat Environment panel automatically on normal threads. default closed open environment panel preference 环境面板 默认展开",
    localizedTitle: true,
  },
  {
    id: "general:environment-usage",
    section: "general",
    title: "Usage",
    keywords: "Show the provider usage row in the chat Environment panel. 用量 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-repository",
    section: "general",
    title: "Repository",
    keywords:
      "Show the GitHub repository link in the chat Environment panel. git changes worktree 仓库 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-pull-request",
    section: "general",
    title: "Pull request",
    keywords:
      "Show the open pull request CI checks and review comments in the chat Environment panel. pr fix github 拉取请求 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-editor",
    section: "general",
    title: "Editor",
    keywords:
      "Show the Editor section in-app editor view and Open in editor picker in the chat Environment panel. 编辑器 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-recap",
    section: "general",
    title: "Recap",
    keywords: "Show the auto-generated chat recap in the Environment panel. 摘要 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-pinned",
    section: "general",
    title: "Pinned messages",
    keywords: "Show the pinned-messages checklist in the Environment panel. 置顶消息 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-markers",
    section: "general",
    title: "Text markers",
    keywords:
      "Show highlighted and underlined transcript text in the Environment panel. 文本标记 高亮 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-instructions",
    section: "general",
    title: "Project instructions",
    keywords: "Show project-level instructions in the Environment panel. 项目指令 环境面板",
    localizedTitle: true,
  },
  {
    id: "general:environment-notepad",
    section: "general",
    title: "Notepad",
    keywords: "Show the per-thread notepad in the Environment panel. 记事本 环境面板",
    localizedTitle: true,
  },

  // ── Appearance ───────────────────────────────────────────────────────────────
  {
    id: "appearance:theme",
    section: "appearance",
    title: "Theme",
    keywords: "Choose how Synara looks across the app. dark light system color 主题 深色 浅色 外观",
    localizedTitle: true,
  },
  {
    id: "appearance:system-ui-font",
    section: "appearance",
    title: "Use system UI font",
    keywords: "Use the operating system interface font throughout Synara. 系统界面字体 字体",
    localizedTitle: true,
  },
  {
    id: "appearance:ui-density",
    section: "appearance",
    title: "UI density",
    keywords:
      "Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size. compact comfortable 界面密度 紧凑 宽松 间距",
    localizedTitle: true,
  },
  {
    id: "appearance:base-font-size",
    section: "appearance",
    title: "Base font size",
    keywords:
      "Adjust the app text base in pixels. Chat and UI typography scale proportionally. font 基础字号 字体大小",
    localizedTitle: true,
  },
  {
    id: "appearance:terminal-font-size",
    section: "appearance",
    title: "Terminal font size",
    keywords: "Adjust terminal text independently from the app and chat font size. 终端字号",
    localizedTitle: true,
  },
  {
    id: "appearance:terminal-font",
    section: "appearance",
    title: "Terminal font",
    keywords:
      "Type any monospace font installed on this device e.g. Fira Code. system monospace family 终端字体 等宽字体",
    localizedTitle: true,
  },
  {
    id: "appearance:font-smoothing",
    section: "appearance",
    title: "Font smoothing",
    keywords: "Use macOS-style antialiasing for lighter, crisper text rendering.",
    target: null,
  },
  {
    id: "appearance:time-format",
    section: "appearance",
    title: "Time format",
    keywords:
      "System default follows your browser or OS clock preference. timestamp 12-hour 24-hour locale 时间格式 12 小时制 24 小时制",
    localizedTitle: true,
  },

  // ── Notifications ─────────────────────────────────────────────────────────────
  {
    id: "notifications:activity-toasts",
    section: "notifications",
    title: "Activity toasts",
    keywords:
      "Show an in-app toast when a chat or managed terminal agent finishes or needs input. alerts 应用内提示 活动提醒",
    localizedTitle: true,
  },
  {
    id: "notifications:desktop-notifications",
    section: "notifications",
    title: "Desktop notifications",
    keywords:
      "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background. alerts toast 桌面通知 系统通知",
    localizedTitle: true,
  },

  // ── AppSnap ───────────────────────────────────────────────────────────────────
  {
    id: "appsnap:enable",
    section: "appsnap",
    title: "Enable AppSnap",
    keywords:
      "Capture the frontmost macOS app window with a configurable two-key shortcut and add it to a recent task. appshot screenshot snap window capture hotkey 截图 窗口捕获",
    localizedTitle: true,
  },
  {
    id: "appsnap:shortcut",
    section: "appsnap",
    title: "Shortcut",
    keywords:
      "Press the left and right Option keys at the same time. hotkey chord alt keys 快捷键 组合键",
    localizedTitle: true,
  },
  {
    id: "appsnap:destination",
    section: "appsnap",
    title: "Destination",
    keywords:
      "Snaps join the task you interacted with in the last minute, otherwise a fresh task opens. automatic target composer 目标位置 自动",
    localizedTitle: true,
  },
  {
    id: "appsnap:capture-sound",
    section: "appsnap",
    title: "Capture sound",
    keywords:
      "Play a short shutter cue when a window is captured. sound effect audio mute 截图提示音 快门音",
    localizedTitle: true,
  },
  {
    id: "appsnap:permissions",
    section: "appsnap",
    title: "Permission status",
    keywords:
      "Input Monitoring and Screen Recording permissions for AppSnap in macOS System Settings. privacy security recheck grant",
    // Renders only in the macOS desktop app, so no stable anchor on other platforms.
    target: null,
  },

  // ── Behavior ──────────────────────────────────────────────────────────────────
  {
    id: "behavior:assistant-output",
    section: "behavior",
    title: "Assistant output",
    keywords: "Show token-by-token output while a response is in progress. streaming 助手输出 流式",
    localizedTitle: true,
  },
  {
    id: "behavior:diff-line-wrapping",
    section: "behavior",
    title: "Diff line wrapping",
    keywords: "Set the default wrap state when the diff panel opens. word wrap 差异自动换行",
    localizedTitle: true,
  },
  {
    id: "behavior:delete-confirmation",
    section: "behavior",
    title: "Delete confirmation",
    keywords: "Ask before deleting a thread and its chat history. safety confirm 删除确认",
    localizedTitle: true,
  },
  {
    id: "behavior:archive-confirmation",
    section: "behavior",
    title: "Archive confirmation",
    keywords: "Ask before archiving a thread. safety confirm 归档确认",
    localizedTitle: true,
  },
  {
    id: "behavior:terminal-close-confirmation",
    section: "behavior",
    title: "Terminal close confirmation",
    keywords:
      "Ask before closing a terminal tab and clearing its history. safety confirm 终端关闭确认",
    localizedTitle: true,
  },

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────────
  {
    id: "shortcuts:keyboard-shortcuts",
    section: "shortcuts",
    title: "Keyboard Shortcuts",
    keywords:
      "Every keyboard shortcut available in Synara, grouped by context. keybindings hotkeys key combo cmd ctrl reference",
    target: null,
  },

  // ── Worktrees ─────────────────────────────────────────────────────────────────
  {
    id: "worktrees:managed-worktrees",
    section: "worktrees",
    title: "Managed worktrees",
    keywords: "Review and clean up the worktrees created by Synara. git branch remove",
    target: null,
  },

  // ── Archived ──────────────────────────────────────────────────────────────────
  {
    id: "archived:archived-threads",
    section: "archived",
    title: "Archived threads",
    keywords: "View and restore archived threads. unarchive history",
    target: null,
  },

  // ── Models ────────────────────────────────────────────────────────────────────
  {
    id: "models:git-writing-model",
    section: "models",
    title: "Git writing model",
    keywords:
      "Used for generated commit messages, PR titles, and branch names. Git 文案模型 提交信息 分支名",
    localizedTitle: true,
  },
  {
    id: "models:saved-model-slugs",
    section: "models",
    title: "Saved model slugs",
    keywords: "Add custom model slugs for supported providers. custom model 自定义模型 模型标识",
    localizedTitle: true,
  },
  {
    id: "models:cloud-catalog",
    section: "models",
    title: "Cloud model catalog",
    keywords:
      "Synara reads the public models.dev catalog so newly released models show up without waiting for an update. refresh 云端模型目录 刷新",
    localizedTitle: true,
  },
  {
    id: "models:visible-models",
    section: "models",
    title: "Models shown in the picker",
    keywords:
      "Turn off the models you never reach for. hide visibility picker 可见模型 隐藏 选择器",
    localizedTitle: true,
  },

  // ── Providers ─────────────────────────────────────────────────────────────────
  {
    id: "providers:automatic-cli-update-checks",
    section: "providers",
    title: "Automatic CLI update checks",
    keywords:
      "Check Codex Claude and other provider CLIs for newer versions in the background. updates upgrade disable nags 自动检查更新",
    localizedTitle: true,
  },
  {
    id: "providers:visible-providers",
    section: "providers",
    title: "Visible providers",
    keywords:
      "Drag providers into your preferred picker order and hide the ones you don't use. visibility order 可见提供商 隐藏 排序",
    localizedTitle: true,
  },
  {
    id: "providers:provider-updates",
    section: "providers",
    title: "Provider updates",
    keywords:
      "Update installed provider tools that Synara can safely update. upgrade cli 提供商更新",
    localizedTitle: true,
  },
  {
    id: "providers:installed-clis",
    section: "providers",
    title: "Installed CLIs",
    keywords:
      "Review provider versions and update tools. binary overrides path install 已安装的 CLI 可执行文件路径",
    localizedTitle: true,
  },

  // ── Skills ────────────────────────────────────────────────────────────────────
  {
    id: "skills:skills",
    section: "skills",
    title: "Skills",
    keywords: "Every skill found across providers, with toggles to control availability. agent",
    target: null,
  },

  // ── Usage ─────────────────────────────────────────────────────────────────────
  {
    id: "usage:usage",
    section: "usage",
    title: "Usage and billing",
    keywords: "Remaining quota and credits for each signed-in provider. limits credits",
    target: null,
  },

  // ── Advanced ──────────────────────────────────────────────────────────────────
  {
    id: "advanced:keybindings",
    section: "advanced",
    title: "Keybindings",
    keywords:
      "Open the persisted keybindings.json file to edit advanced bindings directly. shortcuts 按键绑定 快捷键",
    localizedTitle: true,
  },
  {
    id: "advanced:recovery-tools",
    section: "advanced",
    title: "Recovery tools",
    keywords:
      "Rebuild local project indexes without clearing existing chats when the local state gets out of sync. 恢复工具 修复状态 重建索引",
    localizedTitle: true,
  },
  {
    id: "mcpServers:codex",
    section: "mcpServers",
    title: "Codex MCP servers",
    keywords:
      "Enable disable the MCP servers Codex uses. config.toml CODEX_HOME mcp_servers stdio http toggle",
    target: null,
  },
  {
    id: "mcpServers:claude",
    section: "mcpServers",
    title: "Claude MCP servers",
    keywords:
      "Enable disable the MCP servers Claude uses. claude.json mcpServers disabled stdio http toggle",
    target: null,
  },
  {
    id: "integrations:external-mcp",
    section: "integrations",
    title: "External MCP integrations",
    keywords:
      "Pair Codex Claude and other local MCP clients with scoped project access. revoke credential task create wait read worktree approval",
  },
  {
    id: "advanced:version",
    section: "advanced",
    title: "Version",
    keywords: "Current application version. about 版本 关于",
    localizedTitle: true,
  },
  {
    id: "advanced:release-history",
    section: "advanced",
    title: "Release history",
    keywords:
      "A running log of every update, newest first. changelog what's new about release notes 更新历史 发行说明",
    localizedTitle: true,
  },
] as const;

/**
 * Fuzzy-rank settings rows for the sidebar search. Title carries the strongest intent;
 * the description/synonym keywords and the owning section label match more loosely so a
 * query like "appearance" or "wrap" still surfaces the right rows.
 */
export function rankSettingsSearchEntries(
  query: string,
  limit: number,
  /** Resolves a section's display label. Injected because labels live in the active i18n catalog. */
  sectionLabel: (section: SettingsSectionId) => string,
): readonly SettingsSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const ranked = rankProviderDiscoveryItems(SETTINGS_SEARCH_ENTRIES, trimmed, (entry) => [
    { value: entry.title },
    { value: entry.keywords, weight: 200 },
    { value: sectionLabel(entry.section), weight: 400 },
  ]);
  return ranked.slice(0, limit);
}
