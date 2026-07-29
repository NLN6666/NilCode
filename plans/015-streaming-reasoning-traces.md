# 015 · 思考链实时流式显示（Claude + Codex）

- 状态：TODO —— 设计已定，实施计划待编
- 创建：2026-07-29T03:11:02Z
- 范围：`apps/server`（事件摄取与投影，主体）、`apps/web`（流式思考区渲染）
- 不在范围：Antigravity 及其余 6 个供应商（Antigravity 现有 `reasoning_text` 路径保持不动）；`packages/contracts` 无需改动

## 1. 目标

让 Claude 与 Codex 的思考链在生成过程中**实时可见**，而不是等整个轮次结束才一次性出现。

## 2. 现状（实施前必读）

### 2.1 这不是疏漏，是刻意的性能决策

`apps/server/src/orchestration/providerRuntimeActivityProjection.ts:476-479` 的注释明确写着：

> Codex and Antigravity only render completed reasoning items with a readable summary. Empty starts/completions are private/encrypted reasoning boundaries, not transcript rows. **Waiting for the authoritative completion also avoids per-token activity writes and transcript height churn.**

本计划**主动推翻这条护栏**。这是可以的——护栏挡的是「每 token 一次写库」和「transcript 高度抖动」，不是「流式体验」本身，两者可以通过节流 + 前端定高兼得。但实施时必须正面回答它挡的那两个问题（见 §4、§6），否则就是把前人踩过的坑重踩一遍。

**实施要求**：改动落地时必须同步改写这段注释。留着旧文字会误导后来者，因为「waiting for the authoritative completion」在改动后不再成立。

### 2.2 两条缺口性质不同

| 供应商 | 现状                                                                                                                                                                                                        | 缺口                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Codex  | 链路完整：`reasoning_summary_text` 增量攒进 `bufferedReasoningSummaryByKey`（`ProviderRuntimeIngestion.ts:1018`），轮次终止时由 `settleBufferedReasoningSummaries`（:1055）一次性合成 `item.completed` 下发 | **只是攒到最后才发**                             |
| Claude | `ClaudeAdapter.ts:1260` 把 thinking 增量映射为 `reasoning_text` 流，但 ingestion 中只有 antigravity 消费 `reasoning_text`（:2034）                                                                          | **整条丢弃**——既不实时，最终内容也不落库、不显示 |

即：Claude 侧要同时补「实时」与「终稿持久化」两件事。

### 2.3 三条硬事实

1. **活动是事件溯源、要落库的。** `dispatchActivityUpdate`（`ProviderRuntimeIngestion.ts:798`）唯一出口是 `thread.activity.append`，每次调用都是一条持久化命令。**不存在**旁路的瞬态推送通道。
2. **客户端已能合并同 id 增量。** 活动 id 稳定为 `provider-reasoning:${threadId}:${itemId}`，web 侧 `mergeWorkLogEntry`（`apps/web/src/workLog.ts:1022-1051`）按 id 合并。反复 append 同一 id、detail 越来越长，客户端天然接得住——**成本全在服务端写库与 WS 流量**。
3. **`liveActivity` 帮不上忙。** 它是客户端从同一份持久化 payload 派生的（`apps/web/src/workLog.ts:562`），不是独立实时通道。

## 3. 已确定的决策

| 决策点          | 结论                                                              | 理由                                                                          |
| --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 传输方案        | **节流的持久化增量**：沿用 `thread.activity.append`               | 零新增架构；刷新页面思考内容不丢（已落库）                                    |
| 推送内容        | **到目前为止的全文**，非增量片段                                  | 全文语义幂等，乱序/重发都不出错，与客户端按 id 合并天然契合                   |
| 节流策略        | 时间窗 **250ms** **且** 新增字符达下限，两条件同时满足才推        | 单看时间会在慢模型下推出几个字的空更新；单看字符会在快慢模型间失衡            |
| Claude 接入方式 | 并入 Codex 已有的 `bufferedReasoningSummaryByKey`                 | 一处改动同时解决「实时」与「终稿落库」两个缺口                                |
| 前端占位        | **固定高度思考区 + 内部滚动**，完成后收起为摘要行                 | 在正确的层（前端布局）解决 height churn，而非靠「不发数据」规避               |
| 去重            | 复用 `dispatchActivityUpdate` 已有的 fingerprint 去重（:803-810） | 内容未变的推送自动丢弃，节流器不必自己判重                                    |
| 覆盖范围        | 仅 Claude + Codex                                                 | Claude 缺口最大（完全不可见），Codex 次之；其余供应商事件形状需逐个验证，另议 |

### 被否决的方案

