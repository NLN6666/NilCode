// FILE: locales/zh-CN/diff.ts
// Purpose: Simplified Chinese copy for the diff panel.

import type { Messages } from "../en";

export const diff: Messages["diff"] = {
  options: {
    menu: "差异选项",
    viewMenu: "差异视图选项",
    chooseSource: "选择差异来源",
    chooseTurn: "选择轮次差异",
    source: "来源",
    sourceHeading: "差异来源",
    view: "视图",
    stackedDiff: "堆叠差异",
    splitDiff: "分栏差异",
    stacked: "堆叠",
    split: "分栏",
    ignoreWhitespace: "忽略仅空白的改动",
    wrapLongLines: "长行自动换行",
  },

  scopes: {
    workingTree: "工作区",
    unstaged: "未暂存",
    staged: "已暂存",
    branch: "分支",
  },

  turnDiff: "轮次差异",

  turns: {
    heading: "轮次",
    all: "全部轮次",
    last: "最近一轮",
    turn: (number) => `第 ${number} 轮`,
    showMore: (count) => `再显示 ${count} 条`,
  },

  actions: {
    copyDiff: "复制差异",
    copiedDiff: "已复制差异",
    expandAll: "展开所有文件",
    collapseAll: "折叠所有文件",
    hideFileTree: "隐藏文件树",
    showFileTree: "显示文件树",
    closeFileView: "关闭文件视图",
    jumpToFile: "跳转到文件",
    fileActions: "文件操作",
    referenceInChat: "在对话中引用",
    askWhyChanged: "询问为什么改动",
    copyPath: "复制路径",
  },

  fileTree: {
    label: "审阅文件",
    loading: "正在加载改动的文件…",
    filterPlaceholder: "过滤文件…",
    filterLabel: "过滤文件",
  },

  empty: {
    noFiles: "这个差异里没有文件。",
    noMatches: "没有匹配的文件。",
    selectThread: "选择一个会话来查看轮次差异。",
    notARepo: "这个项目不是 git 仓库，因此无法查看轮次差异。",
    checkingRepo: "正在检查 git 仓库…",
    worktreePreparing: "这个对话环境还在准备中。工作树就绪后即可查看差异。",
    loadingCheckpoint: "正在加载检查点差异…",
    loadingScope: (scope) => `正在加载${scope}差异…`,
    noChangesInSource: "所选差异来源没有改动。",
    noTurnDiffs: "还没有可用的轮次差异。",
    noNetChanges: "这次选择没有净改动。",
    noRepoDiff: "当前没有可用的仓库差异。",
  },

  errors: {
    repoCheckFailed: "检查 git 仓库失败。",
    repoDiffFailed: "加载仓库差异失败。",
  },
};
