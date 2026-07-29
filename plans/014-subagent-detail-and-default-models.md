# 014 · Subagent 详情增强与每供应商默认模型

- 状态：TODO —— 设计已定，实施计划待编
- 创建：2026-07-29T03:11:02Z
- 范围：`apps/web`（全部改动）
- 不在范围：思考链实时流式化（涉及 `apps/server` 事件管道，见计划 015）；`packages/contracts` 与服务端不做任何改动

## 1. 目标

三件独立但落点重合的前端改进：

1. **Subagent 详情** —— 点击时间线里的子代理任务行后，能看到该子代理的模型、角色、状态等元信息，并能查看/跳转到它的完整对话。
2. **每供应商默认模型** —— 用户可为每个供应商各配一个默认模型，新会话直接采用，而非硬编码兜底。
3. **i18n 补漏** —— 修复 subagent / 活动详情链路上残留的硬编码英文。

三者合并为一份计划，因为它们改动的是同一批文件（`agentActivity.logic.ts`、`AgentActivityDetailView.tsx`、`i18n/locales/*`、`appSettings.ts`），拆开会反复触碰同样的代码。

与计划 012（中文语言支持）的关系：012 负责全局 i18n 骨架与批量迁移，本计划只补 012 尚未覆盖的 subagent/活动详情这一小片，不重复其工作。

## 2. 现状（实施前必读）

### 2.1 Subagent 详情

时间线中 `itemType === "collab_agent_tool_call"` 的行由 `TimelineWorkEntryRow.tsx:516` 判定为可点击，点击后 `onOpenAgentActivity(workEntry.id)` 切到 `AgentActivityDetailView.tsx`。

该详情页目前只渲染四块：标题、摘要、Prompt、Result、活动列表。**没有任何模型/角色/状态信息，也无法查看子代理自己的对话。**

数据其实已经全部到位，只是没被渲染：

