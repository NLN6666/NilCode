---
name: subagent-dock-open-and-model
status: approved
created: 2026-08-07T09:29:01Z
updated: 2026-08-07T09:29:01Z
---

# 子代理转录卡片改走右侧折叠面板 + 会话头显示模型 —— 设计文档

## 1. 目标

两件事，同一个架构缺口的两面：

1. **落点统一**：转录里子代理卡片的「打开完整对话」目前是整页跳转，改为在父会话的右侧折叠面板（right dock）开内嵌会话 tab —— 与侧边栏子代理行、底部子代理条一致。
2. **模型可见**：在 dock 里打开的子代理会话，其头部显示该子代理实际使用的模型与 effort（形如 `Sonnet 4.6 · high`）。目前这个信息在打开后完全不可见。

## 2. 现状

### 2.1 三个入口，两种落点

| 入口 | 代码位置 | 点击后 |
| --- | --- | --- |
| 侧边栏子代理行 | `apps/web/src/components/Sidebar.tsx` `activateSidebarThread` | `openThreadInHostDock()` → dock tab |
| 底部子代理条 | `apps/web/src/components/chat/ComposerSubagentStrip.tsx:97` | `onOpenSubagentThread` → dock tab |
| **转录子代理卡片** | `apps/web/src/components/chat/SubagentDetailSections.tsx:167` | **`onOpenThread` → 整页跳转** |

`apps/web/src/lib/dockThreadOpener.ts` 的文件注释已经写明了这条规则的存在理由：把「host = 父线程」收口在一处，避免多个入口漂移成不同的导航模型。转录卡片是唯一还没接进来的那个。

透传链路很窄，中间**不经过** `MessagesTimeline`：

```
ChatView.tsx:12091  onOpenThread={onNavigateToThread}
  └─ ChatTranscriptPane.tsx:236
       └─ AgentActivityDetailView.tsx:125
            └─ SubagentDetailSections.tsx:167  ←「打开完整对话」
```

`ChatView` 已经在 9bb93008 里建好了 `onOpenSubagentThread` 回调（`ChatView.tsx:10772`），内部处理了两个边界情况：split pane 无自己的 dock 时回退为整页导航；从子代理整页打开时把路由挪到父线程以让 tab 可见。本设计直接复用它，不新写导航逻辑。

### 2.2 子代理线程记录不含模型

`packages/contracts/src/orchestration.ts` 的线程 schema 只有 `subagentAgentId` / `subagentNickname` / `subagentRole`，**没有模型字段**。模型只存在于**父线程的 activity payload** 里。

现有两处各自解析该 payload 取模型：

- `apps/web/src/components/chat/ComposerSubagentStrip.logic.ts:95` — 底部条行内标签
- `apps/web/src/components/chat/SubagentDetailSections.tsx:91` — 转录卡片 meta 行

两处都用 `formatSubagentModelLabel()`（`apps/web/src/lib/subagentPresentation.ts:369`）统一口径。

关键点：`apps/web/src/lib/subagentPresentation.ts:155` 的 `resolveSubagentIdentityFromParentActivity()` 已经在构建 identity directory 并解析出 hint 了，而 `ParsedSubagentIdentityHint`（`packages/shared/src/subagents.ts:28`）本来就携带 `model`、`effort`、`modelIsRequestedHint` 三个字段 —— 该函数当场把它们丢弃，只返回 `nickname` 和 `role`。

`apps/web/src/components/chat/ChatHeader.tsx` 中不存在任何模型相关代码，dock tab 的头部因此不显示模型。

## 3. 方案选择

### 模型数据来源：前端派生（采纳）vs 持久化（否决）

**采纳：从父线程 activity 派生。** 扩展已有的 `resolveSubagentIdentityFromParentActivity()`，让它一并返回 `model` / `effort`。零协议改动、零迁移，复用现成的解析路径。

局限：父线程的 activities 未加载时解析不出模型。但 dock tab 的宿主**就是**父线程（`dockThreadOpener.ts` 的 host = parent 规则），恰好是必然已加载的情形，覆盖本设计的全部目标场景。

**否决：把 `subagentModel` 持久化进线程记录。** 需要改动 `packages/contracts/src/orchestration.ts` 的 4 处 schema、server 侧 decider 与 ingestion、store 投影，外加已有线程的回填。它解决的是归档线程/冷启动场景，本设计碰不到。且模型本质上是「这次 fan-out 的运行时事实」，而非线程的持久属性 —— 持久化会把一个派生值提升为需要与运行时保持同步的状态。

