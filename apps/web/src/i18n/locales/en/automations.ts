// FILE: locales/en/automations.ts
// Purpose: English copy for the automations surface — the list route, the detail panel, the
//          create/edit dialog, and the transcript cards that announce a chat-created automation.
//
// Not `as const`: see locales/en/settings.ts for why literal types would break translations.

export const automations = {
  title: "Automations",
  notFound: "Automation not found.",
  backToList: "Back to automations",
  loading: "Loading automations...",
  newAutomation: "New automation",
  editAutomation: "Edit automation",
  newResult: "New result",

  empty: {
    title: "No automations yet",
    description: "Schedule a prompt to run on its own, or wake an existing thread on a loop.",
    noneActive: "No active automations.",
    nonePaused: "No paused automations.",
  },

  filters: {
    all: "All",
    active: "Active",
    paused: "Paused",
  },

  actions: {
    refresh: "Refresh",
    delete: "Delete",
    deleteAutomation: "Delete automation",
    runNow: "Run now",
    pause: "Pause",
    resume: "Resume",
    cancel: "Cancel",
    cancelRun: "Cancel run",
    save: "Save",
    create: "Create",
    close: "Close",
    useTemplate: "Use template",
    accept: "Accept",
    dismiss: "Dismiss",
    open: "Open",
    read: "Read",
    unread: "Unread",
    archive: "Archive",
    unarchive: "Unarchive",
    reEnable: "Re-enable",
  },

  deleteConfirm: (name: string) => `Delete "${name}"?`,

  /** Tooltips explaining why Run now is unavailable. */
  runBlocked: {
    pendingProposal: "Accept the automation proposal first",
    needsApproval: "Approve the automation first",
    reEnable: "Re-enable the automation first",
  },

  proposal: {
    title: "Suggested automation",
    description: "Accept it before it can run, or dismiss it to archive the suggestion.",
    suggestedPrefix: "Suggested · ",
    acceptedSuffix: " · Accepted",
    dismissedSuffix: " · Dismissed",
    updateFailed: "Could not update automation proposal",
  },

  approval: {
    title: "Approval needed",
    description:
      "This automation needs your approval once before Synara can save changes. When a warning blocks manual runs, Run now stays disabled until you approve it.",
    approve: "Approve",
    approveAndRun: "Approve & run now",
  },

  setupBanner: {
    title: "Setting up automation",
    cancelLabel: "Cancel automation setup",
    cancel: "Cancel",
  },

  /** The detail page's inline-editable name/prompt heading and its save feedback. */
  heading: {
    nameLabel: "Automation name",
    promptLabel: "Automation prompt",
    promptPlaceholder: "What should this automation do on each run?",
    saving: "Saving…",
    saved: "Saved",
  },

  /** Right-hand detail panel on a single automation. */
  detail: {
    groups: {
      status: "Status",
      details: "Details",
      memory: "Memory",
      previousRuns: "Previous runs",
    },
    status: "Status",
    nextRun: "Next run",
    lastRan: "Last ran",
    runsIn: "Runs in",
    runsInHint: "Where the automation runs: a worktree, a local checkout, or auto",
    thread: "Thread",
    threadUnavailable: "Thread unavailable",
    project: "Project",
    unknownProject: "Unknown project",
    createdFrom: "Created from",
    repeats: "Repeats",
    every: "Every",
    runAt: "Run at",
    cron: "Cron",
    day: "Day",
    time: "Time",
    timezone: "Timezone",
    model: "Model",
    mode: "Mode",
    notify: "Notify",
    stopWhen: "Stop when",
    stopWhenPlaceholder: "Never",
    maxIterations: "Max iterations",
    onFailure: "On failure",
    noMemory: "No persistent memory yet.",
    noRuns: "No runs yet.",
    archiveHint: "Archiving does not remove generated worktrees or branches.",
    on: "On",
    off: "Off",
  },

  /** Create/edit dialog: the title field, the prompt, and every toolbar picker below it. */
  dialog: {
    namePlaceholder: "Automation title",
    nameLabel: "Automation title",
    aboutLabel: "About automations",
    aboutHint: "Automations run this prompt on a schedule and open the result as a thread.",
    promptPlaceholder: "Add prompt e.g. look for crashes in $sentry",
    promptLabel: "Automation prompt",
    selectProject: "Select project",
    schedule: "Schedule",
    every: "Every",
    runAt: "Run at",
    cron: "Cron",
    day: "Day",
    time: "Time",
    timezone: "Timezone",
    timezonePlaceholder: "Europe/Rome",
    runMode: "Run mode",
    mode: "Mode",
    targetThread: "Target thread",
    noThreads: "No threads in this project",
    stopWhen: "Stop when",
    stopWhenPlaceholder: "PR is ready to merge",
    stopOnError: "Stop on error",
    onFailure: "On failure",
    maxIterations: "Max iterations",
    notify: "Notify",
    permissions: "Permissions",
  },

  /** Lifecycle pill on the detail panel. */
  lifecycle: {
    active: "Active",
    paused: "Paused",
    scheduled: "Scheduled",
    done: "Done",
  },

  /** Why the server stopped an automation on its own. */
  stoppedReason: {
    singleFailure: "Stopped after a failed run",
    multipleFailures: (count: number) => `Stopped after ${count} failed runs`,
    maxIterations: "Stopped at run limit",
    completion: "Stop condition met",
  },

  worktreeMode: {
    auto: "Auto",
    local: "Local",
    worktree: "Worktree",
  },

  mode: {
    standalone: "Standalone",
    dedicated: "Dedicated thread",
    heartbeat: "Heartbeat",
  },

  notifyPolicy: {
    all: "All runs",
    failedRunsOnly: "Failed runs only",
  },

  runtimeMode: {
    approvalRequired: "Approval required",
    auto: "Auto",
    fullAccess: "Full access",
  },

  /** Options for the "On failure" preset picker (create dialog and detail page). */
  failurePolicy: {
    keepRunning: "Keep running",
    stopAfterOne: "Stop after 1 failure",
    stopAfterCount: (count: string) => `Stop after ${count} failures`,
  },

  /** Anchored confirm popover shown before an inline edit changes where an automation runs
   *  or which thread it is bound to. */
  riskConfirm: {
    localCheckoutTitle: "Local checkout",
    localCheckoutDetail: "Runs may edit files in the active project checkout.",
    switch: "Switch",
    switchTo: (target: string) => `Switch to ${target}`,
    continueThreadTitle: "Continue an existing thread",
    releaseThreadTitle: "Release the current thread?",
    continueThreadDetail:
      "Each run appends a turn to the thread you pick and waits for it to go idle.",
    releaseThreadDetail: (threadName: string) =>
      `The automation stops writing to ${threadName}; the thread itself is kept.`,
    unnamedThread: "its thread",
    pickThreadPlaceholder: "Pick a thread…",
  },

  /** Absolute run timestamps: near days read as words, everything else as a formatted date. */
  timestamp: {
    today: (time: string) => `Today at ${time}`,
    tomorrow: (time: string) => `Tomorrow at ${time}`,
    yesterday: (time: string) => `Yesterday at ${time}`,
  },

  runStatus: {
    pending: "Queued",
    claimed: "Starting",
    running: "Running",
    "waiting-for-approval": "Waiting for approval",
    succeeded: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
    skipped: "Skipped",
  },

  runOutcome: {
    findings: "Found something to review",
    noFindings: "No findings",
    changedFiles: "Changed files",
    needsAttention: "Needs attention",
    completedOpenThread: "Completed; open the thread for the reply",
    completed: "Completed",
  },

  /** Why the latest run needs a look, appended to the list row subtitle next to the amber glyph. */
  attention: {
    waitingForApproval: "Waiting for approval",
    failed: "Last run failed",
    cancelled: "Last run cancelled",
    interrupted: "Last run interrupted",
  },

  /** Row subtitle segment for the upcoming run; `countdown` comes from the cadence formatter. */
  nextRunIn: (countdown: string) => `Next run ${countdown}`,

  interval: {
    everyMinutes: (amount: string) => `Every ${amount} min`,
    everySeconds: (amount: string) => `Every ${amount} sec`,
    everyHour: "Every hour",
    everyHours: (amount: string) => `Every ${amount} hours`,
  },

  /** Inline field validators and the create/edit dialog's submit-blocked reason. */
  validation: {
    addName: "Add a name",
    nameTooLong: (max: number) => `Name must be ${max} characters or fewer`,
    addPrompt: "Add a prompt",
    promptTooLong: (max: string) => `Prompt must be ${max} characters or fewer`,
    cronFieldCount: "Use a 5-field cron expression (minute hour day month weekday)",
    addTimezone: "Add a timezone",
    unknownTimezone: "Unknown timezone",
    pickProject: "Pick a project",
    pickTargetThread: "Pick a target thread",
    fastIntervalLimit: (maxIterations: number) =>
      `Intervals under one minute need max iterations set to ${maxIterations} runs or fewer.`,
    setValidInterval: "Set a valid interval",
    addCronExpression: "Add a cron expression",
    pickRunTime: "Pick a run time",
    setValidTime: "Set a valid time",
    acknowledgeRisks: "Acknowledge the flagged risks first",
  },

  maxIterationOption: {
    unlimited: "Unlimited",
    runs: (count: string) => (count === "1" ? "1 run" : `${count} runs`),
  },

  /** The "Repeats" picker's cadence-kind options (detail page and create/edit dialog). */
  scheduleKind: {
    manual: "Manual",
    once: "Once",
    hourly: "Hourly",
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    custom: "Custom",
    cron: "Cron",
  },

  /** Abbreviated weekday labels, indexed Sunday (0) through Saturday (6). */
  weekdayShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],

  /** Starter prompts behind the dialog's "Use template" button. */
  templates: {
    triageCrashes: {
      label: "Triage new crashes",
      name: "Triage crashes",
      prompt: "Look for new crashes in $sentry and open a fix PR for the most impactful one.",
    },
    updateDependencies: {
      label: "Update dependencies",
      name: "Update dependencies",
      prompt:
        "Check for outdated dependencies, bump the safe minor and patch versions, then run the tests.",
    },
    dailySummary: {
      label: "Daily standup summary",
      name: "Daily summary",
      prompt:
        "Summarize what changed on the main branch in the last 24 hours as a short standup update.",
    },
  },
};
