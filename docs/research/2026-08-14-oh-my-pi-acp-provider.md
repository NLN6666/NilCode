# Oh My Pi（OMP）ACP Provider 调研

日期：2026-08-14

范围：只读技术调研；不包含实现

Synara 基线：`dev` / `2e319585893856b6b1c7c892c8c0a45748b0bb89`

OMP 基线：`17.3.3` / `ad318c7572abaeebd5cf8a7a16d350ff1d32a738`

ACP 规范基线：stable v1 / `e446783993e5d3df5c88c629d0794a7755a74768`

ACP TypeScript SDK：Synara 当前 `1.2.1`；上游当前 `1.3.0` / `01010146a731212fbbb677d6055e0b7bf183b288`

## 结论

接入 **可行，而且 Synara 已经具备最难的底座**：现有 `AcpSessionRuntime` 已拥有 ACP 子进程、初始化与认证、new/load/resume、prompt/cancel、权限、文件、终端、MCP、事件背压、Windows 安全启动和进程树回收。

但“支持 OMP provider”与“拥有 OMP 全部功能”是两档目标：

1. **行为可用**：用 `omp acp --config <overlay>` 启动，OMP 的 Launch、Advisor、Auto-Learn、Memory 可以在 OMP 进程内运行；标准 ACP 能承载普通文本、工具、权限和终端事件。
2. **产品级保真**：标准 ACP v1 没有 Launch/Advisor/Auto-Learn/Memory 的专属 capability、状态或控制方法。若要让 Synara 正确显示状态、配置开关、恢复生命周期并避免与自身同类功能打架，需要 OMP `_omp/*` 扩展方法/事件，或推动 OMP 上游补充扩展。

因此不能把“工具能执行、聊天里能看到一些输出”描述成“OMP 全功能已原生支持”。推荐目标是：**ACP 标准核心 + OMP typed extensions + 明确的宿主能力仲裁**。

## 一手资料快照

- OMP 官方 README：安装、Windows 原生支持、工具面、Memory 与 ACP 定位。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/README.md>
- OMP ACP agent：初始化、会话、mode/model/thinking、扩展方法。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/packages/coding-agent/src/modes/acp/acp-agent.ts>
- OMP ACP client bridge：文件、终端、权限路由与 `deferAgentInitiatedTurns`。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/packages/coding-agent/src/modes/acp/acp-client-bridge.ts>
- OMP ACP event mapper：标准 assistant/tool/plan update 投影。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/packages/coding-agent/src/modes/acp/acp-event-mapper.ts>
- OMP settings：配置层、Advisor、Memory、Auto-Learn、Launch。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/docs/settings.md>
- OMP Advisor/WATCHDOG：触发、工具隔离、ACP 延迟 turn 行为、持久化。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/docs/advisor-watchdog.md>
- OMP Memory：local pipeline 与持久化语义。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/docs/memory.md>
- OMP ACP 审批：ACP 配置优先级与按进程隔离。<https://github.com/can1357/oh-my-pi/blob/ad318c7572abaeebd5cf8a7a16d350ff1d32a738/docs/approval-mode.md#ACP-sessions>
- OMP `16.1.12` release：修复 RPC/ACP 覆盖显式 `memory.*` / `advisor.*` 配置。<https://github.com/can1357/oh-my-pi/releases/tag/v16.1.12>
- ACP v1 官方概览：初始化、会话、流式 update、权限、文件、终端、扩展约定。<https://agentclientprotocol.com/protocol/v1/overview>
- ACP 官方仓库：stable protocol version 为 1；wire compatibility 以 `initialize.protocolVersion` 与 capabilities 为准。<https://github.com/agentclientprotocol/agent-client-protocol/tree/e446783993e5d3df5c88c629d0794a7755a74768>
- ACP 官方 TypeScript SDK：稳定入口仍为 v1，v2 是 experimental draft。<https://github.com/agentclientprotocol/typescript-sdk/tree/01010146a731212fbbb677d6055e0b7bf183b288>

## Synara 当前条件

### 已具备