后续若出现「归档后仍需看到模型」的真实需求，再单独立项。

## 4. 设计

### 4.1 Part 1 —— 转录卡片改走 dock

沿 `ChatTranscriptPane → AgentActivityDetailView → SubagentDetailSections` 新增一个可选 prop `onOpenSubagentThread`，`ChatView` 传入已有的同名回调。

`SubagentDetailSections` 内「打开完整对话」的点击目标改为 `onOpenSubagentThread ?? onOpenThread` —— 与 `ComposerSubagentStrip.tsx:198` 完全相同的回退写法，保证未传该 prop 的调用方（测试夹具、`.browser.tsx` 预览）行为不变。

**不改动**的部分：`MessagesTimeline` 的 `onOpenThread`（服务于 `SynaraThreadCreationCard` 等非子代理场景）保持整页跳转；父线程行、普通线程行的导航语义不变。

### 4.2 Part 2 —— dock tab 头部显示模型

1. **`packages/shared` 无需改动** —— `ParsedSubagentIdentityHint` 已含所需字段。

2. **`apps/web/src/lib/subagentPresentation.ts`**
   - `resolveSubagentIdentityFromParentActivity()` 的返回值增加 `model` 与 `effort`。
   - `SubagentPresentation` 接口增加 `modelLabel: string | null`。
   - 该标签由 `formatSubagentModelLabel()` 生成，并在 `effort` 存在时拼为 `${model} · ${effort}` —— 与 `ComposerSubagentStrip.logic.ts:106-109` 现有拼法逐字一致。同一个模型在底部条、转录卡片、会话头三处必须长得一样。
   - 保留 `formatSubagentModelLabel()` 现有的「砍掉 `Claude ` 前缀」行为，会话头同样不带前缀。

3. **`apps/web/src/components/chat/ChatHeader.tsx`**
   - 新增可选 prop `subagentModelLabel?: string | null`。
   - 有值时在线程标题旁渲染一条 meta 文本；无值时不渲染任何占位。

4. **`apps/web/src/components/ChatView.tsx`**
   - 当 `activeThread.parentThreadId` 存在时，用 `resolveSubagentPresentationForThread()` 解析出 `modelLabel` 并传给 `ChatHeader`；否则传 `null`。
   - 该解析对所有 surface mode 生效（dock tab 走 `surfaceMode="split"`），非子代理线程自然得到 `null`。

### 4.3 降级行为

解析不出模型时**不渲染**，且**不回退到父线程的模型**。显示一个错误的模型比不显示更糟 —— 用户看模型标签正是为了确认这次 fan-out 的路由是否符合预期，一个看似合理的错值会直接误导该判断。

## 5. 测试

| 覆盖点 | 位置 |
| --- | --- |
| 从父线程 activity 派生出 `model` / `effort` / `modelLabel`；缺字段时为 `null` | `apps/web/src/lib/subagentPresentation` 相应测试 |
| `modelLabel` 与底部条口径一致（含 `· effort` 拼接、`Claude ` 前缀剥离） | 同上 |
| 「打开完整对话」调用 `onOpenSubagentThread` 而非 `onOpenThread`；未传时回退 | `apps/web/src/components/chat/SubagentDetailSections.test.tsx` |
| `ChatHeader` 有 / 无 `subagentModelLabel` 时的渲染 | `apps/web/src/components/chat/` 相应测试 |

现有 `packages/shared/src/subagents.test.ts` 已有携带 `model` / `requested_model` 的 activity payload 夹具，可直接复用其形状。

## 6. 验证

按 `AGENTS.md`：实施完成前 `bun fmt`、`bun lint`、`bun typecheck` 三项必须通过，合并为一次收尾验证。测试用 `bun run test`，**不得**使用 `bun test`。

## 7. 范围之外

- 侧边栏子代理行显示模型（本次不做；`modelLabel` 落地后是一行 UI 的事，需要时再加）。
- 转录卡片内联「显示对话」预览区的模型显示（卡片 meta 行已有模型，不重复）。
- 把 `subagentModel` 持久化进契约与线程记录（见 §3 的否决理由）。
- 子代理会话头部的模型**切换**能力 —— 本设计只做只读展示。