| 方案                                                 | 否决理由                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 瞬态推送通道 + 仅终稿落库                            | 真正 per-token 流式且不放大写入，但引入与事件溯源并行的**第二条数据通路**——架构分叉的长期维护成本高于它省下的写入；且刷新页面会丢失进行中的思考，断线重连一致性需另行设计 |
| 只把 Claude 补齐到 Codex 现状（turn 结束一次性显示） | 改动最小、不碰护栏，但不满足「实时」这一核心需求                                                                                                                          |
| 固定字符阈值节流（不看时间）                         | 实现最简，但慢模型下长时间不更新、快模型下推送过密                                                                                                                        |
| 段落/换行边界节流                                    | 写入最少，但长段落时停顿明显，观感不连贯                                                                                                                                  |
| 思考区自然增长不限高                                 | 信息最完整，但持续推动下方内容——正是 §2.1 护栏警告的 height churn                                                                                                         |

## 4. 架构

```
ClaudeAdapter  ──reasoning_text──┐
                                 ├─→ bufferedReasoningSummaryByKey
CodexAdapter ──reasoning_summary_text──┘         │
                                                 ├─ 节流出口（新增）：≥250ms 且新增字符达下限
                                                 │     → 合成 item.updated → dispatchActivityUpdate
                                                 │        （status: inProgress，同一活动 id）
                                                 │
                                                 └─ settleBufferedReasoningSummaries（既有，不变）
                                                       → item.completed（status: completed，权威终稿）
                                                            │
providerRuntimeActivityProjection ←──────────────────────────┘
  └─ 放宽：接受 item.updated；provider 白名单加 claudeAgent
       │
apps/web
  └─ reasoning work entry：inProgress → 固定高度流式区；completed → 收起为摘要行
```

### 4.1 服务端改动点

1. **`reasoningSummaryBufferKey`**（`ProviderRuntimeIngestion.ts:276`）：provider 白名单加 `claudeAgent`，接住其 `reasoning_text` 流。
2. **`appendBufferedReasoningSummary`**（:1018）：增加节流判定与推送出口。
3. **节流状态**：per-item 存放，随轮次终止清理。参照已有的 `clearActivityUpdateFingerprints`（:828）。**跨 turn 状态泄漏是这类节流器最典型的 bug**，必须有对应测试。
4. **`providerRuntimeActivityProjection.ts:476-505`**：条件由 `item.completed` 放宽为同时接受 `item.updated`（产出 `status: "inProgress"` 的同 id 活动）；provider 白名单加 `claudeAgent`；改写 §2.1 引用的注释。
5. **`MAX_BUFFERED_REASONING_SUMMARY_CHARS` 上限不变** —— 流式化不放宽任何既有内存上限。

### 4.2 前端改动点

reasoning work entry 在 `status === "inProgress"` 时渲染固定高度容器，内容内部滚动并自动贴底；完成后收起为现有摘要行（`Reasoning trace` + 最后一行预览），完整内容仍可展开。

可复用计划 014 的产物：思考内容的 Markdown 展开区与 014 的 subagent 对话预览用的是同一套 `DisclosureRegion`（遵守 `CLAUDE.md` 的统一开合动效规范）。

## 5. 实施前须核实（不得当作依据）

以下均为**未验证的假设**，实施第一步必须逐条核实：

| 待核实                                                   | 不成立的后果                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Claude reasoning 事件是否带稳定 `itemId`                 | `reasoningSummaryBufferKey` 在 `!event.itemId` 时直接返回 `null`（:278），整条路不通，需另设键策略 |
| Claude 是否有 `summaryIndex` 概念                        | 现有缓冲按 `summaryIndex` 分片（:1024）；Claude 若无则需退化为单片处理                             |
| Codex 的 `item.updated` 是否已被 projection 其他分支占用 | 新分支可能与既有行为打架                                                                           |

## 6. 验收标准

1. Claude 会话中思考链可见，且在生成过程中持续更新（此前完全不可见）。
2. Codex 会话中思考链在轮次进行中即可见，不再等到轮次结束。
3. 流式期间 transcript 高度恒定，下方内容不被推动。
4. 轮次结束后思考内容收起为摘要行，完整内容可展开；刷新页面后内容仍在。
5. 一段 N 字符的思考，其活动 dispatch 次数有明确上界（个位数量级），**绝不出现 per-token 写入**。
6. 轮次结束后节流状态被清理，不跨 turn 泄漏。

## 7. 测试

- 节流器单测：250ms 窗内多次 append 只推一次；字符下限生效；跨 turn 状态清理。
- Claude reasoning 从 `content.delta` 到活动的端到端投影测试。
- 终稿覆盖流式中间态：同一活动 id，最后一条为 `completed`。
- 写入放大回归：给定长度的思考文本，断言 dispatch 次数上界。
- 前端：`inProgress` 渲染定高流式区、`completed` 收起为摘要行两个分支。

## 8. 验证基线

依 `AGENTS.md`：

- 用 `bun run test`，**绝不**用 `bun test`。
- `bun fmt` / `bun lint` / `bun typecheck` 合并为任务末尾一次性验证，不在迭代中反复跑。
- 注意：Windows 上 `bun fmt` 会重写全仓库行尾，判断真实改动须用 `git diff --numstat`。

聚焦命令：

- `cd apps/server && bun run test src/orchestration/Layers/ProviderRuntimeIngestion.test.ts src/orchestration/projector.test.ts`
