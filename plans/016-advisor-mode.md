# 016 · Advisor 模式（第二个模型实时监察并纠偏主模型）

- 状态：TODO —— 设计已定，实施计划待编
- 创建：2026-08-07T09:38:07Z
- 范围：`packages/contracts`（advisor 契约；既有 schema 无需改动，理由见 §3.3）、`apps/server`（advisor 会话与 reactor，主体）、`apps/web`（设置项、线程开关、transcript 呈现）
- 不在范围：Cursor、Antigravity、Grok、Droid、Kilo、OpenCode、Pi 七个供应商；advisor 的工具权限；多 advisor 并存

## 1. 目标

让用户指定第二个模型，在主模型跑任务的过程中**实时旁观**，发现跑偏时**主动注入一条建议**纠正方向。

一句话概括边界：**advisor 只说不做**。

## 2. 已确定的决策

| 维度 | 决策 |
|---|---|
| 介入时机 | 实时旁观 + 主动打断（非事后评审） |
| 评估节奏 | 持续会话，事件增量喂入，advisor 自主决定何时发声 |
| 发言方式 | 自动注入主模型，受硬性防护约束（非用户确认） |
| 工具权限 | **无**。不读文件、不执行命令、不写入。只看推给它的事件流 |
| 配置粒度 | 全局默认（provider + model + 开关），每个线程可覆盖 |
| 架构 | 独立 `AdvisorReactor`，订阅 `OrchestrationThreadActivity` 投影 |
| 供应商范围 | 仅 Codex 与 Claude |

### 2.1 为什么 advisor 没有工具权限

初版设计曾考虑给 advisor 完整工具集（参考仓库根残留的 `WATCHDOG.yml`，它给 advisor 配了 `read`/`bash`/`edit`/`write` 全套）。**已否决**。

理由：两个模型同时持有写权限、操作同一工作区，会产生文件级竞态——主模型正在编辑的文件被 advisor 改写，是极难复现和调试的一类故障，与 `CLAUDE.md` 的「可靠性优先」直接冲突。

去掉写权限后，系统里**始终只有一个写入者**。所有并发写冲突、文件锁、worktree 隔离的复杂度全部消失。advisor 的影响力只经由 steer 消息传递，执行权始终在主模型手里。

**这个取舍的代价必须讲清楚**：advisor 对「测试通过了」「文件已更新」这类断言只能采信主模型的转述，无法独立核实。它擅长发现的是**方向性和过程性问题**——绕远路、偏离原始需求、在同一个错误上反复尝试——而不是事实核查。不要指望它抓出「模型声称改好了其实没改」。

## 3. 现状（实施前必读）

### 3.1 steer 是现成的一等能力，不要新建注入通道

`packages/contracts/src/orchestration.ts:237` 已定义 `TurnDispatchMode = ["queue", "steer"]`，`decider.ts:1662-1704` 已完整处理分发与降级。Advisor 复用的是**用户手动 steer 时走的同一条路径**，其可靠性已被现有测试覆盖。

### 3.2 只有 Codex 和 Claude 能真正实时打断

`packages/shared/src/providerMetadata.ts` 的 `supportsNativeTurnSteering` 中，仅 `codex` 与 `claudeAgent` 为 `true`。

对其余七个供应商，`decider.ts:1671-1674` 的 `shouldQueue` 会命中，随后 `decider.ts:1686` 的分支把一次 steer 变成**「中断当前轮 + 排队消息 + 重新起轮」**（发出 `thread.turn-queued` 与 `thread.turn-interrupt-requested` 两个事件）。

这与 advisor 想要的「在不打断的前提下轻推一下」语义**完全不同**：它会强行终止主模型正在进行的工作。因此 advisor 只对 Codex 和 Claude 开放。**这不是暂缓实现，是刻意的能力边界**——在其余供应商上开放会得到一个具有破坏性的功能。

**实施要求**：线程级 advisor 开关在非 Codex/Claude 线程上必须**不可用且给出原因**，不能静默失效。