- Provider 是统一 adapter 契约，核心生命周期、权限响应、discovery、event stream 已抽象在 `ProviderAdapterShape`。
- `AcpSessionRuntime` 已封装一个经过认证的 ACP 进程及会话，提供：
  - `initialize` / `authenticate`
  - `session/new` / `session/load` / `session/resume`
  - `session/prompt` / `session/cancel`
  - `session/set_config_option`
  - `session/request_permission`
  - `fs/read_text_file` / `fs/write_text_file`
  - terminal create/output/wait/kill/release
  - elicitation、MCP、任意 extension request/notification
- runtime 已有 8 MiB incoming frame guard、64/256/2048 级有界队列、启动分步超时、resume/load 不错误降级为 new、Windows 命令准备与进程树证明式清理。
- Synara 已有自己的 Advisor；服务端已经接线，且 UI 有线程级覆盖。
- Synara 已有从 OMP 设计移植并增强的 daemon/`@Launch` 子系统，支持命名、就绪探针、日志、输入、重启、detached/reclaim 与 Services UI。

关键本地证据：

- Provider 闭集与 model/start options：`packages/contracts/src/orchestration.ts:75`、`:159`、`:166`、`:218`、`:223`
- Discovery 闭集：`packages/contracts/src/providerDiscovery.ts:10`
- Adapter 契约：`apps/server/src/provider/Services/ProviderAdapter.ts:69`、`:98`、`:242`
- ACP runtime：`apps/server/src/provider/acp/AcpSessionRuntime.ts:1`、`:204`、`:261`、`:483`、`:724`、`:785`、`:1070`、`:1119`
- Registry 与 Layer 接线：`apps/server/src/provider/Layers/ProviderAdapterRegistry.ts:32`、`apps/server/src/provider/runtimeLayer.ts:27`
- Synara Advisor 接线：`apps/server/src/serverLayers.ts:146`
- Synara `@Launch` 与 daemon 语义：`apps/server/src/provider/launchPromptInjection.ts:1`
- 既有设计边界：`plans/016-advisor-mode.md`、`docs/superpowers/specs/2026-08-07-agent-background-server-sessions-design.md`

### 缺口

- `ProviderKind`、`ProviderDiscoveryKind`、`ModelSelection`、`ProviderStartOptions` 都是闭集，目前无 `omp`。
- Registry/runtime layer 无 OMP adapter。
- OMP 的 ACP `initialize` 只广告标准会话/MCP/prompt 能力；其 session config options 只包括 `mode`、`model`、`thinking`。
- OMP 当前 `_omp/*` 扩展覆盖 session/project/usage/extensions 等，但没有已确认的 Advisor、Memory、Auto-Learn、Launch 状态 API。
- Synara 现有 canonical provider capabilities 只描述模型切换、skills/plugins/commands、turn steering、live diff，无法表达这四项 OMP 特性。

## ACP 能力适配

| 能力              | 标准 ACP v1                     | OMP 当前实现                                                     | Synara 现状                                                        | 判断                                  |
| ----------------- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| 启动/认证         | `initialize`、`authenticate`    | `agent` 本地凭据；客户端支持 terminal auth 时额外广告 `terminal` | runtime 已支持 auth resolver                                       | 直接可做                              |
| 会话              | new/load/list/resume/fork/close | 全部广告并实现                                                   | runtime 已支持 new/load/resume/fork；adapter 需补 read/import 语义 | 直接可做                              |
| Prompt/Cancel     | 标准                            | 已实现；取消清理有 5s 上限                                       | 已支持                                                             | 直接可做                              |
| 模型/思考/模式    | session config/mode             | 只暴露 `mode`、`model`、`thinking`                               | 已有 generic config option support                                 | 直接可做                              |
| 文件/终端         | client capabilities             | OMP 按 initialize capability 路由                                | runtime 已有 handler surface                                       | 需接到 Synara workspace/terminal 策略 |
| 权限              | `session/request_permission`    | 总是可请求，是否发请求由 OMP policy 决定                         | 已有 canonical decision mapping                                    | 需完整矩阵验证                        |
| MCP               | session MCP servers             | stdio/http/sse；initialize 广告 http/sse                         | Synara 已有 agent gateway MCP builder 模式                         | 直接可做                              |
| 高级 OMP 功能状态 | 无专属标准                      | 无已确认 typed capability/event                                  | 无 OMP 投影                                                        | 需要扩展                              |