| 字段                    | 位置                              | 内容                                                                                                                                  |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLogSubagent`       | `apps/web/src/workLog.ts:125-141` | `threadId` `resolvedThreadId` `agentId` `nickname` `role` `model` `effort` `background` `prompt` `rawStatus` `statusLabel` `isActive` |
| `WorkLogSubagentAction` | `apps/web/src/workLog.ts:143-149` | `tool` `status` `summaryText` `model` `prompt`                                                                                        |

`resolvedThreadId` 由 `enrichSubagentWorkEntries`（`apps/web/src/components/ChatView.logic.ts:1462`）在渲染前回填，指向一条**真实存在的 Synara thread**。

Claude 侧的子代理对话是完整落库的：`ClaudeAdapter.ts:4936` 设了 `forwardSubagentText: true`，注释明确写着"Forward full subagent conversations (text + thinking) tagged with parent_tool_use_id so child threads can stream live"。因此"跳转看完整对话"无需任何新数据管道。

`ComposerSubagentStrip.tsx` 已实现"点击行切到子代理线程"（`onOpenThread`），本计划复用同一回调路径，不新造。

### 2.2 默认模型

`settings.defaultProvider` 已存在（`apps/web/src/appSettings.ts:286`），设置界面在 `apps/web/src/routes/_chat.settings.tsx:364-400`。

**但只有供应商，没有模型。** 新会话的模型由 `resolvePreferredComposerModelSelection`（`apps/web/src/composerDraftModels.ts:744-778`）解析，其回退链末端是硬编码的 `getDefaultModel(provider)`，用户无从干预。

现有的每供应商模型记忆结构是 `modelSelectionByProvider`（草稿态），以及 `hiddenModels: Array<{provider, slug}>`（持久设置）—— 后者是本计划新增字段的形状参照。

### 2.3 硬编码英文

已逐条定位：

| 位置                             | 硬编码内容                                                  |
| -------------------------------- | ----------------------------------------------------------- |
| `AgentActivityDetailView.tsx:94` | `` `${n} ${pluralize(n, "update")}` ``                      |
| `agentActivity.logic.ts:53`      | `"Reasoning"`                                               |
| `agentActivity.logic.ts:57`      | `"Agent task"` / `"Activity"`                               |
| `agentActivity.logic.ts:117`     | `` `${n} updates - ${preview}` `` / `` `${n} updates` ``    |
| `agentActivity.logic.ts:123-124` | `"Reasoning trace"`（`label` 与 `toolTitle`）               |
| `agentActivity.logic.ts:154-155` | `"Reasoning trace"`（第二处，非折叠分支）                   |
| `TimelineWorkEntryRow.tsx:790`   | `"Edited"` —— i18n 键 `chat.work.edited` 已存在但从未被引用 |
| `TimelineWorkEntryRow.tsx:173`   | `` `${n} files` ``                                          |

## 3. 已确定的决策

| 决策点            | 结论                                                        | 理由                                                                                                                            |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Subagent 交互形态 | 详情页内嵌对话预览 **+** 跳转完整会话，两者都做             | 预览满足"扫一眼就够"的场景，跳转满足深入排查                                                                                    |
| 对话预览加载      | **懒加载**：折叠区展开时才 `retainThreadDetailSubscription` | 一次 fan-out 常见 5–10 个子代理，无条件订阅等于详情页一打开就建 10 条实时通道                                                   |
| 默认模型粒度      | **每供应商各存一个**                                        | 与既有 `modelSelectionByProvider` / `hiddenModels` 的心智模型一致；切供应商时各自记住自己的默认值                               |
| 默认模型存储形状  | `Array<{provider, slug}>`，非 `Record`                      | 对齐 `hiddenModels`；`ProviderKind` 增删时无需 schema 迁移                                                                      |
| 默认模型优先级    | 插在回退链**最末尾**（`getDefaultModel` 之前）              | 保持"越具体的上下文越优先"这一既有原则；`defaultProvider` 目前也正是这个位置（`composerDraftModels.ts:763`，排在 project 之后） |
| 默认模型候选范围  | 经 `filterModelOptionsByVisibility` 过滤                    | 已被用户隐藏的模型不应还能被设成默认                                                                                            |
| i18n 修复手法     | 逻辑层返回**语义 key**，组件层翻译                          | 见 §5                                                                                                                           |
| 新增组件          | 抽 `SubagentDetailSections.tsx`                             | `AgentActivityDetailView` 现 215 行，直接塞入会到 400+，违反"文件聚焦"约定                                                      |
| 开合动效          | 一律用 `DisclosureRegion` / `disclosureShellClassName`      | `CLAUDE.md` 明令：任何开合切换必须复用 `lib/disclosureMotion.ts`，禁止自写高度/透明度过渡                                       |

### 被否决的方案

| 方案                                                 | 否决理由                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| 只加跳转按钮，不做内嵌预览                           | 排查一个 fan-out 要来回跳 10 次，失去"详情页"的意义                    |
| 只做内嵌预览，不做跳转                               | 预览必然截断；深入排查仍需完整会话与其工具调用细节                     |
| 详情页打开即订阅全部子线程                           | 与 `CLAUDE.md` "Performance first" 冲突，见上表                        |
| 只给 `defaultProvider` 配一个默认模型                | 切到别的供应商仍走硬编码兜底，问题只解决了 1/9                         |
| 在 `agentActivity.logic.ts` 里直接调 `useMessages()` | 它是纯函数模块，不是组件，hook 不可用；且会让其现有单测被迫依赖 locale |
| 把默认模型优先级放在 project 之上                    | 会让 project 层的模型记忆形同虚设                                      |

## 4. 架构

改动全部在 `apps/web`，无服务端、无契约变更。

```
appSettings.ts
  └─ 新增 defaultModelByProvider          （持久设置）
        │
composerDraftModels.ts
  └─ resolvePreferredComposerModelSelection 回退链末端接入
        │
ModelsSettingsPanel.tsx
  └─ 新增「默认模型」SettingsSection      （读写上面的设置）