### 3.3 不需要扩展任何 `Schema.Literals`（实施中修正）

设计初稿要求扩展 `MessageDispatchOrigin` 与 `OrchestrationThreadActivityTone` 两个 literal union，并走 `wsCompatibility.ts` 的兼容策略。**实施时确认这一整块都不需要。**

向 `Schema.Literals` 增加取值向后兼容但**向前不兼容**——旧版本客户端读到新值会解码失败。避开它的办法是使用已有的自由字符串字段：

| 需求 | 原方案 | 实际方案 |
|---|---|---|
| 标记 advisor 发言 | 扩展 `tone` literal | `kind: "advisor.advice"` + `tone: "info"` |
| 自激掐断依据 | 扩展 `MessageDispatchOrigin` | 按 activity `kind` 判定 |

`OrchestrationThreadActivity.kind`（`orchestration.ts:607`）是 `TrimmedNonEmptyString`，现有取值形如 `task.progress`、`turn.steered`、`runtime.error`。**新增取值零兼容成本。**

### 3.4 steer 自身不产生 activity，自激点在别处

`providerRuntimeActivityProjection.ts:876-883`：`turn.steered` 事件在 `target === "turn"` 时直接 `return []`——理由是 steer 自己的轮次已经以用户消息气泡的形式可见，再加一行活动只是重复。

因此「advisor steer → activity → 回喂 advisor」这条直接回路**不存在**。

真正会形成回路的是 §5 中 advisor 为了让用户看见而追加的那条 `advisor.advice` 活动。自激掐断针对的是它，判定依据即 §3.3 的 activity kind。

主模型**对建议作出的反应**所产生的活动则必须照常喂给 advisor——那是 advisor 判断建议是否被采纳的唯一依据。

### 3.4 事件摘要不要自己造，投影层已经做好了

`providerRuntimeActivityProjection.ts:12-16` 定义了 16,000 字符 JSON 上限、2,000 字符字符串上限、24 项数组上限、64 键对象上限，并有 `jsonSafeValue` 保证 payload 可序列化。Advisor 消费的是这一层的产物，**天然受控**。绕过它去接原始 `ProviderRuntimeEvent` 意味着重写这套截断逻辑，并把九个供应商的事件差异全部引入 advisor——已否决。

## 4. 组件划分

```
packages/contracts/src/advisor.ts               # AdvisorSettings、线程级覆盖、advisor 输出 schema

apps/server/src/advisor/
  advisorEventDigest.ts                         # activity → advisor 输入摘要（纯函数）
  advisorGuards.ts                              # 冷却/限次/去重/自激判定（纯函数）
  AdvisorSession.ts                             # 每个受监察线程一个 advisor provider 会话
apps/server/src/orchestration/Layers/
  AdvisorReactor.ts                             # 订阅 activity，驱动上述三者

apps/web/src/components/settings/               # 全局默认：provider + model + 开关
apps/web/  (线程 header)                         # 线程级开关与模型覆盖
apps/web/  (transcript)                          # advisor tone 的渲染
```

设计要点：**两个纯函数模块承担全部决策逻辑**。`AdvisorSession` 只管会话生命周期，`AdvisorReactor` 只管接线。绝大部分行为因此可以脱离 provider 直接单测。

## 5. 数据流

```
主模型 turn 运行
  → provider 事件
  → providerRuntimeActivityProjection
  → thread.activity.append
  → AdvisorReactor 订阅到 activity
  → advisorGuards 判定：kind 为 "advisor.advice" 的活动直接丢弃（自激掐断）
  → advisorEventDigest 压成紧凑摘要，增量喂入 advisor 会话
  → advisor 输出「沉默」或「建议」
  → advisorGuards 判定：冷却 / 每轮上限 / 去重
  → 通过则以 dispatchMode:"steer" 注入主线程
  → 同时追加一条 kind:"advisor.advice"、tone:"info" 的 activity，让用户看见
```

### 5.1 advisor 的输出契约

「沉默」必须是 advisor 的一等输出。一个每次都必须说点什么的评审者会持续制造噪音并浪费 steer 配额。

