// FILE: settingsSearchIndex.ts
// Purpose: Declarative, searchable index of settings rows/sections so the sidebar can
//          surface matches by title/description the same way the editor file search does.
// Layer: Route/UI support
// Exports: entry type, the index, and the ranking helper

import type { Messages } from "./i18n/locales/en";
import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import { settingRowAnchorId, type SettingsSectionId } from "./settingsNavigation";

/** One searchable settings result. `target: null` marks panel-only or conditional rows. */
export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  /**
   * Resolved against the active catalog rather than stored, so results read in the user's
   * language. Anchors never come from here — a translated title slugs to nothing, since
   * `settingRowAnchorId` keeps only `[a-z0-9]`.
   */
  title: (m: Messages) => string;
  /** Match text: the English description plus synonyms in every supported language. */
  keywords: string;
  target?: string | null;
}

/**
 * DOM id a result deep-links to, or null for panel-level entries with no anchored row. Derived
 * from the locale-independent `id`; the row opts in by passing that same id as `anchorKey`.
 */
export function settingsSearchEntryTarget(entry: SettingsSearchEntry): string | null {
  if (entry.target !== undefined) return entry.target;
  return settingRowAnchorId(entry.id);
}

// Mirrors row titles/descriptions rendered in settings panels. Panels stay mounted but render
// null while inactive, so the sidebar cannot read every row at runtime; keep this list in sync
// when rows are added, renamed, hidden conditionally, or represented as panel-level results.
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  // ── General ────────────────────────────────────────────────────────────────
  {
    id: "general:language",
    section: "general",
    title: (m) => m.settings.general.coreDefaults.language.title,
    keywords:
      "Choose the display language for the Synara interface. locale i18n english chinese 语言 中文 简体中文",
  },
  {
    id: "general:default-provider",
    section: "general",
    title: (m) => m.settings.general.coreDefaults.defaultProvider.title,
    keywords: "Choose the provider used for new chats. agent codex claude 默认提供商 新对话",
  },
  {
    id: "general:new-threads",
    section: "general",
    title: (m) => m.settings.general.coreDefaults.newThreads.title,
    keywords:
      "Pick the default workspace mode for newly created draft threads. local worktree environment 新建会话 本地 工作树",
  },
  {
    id: "general:project-order",
    section: "general",
    title: (m) => m.settings.general.sidebarOrganization.projectOrder.title,
    keywords:
      "Controls how projects are arranged in the main sidebar. sort updated created manual 项目排序 侧边栏",
  },
  {
    id: "general:thread-order",
    section: "general",
    title: (m) => m.settings.general.sidebarOrganization.threadOrder.title,
    keywords:
      "Controls how threads are arranged inside each project in the main sidebar. sort updated created 会话排序 侧边栏",
  },
  {
    id: "general:chats-section",
    section: "general",
    title: (m) => m.settings.general.sidebarSections.chats.title,
    keywords:
      "Show the standalone Chats list in the sidebar footer chats not tied to a project. sidebar section 对话 侧边栏板块",
  },
  {
    id: "general:studio-section",
    section: "general",
    title: (m) => m.settings.general.sidebarSections.studio.title,
    keywords:
      "Show the Studio tab in the sidebar switcher. sidebar section content outbox 侧边栏板块",
  },
  {
    id: "general:environment-default-open",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.defaultOpen.title,
    keywords:
      "Open the chat Environment panel automatically on normal threads. default closed open environment panel preference 环境面板 默认展开",
  },
  {
    id: "general:environment-usage",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.usage.title,
    keywords: "Show the provider usage row in the chat Environment panel. 用量 环境面板",
  },
  {
    id: "general:environment-repository",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.repository.title,
    keywords:
      "Show the GitHub repository link in the chat Environment panel. git changes worktree 仓库 环境面板",
  },
  {
    id: "general:environment-pull-request",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.pullRequest.title,
    keywords:
      "Show the open pull request CI checks and review comments in the chat Environment panel. pr fix github 拉取请求 环境面板",
  },
  {
    id: "general:environment-editor",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.editor.title,
    keywords:
      "Show the Editor section in-app editor view and Open in editor picker in the chat Environment panel. 编辑器 环境面板",
  },
  {
    id: "general:environment-recap",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.recap.title,
    keywords: "Show the auto-generated chat recap in the Environment panel. 摘要 环境面板",
  },
  {
    id: "general:environment-pinned",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.pinned.title,
    keywords: "Show the pinned-messages checklist in the Environment panel. 置顶消息 环境面板",
  },
  {
    id: "general:environment-markers",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.markers.title,
    keywords:
      "Show highlighted and underlined transcript text in the Environment panel. 文本标记 高亮 环境面板",
  },
  {
    id: "general:environment-instructions",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.instructions.title,
    keywords: "Show project-level instructions in the Environment panel. 项目指令 环境面板",
  },
  {
    id: "general:environment-notepad",
    section: "general",
    title: (m) => m.settings.general.environmentPanel.notepad.title,
    keywords: "Show the per-thread notepad in the Environment panel. 记事本 环境面板",
  },

  // ── Appearance ───────────────────────────────────────────────────────────────
  {
    id: "appearance:theme",
    section: "appearance",
    title: (m) => m.settings.appearance.theme.title,
    keywords: "Choose how Synara looks across the app. dark light system color 主题 深色 浅色 外观",
  },
  {
    id: "appearance:system-ui-font",
    section: "appearance",
    title: (m) => m.settings.appearance.systemUiFont.title,
    keywords: "Use the operating system interface font throughout Synara. 系统界面字体 字体",
  },
  {
    id: "appearance:ui-density",
    section: "appearance",
    title: (m) => m.settings.appearance.uiDensity.title,
    keywords:
      "Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size. compact comfortable 界面密度 紧凑 宽松 间距",
  },
  {
    id: "appearance:base-font-size",
    section: "appearance",
    title: (m) => m.settings.appearance.baseFontSize.title,
    keywords:
      "Adjust the app text base in pixels. Chat and UI typography scale proportionally. font 基础字号 字体大小",
  },
  {
    id: "appearance:terminal-font-size",
    section: "appearance",
    title: (m) => m.settings.appearance.terminalFontSize.title,
    keywords: "Adjust terminal text independently from the app and chat font size. 终端字号",
  },
  {
    id: "appearance:terminal-font",
    section: "appearance",
    title: (m) => m.settings.appearance.terminalFont.title,
    keywords:
      "Type any monospace font installed on this device e.g. Fira Code. system monospace family 终端字体 等宽字体",
  },
  {
    id: "appearance:font-smoothing",
    section: "appearance",
    title: (m) => m.settings.searchTitles.fontSmoothing,
    keywords: "Use macOS-style antialiasing for lighter, crisper text rendering.",
    target: null,
  },
  {
    id: "appearance:time-format",
    section: "appearance",
    title: (m) => m.settings.appearance.timeFormat.title,
    keywords:
      "System default follows your browser or OS clock preference. timestamp 12-hour 24-hour locale 时间格式 12 小时制 24 小时制",
  },

  // ── Notifications ─────────────────────────────────────────────────────────────
  {
    id: "notifications:activity-toasts",
    section: "notifications",
    title: (m) => m.settings.notifications.toasts.title,
    keywords:
      "Show an in-app toast when a chat or managed terminal agent finishes or needs input. alerts 应用内提示 活动提醒",
  },
  {
    id: "notifications:desktop-notifications",
    section: "notifications",
    title: (m) => m.settings.notifications.desktop.title,
    keywords:
      "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background. alerts toast 桌面通知 系统通知",
  },

  // ── AppSnap ───────────────────────────────────────────────────────────────────
  {
    id: "appsnap:enable",
    section: "appsnap",
    title: (m) => m.settings.appSnap.capture.enable.title,
    keywords:
      "Capture the frontmost macOS app window with a configurable two-key shortcut and add it to a recent task. appshot screenshot snap window capture hotkey 截图 窗口捕获",
  },
  {
    id: "appsnap:shortcut",
    section: "appsnap",
    title: (m) => m.settings.appSnap.capture.shortcut.title,
    keywords:
      "Press the left and right Option keys at the same time. hotkey chord alt keys 快捷键 组合键",
  },
  {
    id: "appsnap:destination",
    section: "appsnap",
    title: (m) => m.settings.appSnap.capture.destination.title,
    keywords:
      "Snaps join the task you interacted with in the last minute, otherwise a fresh task opens. automatic target composer 目标位置 自动",
  },
  {
    id: "appsnap:capture-sound",
    section: "appsnap",
    title: (m) => m.settings.appSnap.capture.sound.title,
    keywords:
      "Play a short shutter cue when a window is captured. sound effect audio mute 截图提示音 快门音",
  },
  {
    id: "appsnap:permissions",
    section: "appsnap",
    title: (m) => m.settings.appSnap.permissions.status.title,
    keywords:
      "Input Monitoring and Screen Recording permissions for AppSnap in macOS System Settings. privacy security recheck grant",
    // Renders only in the macOS desktop app, so no stable anchor on other platforms.
    target: null,
  },

  // ── Behavior ──────────────────────────────────────────────────────────────────
  {
    id: "behavior:follow-up-behavior",
    section: "behavior",
    title: (m) => m.settings.behavior.followUpBehavior.title,
    keywords:
      "Choose whether messages sent during an active turn wait in the queue or steer the current run. Ctrl Cmd Enter opposite send 追问 排队 引导",
  },
  {
    id: "behavior:assistant-output",
    section: "behavior",
    title: (m) => m.settings.behavior.assistantOutput.title,
    keywords: "Show token-by-token output while a response is in progress. streaming 助手输出 流式",
  },
  {
    id: "behavior:diff-line-wrapping",
    section: "behavior",
    title: (m) => m.settings.behavior.diffLineWrapping.title,
    keywords: "Set the default wrap state when the diff panel opens. word wrap 差异自动换行",
  },
  {
    id: "behavior:delete-confirmation",
    section: "behavior",
    title: (m) => m.settings.behavior.deleteConfirmation.title,
    keywords: "Ask before deleting a thread and its chat history. safety confirm 删除确认",
  },
  {
    id: "behavior:archive-confirmation",
    section: "behavior",
    title: (m) => m.settings.behavior.archiveConfirmation.title,
    keywords: "Ask before archiving a thread. safety confirm 归档确认",
  },
  {
    id: "behavior:terminal-close-confirmation",
    section: "behavior",
    title: (m) => m.settings.behavior.terminalCloseConfirmation.title,
    keywords:
      "Ask before closing a terminal tab and clearing its history. safety confirm 终端关闭确认",
  },

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────────
  {
    id: "shortcuts:keyboard-shortcuts",
    section: "shortcuts",
    title: (m) => m.settings.searchTitles.keyboardShortcuts,
    keywords:
      "Every keyboard shortcut available in Synara, grouped by context. keybindings hotkeys key combo cmd ctrl reference",
    target: null,
  },

  // ── Worktrees ─────────────────────────────────────────────────────────────────
  {
    id: "worktrees:managed-worktrees",
    section: "worktrees",
    title: (m) => m.settings.searchTitles.managedWorktrees,
    keywords: "Review and clean up the worktrees created by Synara. git branch remove",
    target: null,
  },

  // ── Archived ──────────────────────────────────────────────────────────────────
  {
    id: "archived:archived-threads",
    section: "archived",
    title: (m) => m.settings.searchTitles.archivedThreads,
    keywords: "View and restore archived threads. unarchive history",
    target: null,
  },

  // ── Models ────────────────────────────────────────────────────────────────────
  {
    id: "models:git-writing-model",
    section: "models",
    title: (m) => m.settings.models.generationDefaults.gitWritingModel.title,
    keywords:
      "Used for generated commit messages, PR titles, and branch names. Git 文案模型 提交信息 分支名",
  },
  {
    id: "models:saved-model-slugs",
    section: "models",
    title: (m) => m.settings.models.custom.saved.title,
    keywords: "Add custom model slugs for supported providers. custom model 自定义模型 模型标识",
  },
  {
    id: "models:cloud-catalog",
    section: "models",
    title: (m) => m.settings.models.catalog.cloud.title,
    keywords:
      "Synara reads the public models.dev catalog so newly released models show up without waiting for an update. refresh 云端模型目录 刷新",
  },
  {
    id: "models:visible-models",
    section: "models",
    title: (m) => m.settings.models.visible.picker.title,
    keywords:
      "Turn off the models you never reach for. hide visibility picker 可见模型 隐藏 选择器",
  },

  // ── Providers ─────────────────────────────────────────────────────────────────
  {
    id: "providers:automatic-cli-update-checks",
    section: "providers",
    title: (m) => m.settings.providers.updates.autoChecks.title,
    keywords:
      "Check Codex Claude and other provider CLIs for newer versions in the background. updates upgrade disable nags 自动检查更新",
  },
  {
    id: "providers:visible-providers",
    section: "providers",
    title: (m) => m.settings.providers.picker.visible.title,
    keywords:
      "Drag providers into your preferred picker order and hide the ones you don't use. visibility order 可见提供商 隐藏 排序",
  },
  {
    id: "providers:provider-updates",
    section: "providers",
    title: (m) => m.settings.providers.updates.providerUpdates.title,
    keywords:
      "Update installed provider tools that Synara can safely update. upgrade cli 提供商更新",
  },
  {
    id: "providers:installed-clis",
    section: "providers",
    title: (m) => m.settings.providers.tools.installed.title,
    keywords:
      "Review provider versions and update tools. binary overrides path install 已安装的 CLI 可执行文件路径",
  },

  // ── Skills ────────────────────────────────────────────────────────────────────
  {
    id: "skills:skills",
    section: "skills",
    title: (m) => m.settings.skills.sectionTitle,
    keywords: "Every skill found across providers, with toggles to control availability. agent",
    target: null,
  },

  // ── Usage ─────────────────────────────────────────────────────────────────────
  {
    id: "usage:usage",
    section: "usage",
    title: (m) => m.settings.searchTitles.usageAndBilling,
    keywords: "Remaining quota and credits for each signed-in provider. limits credits",
    target: null,
  },

  // ── Advanced ──────────────────────────────────────────────────────────────────
  {
    id: "advanced:keybindings",
    section: "advanced",
    title: (m) => m.settings.advanced.developerTools.keybindings.title,
    keywords:
      "Open the persisted keybindings.json file to edit advanced bindings directly. shortcuts 按键绑定 快捷键",
  },
  {
    id: "advanced:recovery-tools",
    section: "advanced",
    title: (m) => m.settings.advanced.developerTools.recovery.title,
    keywords:
      "Rebuild local project indexes without clearing existing chats when the local state gets out of sync. 恢复工具 修复状态 重建索引",
  },
  {
    id: "mcpServers:codex",
    section: "mcpServers",
    title: (m) => m.settings.searchTitles.codexMcpServers,
    keywords:
      "Enable disable the MCP servers Codex uses. config.toml CODEX_HOME mcp_servers stdio http toggle",
    target: null,
  },
  {
    id: "mcpServers:claude",
    section: "mcpServers",
    title: (m) => m.settings.searchTitles.claudeMcpServers,
    keywords:
      "Enable disable the MCP servers Claude uses. claude.json mcpServers disabled stdio http toggle",
    target: null,
  },
  {
    id: "integrations:external-mcp",
    section: "integrations",
    title: (m) => m.settings.searchTitles.externalMcpIntegrations,
    keywords:
      "Pair Codex Claude and other local MCP clients with scoped project access. revoke credential task create wait read worktree approval 外部 MCP 集成 配对 撤销",
    // The panel swaps between a create form and a setup flow, so no row is always mounted.
    target: null,
  },
  {
    id: "integrations:cdp-proxy-enable",
    section: "integrations",
    title: (m) => m.settings.browserCdpProxy.enable.title,
    keywords:
      "Let chrome-devtools-mcp drive the in-app browser over a local CDP endpoint. puppeteer devtools protocol websocket automation 内置浏览器 调试协议 自动化",
    // The section only renders in the desktop app, so it has no stable anchor elsewhere.
    target: null,
  },
  {
    id: "integrations:cdp-proxy-port",
    section: "integrations",
    title: (m) => m.settings.browserCdpProxy.port.title,
    keywords: "Local port for the in-app browser CDP endpoint. 9333 listen address 端口 监听",
    target: null,
  },
  {
    id: "integrations:cdp-proxy-configuration",
    section: "integrations",
    title: (m) => m.settings.browserCdpProxy.configuration.title,
    keywords:
      "Copy the chrome-devtools-mcp server entry with the current endpoint and token. ws-endpoint ws-headers bearer 配置 复制 令牌",
    target: null,
  },
  {
    id: "advanced:version",
    section: "advanced",
    title: (m) => m.settings.advanced.about.version.title,
    keywords: "Current application version. about 版本 关于",
  },
  {
    id: "advanced:release-history",
    section: "advanced",
    title: (m) => m.settings.advanced.about.releaseHistory.title,
    keywords:
      "A running log of every update, newest first. changelog what's new about release notes 更新历史 发行说明",
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
  /** Active catalog: both row titles and section labels are ranked in the user's language. */
  m: Messages,
): readonly SettingsSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const ranked = rankProviderDiscoveryItems(SETTINGS_SEARCH_ENTRIES, trimmed, (entry) => [
    { value: entry.title(m) },
    { value: entry.keywords, weight: 200 },
    { value: m.settingsNav.sections[entry.section].label, weight: 400 },
  ]);
  return ranked.slice(0, limit);
}
