// FILE: locales/zh-CN/composer.ts
// Purpose: Simplified Chinese copy for the chat composer.

import type { Messages } from "../en";

export const composer: Messages["composer"] = {
  extras: {
    menu: "输入区更多操作",
    addFiles: "添加文件",
    planMode: "计划模式",
    fast: "快速",
    default: "默认",
    advisor: {
      title: "监察",
      followDefault: "跟随全局设置",
      on: "旁观此会话",
      off: "不旁观",
    },
  },

  modelPicker: {
    ariaLabel: "更换模型与推理强度",
    tooltip: "更换模型",
    ultrathink: "超深度思考",
    thinking: (enabled) => `思考${enabled ? "开" : "关"}`,
  },

  placeholder: {
    approval: "先处理这个授权请求才能继续",
    pendingAnswer: "输入你的回答以继续",
    pendingAnswerWithOptions: "可以自己作答，留空则使用已选中的选项",
    planFollowUp: "补充反馈来完善计划，留空则直接开始执行",
    subagent: "在子智能体工作期间给它发消息",
    liveTurn: "继续提出修改要求",
    disconnected: "继续提出修改要求，或添加图片",
    idle: "随便问点什么，用 @ 引用文件/文件夹，用 / 查看可用命令",
  },

  slashCommands: {
    clear: "开启一个全新会话，清空当前对话上下文",
    compact: "压缩当前会话上下文以腾出空间",
    model: "为这个会话切换回复模型",
    plan: "把这个会话切换到计划模式",
    default: "把这个会话切回普通对话模式",
    review: "针对当前改动发起代码审查",
    fork: "把这个会话复刻到本地或新的工作树",
    side: "从这个会话开启受限的侧边会话",
    status: "查看上下文用量与速率限制状态",
    subagents: "插入一段提示词，让助手把工作委派出去",
    fast: "开启或关闭这个会话的快速模式",
    export: "把这个会话导出为 ZIP（thread.json + transcript.md）",
    feedback: "把反馈发送给 Synara 团队",
    automation: "用这段提示词创建一个定时自动化",
  },

  commandMenu: {
    files: "文件",
    filesHint: "输入以搜索文件",

    groups: {
      plugins: "插件",
      chats: "会话",
      subagents: "我的智能体",
      builtInAgents: "Synara 智能体",
      models: "模型",
      modes: "模式",
      local: "本地",
      builtIn: "内置",
      provider: "服务商",
      skills: "技能",
    },

    commands: {
      clear: "清空会话",
      compact: "压缩上下文",
      model: "切换模型",
      fast: "快速模式",
      plan: "计划模式",
      default: "默认模式",
      review: "代码审查",
      fork: "复刻会话",
      side: "侧边会话",
      status: "会话状态",
      subagents: "子智能体",
      feedback: "反馈给 Synara",
    },

    colorPreview: {
      description: "让本轮回复用可预览的色卡给出配色方案",
      keywords: "配色 主题 预览 色卡 调色板 preview",
    },

    meta: {
      switchModel: "切换模型",
      delegateTask: "委派给子智能体",
      plugin: "插件",
      local: "本地",
      unavailable: "不可用",
      mcpServer: "MCP 服务器",
      mcpTool: "MCP 工具",
      model: "模型",
    },

    loading: {
      mentions: "正在搜索提及项…",
      skills: "正在加载技能…",
      mcp: "正在连接 MCP 服务器…",
      commands: "正在加载命令…",
    },

    empty: {
      mention: "没有匹配的插件、会话或文件。",
      skill: "没有匹配的技能。",
      mcp: "该智能体没有配置任何 MCP 工具。",
      command: "没有匹配的命令。",
    },
  },

  directory: {
    goUp: "回到上级目录",
    useThisFolder: "使用此文件夹",
    matchesDeeper: "更深层的匹配",
    awaitingHomeDir: "正在等待服务器返回主目录…",
    loading: "正在加载本地文件…",
    searching: "正在搜索嵌套文件…",
    noMatches: "没有匹配项。",
    empty: "这里没有文件或文件夹。",
    topMatches: "只显示最匹配的结果。继续输入以缩小范围。",

    errors: {
      notFound: "找不到该文件夹。",
      permissionDenied: "没有访问权限。",
      notAFolder: "这不是一个文件夹。",
      loadFailed: "无法加载文件夹。",
      appConnecting: "应用仍在连接中，请稍后重试。",
    },
  },

  subagents: {
    expandStrip: "展开子智能体条",
    collapseStrip: "折叠子智能体条",
    stopAll: "停止所有子智能体",
    stopAllTitle: "停止所有运行中的子智能体",
    runInBackground: "转到后台运行（ctrl+b）",
    stop: "停止子智能体",
    settledGroup: (count: number) => `已完成 ${count} 个`,
    showSettled: "展开已结束的子智能体",
    hideSettled: "收起已结束的子智能体",
  },

  queued: {
    defaultTitle: "排队的后续消息",
    codeBlock: "代码块",
    steer: "介入",
    steerInterrupt: "立即发送",
    steerHint: "把这条消息并入正在进行的回合",
    steerInterruptHint: "停止当前回答,然后发送这条消息",
    delete: "删除排队的后续消息",
    menu: "排队消息的操作",
    edit: "编辑排队的提示词",
    deletePrompt: "删除排队的提示词",
  },

  pendingInput: {
    previousQuestion: "上一个问题",
    nextQuestion: "下一个问题",
    progress: (index, total) => `第 ${index} / ${total} 个`,
    selectMultiple: "可多选。",
    cancel: "取消",
    submit: "提交答案",
    submitting: "正在提交…",
  },

  pendingApproval: {
    reviewToContinue: "查看这个请求后才能继续。",

    prompts: {
      command: "允许执行这条命令吗？",
      "file-read": "允许读取这个文件吗？",
      "file-change": "允许这次文件修改吗？",
      permissions: "授予这些权限吗？",
    },

    permissionProfileTitle: "请求的权限配置",

    actions: {
      acceptOnce: { label: "仅允许这一次", description: "只放行本次请求" },
      acceptForSession: {
        label: "本次会话始终允许",
        description: "本次会话内不再询问",
      },
      decline: { label: "拒绝", description: "拒绝本次请求，让智能体继续" },
      cancelTurn: { label: "中止本轮", description: "停止当前这一轮对话" },
    },
  },

  taskBanner: {
    expand: "展开任务栏",
    collapse: "折叠任务栏",
  },

  liveChanges: {
    filesChanged: "文件有改动",
    filesChangedCount: (count) => `${count} 个文件有改动`,
  },

  voice: {
    record: "录制语音",
    transcribing: "正在转写语音",
    stop: (duration) => `结束录音（${duration}）`,
    cancel: "取消语音",
    send: "发送语音",
  },

  planBanner: {
    ready: "计划已就绪",
  },

  attachments: {
    readFailed: "无法读取附件数据。",
    readError: "读取附件失败。",
    pathProblem: (name) =>
      `无法读取「${name}」。含空格或特殊字符的路径可能需要用路径提及（@"…"）而不是文件附件。`,
    unnamedItem: "该项",
    remove: "移除附件",
    removeSelections: "移除已选内容",
    removeComments: "移除评论",
    commentCount: (count) => `${count} 条评论`,
    unknownType: "未知类型",
    capturedApp: "已截取的应用",
    showText: "展开全文",
    hideText: "收起全文",
    draftWarningLabel: "草稿附件可能不会保留",
    draftWarningDescription: "草稿附件仅保存在内存中，页面跳转后可能丢失。",

    browserAnnotation: {
      fallbackLabel: "页面元素",
      remove: (ordinal) => `移除浏览器标注 ${ordinal}`,
      describe: (ordinal, label, page) => `浏览器标注 ${ordinal}：${label}，${page}`,
      overflow: (count) => `+${count} 个`,
      showOverflow: (count) => `显示另外 ${count} 个浏览器标注`,
      overflowHeading: (count) => `另外 ${count} 个标注`,
    },
  },

  status: {
    title: "会话状态",
    description: "当前输入区的运行时设置与本地会话状态。",
    model: "模型",
    fastMode: "快速模式",
    on: "开",
    off: "关",
    reasoning: "推理强度",
    defaultEffort: "默认",
    mode: "模式",
    planMode: "计划",
    defaultMode: "默认",
    environment: "环境",
    envLocal: "本地",
    envWorktree: "工作树",
    envWorktreePending: "新建工作树（待创建）",
    branch: "分支",
    unknown: "未知",
    contextWindow: "上下文窗口",
    contextWindowHint: "当前会话最近一次上报的用量。",
    sessionWindows: (current, next) => `当前会话：${current}。下一轮：${next}。`,
    used: "已用",
    remaining: "剩余",
    window: "窗口",
    cost: "费用",
    costUnavailable: "不可用",
    noContextUsage: "这个会话还没有上报上下文用量。",
    rateLimits: "速率限制",
    rateLimitReached: "已达到速率限制。",
    rateLimitApproaching: (utilization) =>
      utilization === null ? "即将达到速率限制。" : `即将达到速率限制（已用 ${utilization}）。`,
    rateLimitResetsAt: (time) => ` 将于 ${time} 重置。`,
    noRateLimitWarning: "这个会话当前没有速率限制警告。",
    close: "关闭",
  },
};