ACP 允许 `_` 前缀的私有方法，并允许 `_meta` 携带扩展数据。Synara runtime 已有任意 `request()` / `notify()` 与 extension handler，这正是高保真层应该使用的扩展点，不必另造第二套 transport。

## 四项重点能力

### 1. Launch

OMP 事实：

- `launch.enabled` 默认 `true`，用于监管共享的长时间运行项目进程。
- 在 ACP 下，Launch 至少会以普通 tool call/update 被看见；OMP ACP event mapper 没有 Launch 专属 update。

与 Synara 的冲突：

- Synara 已有更宿主化的 daemon broker、八个 `synara_*_daemon` 工具、`@Launch`、`.nilcode/launch.json` 与 Services UI。
- 让 OMP native Launch 与 Synara daemon 同时拥有同一项目的进程，会形成两个互不知情的 registry：UI 状态、停止语义、重启认领和日志游标可能分叉。

建议：

- POC 保留 OMP native Launch，确认 ACP tool updates、Windows 子进程树与 OMP session 关闭行为。
- 正式产品必须提供明确的“进程所有者”策略：
  - `omp-native`：保留 OMP Launch；Synara 只显示 generic tool activity，暂不把 Services UI 当权威。
  - `synara-managed`（推荐默认）：通过 Synara agent gateway MCP 使用 daemon 工具，并禁用 OMP native Launch，保留 Synara 的可见性与恢复保证。
- 若“所有 OMP 功能”要求 OMP-native 且也要求 Services UI 保真，则需 `_omp/launch/list|describe|logs|send|stop|restart` 及 launch lifecycle notification；当前上游没有已确认接口。

### 2. Advisor

OMP 事实：

- Advisor 是独立 model/context/ToolSession；默认工具是 `read`/`grep`/`glob`/`advise`，`WATCHDOG.yml` 可以授予写和执行工具。
- 每个 primary turn 后审阅；`nit`/`concern`/`blocker` 会以不同投递策略回到主会话。
- ACP bridge 设置 `deferAgentInitiatedTurns: true`：idle 时不能由 ACP host 表示的自动续轮会保存为可见卡片；live turn 仍可 steer。
- `advisor.enabled` 与 `modelRoles.advisor` 必须同时有效。OMP `16.1.12+` 会尊重显式 global/project/`--config` 设置。

与 Synara 的冲突：

- Synara 已有自己的 Advisor reactor。对 OMP thread 同时启用两套 Advisor 会重复审查、重复花费、互相 steer，甚至形成难以解释的建议来源。
- 标准 ACP update 没有 advisor id、severity、backlog、status、usage 的 typed envelope。仅凭 `<advisory>` 文本或普通 message 无法稳定驱动 Synara 的 Advisor UI。

建议：

- OMP provider 的 Advisor 模式做互斥：`off | omp | synara`，默认 `omp` 才符合“使用 OMP 全功能”的目标。
- 第一阶段把 OMP advisory 当 provider transcript 内容保真保存，不做脆弱的 XML 字符串解析来伪造 typed state。
- 高保真阶段增加 `_omp/advisor/status`、`_omp/advisor/set`、`_omp/advisor/note` notification；至少包含 advisor id/name、severity、delivery、model、usage、backlog、failure。
- Advisor 有写工具时必须独立显示风险，不得沿用 Synara Advisor“只说不做”的安全文案。

### 3. Auto-Learn

OMP 事实：

- 实验性、默认关闭。
- 开启后提供 `manage_skill`；memory backend 激活时提供 `learn`。
- `autolearn.autoContinue` 默认关闭；打开后在 agent stop 自动运行一次私有 capture turn，会额外消耗 token。
- managed skills 写入 OMP agent dir 下的 `managed-skills`。

ACP 缺口：

- OMP 没有广告 Auto-Learn capability，也没有专属 ACP update/config option。
- 标准 ACP 不能告诉 Synara“主 turn 已结束，但私有 capture/drain 尚未完成”，容易在 stop/restart 时出现丢写或 UI 假 idle。

建议：

- 仅通过显式 `--config` 开启；UI 标记 experimental 与额外 token/磁盘写入。
- 必须验证 prompt settle、agent_end、capture turn、session close 四个边界的真实顺序。
- 正式支持需要 `_omp/autolearn/status` 和 `_omp/autolearn/drain`，让 Synara 在关闭 ACP process 前等待有界落盘；超时不得卡住主会话停止。
- Managed skill discovery 应复用 Synara provider skill catalog，不建立 OMP-only 侧栏。

