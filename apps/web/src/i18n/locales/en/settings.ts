// FILE: locales/en/settings.ts
// Purpose: English copy for the settings screen. Also defines the key structure every other locale must match.
//
// Deliberately NOT `as const`: literal types would force translations to equal the English
// string. Plain inference gives each entry type `string`, so other locales are constrained by
// structure while free in value.
//
// On/off rows carry the exact four keys `renderBooleanSettingRow` needs, so a call site is just
// `renderBooleanSettingRow({ settingKey: "…", ...m.settings.general.sidebarSections.chats })`.
//
// This file is long because it is pure data — one group per settings tab, navigated by key rather
// than read top to bottom. Splitting it would only move the keys somewhere else.

import { pluralize } from "@synara/shared/text";

export const settings = {
  // Titles for search results whose row has no catalog entry of its own — panel-level results
  // and rows that live outside the settings panels.
  searchTitles: {
    fontSmoothing: "Font smoothing",
    keyboardShortcuts: "Keyboard Shortcuts",
    managedWorktrees: "Managed worktrees",
    archivedThreads: "Archived threads",
    usageAndBilling: "Usage and billing",
    codexMcpServers: "Codex MCP servers",
    claudeMcpServers: "Claude MCP servers",
    externalMcpIntegrations: "External MCP integrations",
  },
  controls: {
    resetTooltip: "Reset to default",
    /** A function, not a template with a placeholder: word order around `label` differs per language. */
    resetAriaLabel: (label: string) => `Reset ${label} to default`,
  },
  general: {
    codeAndStatus: "Code and status",
    contextAndNotes: "Context and notes",
    coreDefaults: {
      title: "Core defaults",
      language: {
        title: "Language",
        description: "Choose the display language for the Synara interface.",
        ariaLabel: "Language",
        resetLabel: "language",
      },
      defaultProvider: {
        title: "Default provider",
        description: "Choose the provider used for new chats.",
        ariaLabel: "Default provider",
        resetLabel: "default provider",
      },
      newThreads: {
        title: "New threads",
        description: "Pick the default workspace mode for newly created draft threads.",
        ariaLabel: "Default thread mode",
        resetLabel: "new threads",
        local: "Local",
        worktree: "New worktree",
      },
    },
    sidebarOrganization: {
      title: "Sidebar organization",
      projectOrder: {
        title: "Project order",
        description: "Controls how projects are arranged in the main sidebar.",
        ariaLabel: "Project sort order",
        resetLabel: "project order",
        options: {
          updated_at: "Recently active",
          created_at: "Recently added",
          manual: "Manual order",
        },
      },
      threadOrder: {
        title: "Thread order",
        description: "Controls how threads are arranged inside each project in the main sidebar.",
        ariaLabel: "Thread sort order",
        resetLabel: "thread order",
        options: {
          updated_at: "Recently active",
          created_at: "Newest first",
        },
      },
    },
    sidebarSections: {
      title: "Sidebar sections",
      chats: {
        title: "Chats",
        description:
          "Show the standalone Chats list in the sidebar footer (chats not tied to a project).",
        resetLabel: "chats section",
        ariaLabel: "Show the Chats section in the sidebar",
      },
      studio: {
        title: "Studio",
        description: "Show the Studio tab in the sidebar switcher.",
        resetLabel: "studio section",
        ariaLabel: "Show the Studio section in the sidebar",
      },
    },
    environmentPanel: {
      title: "Environment panel",
      defaultOpen: {
        title: "Open by default",
        description:
          "Open the chat Environment panel automatically on normal threads. When off, the panel stays closed until you open it. Your last open/close also updates this preference.",
        resetLabel: "environment panel default open",
        ariaLabel: "Open the Environment panel by default on normal threads",
      },
      usage: {
        title: "Usage",
        description: "Show the provider usage row in the chat Environment panel.",
        resetLabel: "usage section",
        ariaLabel: "Show the Usage section in the Environment panel",
      },
      repository: {
        title: "Repository",
        description:
          "Show the GitHub repository link in the chat Environment panel. The git block (Changes, Worktree, branch, Commit and Push) always stays visible.",
        resetLabel: "repository section",
        ariaLabel: "Show the Repository section in the Environment panel",
      },
      pullRequest: {
        title: "Pull request",
        description:
          "Show the open pull request (CI checks and review comments) for the current branch in the chat Environment panel.",
        resetLabel: "pull request section",
        ariaLabel: "Show the Pull request section in the Environment panel",
      },
      editor: {
        title: "Editor",
        description:
          "Show the Editor section (in-app editor view and Open in editor picker) in the chat Environment panel.",
        resetLabel: "editor section",
        ariaLabel: "Show the Editor section in the Environment panel",
      },
      recap: {
        title: "Recap",
        description: "Show the auto-generated chat recap in the Environment panel.",
        resetLabel: "recap section",
        ariaLabel: "Show the Recap section in the Environment panel",
      },
      pinned: {
        title: "Pinned messages",
        description: "Show the pinned-messages checklist in the Environment panel.",
        resetLabel: "pinned messages section",
        ariaLabel: "Show the Pinned messages section in the Environment panel",
      },
      markers: {
        title: "Text markers",
        description: "Show highlighted and underlined transcript text in the Environment panel.",
        resetLabel: "text markers section",
        ariaLabel: "Show the Text markers section in the Environment panel",
      },
      instructions: {
        title: "Project instructions",
        description: "Show project-level instructions in the Environment panel.",
        resetLabel: "project instructions section",
        ariaLabel: "Show the Project instructions section in the Environment panel",
      },
      notepad: {
        title: "Notepad",
        description: "Show the per-thread notepad in the Environment panel.",
        resetLabel: "notepad section",
        ariaLabel: "Show the Notepad section in the Environment panel",
      },
    },
  },
  appearance: {
    themeAndTypography: "Theme and typography",
    theme: {
      title: "Theme",
      description: "Choose how Synara looks across the app.",
      ariaLabel: "Theme preference",
      resetLabel: "theme",
      options: { light: "Light", dark: "Dark", system: "System" },
    },
    systemUiFont: {
      title: "Use system UI font",
      description:
        "Ignore the theme's custom UI font and render the interface with the native system font (SF Pro on macOS).",
      ariaLabel: "Use system UI font",
      resetLabel: "system UI font",
    },
    uiDensity: {
      title: "UI density",
      description:
        "Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size.",
      ariaLabel: "UI density",
      resetLabel: "UI density",
      options: { compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" },
    },
    baseFontSize: {
      title: "Base font size",
      description:
        "Adjust the app text base in pixels. Chat and UI typography scale proportionally from this value.",
      ariaLabel: "Base font size in pixels",
      resetLabel: "base font size",
    },
    terminalFontSize: {
      title: "Terminal font size",
      description: "Adjust terminal text independently from the app and chat font size.",
      ariaLabel: "Terminal font size in pixels",
      resetLabel: "terminal font size",
    },
    terminalFont: {
      title: "Terminal font",
      description:
        "Type any monospace font installed on this device (e.g. Fira Code). Leave empty for the default. Fonts that aren't installed fall back to the system monospace.",
      ariaLabel: "Terminal font family",
      resetLabel: "terminal font",
      placeholder: "Default (JetBrains Mono)",
      noSuggestions: "No matching suggested fonts.",
    },
    typographyAndSpacing: "Typography and spacing",
    fontSmoothing: {
      title: "Font smoothing",
      description: "Use macOS-style antialiasing for lighter, crisper text rendering.",
      resetLabel: "font smoothing",
      ariaLabel: "Enable font smoothing",
    },
    timeAndReading: "Time and reading",
    timeFormat: {
      title: "Time format",
      description: "System default follows your browser or OS clock preference.",
      resetLabel: "time format",
      options: { locale: "System default", "12-hour": "12-hour", "24-hour": "24-hour" },
    },
    restoreDefaults: "Restore defaults",
  },
  behavior: {
    runtimeBehavior: "Runtime behavior",
    conversation: "Conversation",
    review: "Review",
    followUpBehavior: {
      title: "Follow-up behavior",
      description:
        "Choose whether messages sent during an active turn wait in the queue or steer the current run. Ctrl/Cmd+Enter uses the opposite behavior for one message.",
      resetLabel: "follow-up behavior",
      queue: "Queue",
      steer: "Steer",
    },
    assistantOutput: {
      title: "Assistant output",
      description: "Show token-by-token output while a response is in progress.",
      resetLabel: "assistant output",
      ariaLabel: "Stream assistant messages",
    },
    diffLineWrapping: {
      title: "Diff line wrapping",
      description:
        "Set the default wrap state when the diff panel opens. The in-panel wrap toggle only affects the current diff session.",
      resetLabel: "diff line wrapping",
      ariaLabel: "Wrap diff lines by default",
    },
    safetyConfirmations: "Safety confirmations",
    deleteConfirmation: {
      title: "Delete confirmation",
      description: "Ask before deleting a thread and its chat history.",
      resetLabel: "delete confirmation",
      ariaLabel: "Confirm thread deletion",
    },
    archiveConfirmation: {
      title: "Archive confirmation",
      description: "Ask before archiving a thread.",
      resetLabel: "archive confirmation",
      ariaLabel: "Confirm thread archive",
    },
    terminalCloseConfirmation: {
      title: "Terminal close confirmation",
      description: "Ask before closing a terminal tab and clearing its history.",
      resetLabel: "terminal close confirmation",
      ariaLabel: "Confirm terminal tab close",
    },
  },
  advanced: {
    network: {
      title: "Network",
      proxy: {
        title: "HTTP proxy",
        description:
          "Route Synara's own requests (provider usage and limits, model catalog, voice transcription) through a proxy. Provider CLIs are launched as separate processes and are not covered by this setting.",
        ariaLabel: "Proxy mode",
        modes: {
          off: "Off",
          env: "Environment",
          manual: "Manual",
        },
        modeHints: {
          off: "Always connect directly, even if HTTPS_PROXY is set.",
          env: "Follow HTTPS_PROXY, HTTP_PROXY, ALL_PROXY and NO_PROXY.",
          manual: "Use the address below and ignore environment variables.",
        },
        url: {
          title: "Proxy address",
          description:
            "An http:// address, for example http://127.0.0.1:7890. SOCKS is not supported.",
          ariaLabel: "Proxy address",
          placeholder: "http://127.0.0.1:7890",
          invalid: "Enter an http:// address such as http://127.0.0.1:7890.",
        },
        noProxy: {
          title: "Bypass list",
          description:
            "Comma-separated hosts that skip the proxy. A leading dot covers subdomains; * bypasses everything.",
          ariaLabel: "Proxy bypass list",
          placeholder: "localhost, .internal",
        },
        failClosedNote:
          "If the proxy is unreachable, requests fail rather than falling back to a direct connection.",
      },
    },
    session: {
      title: "Session",
      thisBrowser: {
        title: "This browser",
        description:
          "Revoke this browser session and close every live Synara connection it owns. A fresh pairing link is required to reconnect.",
      },
      authenticatedAs: (role: string) => `Authenticated as ${role}.`,
      signOut: "Sign out",
      signingOut: "Signing out...",
      signOutConfirm:
        "Sign out this browser?\n\nIts session and every live connection opened with it will be revoked.",
      signOutFailedTitle: "Sign out failed",
      signOutFailedDescription: "Unable to revoke this session.",
    },
    developerTools: {
      title: "Developer tools",
      keybindings: {
        title: "Keybindings",
        description:
          "Open the persisted `keybindings.json` file to edit advanced bindings directly.",
      },
      resolvingPath: "Resolving keybindings path...",
      opensInEditor: "Opens in your preferred editor.",
      openFile: "Open file",
      opening: "Opening...",
      noEditors: "No available editors found.",
      openFailed: "Unable to open keybindings file.",
      recovery: {
        title: "Recovery tools",
        description:
          "Rebuild local project indexes without clearing existing chats when the local state gets out of sync.",
      },
      recoveryVisible: "Visible because projects exist but no chat history is currently available.",
      recoveryHidden: "Shown automatically only when recovery actions are relevant.",
      repairState: "Repair state",
      repairing: "Repairing...",
      whatThisDoes: "What this does",
      whatThisDoesBody:
        "Rebuilds local project indexes and refreshes project snapshots. Existing chats stay in place.",
      repairConfirm: [
        "Repair local state?",
        "This rebuilds local project indexes and refreshes project snapshots.",
        "It keeps existing chats in place, but it may take a moment.",
      ].join("\n"),
      repairedTitle: "Local state repaired",
      repairedDescription: "Project indexes were rebuilt without clearing existing chats.",
      repairFailedTitle: "Repair failed",
      repairFailedDescription: "Unable to repair local state.",
    },
    about: {
      title: "About",
      version: { title: "Version", description: "Current application version." },
      releaseHistory: {
        title: "Release history",
        description:
          "A running log of every update, newest first. Same notes the post-update dialog shows, kept here so you can revisit them any time.",
      },
      viewReleaseHistory: "View release history",
    },
  },
  skills: {
    portable: "Portable skills",
    folder: {
      title: "Synara skills folder",
      description:
        "Skills placed here are available on every provider. When a provider already ships its own copy of a skill, that copy is used; otherwise Synara's copy is the fallback.",
    },
    scanning: "Scanning…",
    enabledCount: (enabled: number, total: number) =>
      `${enabled} of ${total} ${pluralize(total, "skill")} enabled`,
    sectionTitle: "Skills",
    discoveryFailed: {
      title: "Skill discovery failed",
      description:
        "Synara could not scan the skill folders. Retry after checking that the server is running.",
    },
    noneFound: {
      title: "No skills found",
      description:
        "Add a skill folder containing a SKILL.md to the Synara skills folder above, or install skills for any supported provider.",
    },
    providerCopies: (count: number, names: string) =>
      `Provider ${pluralize(count, "copy", "copies")}: ${names}`,
    enableSkill: (name: string) => `Enable the ${name} skill`,
    toggleAll: "Enable every skill",
    toggleSection: (title: string) => `Enable every skill under ${title}`,
    // Consumed as `SettingsSkillLabels` by skillsSettingsModel, which groups and titles the list.
    sharedSkills: "Shared skills",
    fromOrigin: (label: string) => `From ${label}`,
    noDescription: "No description.",
    origins: { shared: "Shared (.agents)", project: "Project", personal: "Personal" },
  },
  agentMcp: {
    sectionTitle: "MCP servers",
    overview: {
      title: "Agent MCP servers",
      description:
        "Servers your local Codex and Claude agents can call. Turning one off edits that agent's own config file; Synara never starts these servers itself.",
    },
    refresh: "Refresh",
    refreshing: "Refreshing...",
    loading: "Loading MCP servers...",
    readFailedTitle: "Could not read the agent configs",
    readFailedDescription: "Reading the local agent configuration failed.",
    sourceTitle: (provider: string) => `${provider} MCP servers`,
    parseError: (message: string) =>
      `This file could not be parsed, so its servers cannot be changed: ${message}`,
    notConfigured: "Not configured",
    noServers: "No servers",
    empty: {
      codex: "No MCP servers are declared in this Codex config.",
      claudeAgent: "No MCP servers are declared in this Claude config.",
    },
    unavailable: {
      codex: "No Codex configuration was found on this machine.",
      claudeAgent: "No Claude configuration was found on this machine.",
    },
    noCommand: "(no command)",
    updateFailedTitle: "Could not update the MCP server",
    updateFailedDescription: "The config file was not changed.",
  },
  worktrees: {
    loading: "Loading managed worktrees...",
    loadFailed: "Unable to load worktrees.",
    empty: "No app-managed worktrees found yet.",
    worktree: "Worktree",
    conversations: "Conversations",
    noLinkedConversations: "No conversations linked to this worktree.",
    delete: "Delete",
    linkedWarning: "Linked conversations exist. Deleting will ask for confirmation.",
    verifyFailedTitle: "Could not verify linked conversations",
    verifyFailedDescription: "Retry once the app reconnects to the server.",
    deleteConfirm: (name: string, activeCount: number, archivedCount: number) =>
      [
        `Delete worktree "${name}"?`,
        "",
        `${activeCount} active and ${archivedCount} archived ${pluralize(activeCount + archivedCount, "conversation is", "conversations are")} linked to this worktree.`,
        archivedCount > 0
          ? "Archived conversations will be deleted first."
          : "Deleting it can break reopening those chats in the same workspace.",
        "",
        "Delete the worktree anyway?",
      ].join("\n"),
    deleteConfirmUnlinked: (name: string) =>
      [`Delete worktree "${name}"?`, "This removes the Git worktree from disk."].join("\n"),
    deletedTitle: "Worktree deleted",
    deletedDescription: (name: string) => `${name} was removed.`,
    deletedWithArchived: (name: string, archivedCount: number) =>
      `${name} was removed and ${archivedCount} archived ${pluralize(archivedCount, "conversation")} were deleted.`,
    deleteFailedTitle: "Could not delete worktree",
    deleteFailedDescription: "Unable to delete the worktree.",
  },
  archived: {
    emptyTitle: "No archived threads",
    emptyDescription: "Archived threads will appear here and can be restored to the sidebar.",
    unknownProject: "Unknown project",
    archivedAt: (relative: string) => `Archived ${relative}`,
    restore: "Restore",
    delete: "Delete",
    restoredTitle: "Thread restored",
    restoredDescription: "The thread has been moved back to the sidebar.",
    restoreFailedTitle: "Could not restore thread",
    restoreFailedDescription: "Unable to restore the thread.",
    deleteConfirm: (title: string) =>
      `Permanently delete "${title}"?\n\nThis will remove the thread and its conversation history forever.`,
    deletedTitle: "Thread deleted",
    deletedDescription: "The archived thread has been permanently removed.",
    deleteFailedTitle: "Could not delete thread",
    deleteFailedDescription: "Unable to delete the thread.",
  },
  integrations: {
    connect: {
      title: "Connect a coding agent",
      name: {
        title: "Name",
        description:
          "How this connection appears in Synara. Works with Codex, Claude, and any other MCP-capable agent.",
        defaultValue: "Coding agent",
      },
      allProjects: {
        title: "Access all of Synara",
        description:
          "The agent can discover and work in every project, including ones you add later. Turn off to pick specific projects.",
      },
      noProjects: "No projects are available.",
      advanced: {
        title: "Advanced permissions",
        description:
          "Optional access for existing tasks, shared checkouts, or execution without approvals. The safe defaults are recommended.",
        review: "Review",
        readOtherTasks: {
          title: "Read other project tasks",
          description: "Without this permission, the agent can read only tasks it creates.",
        },
        sharedCheckout: {
          title: "Use the shared local checkout",
          description:
            "High impact. Tasks may modify the checkout you are actively using instead of an isolated worktree.",
        },
        noApprovals: {
          title: "Run without approval prompts",
          description:
            "High impact. The external agent may start full-access execution without asking you to approve tool actions.",
        },
      },
      create: {
        title: "Create connection",
        description:
          "The connection lasts 30 days and can be revoked at any time. The next screen gives you one prompt to paste into your agent.",
        action: "Create connection",
        pending: "Creating...",
      },
    },
    setup: {
      title: (name: string) => `Connect ${name}`,
      status: {
        revoked: "Revoked",
        expired: "Expired",
        connected: "Connected",
        pairedWaiting: "Paired — waiting for first use",
        pairingExpired: "Pairing code expired",
        waiting: "Waiting for pairing",
        pairedNotUsed: "Paired — not used yet",
      },
      description: {
        revoked: "This connection has been revoked and can no longer access Synara.",
        expired: "This connection has expired and can no longer access Synara.",
        connected: "Synara received a request from this agent. Setup is complete.",
        paired:
          "The private credential is stored locally. If the agent has not registered Synara yet, give it the setup prompt below.",
        pairingExpired:
          "The one-time pairing code was not used in time. Resume pairing to issue a fresh code without replacing this connection.",
        waiting:
          "Paste the setup prompt into your agent. This page updates automatically when pairing succeeds.",
      },
      lastConnected: (when: string) => `Last connected ${when}.`,
      connectionExpires: (when: string) => `Connection expires ${when}.`,
      revokeAndRestart: "Revoke and start over",
      resumePairing: "Resume pairing",
      resuming: "Resuming...",
      back: "Back",
      done: "Done",
      pairingAlreadyCompleted: "Pairing already completed",
      prompt: {
        title: "1. Give your agent this prompt",
        description:
          "Copy the prompt and paste it into the agent you want to connect (Codex, Claude Code, or any MCP-capable app). The agent pairs this computer, registers Synara in its own configuration, and verifies the connection by itself.",
        pairedStatus: "Paired. The prompt now covers only registration and verification.",
        pairingExpires: (when: string) => `Pairing code expires ${when}.`,
        copy: "Copy setup prompt",
        copied: "Setup prompt copied",
      },
      manual: {
        title: "Set up by hand instead",
        description:
          "For apps without a terminal or chat, like Claude Desktop: run the pairing command in Terminal, then add the JSON below to the app's MCP configuration.",
        show: "Show",
        pairingCommand: "Pairing command (run in Terminal)",
        pairingCommandCopied: "Pairing command copied",
        configuration: "MCP configuration (JSON)",
        configurationCopied: "Configuration copied",
        copy: "Copy",
      },
      tryIt: {
        title: "2. Try it",
        description:
          "Open a new chat in the agent you just connected and send this editable example. You never need to copy project IDs, model IDs, or request IDs yourself.",
        verified: "Connection verified by Synara.",
        pending: "Synara will show Connected after the agent makes its first request.",
        copy: "Copy example prompt",
        copied: "Example prompt copied",
      },
    },
    connected: {
      title: "Connected agents",
      loading: "Loading connections...",
      projects: (value: string) => `Projects: ${value}`,
      permissions: (value: string) => `Permissions: ${value}`,
      timeline: (created: string, lastUsed: string, expires: string) =>
        `Created ${created} · Last used ${lastUsed} · Expires ${expires}`,
      continueSetup: "Continue setup",
      revoke: "Revoke",
      emptyTitle: "No connected agents",
      emptyDescription:
        "Connect Codex, Claude, or another local MCP agent to create and follow Synara tasks.",
    },
    // Consumed by `describeExternalMcpProjects` / `describeExternalMcpPermissions`.
    describe: {
      allProjects: "All projects, including future ones",
      noProjects: "No projects",
      ownTasks: "Create and follow its own tasks",
      readProjectTasks: "Read other tasks in selected projects",
      localCheckout: "Use the shared local checkout",
      fullAccess: "Run without approval prompts",
    },
    never: "Never",
    toasts: {
      readyTitle: "Connection ready",
      readyDescription: "Give your agent the setup prompt before the one-time code expires.",
      createFailedTitle: "Could not create connection",
      createFailedDescription: "External MCP setup failed.",
      revokedTitle: "Connection revoked",
      revokedDescription: "Its credential stops working immediately.",
      revokeFailedTitle: "Could not revoke connection",
      revokeFailedDescription: "Revocation failed.",
      pairingReadyTitle: "New pairing code ready",
      pairingReadyDescription:
        "Copy the refreshed setup prompt. The new one-time code lasts 10 minutes.",
      pairingFailedTitle: "Could not resume pairing",
      pairingFailedDescription: "Pairing refresh failed.",
      copyFailedTitle: "Could not copy",
      copyFailedDescription: "Clipboard access failed.",
    },
  },
  providers: {
    updates: {
      title: "Updates",
      autoChecks: {
        title: "Automatic CLI update checks",
        description:
          "Check Codex, Claude, and other provider CLIs for newer versions in the background.",
        resetLabel: "CLI update checks",
        ariaLabel: "Automatic CLI update checks",
      },
      providerUpdates: {
        title: "Provider updates",
        description: "Review installed provider tools that Synara can safely update.",
      },
      manualUpdate: "Manual update",
    },
    /** Shared by the Provider updates and Installed CLIs rows. */
    checkStatus: {
      off: "Automatic checks off",
      available: (count: number) => `${count} ${pluralize(count, "update")} available`,
      none: "No provider updates detected",
    },
    picker: {
      title: "Provider picker",
      visible: {
        title: "Visible providers",
        description:
          "Drag providers into your preferred picker order and hide the ones you don't use. The provider you're currently using on a thread always stays visible.",
        resetLabel: "provider picker",
      },
      hiddenCount: (count: number) => `${count} ${pluralize(count, "provider")} hidden`,
      customOrder: "Custom order",
      allVisible: "All providers visible",
      reorder: (name: string) => `Reorder ${name}`,
      showInPicker: (name: string) => `Show ${name} in the provider picker`,
    },
    tools: {
      title: "Provider tools",
      installed: {
        title: "Installed CLIs",
        description:
          "Review provider versions and update tools. Open a row only when you need binary overrides.",
        resetLabel: "provider tools",
      },
      custom: "Custom",
      cliDocs: "CLI docs",
      command: "Command: ",
      noSafeCommand:
        "A newer version is available, but Synara could not identify a safe one-click update command for this installation.",
      passwordConfigured: "Configured — enter a replacement or leave blank",
    },
    update: {
      action: "Update",
      queued: "Update queued",
      running: "Updating",
      succeeded: "Updated",
      failed: "Update failed",
      unchanged: "Still outdated",
      latest: (version: string) => `Latest ${version}`,
      current: (version: string) => `Current ${version}`,
      runCommand: (command: string) => `Run ${command}`,
      didNotComplete: "The provider update did not complete.",
      failedTitle: (provider: string) => `Could not update ${provider}`,
      manualHint: (failure: string) =>
        `${failure}\n\nCopy the command below to update manually in a terminal.`,
      finishedTitle: (provider: string) => `${provider} update finished`,
      finishedDescription: "New sessions will use the refreshed provider.",
      requestFailed: "The provider update failed.",
    },
    docs: {
      install: "Install",
      update: "Update",
      config: "Config",
      reference: "Reference",
      hooks: "Hooks",
      headless: "Headless",
      quickstart: "Quickstart",
    },
    // One entry per install field, keyed by its settings key. `binaryHint` descriptions name the
    // executable; the schema marks which word to render as inline code so the styling survives
    // any word order.
    binaryHint: (binary: string) => `Leave blank to use ${binary} from your PATH.`,
    cursorBinaryHint: (binary: string) =>
      `Leave blank to use ${binary} from your PATH. Cursor editor CLI paths are accepted too.`,
    fields: {
      codexBinaryPath: { label: "Codex binary path", placeholder: "Codex binary path" },
      codexHomePath: {
        label: "CODEX_HOME path",
        placeholder: "CODEX_HOME",
        description: "Optional custom Codex home and config directory.",
      },
      claudeBinaryPath: { label: "Claude binary path", placeholder: "Claude binary path" },
      cursorBinaryPath: {
        label: "Cursor binary path",
        placeholder: "Cursor Agent or Cursor CLI path",
      },
      cursorApiEndpoint: {
        label: "Cursor API endpoint",
        placeholder: "https://api2.cursor.sh",
        description: "Optional Cursor API endpoint override passed to `cursor-agent -e`.",
      },
      antigravityBinaryPath: {
        label: "Antigravity binary path",
        placeholder: "Antigravity CLI binary path",
      },
      grokBinaryPath: { label: "Grok binary path", placeholder: "Grok binary path" },
      droidBinaryPath: { label: "Droid binary path", placeholder: "droid" },
      kiloBinaryPath: { label: "Kilo binary path", placeholder: "Kilo binary path" },
      kiloServerUrl: {
        label: "Kilo server URL",
        placeholder: "http://127.0.0.1:4096",
        description: "Optional existing Kilo server URL. Leave blank to spawn a local server.",
      },
      kiloServerPassword: {
        label: "Kilo server password",
        placeholder: "Kilo server password",
        description: "Optional password for an externally managed Kilo server.",
      },
      openCodeBinaryPath: { label: "OpenCode binary path", placeholder: "OpenCode binary path" },
      openCodeServerUrl: {
        label: "OpenCode server URL",
        placeholder: "http://127.0.0.1:4096",
        description: "Optional existing OpenCode server URL. Leave blank to spawn a local server.",
      },
      openCodeServerPassword: {
        label: "OpenCode server password",
        placeholder: "OpenCode server password",
        description: "Optional password for an externally managed OpenCode server.",
      },
      openCodeExperimentalWebSockets: {
        label: "OpenAI response WebSockets",
        description:
          "Use Opencode's experimental OpenAI response WebSocket transport for managed local servers.",
      },
      piBinaryPath: { label: "Pi binary path", placeholder: "Pi binary path" },
      piAgentDir: {
        label: "Pi agent directory",
        placeholder: "Pi agent directory",
        description: "Optional custom Pi agent directory for auth, models, skills, and commands.",
      },
    },
  },
  notifications: {
    activityAlerts: "Activity alerts",
    toasts: {
      title: "Activity toasts",
      description:
        "Show an in-app toast when a chat or managed terminal agent finishes or needs input.",
      resetLabel: "activity toasts",
      ariaLabel: "Activity toast notifications",
    },
    desktop: {
      title: "Desktop notifications",
      description:
        "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background.",
      resetLabel: "desktop notifications",
      ariaLabel: "Desktop activity notifications",
    },
    test: "Test",
    testTitle: "Activity notification",
    testBody: "Notification test for chats and terminal agents.",
    unavailableTitle: "Desktop notifications unavailable",
    testSentTitle: "Test notification sent",
    testUnavailableTitle: "Notifications unavailable",
    testShownOs: "Your operating system should show the notification.",
    testShownBrowser: "Your browser should show the notification.",
    testUnsupported: "Desktop notifications are not supported on this device.",
    // Keyed by `BrowserNotificationPermissionState`; `buildNotificationSettingsSupportText` picks one.
    support: {
      electron: "Desktop app notifications use your operating system notification center.",
      granted: "Browser notifications are enabled for this app.",
      denied: "Browser notifications are blocked. Re-enable them in your browser site settings.",
      insecure:
        "Browser notifications need a secure context. Localhost works; plain HTTP does not.",
      unsupported: "This browser does not support desktop notifications.",
      default:
        "Allow browser notifications to get alerts when chats or terminal agents finish or need input in the background.",
    },
  },
  appSnap: {
    intro: {
      title: "Take an AppSnap to show your agent another app's window",
      description:
        "Press your two-key shortcut while any app is frontmost. Synara captures that window as an image, brings itself forward, and attaches the snap to a task composer — the capture stays on this device until you send the message.",
    },
    unsupportedFallback: "AppSnap is available only in the macOS desktop app.",
    requiresDesktop: "AppSnap requires the Synara desktop app on macOS.",
    status: {
      desktopOnly: "Available in the Synara desktop app",
      macOnly: "Available on macOS only",
      listening: (shortcut: string) => `Listening — press ${shortcut} to snap`,
      theShortcut: "the shortcut",
      off: "Off",
      starting: "Starting the capture listener…",
      permissionRequired: "Permission setup required",
    },
    capture: {
      title: "Capture",
      enable: {
        title: "Enable AppSnap",
        description: "Run the capture listener in the background while Synara is open.",
        resetLabel: "AppSnap",
        ariaLabel: "Enable AppSnap",
      },
      shortcut: {
        title: "Shortcut",
        description:
          "Choose exactly two keys: one modifier and one other key. Synara checks its own bindings and asks macOS whether another app already owns the shortcut before saving it.",
      },
      destination: {
        title: "Destination",
        description:
          "Snaps join the task you interacted with in the last minute, and consecutive snaps stay together. Otherwise Synara opens a fresh task with the capture attached.",
        automatic: "Automatic",
      },
      sound: {
        title: "Capture sound",
        description: "Play a short shutter cue when a window is captured.",
        resetLabel: "capture sound",
        ariaLabel: "Play a sound when an AppSnap is captured",
        preview: "Preview",
      },
    },
    permissions: {
      title: "macOS permissions",
      inputMonitoring: {
        title: "Input Monitoring",
        description:
          "Lets Synara notice the double-Option chord while another app owns the keyboard. Nothing you type is recorded.",
      },
      screenRecording: {
        title: "Screen Recording",
        description:
          "Lets Synara capture an image of the frontmost window. Only the single window you snap is captured, only at the moment you press the chord.",
      },
      status: {
        title: "Permission status",
        description:
          "Grant both permissions to Synara under System Settings → Privacy & Security, then recheck here. macOS may require relaunching the app after a change.",
      },
      recheck: "Recheck permissions",
      labels: {
        granted: "Granted",
        denied: "Denied",
        "not-determined": "Not requested yet",
        restricted: "Restricted",
        unknown: "Unknown",
      },
    },
    unavailableTitle: "AppSnap unavailable",
    finishSetupTitle: "Finish AppSnap setup",
    finishSetupDescription: "Allow the required macOS permissions, then try again.",
    setupFailedTitle: "AppSnap setup failed",
    setupFailedDescription: "Could not configure AppSnap.",
    permissionCheckFailedTitle: "Could not check AppSnap permissions",
    permissionCheckFailedDescription: "Permission check failed.",
  },
  profile: {
    loadFailed: "Couldn’t load your local stats.",
    tryAgain: "Try again",
    share: "Share",
    edit: "Edit",
    lifetimeTokens: "Lifetime tokens",
    peakDay: "Peak day",
    totalPrompts: "Total prompts",
    currentStreak: "Current streak",
    longestStreak: "Longest streak",
    activity: "Activity",
    activityInsights: "Activity insights",
    mostUsedProvider: "Most used provider",
    mostUsedReasoning: "Most used reasoning",
    mostActiveHour: "Most active hour",
    mostWorkedProject: "Most worked project",
    skillsExplored: "Skills explored",
    totalSkillsUsed: "Total skills used",
    totalThreads: "Total threads",
    mostUsedPlugins: "Most used plugins",
    noSkills: "No skills or agents used yet.",
    modelUsage: "Model usage",
    noModelActivity: "No model activity yet.",
    /** Shown wherever a stat has no value yet; an em dash reads the same in every locale. */
    noValue: "—",
    runs: (count: string) => `${count} runs`,
    projectPrompts: (title: string, count: number, formattedCount: string) =>
      `${title} · ${formattedCount} ${pluralize(count, "prompt")}`,
    meridiem: { am: "AM", pm: "PM" },
    hour: (hour12: number, meridiem: string) => `${hour12} ${meridiem}`,
  },
  models: {
    catalog: {
      title: "Model catalog",
      cloud: {
        title: "Cloud model catalog",
        description:
          "Synara reads the public models.dev catalog so newly released models show up without waiting for an update. Refresh to pull it again right now.",
      },
      refresh: "Refresh",
      refreshing: "Refreshing...",
      refreshedTitle: "Model catalog refreshed",
      refreshedDescription: (count: number) =>
        `${count} cloud ${pluralize(count, "model is", "models are")} available.`,
      unavailableTitle: "Model catalog is unavailable",
      unavailableDescription:
        "models.dev could not be reached. Built-in models are still available.",
      refreshFailedTitle: "Could not refresh the model catalog",
      refreshFailedDescription: "The refresh request failed.",
    },
    advisor: {
      title: "Advisor",
      enabled: {
        title: "Watch and advise",
        description:
          "A second model watches what the agent does and speaks up when it sees a problem. It has no tools: it cannot read files, edit anything, or run commands, and it only sees a summary of the activity you see.",
        ariaLabel: "Enable the advisor",
      },
      model: {
        title: "Advisor model",
        description:
          "Only Codex and Claude can be interrupted mid-turn without discarding the work, so the advisor is limited to those.",
        ariaLabel: "Advisor model",
      },
      effort: {
        title: "Reasoning level",
        description:
          "How hard the advisor thinks before it decides whether to speak up. It runs on every turn, so a higher level costs more and takes longer to arrive. Modes that push the model into autonomous work are not offered: the advisor has no tools to use them with.",
        ariaLabel: "Advisor reasoning level",
      },
      severities: {
        nit: "Nit",
        concern: "Concern",
        blocker: "Blocker",
      },
    },
    generationDefaults: {
      title: "Generation defaults",
      gitWritingModel: {
        title: "Git writing model",
        description: "Used for generated commit messages, PR titles, and branch names.",
        resetLabel: "git writing model",
        ariaLabel: "Git text generation model",
      },
    },
    defaults: {
      title: "Default models",
      picker: {
        title: "Model for new chats",
        description:
          "Pick the model each provider starts a new chat on. A chat that already remembers a model — its own, its project's, or your last pick — keeps that instead. Pi has no model of its own and follows the Codex default.",
        resetLabel: "these model choices",
      },
      providerAriaLabel: "Default model provider",
      modelAriaLabel: "Default model",
      /** Placeholder option meaning "no preference"; the built-in default applies. */
      builtIn: "Built-in default",
      noModels: "No models discovered for this provider yet.",
    },
    visible: {
      title: "Visible models",
      picker: {
        title: "Models shown in the picker",
        description:
          "Turn off the models you never reach for. The model a conversation is already using stays visible so a thread is never stranded.",
        resetLabel: "visible models",
      },
      providerAriaLabel: "Provider",
      showModel: (name: string) => `Show ${name}`,
      noModels: "No models discovered for this provider yet.",
    },
    custom: {
      title: "Custom models",
      saved: {
        title: "Saved model slugs",
        description: "Add custom model slugs for supported providers.",
        resetLabel: "custom models",
      },
      providerAriaLabel: "Custom model provider",
      add: "Add",
      remove: (slug: string) => `Remove ${slug}`,
      showLess: "Show less",
      showMore: (count: number) => `Show more (${count})`,
      // `validateCustomModelInput` returns these keys instead of copy, so the validator stays
      // locale-free and unit-testable while the panel does the wording.
      errors: {
        empty: "Enter a model slug.",
        builtIn: "That model is already built in.",
        tooLong: (max: number) => `Model slugs must be ${max} characters or less.`,
        duplicate: "That custom model is already saved.",
      },
    },
  },
  shortcuts: {
    searchPlaceholder: "Search shortcuts...",
    searchAriaLabel: "Search shortcuts",
    command: "Command",
    keybinding: "Keybinding",
    noMatches: (query: string) => `No shortcuts match “${query}”.`,
  },
  providerUsage: {
    title: "Provider usage",
    refresh: "Refresh",
    loading: "Loading provider usage…",
    footnote:
      "Usage is read locally from each provider CLI's stored credentials and fetched directly from the provider. OAuth providers may refresh short-lived tokens through their official token endpoint; if a provider shows “Not signed in”, re-authenticate with its CLI.",
  },
  appSnapShortcut: {
    recordAriaLabel: "Record AppSnap shortcut",
    pressTwoKeys: "Press two keys…",
    save: "Save",
    reset: "Reset",
    nowPressOther: "Now press the other key…",
    holdModifier: "Hold a modifier, then press one other key. Esc cancels.",
    checking: "Checking macOS and other apps…",
    available: "Available — save to apply.",
    checkBeforeSaving: "Check a new combination before saving.",
    availableReserved: "Available and reserved",
    current: "Current shortcut",
    conflictCommand: (label: string) => `Synara already uses this for “${label}”.`,
    requiresDesktop: "Requires the Synara desktop app on macOS.",
    checkFailed: "Could not check this shortcut.",
    unsupportedKey: "That key isn't supported — try another.",
    holdModifierFirst: "Hold ⌘, ⌃, ⌥ or ⇧ first, then press the other key.",
    holdOnlyOne: "Hold only one modifier.",
    savedTitle: "AppSnap shortcut saved",
    savedEnabled: "The shortcut is reserved while AppSnap is enabled.",
    savedDisabled: "The shortcut will be reserved when you enable AppSnap.",
    savedUnavailableTitle: "AppSnap shortcut saved, but unavailable",
  },
};

export type Settings = typeof settings;