agentActivity.logic.ts                     （纯逻辑，locale-free）
  └─ 文案 → 语义 key + 结构化数据
        │
AgentActivityDetailView.tsx                （组件层翻译）
  └─ SubagentDetailSections.tsx  ← 新增
        ├─ 元信息卡
        ├─ 对话预览（懒加载折叠区）
        └─ 跳转完整会话
```

## 5. i18n 修复手法

`agentActivity.logic.ts` 是纯函数模块且有独立单测（`agentActivity.logic.test.ts`）。若让它返回本地化字符串，测试断言会从 `"Reasoning"` 变成随 locale 漂移的脆弱值。

因此：**逻辑层返回语义 key 与结构化数据，组件层负责翻译。**

- `formatAgentActivityEntryTitle` 返回 `"reasoning" | "agentTask" | "activity"` 之类的判别式，而非人类可读串。
- 折叠组的 `"N updates - preview"` 拆成 `{ count, preview }`，由组件拼装。
- `deriveAgentActivityTimelineState` 内部写入 `label` / `toolTitle` 的 `"Reasoning trace"` 同理改为 key；注意 `isReasoningUpdateWorkEntry` 依赖 `label`/`toolTitle` 的**英文文本匹配**（`agentActivity.logic.ts:27-33`），改 key 时必须同步调整该判定，否则会静默失配。

新增 / 启用的文案键（`en` 与 `zh-CN` 同步）：

- `chat.activity.updates(count)`
- `chat.activity.titles.reasoning` / `.agentTask` / `.activity` / `.reasoningTrace`
- `chat.activity.subagent.*`（模型、角色、状态、effort、后台、打开完整会话、无可用会话等）
- `chat.work.files(count)`
- 接上已存在但未使用的 `chat.work.edited`

## 6. 验收标准

1. 点击子代理任务行 → 详情页显示该子代理的模型、角色/昵称、状态、effort（字段缺失时不显示空行）。
2. 有 `resolvedThreadId` 的子代理，详情页可展开查看其对话；展开前不建立订阅。
3. 「打开完整会话」按钮切到该子线程；无 `resolvedThreadId` 时按钮禁用并说明原因。
4. 设置 → 模型页可为每个供应商配默认模型；新会话在无 draft/thread/project 记忆时采用该模型。
5. 已隐藏的模型不出现在默认模型候选中。
6. 切换语言为中文后，§2.3 表中所有位置均显示中文。
7. 所有开合区使用共享 disclosure 动效（220ms `ease-out` + `motion-reduce` 回退）。

## 7. 测试

- `agentActivity.logic.test.ts` —— 断言由字符串改为 key；新增折叠组返回 `{count, preview}` 结构的用例；补 `isReasoningUpdateWorkEntry` 在 key 化后仍能正确识别的回归用例。
- 新增 `defaultModelByProvider` 解析优先级单测（draft > thread > project > 用户默认 > `getDefaultModel`），置于 `composerDraftStore.models.test.ts` 邻近。
- 新增 `SubagentDetailSections` 渲染测试：有/无 `resolvedThreadId`、有/无 `model`、多子代理三类分支。
- 懒加载断言：未展开时 `retainThreadDetailSubscription` 零调用。

### 文案扫描注意

硬编码文案扫描器**只看 JSX，对象字面量与函数返回值里的文案扫不到**。`agentActivity.logic.ts` 的返回值属于后者，扫描归零不等于译完，必须人工核对 §2.3 表逐条落实。

## 8. 验证基线

依 `AGENTS.md`：

- 用 `bun run test`，**绝不**用 `bun test`。
- `bun fmt` / `bun lint` / `bun typecheck` 合并为任务末尾一次性验证，不在迭代中反复跑。
- 注意：Windows 上 `bun fmt` 会重写全仓库行尾，判断真实改动须用 `git diff --numstat`。

聚焦命令：

- `cd apps/web && bun run test src/components/chat/agentActivity.logic.test.ts src/composerDraftStore.models.test.ts`