### 4. Memory

OMP 事实：

- `memory.backend` 默认 `off`，可选 `local`、`hindsight`、`mnemopi`。
- Memory 会在后续 session 注入已有记忆，并提供 retain/recall/reflect/memory_edit/learn 等工具；具体工具依 backend 开启。
- local backend 使用 rollout extraction/consolidation，生成 `MEMORY.md`、`memory_summary.md`、skills，并带 SQLite job queue、lease/heartbeat 与 secrets redaction。
- 默认按项目作用域；Hindsight 是远端服务，Mnemopi 使用本地 SQLite。

ACP 缺口：

- 标准 ACP 不描述 memory backend、recall provenance、retain queue、consolidation/drain 或清理状态。
- OMP ACP 当前只把相关工具当 ordinary tool calls；没有 Memory 专属 config option/status method。

建议：

- 明确 OMP agent dir 策略：
  - `shared`：沿用用户 `~/.omp`，能继承 TUI 记忆，但 Synara session 之间共享敏感状态。
  - `profile-isolated`（推荐可选）：为 Synara/项目配置独立 `PI_CODING_AGENT_DIR`，隔离 credentials/memory/managed skills，但不会自动继承用户已有 OMP TUI 记忆。
- UI 必须显示 backend、scope、存储位置以及 remote/local，Memory 默认保持 opt-in。
- Hindsight 需要独立的网络/凭据披露；日志与 protocol logging 必须做 secret redaction。
- 高保真阶段增加 `_omp/memory/status|stats|diagnose|enqueue|clear`，写操作必须走确认。

## 推荐架构

### Adapter

新增 `OhMyPiAdapter`，复用 `AcpSessionRuntime` 与 `AcpAdapterSupport`，不要复制 ACP framing、队列、权限或进程管理。

建议启动形态：

```text
omp acp --config <synara-generated-overlay.yml>
```

Provider options 至少应包含：

- `binaryPath`
- `agentDir` / profile policy
- `configFiles` 或 Synara 生成的单次 overlay
- `advisorMode: off | omp | synara`
- `launchOwner: omp-native | synara-managed`
- `memoryBackend` 与 backend-specific settings
- `autoLearnEnabled` / `autoLearnAutoContinue`

不要把这些值偷偷写入用户全局 `~/.omp/agent/config.yml`；应使用进程级 overlay，除非用户明确选择持久化到 OMP 全局配置。

### Capability 分层

1. **ACP negotiated capabilities**：只相信 `initialize` 返回值。
2. **OMP versioned capabilities**：通过 `_omp/capabilities`（需上游/扩展）返回 feature schema version。
3. **Synara policy**：决定同类宿主功能由 OMP 还是 Synara 所有。

未知扩展必须降级成普通 transcript/tool activity，并保留 raw diagnostic；不得使 session 解码失败。

### UI

- Provider picker 增加 `Oh My Pi`，模型列表使用 OMP runtime model config/catalog。
- Provider settings 增加 OMP binary/agent-dir/config overlay 状态。
- 高级功能集中在一个 OMP capabilities 区域，区分 `enabled`、`available`、`observable`。
- Advisor/Launch 不复制一套 timeline 或 Services UI；先投影到现有 canonical surface，只有 OMP 特有且无法归一的状态才保留 provider badge/details。

## 分阶段实施

### Phase 0：兼容性 POC

- 固定 OMP 最低版本为 `>=16.1.12`；开发基线用 `17.3.3`。
- Windows 上验证 binary discovery、空格路径、terminal auth、初始化、new/prompt/cancel/stop。
- 声明并验证 fs/terminal/permission/elicitation/MCP capabilities。
- 用显式 overlay 分别启用 Launch、Advisor、Auto-Learn、Memory，记录真实 ACP frames。
- 关闭 OMP/Synara 双 Advisor，分别单独 A/B。

退出标准：四项功能均有真实运行证据，且能准确说出哪些状态只在 OMP 内部可见。

### Phase 1：标准 ACP Provider

