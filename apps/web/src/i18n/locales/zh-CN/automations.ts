// FILE: locales/zh-CN/automations.ts
// Purpose: Simplified Chinese copy for the automations surface.

import type { Messages } from "../en";

type Automations = Messages["automations"];

export const automations: Automations = {
  title: "自动化",
  notFound: "找不到该自动化。",
  backToList: "返回自动化列表",
  loading: "正在加载自动化…",
  newAutomation: "新建自动化",
  editAutomation: "编辑自动化",
  newResult: "有新结果",

  empty: {
    title: "还没有自动化",
    description: "让提示词按计划自行运行，或按固定节奏唤醒一个已有会话。",
    noneActive: "没有启用中的自动化。",
    nonePaused: "没有已暂停的自动化。",
  },

  filters: {
    all: "全部",
    active: "启用中",
    paused: "已暂停",
  },

  actions: {
    refresh: "刷新",
    delete: "删除",
    deleteAutomation: "删除自动化",
    runNow: "立即运行",
    pause: "暂停",
    resume: "恢复",
    cancel: "取消",
    cancelRun: "取消本次运行",
    save: "保存",
    create: "创建",
    close: "关闭",
    useTemplate: "使用模板",
    accept: "接受",
    dismiss: "忽略",
    open: "打开",
    read: "标为已读",
    unread: "标为未读",
    archive: "归档",
    unarchive: "取消归档",
  },

  deleteConfirm: (name) => `要删除「${name}」吗？`,

  runBlocked: {
    pendingProposal: "请先接受这条自动化建议",
    needsApproval: "请先批准这条自动化",
  },

  proposal: {
    title: "建议的自动化",
    description: "接受后它才会运行；忽略则会归档这条建议。",
    suggestedPrefix: "建议 · ",
    acceptedSuffix: " · 已接受",
    dismissedSuffix: " · 已忽略",
    updateFailed: "无法更新自动化建议",
  },

  approval: {
    title: "需要批准",
    description:
      "Synara 保存改动前，这条自动化需要你批准一次。当某条警告拦住了手动运行时，「立即运行」会一直保持禁用，直到你批准为止。",
    approve: "批准",
    approveAndRun: "批准并立即运行",
  },

  setupBanner: {
    title: "正在设置自动化",
    cancelLabel: "取消自动化设置",
    cancel: "取消",
  },

  detail: {
    groups: {
      status: "状态",
      details: "详情",
      memory: "记忆",
      previousRuns: "历史运行",
    },
    status: "状态",
    nextRun: "下次运行",
    lastRan: "上次运行",
    runsIn: "运行位置",
    runsInHint: "自动化的运行位置：工作树、本地检出，或自动选择",
    thread: "会话",
    threadUnavailable: "会话不可用",
    project: "项目",
    unknownProject: "未知项目",
    createdFrom: "创建自",
    repeats: "重复",
    every: "每隔",
    runAt: "运行时间",
    cron: "Cron",
    day: "星期",
    time: "时间",
    timezone: "时区",
    model: "模型",
    mode: "模式",
    notify: "通知",
    stopWhen: "停止条件",
    stopWhenPlaceholder: "从不",
    maxIterations: "最大运行次数",
    noMemory: "还没有持久记忆。",
    noRuns: "还没有运行记录。",
    archiveHint: "归档不会删除已生成的工作树或分支。",
    on: "开",
    off: "关",
  },

  dialog: {
    namePlaceholder: "自动化标题",
    nameLabel: "自动化标题",
    aboutLabel: "关于自动化",
    aboutHint: "自动化会按计划运行这段提示词，并把结果作为会话打开。",
    promptPlaceholder: "填写提示词，例如：查找 $sentry 中的崩溃",
    promptLabel: "自动化提示词",
    selectProject: "选择项目",
    schedule: "计划",
    every: "每隔",
    runAt: "运行时间",
    cron: "Cron",
    day: "星期",
    time: "时间",
    timezone: "时区",
    timezonePlaceholder: "Asia/Shanghai",
    runMode: "运行方式",
    mode: "模式",
    targetThread: "目标会话",
    noThreads: "该项目下没有会话",
    stopWhen: "停止条件",
    stopWhenPlaceholder: "PR 可以合并时",
    stopOnError: "出错时停止",
    maxIterations: "最大运行次数",
    notify: "通知",
    permissions: "权限",
  },

  lifecycle: {
    active: "运行中",
    paused: "已暂停",
    scheduled: "已排期",
    done: "已完成",
  },

  worktreeMode: {
    auto: "自动",
    local: "本地",
    worktree: "工作树",
  },

  mode: {
    standalone: "独立",
    dedicated: "专属会话",
    heartbeat: "心跳",
  },

  notifyPolicy: {
    all: "每次运行",
    failedRunsOnly: "仅失败的运行",
  },

  runtimeMode: {
    approvalRequired: "需要批准",
    fullAccess: "完全访问",
  },

  timestamp: {
    today: (time) => `今天 ${time}`,
    tomorrow: (time) => `明天 ${time}`,
    yesterday: (time) => `昨天 ${time}`,
  },

  runStatus: {
    pending: "排队中",
    claimed: "启动中",
    running: "运行中",
    "waiting-for-approval": "等待批准",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断",
    skipped: "已跳过",
  },

  runOutcome: {
    findings: "发现了需要查看的内容",
    noFindings: "没有发现",
    changedFiles: "修改了文件",
    needsAttention: "需要关注",
    completedOpenThread: "已完成；打开会话查看回复",
    completed: "已完成",
  },

  attention: {
    waitingForApproval: "等待批准",
    failed: "上次运行失败",
    cancelled: "上次运行已取消",
    interrupted: "上次运行被中断",
  },

  nextRunIn: (countdown) => `下次运行 ${countdown}`,

  interval: {
    everyMinutes: (amount) => `每 ${amount} 分钟`,
    everySeconds: (amount) => `每 ${amount} 秒`,
    everyHour: "每小时",
    everyHours: (amount) => `每 ${amount} 小时`,
  },

  maxIterationOption: {
    unlimited: "不限",
    runs: (count) => `${count} 次`,
  },

  templates: {
    triageCrashes: {
      label: "分诊新崩溃",
      name: "分诊崩溃",
      prompt: "在 $sentry 中查找新的崩溃，并为影响最大的那个提交修复 PR。",
    },
    updateDependencies: {
      label: "更新依赖",
      name: "更新依赖",
      prompt: "检查过期依赖，升级安全的次版本和补丁版本，然后运行测试。",
    },
    dailySummary: {
      label: "每日站会摘要",
      name: "每日摘要",
      prompt: "把过去 24 小时内主分支上的改动总结成一条简短的站会更新。",
    },
  },
};