因此 advisor 每次评估的输出被约束为一个判别联合，而非自由文本：

```
{ verdict: "silent" }
{ verdict: "advise", message: <非空文本> }
```

不满足此形状的输出按 §7 的「输出不符合 schema」处理——丢弃并计一次失败，**不做兜底解析**。放宽解析等于允许 advisor 用自由文本绕过防护规则。

## 6. 防护规则

自动注入的前提是这几条规则全部生效。具体数值应可配置，下表给出默认值。

| 规则 | 默认值 | 作用 |
|---|---|---|
| 冷却间隔 | 20 秒 | 两次发言的最小间隔，防刷屏 |
| 每轮上限 | 3 条 | 单个 turn 内的建议条数上限 |
| 文本去重 | 最近 5 条 | 规范化后与近期建议重复的丢弃 |
| **自激掐断** | 强制 | `kind === "advisor.advice"` 的活动不回喂 advisor |
| turn 边界 | 强制 | 仅在 turn 运行中发言，turn 结束即静默 |

**自激掐断是这里最容易被漏掉的一条。** advisor 为了让用户看见而追加的那条活动本身就在活动流里；若回喂 advisor 就形成正反馈回路——advisor 看到自己的话，再评论一次，无限循环。按 activity kind 判定让这条规则有结构化依据，而不是靠文本匹配或时间窗去猜（回路的确切位置见 §3.4）。

### 6.1 两个常量的关系决定了去重记忆只能跨轮累积

`ADVISOR_DEDUPE_WINDOW`（5）**大于** `ADVISOR_MAX_ADVICE_PER_TURN`（3）。因此单个 turn 内不可能填满去重窗口——窗口只有跨 turn 才会被填满，这也正是去重记忆必须在 turn 重置中存活的原因。

调整这两个默认值时必须一并考虑该关系。若把窗口调到小于等于每轮上限，去重就退化成了「只在本轮内生效」。

## 7. 错误处理

**硬性不变量：advisor 的任何故障都不得影响主模型。**

| 故障 | 处理 |
|---|---|
| advisor 会话起不来 | 降级为静默，UI 标注不可用，指数退避重启（非重试风暴） |
| advisor 会话崩溃 | 同上 |
| 输出不符合 schema | 丢弃该次输出并计一次失败 |
| 连续失败 3 次 | 自动禁用该线程 advisor，UI 标注 |
| advisor 响应超时 | 丢弃该次评估，不排队堆积 |
| turn 已结束但 advisor 仍在思考 | 丢弃结果——过期建议没有价值 |

任何一种情况下主 turn 都照常跑完。advisor 永不进入主模型的关键路径。

## 8. 上下文增长

长期会话会无限膨胀，必须有边界。

**决策：以 turn 为边界重置 advisor 会话**，重置时把最近几轮的建议摘要作为种子带入新会话。

turn 内复用上下文（这是「持续会话」相对「每次独立评估」的省钱效果所在），跨 turn 不累积原始事件。turn 是天然的语义边界，同时也掐断了跨轮的上下文污染。

## 9. 测试

| 对象 | 方式 |
|---|---|
| `advisorEventDigest` | 纯函数单测，覆盖截断与格式分支 |
| `advisorGuards` | 纯函数单测，覆盖全部规则分支 |
| `AdvisorReactor` | 用 `apps/server/src/orchestration/testing/` 现有工具做集成测试 |

三条不变量必须有专门用例，缺一不可：

1. advisor 各类故障（起不来/崩溃/超时/输出非法）下，主 turn 正常完成
2. 自激回路被掐断——advisor 自己产生的 activity 不触发新一轮评估
3. 冷却、每轮上限、去重三条限流规则各自生效

## 10. 明确不做（YAGNI）

- advisor 的工具权限（理由见 §2.1）
- 多 advisor 并存
- 建议的严重度分级与分级处理
- 独立的评审历史视图——先复用 activity 流
- 非 Codex/Claude 供应商的支持（理由见 §3.2）