- 扩展 contracts/provider 闭集、model/start options、registry、runtime layer、discovery/UI maps。
- 实现 session lifecycle、模型切换、commands/skills/models discovery、permission、terminal/fs/MCP、canonical event mapping。
- 完成 resume/load、进程退出、背压与 Windows process-tree 测试。

退出标准：OMP 是可日常使用的 Synara provider；高级功能可运行，但 UI 只承诺 ACP 可见范围。

### Phase 2：宿主能力仲裁

- 实现 `advisorMode` 与 `launchOwner` 互斥策略。
- 定义 agent-dir/memory scope 与配置持久化策略。
- Auto-Learn stop/drain 加生命周期保护。

退出标准：不存在双 Advisor、双进程 registry 或不明确的 Memory 存储所有权。

### Phase 3：OMP typed extensions

- 与 OMP 上游协作补 `_omp/capabilities` 及 Advisor/Launch/Auto-Learn/Memory status/control methods/events。
- Synara 通过 `AcpSessionRuntime.request/notify/handleExt*` 消费，按 feature schema version 降级。
- 将 typed state 投影到现有 Advisor、Services、skills、settings surfaces。

退出标准：Synara 能对“OMP 全功能支持”给出可验证的 UI、控制与恢复保证。

## 风险与验证

| 风险                                 | 严重度 | 缓解/验证                                                                      |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------ |
| OMP 版本/ACP capability 漂移         | 高     | 最低版本 + initialize feature detection + `_omp/capabilities` schema version   |
| 双 Advisor 互相 steer                | 高     | provider policy 互斥；组合测试确保只能启动一个                                 |
| 双 Launch registry                   | 高     | 明确 owner；Services UI 只展示权威 registry                                    |
| Auto-Learn 在关闭时丢写              | 高     | stop/drain protocol、超时、kill/restart 测试                                   |
| Memory/managed skills 泄露敏感上下文 | 高     | opt-in、scope 显示、redaction、remote backend disclosure                       |
| resume/load 重复或丢事件             | 高     | prompt 中 kill、resume/load replay、事件序列去重测试                           |
| Windows 子进程/孙进程泄漏            | 高     | initialize/prompt/permission/launch 各阶段 kill tree 实测                      |
| ACP update 无法表达 OMP 特性         | 中高   | raw diagnostic + typed extensions；禁止字符串猜测成为持久契约                  |
| 背压/大帧                            | 中高   | >2048 update burst、慢 consumer、8 MiB 边界测试                                |
| SDK 版本差异                         | 中     | 先用 v1 wire fixture 验证；`1.2.1 → 1.3.0` 单独升级，不与 adapter 大改绑在一起 |

## POC 验收清单

1. Windows 原生安装与自定义 `binaryPath` 都能启动 `omp acp`，包括含空格的路径。
2. 记录 initialize/version/capabilities/authMethods；未知或不兼容协议明确失败。
3. new/load/resume/fork/close、prompt/cancel、mode/model/thinking 全部实测。
4. default/plan/full-access 下的 allow-once/allow-always/reject/cancel/late request 全覆盖。
5. fs/terminal/MCP/elicitation 能力组合测试，未声明能力时 OMP fallback 行为明确。
6. Launch 启动长驻进程后，分别验证 OMP session stop、Synara server stop、桌面退出、重启恢复。
7. OMP Advisor 的 nit/concern/blocker 在 live turn 与 idle/deferred ACP 下都记录真实 frame。
8. Auto-Learn `autoContinue` 开/关时捕获 agent_end 到落盘的完整时序。
9. local/Mnemopi/Hindsight 分别验证 memory scope、首次 recall、retain、重启、清理和敏感信息。
10. 1000+ update burst、慢 consumer、8 MiB frame、process crash 与 resume exactly-once 验证。

## 最终建议

先做 POC，再实现标准 ACP adapter；不要一开始就把四项高级能力硬编码进 Synara 的公共 contracts。POC 的关键产物不是“能聊天”，而是一组真实 OMP 17.3.3 ACP frame fixtures，尤其覆盖 Advisor idle delivery、Auto-Learn drain、Memory persistence 与 Launch process ownership。

如果产品目标确实是“OMP 的所有功能都在 Synara 中可配置、可观察、可恢复”，应把 `_omp/*` typed extensions 视为正式范围，而不是可选增强。仅用 ACP v1 标准层无法诚实完成这个承诺。
