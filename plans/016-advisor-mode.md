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
| 评估节奏 | 持续会话；**在 turn 边界**喂入自上次评估以来的 delta（见 §5.2） |
| 发言方式 | **按严重度分级投递**，全自动、不需用户逐条确认（见 §6） |
| 工具权限 | **无**。不读文件、不执行命令、不写入。只看推给它的事件流 |
| 配置粒度 | 全局默认（provider + model + 开关），每个线程可覆盖 |
| 架构 | 独立 `AdvisorReactor`，订阅 `OrchestrationThreadActivity` 投影 |
| 供应商范围 | 仅 Codex 与 Claude |
| 参考实现 | [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 的 advisor（README 已致谢） |

### 2.0 与参考实现的关系

守卫层全盘对齐 OMP 的 advisor。它比本设计初稿多解决了三个问题，我们直接采用而不是重新发明：

1. **严重度分级**（§6.1）。初稿只有「打断/不打断」二选一，而绝大多数建议不值得打断。
2. **打断免疫期**（§6.2）替代墙钟冷却。真正该计量的是主模型的进展，不是时间——慢轮次里 20 秒毫无意义，快轮次里又卡太久。
3. **不安全输出隔离**（§7.1）。初稿完全没有安全维度，而 advisor 本身就是一条 prompt injection 链路。

仓库根残留的 `WATCHDOG.yml` 就是 OMP 的 advisor 配置文件，不是 Synara 的东西。

### 2.1 为什么 advisor 没有工具权限

初版设计曾考虑给 advisor 完整工具集（`WATCHDOG.yml` 里给 advisor 配了 `read`/`bash`/`edit`/`write` 全套）。**已否决**。

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
packages/contracts/src/advisor.ts               # 设置、严重度、投递通道、输出 schema  ✅

apps/server/src/advisor/                        # 六个纯函数模块，全部已实现 ✅
  advisorEventDigest.ts                         # activity → 单行摘要；噪音过滤 + 自激掐断
  advisorDeltaBuffer.ts                         # 两次评估之间累积摘要行，带上限与截断披露
  advisorEmissionGuard.ts                       # 能不能说：规范化/空话过滤/去重/升级
  advisorDelivery.ts                            # 怎么送达：通道决策 + 打断免疫期
  advisorQuarantine.ts                          # 该不该丢：不安全输出隔离
  advisorPipeline.ts                            # 把以上编排成 reactor 需要的两个状态转移
  AdvisorSession.ts                             # 每个受监察线程一个 advisor 影子会话 ⬜
apps/server/src/orchestration/Layers/
  AdvisorReactor.ts                             # 订阅 activity，驱动上述模块       ⬜

apps/web/src/components/settings/               # 全局默认：provider + model + 开关  ⬜
apps/web/  (线程 header)                         # 线程级开关与模型覆盖              ⬜
apps/web/  (transcript)                          # advisor.advice 活动的渲染         ⬜
```

设计要点：**四个纯函数模块承担全部决策逻辑**，各自回答一个问题（值不值得看 / 能不能说 / 怎么送达 / 该不该丢）。`AdvisorSession` 只管会话生命周期，`AdvisorReactor` 只管接线。绝大部分行为因此可以脱离 provider 直接单测——目前 66 个测试全部无需启动任何 provider。

## 5. 数据流

```
主模型 turn 运行
  → provider 事件
  → providerRuntimeActivityProjection
  → thread.activity.append
  → AdvisorReactor 订阅到 activity
  → digestActivity：噪音丢弃、自激丢弃、压成 ≤200 字符的一行
  → appendAdvisorDeltaLine：累积进 delta 缓冲（不评估）
  ⋯ turn 边界到达 ⋯
  → takeAdvisorDelta：取出 delta 并清空；delta 为空则完全不调用 advisor
  → 喂入 advisor 会话，请求一次评估
  → advisor 输出「沉默」或「带严重度的建议」
  → isAdvisorOutputUnsafe：不安全则整轮隔离（§7.1）
  → shouldWithholdAdvice：评估半成品时只放行 blocker
  → shouldAcceptAdvisorNote：空话过滤 / 去重 / 每次一条（§6.3）
  → resolveAdvisorDeliveryChannel：aside | steer | preserve（§6.1）
      aside    → dispatchMode "queue"，下个轮次边界并入
      steer    → dispatchMode "steer"，打断当前轮；并起 3 轮免疫期
      preserve → 不注入，仅留卡片
  → 无论走哪条，都追加一条 kind:"advisor.advice"、tone:"info" 的 activity 让用户看见
```

### 5.1 advisor 的输出契约

「沉默」必须是 advisor 的一等输出。一个每次都必须说点什么的评审者会持续制造噪音。

因此 advisor 每次评估的输出被约束为一个判别联合，而非自由文本：

```
{ verdict: "silent" }
{ verdict: "advise", severity: "nit" | "concern" | "blocker", message: <非空文本> }
```

不满足此形状的输出按 §7 的「输出不符合 schema」处理——丢弃并计一次失败，**不做兜底解析**。放宽解析等于允许 advisor 用自由文本绕过全部防护规则。

### 5.2 触发点是 turn 边界，不是每个事件（实施中修正）

初稿设想「每条 activity 喂一行并评估一次」。**已修正为按 OMP 的模型：在 turn 边界触发一次评估**，喂入自上次评估以来累积的 delta。

理由有两条，都很硬：

1. **成本从 O(事件数) 降到 O(轮次数)。** 一个 turn 能产生上百条 activity，逐条评估会让 advisor 的开销盖过主模型本身。
2. **半个工具调用的中间态不足以判断。** turn 边界上的信息才是完整的。

`digestActivity` 因此不再是「评估的输入」，而是「构造 delta 的方式」——它仍然每条 activity 调用一次，只是结果进缓冲区而非直接触发模型。

**`workInProgress` 由此而来。** 一个 turn 可能在中途到达边界而后续仍有动作（对应 OMP 的 `willContinue`）。这种 delta 会被标记 `[in progress]`，advisor 知道自己看的是未完成的工作，`shouldWithholdAdvice` 据此只放行 `blocker`。

delta 有 200 行上限。超出时丢弃最老的行并在 delta 中显式声明 `[earlier activity omitted]`——**静默丢弃会让 advisor 以为主模型做的事比实际少**，那比承认记录不全更糟。

### 5.3 长轮次的中途评估（相对 OMP 的有意偏离）

纯按 turn 边界触发有一个问题：一个跑十分钟的长 turn，advisor 要等到全部做完才开口，这谈不上「实时旁观」。

因此 delta 累积到 `ADVISOR_INTERIM_EVALUATION_LINES`（50 行）时**提前触发一次评估**，并标记 `workInProgress: true`。配合 §6.1 的 `shouldWithholdAdvice`，这类评估里只有 `blocker` 能通过，`nit`/`concern` 直接丢弃。

于是长轮次拿到了实时性，同时 advisor 并没有因此获得对半成品挑刺的权利。这也让 `workInProgress` 在 Synara 里有了真实用途——否则它恒为 `false`，是一个从 OMP 照搬来的死参数。

### 5.4 turn 边界标记不进 delta

`turn.completed` 这条 activity 只作**边界信号**，不作为内容进入 delta。

advisor 被问的是「模型做了什么」，不是「轮次结束了」这个元事件；而 `workInProgress: false` 已经表达了「这是完整画面」。把它折进去还会让一个空转的轮次看起来有活动，进而触发一次没有意义的评估。

## 6. 防护规则

全盘对齐 OMP。贯穿全部规则的一条原则：**advisor 可以改变主模型自己选择做的事，但绝不能推翻用户选择的事。** plan 模式、用户中断、线程空闲都是用户所有的状态，落在其中的建议一律降级为卡片而非动作。

### 6.1 严重度与投递通道

`resolveAdvisorDeliveryChannel`（`advisorDelivery.ts`）按以下**顺序**判定，先命中先返回：

| 条件 | 通道 | 理由 |
|---|---|---|
| plan 模式激活 | `preserve` | plan 模式是用户在决定下一步，steer 会启动用户没批准的工作 |
| 正在中断本轮 | `preserve` | 中断是明确的停止指令，advisor 不得立刻反手再起一轮 |
| `severity === "nit"` | `aside` | 小建议永远不值得切进运行中的轮次 |
| 处于打断免疫期 | `aside` | 见 §6.2 |
| 无轮次在跑，且非 `blocker` | `preserve` | 没有可重定向的对象，steer 会凭空起一轮用户没要的活 |
| 其余 | `steer` | 打断当前轮 |

三个通道映射到 Synara 现有能力，**不新建投递机制**：`aside` → `dispatchMode: "queue"`，`steer` → `dispatchMode: "steer"`，`preserve` → 不注入、只留活动卡片。

另有 `shouldWithholdAdvice`：评估的是**进行中**的工作时，`nit` 与 `concern` 直接丢弃，只有 `blocker` 放行。对半成品提意见，多半是在说模型本来就要做的事。

### 6.2 打断免疫期取代墙钟冷却

`ADVISOR_IMMUNE_TURNS = 3`。一次 `steer` 成功送达后，接下来 3 个主轮次内的 `concern`/`blocker` 全部降级为 `aside`（`nit` 不受影响，它本来就是 aside）。

这是掐断拉扯循环的关键。初稿用的是 20 秒墙钟冷却，但**真正该计量的是主模型的进展而非时间**——慢轮次里 20 秒毫无意义，快轮次里又卡太久。免疫期让 advisor 打断之后给模型留出反应余地，而不是对着模型的反应再打断一次。

### 6.3 能不能说：emission guard

`advisorEmissionGuard.ts`，四道过滤：

| 规则 | 值 | 作用 |
|---|---|---|
| 每次评估一条 | 1 | 真正贴合设计的限流：绑定在「advisor 被问了一次」上，而非墙钟 |
| 空话过滤 | 短语表 | `stop`/`lgtm`/`nothing to add` 一类——advisor 无话可说时最常见的失败模式 |
| 去重 | 4096 条 | 规范化后已说过的不再说 |
| 升级放行 | 强制 | 同一条建议**只有严重度提升时**才能再次通过 |

规范化为 NFKC + 小写 + 非字母数字折叠为单空格 + trim，因此 `Stop.`、`*Stop*`、`  stop  ` 共用一个键——否则加个标点就能绕过去重。

### 6.4 自激掐断

`kind === "advisor.advice"` 的活动不回喂 advisor（实现在 `advisorEventDigest.ts`）。advisor 为让用户看见而追加的那条活动本身就在活动流里，回喂即成正反馈回路。

主模型**对建议作出的反应**所产生的活动必须照常喂入——那是 advisor 判断建议是否被采纳的唯一依据。回路的确切位置见 §3.4。

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

### 7.1 不安全输出隔离（安全边界）

**advisor 是一条 prompt injection 链路。** 主模型读到的不可信文本——文件内容、网页、工具结果——会以摘要行的形式进入 advisor；advisor 若把其中的指令复述进建议，它就以「建议」而非「数据」的身份抵达主模型。advisor 自己没有工具，但**它建议的那个模型拥有全部工具**。

`isAdvisorOutputUnsafe`（`advisorQuarantine.ts`）的核心是 **output-only** 判定：区分 advisor **originate（自己编造）** 的危险内容与它**复述**主模型已执行内容。没有这个区分，这道门就是无用的——advisor 将永远无法警告一条危险命令，因为说「你刚跑了 `rm -rf /`」会把自己隔离掉。

触发条件：

1. advisor 自己编造的破坏性 shell 命令 —— 单独即触发，它没有正当理由去撰写这种命令
2. 三类危险同时出现（指令覆盖 / 缄默指令 / 账户删除）—— 任一单独出现都太弱，「忽略前面的做法」是正常的工程建议
3. 指令覆盖 + 输入上下文中存在破坏性命令 —— 中继型攻击：命令不是 advisor 编的，但它在让主模型去执行来自不可信输入的命令

处置：**第一次连续隔离静默处理**（重置 advisor 并重新 prime，单次坏生成通常只是噪音）；**第二次连续隔离**才向用户告警、丢弃该批次并重置上下文以打破循环。任何一次被接受的正常输出都会清零连续计数。

## 8. 上下文增长

长期会话会无限膨胀，必须有边界。

**决策：以 turn 为边界重置 advisor 会话**，重置时把最近几轮的建议摘要作为种子带入新会话。

turn 内复用上下文（这是「持续会话」相对「每次独立评估」的省钱效果所在），跨 turn 不累积原始事件。turn 是天然的语义边界，同时也掐断了跨轮的上下文污染。

会话重置时，emission guard 与 quarantine 的状态一并清空；**打断免疫期不清**——它计的是主模型的轮次进展，与 advisor 自己的会话生命周期无关。

## 9. 测试

| 对象 | 方式 | 状态 |
|---|---|---|
| `advisorEventDigest` | 纯函数单测：截断、噪音过滤、自激掐断 | ✅ 15 |
| `advisorDeltaBuffer` | 纯函数单测：累积、上限淘汰、截断披露、空 delta | ✅ 8 |
| `advisorPipeline` | 纯函数单测：触发时机、边界语义、五道守卫的编排顺序 | ✅ 16 |
| `advisorEmissionGuard` | 纯函数单测：规范化、空话、去重、升级、每次一条 | ✅ 21 |
| `advisorDelivery` | 纯函数单测：通道决策全分支、免疫期、withhold | ✅ 16 |
| `advisorQuarantine` | 纯函数单测：三条触发规则、output-only 判定、连续计数 | ✅ 14 |
| `contracts/advisor` | 契约单测：默认值、供应商收窄、verdict 形状 | ✅ 21 |
| `advisorResponseCollector` | 纯函数单测：拼接、忽略 reasoning、终态不可重开 | ✅ 12 |
| `advisorThreadState` | 纯函数单测：打断窗口、plan 模式跨 turn | ✅ 8 |
| `AdvisorSession` | 假 ProviderService：verdict 解析、只注入一次指令、连续失败停手 | ✅ 9 |
| `AdvisorReactor` | 四个假服务：三条通道派发、自激掐断、开关生效 | ✅ 8 |

四条不变量必须有专门用例，缺一不可：

1. advisor 各类故障（起不来/崩溃/超时/输出非法）下，主 turn 正常完成
2. 自激回路被掐断——advisor 自己产生的 activity 不触发新一轮评估
3. 每次一条、去重、免疫期三条限流各自生效
4. **不安全输出被隔离**，且复述主模型已执行的危险命令不会被误隔离

## 10. 明确不做（YAGNI）

- advisor 的工具权限（理由见 §2.1）
- 多 advisor 并存
- 独立的评审历史视图——先复用 activity 流
- 非 Codex/Claude 供应商的支持（理由见 §3.2）
- OMP 的 `obfuscator`（对工具参数/结果脱敏后再给 advisor 看）与 `syncBacklog`（advisor 落后时有界阻塞主模型）——前者在 advisor 只看摘要行的前提下收益有限，后者与「advisor 永不阻塞主模型」这条不变量冲突


## 11. 落地状态（截至服务端接线完成）

服务端全部完成并已接入 `serverLayers.ts` / `effectServer.ts`，共 150 个 advisor 用例通过。
默认 `enabled: false`，未开启前对现有行为零影响。

**已完成**

- 契约：`packages/contracts/src/advisor.ts` + `ServerSettings.advisor`
- 决策层（纯函数）：digest / deltaBuffer / emissionGuard / delivery / quarantine / pipeline / threadState / responseCollector
- 协议层：`advisorProtocol.ts`（系统提示 + verdict 解析）
- 影子会话：`advisorShadowThread.ts` + `Layers/AdvisorSession.ts`；其 provider 事件在 `ProviderRuntimeIngestion` 入口被过滤，不进 journal / 投影 / 浏览器
- 反应器：`Layers/AdvisorReactor.ts`，三条通道分别派发 `thread.turn.start`（steer / queue）与 `thread.activity.append`

**未完成**

| 项 | 说明 |
|---|---|
| 线程级开关的界面入口 | 覆盖本身已打通（`thread.meta.update` 可设置、持久化、reactor 生效），缺的是把它放在哪个界面上 |

**后续补齐**

- 设置界面：`AdvisorSettingsSection`（开关 + 合并的 provider/model 选择器），挂在「模型」面板
- 线程级覆盖：`advisorEnabled`（null = 跟随全局）贯穿 contracts → decider → projector → `projection_threads.advisor_enabled`（迁移 091）→ reactor
- `advisor.advice` 渲染：时间线用眼睛图标区分「旁观意见」与「主模型做过的事」
- i18n：en / zh-CN 双语文案

**实施中相对原设计的修正**

- `turnRunning` 不单独跟踪：中途评估必然在 turn 内、边界评估必然在 turn 后，`workInProgress` 已经回答了同一个问题，再引入第二个来源只会产生分歧
- activity tone 无 `warning`，`concern` 落为 `info`，严重度改由 payload 承载
- `advisorThreadState` 只从领域事件折叠，进程启动前就处于 plan 模式的线程会被看作 default，直到它再次变更
