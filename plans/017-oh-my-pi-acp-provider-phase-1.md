# Plan 017 — Oh My Pi 标准 ACP Provider（Phase 1）

- 状态：TODO —— 产品决策已锁定，等待实施
- 创建：2026-08-14
- 优先级：P1
- 工作量：L
- 范围：`packages/contracts`、`packages/shared`、`apps/server`、`apps/web`
- 依赖：[OMP ACP Provider 调研](../docs/research/2026-08-14-oh-my-pi-acp-provider.md)及 §6 的 Phase 1 入口门禁
- 基线：`dev` / `7eea8ecf3603`
- 执行要求：实施代理开始前完整阅读本计划；每个工作流都要满足自己的完成标准后才能进入依赖它的下一步。

## 1. 目标

让本机已经安装的 Oh My Pi（下文简称 OMP）作为 Synara 的一等 Provider，通过标准 ACP v1 完成日常编码会话：

- 自动检测 `omp` 可执行文件和版本；检测成功即把 OMP 标为可用，无需用户手动启用。
- 通过 `omp acp` 启动会话，沿用用户现有的 `~/.omp` 身份、模型配置和会话数据。
- 支持 new/load/resume、prompt/cancel、模型与思考等级、模式、权限、elicitation、文件、终端、MCP 和标准 tool/message/plan 事件。
- 复用 Synara 现有的 Provider、ACP、持久化和 UI seam，不建立第二套会话或事件通路。

Phase 1 的完成定义是“OMP 成为稳定可用的标准 ACP Provider”，不是“Synara 已经对 OMP 全部高级能力提供专属 UI”。Launch、Advisor、Memory、Auto-Learn 的原生所有权已确定归 OMP，但强制启用、宿主仲裁和 typed extensions 属于后续阶段。

## 2. 已锁定的决策

| 决策             | 结论                           | 实施含义                                                                                                   |
| ---------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 内部 Provider id | `omp`                          | 避免与现有 `pi` 混淆；显示名固定为 `Oh My Pi`，实现文件使用 `OhMyPi*`                                      |
| 功能所有权       | OMP-native                     | 后续由 OMP 拥有 Launch、Advisor、Memory、Auto-Learn；Synara 负责托管、投影和控制                           |
| OMP Home         | 共享 `~/.omp`                  | Phase 1 不设置 `PI_CODING_AGENT_DIR`，不创建 Synara 隔离 profile                                           |
| 自动启用         | 检测到可兼容 `omp` 即 ready    | `settings.providers.omp.enabled` 默认 `true`；health probe 决定 `available`，不在探测阶段启动常驻 ACP 进程 |
| 未安装行为       | Settings 可见，Composer 不可选 | 显示可操作的安装/路径错误；缺少 binary 不等于启动失败后的活跃 session                                      |
| 显式禁用         | 用户设置优先                   | 用户将 `enabled=false` 后不探测、不出现在可用 Provider 集合中                                              |
| 兼容路线         | stock-first                    | Phase 1 不要求 Synara 私有 OMP fork；只依赖标准 ACP 和已确认的 OMP 行为                                    |
| 最低版本         | `>=16.1.12`                    | 与后续共享配置和高级功能阶段采用同一最低基线；开发与 fixture 基线为 `17.3.3`                               |
| ACP 版本         | negotiated stable v1           | 只相信 `initialize.protocolVersion` 和 capabilities，不根据 SDK 包版本推断 wire 能力                       |
| 配置写入         | Phase 1 不写 OMP 配置          | 不生成强制高级功能的 overlay；该工作留给 Phase 2                                                           |

“自动启用”不表示 Synara 启动时常驻一个 `omp acp`。探测只运行有界的 `omp --version`；真正的 ACP 进程只在模型/命令发现、创建会话或恢复会话时短暂或按需启动。

## 3. 范围边界

### 3.1 Phase 1 包含

- Provider identity、模型选择、start options、settings、discovery schemas 及所有 exhaustive maps。
- OMP binary discovery、自定义 binary path、版本探测和 Provider health。
- OMP ACP spawn、认证、capability negotiation 和标准错误映射。
- new/load/resume、prompt/cancel、session stop、server stop 和进程树清理。
- ACP 标准 message、reasoning、tool、plan、permission、elicitation、fs、terminal 和 MCP 映射。
- 从 disposable ACP session 的 config options/commands 获取 runtime models、thinking options 和 slash commands。
- Provider picker、模型 picker、通用 Provider settings、状态和图标。
- 聚焦自动化测试和一次真实 OMP 的隔离手工验证。

### 3.2 Phase 1 不包含

- 强制启用 Launch、Advisor、Memory、Auto-Learn 的 `~/.omp/synara` overlay。
- Synara Advisor 与 OMP Advisor 的运行时互斥接线。
- Synara `@Launch`/daemon 与 OMP native Launch 的可见性仲裁。
- `_omp/*` typed extensions、专属状态卡片或控制 UI。
- Memory backend、Auto-Learn drain、Advisor backlog、Launch Services 的宿主级恢复保证。
- OMP native plugins、agents/subagents、managed skills 或 Memory skills 的专属 discovery。
- OMP usage/rate-limit 统计、登录向导、自动安装或自动升级。
- `@agentclientprotocol/sdk` `1.2.1 → 1.3.0` 升级；SDK 升级必须是独立变更，不能与新 Adapter 混在一起。
- 抽象或重写所有现有 ACP adapters。Phase 1 复用既有 runtime；只有明确重复且能用小 interface 隐藏复杂度的 helper 才允许提取。

OMP 用户全局配置若已经启用了高级功能，它们可能在 ACP 进程内部运行。Phase 1 只保证标准 ACP 可观察到的普通消息和工具活动，不据此宣称高级功能已完成 Synara 产品级支持。

## 4. 当前事实与复用点

### 4.1 已有深模块

- `apps/server/src/provider/acp/AcpSessionRuntime.ts`
  - 已拥有 authenticated ACP process、initialize/auth、new/load/resume、prompt/cancel、config options、permissions、elicitation、fs、terminal、MCP、extension hooks、背压和 Windows 进程树清理。
  - resume/load 失败不会降级成 new；OMP Adapter 必须保留这一不变量。
- `apps/server/src/provider/acp/AcpAdapterSupport.ts`
  - 已拥有 ACP error、permission option、runtime mode 和 prompt completion 的 canonical 映射。
- `apps/server/src/provider/Services/ProviderAdapter.ts`
  - 是 ProviderService 和 tests 共用的外部 seam；OMP 不增加平行的 provider-specific orchestration RPC。

### 4.2 三个参考实现

1. `DroidAcpSupport.ts` / `DroidAdapter.ts`
   - 最接近 OMP：通过 disposable ACP session 发现 models/commands，使用 config options 设置模型和思考等级。
2. `GrokAcpSupport.ts` / `GrokAdapter.ts`
   - 参考动态 auth resolution、headless auth 错误、fresh-session retry 和进程启动设置。
3. `CursorAcpSupport.ts` / `CursorAdapter.ts`
   - 参考 ACP capability extension、runtime model projection、模型拒绝后的可恢复降级和严格 session cleanup。

这些文件是行为参考，不是复制模板。OMP implementation 只保留自身需要的分支。

### 4.3 当前传播面

`ProviderKind` 是闭集。新增 `omp` 会传播到：

- `packages/contracts`：orchestration、model、settings、providerDiscovery、agentMentions。
- `packages/shared`：model index、provider metadata、skill origins。
- `apps/server`：settings migration/default、ProviderHealth、Agent Gateway target map、Adapter registry/runtime layer。
- `apps/web`：persisted provider schema、model catalog maps、provider registry/icon、settings、PluginLibrary 和 browser fixtures。

实施时必须在修改 `ProviderKind` 后执行一次完整 `Record<ProviderKind` / provider literals 搜索；编译报错是辅助证据，不替代这次 exhaustive audit。

## 5. 目标架构

```text
ProviderService / ProviderDiscoveryService
                    │
                    ▼
            OhMyPiAdapter
       ┌────────────┴────────────┐
       ▼                         ▼
OhMyPiAcpSupport          canonical session state
       │                  events / approvals / turns
       ▼
AcpSessionRuntime
       │
       ▼
omp acp  ───────────────→ ~/.omp
```

### 5.1 `OhMyPiAcpSupport` 的 interface

该内部模块隐藏 OMP-specific 的启动、认证和 config option 解释。计划中的最小 surface：

- `buildOhMyPiAcpSpawnInput(settings, cwd)`
- `resolveOhMyPiAcpAuthMethodId(initializeResult)`
- `makeOhMyPiAcpRuntime(input)`
- `discoverOhMyPiAcpModels(runtime)`
- `applyOhMyPiAcpModelSelection(runtime, selection)`
- `applyOhMyPiAcpInteractionMode(runtime, interactionMode, runtimeMode)`

如果 W0 证明其中某个方法没有真实变化点，则删除该方法并直接使用 `AcpSessionRuntime`；避免创建 shallow pass-through。

### 5.2 `OhMyPiAdapter` 的职责

- 拥有 Synara thread 到一个 OMP ACP runtime/session 的映射。
- 将 ACP events 投影为 `ProviderRuntimeEvent`。
- 协调 turn、approval、elicitation、resume cursor 和 cleanup。
- 提供 models/commands discovery 的有界 disposable runtime。

它不解析 OMP 配置文件，不扫描 `~/.omp` 内部数据库，不解释高级功能文本，也不直接管理 Launch 子进程。

### 5.3 不变量

1. ACP capability 必须来自本次 initialize；未知 capability 走降级路径。
2. resume/load 失败向用户返回错误，不新建隐藏 session。
3. shared `~/.omp` 通过“不覆盖 OMP agent dir”实现；不得复制或同步该目录。
4. OMP child 继承多模型所需 provider credentials，但不继承 Synara control-plane token。
5. 一条 thread 同时最多拥有一个 live OMP runtime。
6. stop 是幂等 cleanup barrier；pending approval/elicitation 都必须 settle。
7. 未知 ACP extension 不使会话解码失败；只进入受 redaction 保护的 diagnostic。
8. discovery process 有 timeout、并发锁和缓存，不随每次 React render 重复 spawn。
9. 标准 ACP tool/activity 走现有 transcript/work-log 通路，不新增 OMP-only timeline。

## 6. 工作流与完成标准

工作流按 W0 → W1 → W2 → W3 → W4 → W5 → W6 顺序执行。W2 与 W5 的纯文件准备可以在 W1 完成后并行，但 W3/W4 必须使用已经落地的 contracts。

### W0 — Phase 1 入口门禁：固定真实 OMP ACP 契约

目的：把实现依赖的事实变成可重复证据，禁止根据 README 或其他 ACP provider 猜测。

动作：

1. 在 Windows 上解析实际 `omp` 路径并记录：
   - `omp --version`
   - resolved absolute path
   - executable identity（size + mtime）
2. 用隔离 cwd 启动一次 `omp acp`，记录并脱敏：
   - initialize protocol version、agentInfo、authMethods、agentCapabilities
   - clientCapabilities 对 fs/terminal/elicitation/permission 路由的影响
   - session/new 返回的 modes、configOptions 和 commands
   - model、thinking、mode 的 option id/category/value
   - prompt/cancel/close 的 stop reasons 和事件顺序
3. 把用于单测的最小响应写成 deterministic fixture；只保留 schema 字段，不保留 prompt、token、绝对用户路径或凭据。
4. 对照 `AcpSessionRuntime` 当前支持面，记录是否需要 generic runtime fix。

STOP 条件：

- OMP 不能协商 stable ACP v1。
- OMP `>=16.1.12` 的实际启动命令不是 `omp acp`。
- 只广告 Synara 无法完成的交互式认证方式。
- session/new 不返回可识别的 session id，或标准 prompt/update 流不符合 SDK schema。

命中 STOP 时先更新本计划的“阻塞原因”，不在 Adapter 中加入字符串解析或版本猜测绕过。

完成标准：真实 fixture 能驱动 initialize → auth → new → prompt → cancel/stop 的 deterministic test，且每个实现假设都能指向 fixture 字段。

### W1 — Provider identity、contracts、settings 和 exhaustive maps

目的：先让 `omp` 成为类型完整的一等 Provider，再接运行时。

主要文件：

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/providerDiscovery.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/agentMentions.ts`
- `packages/contracts/src/orchestration.test.ts`
- `packages/contracts/src/providerDiscovery.test.ts`
- `packages/contracts/src/rpc.test.ts`
- `packages/shared/src/model.ts`
- `packages/shared/src/providerMetadata.ts`
- `packages/shared/src/skillOrigins.ts`
- `packages/shared/src/model.test.ts`
- `packages/shared/src/serverSettings.test.ts`
- `apps/server/src/serverSettings.ts`
- `apps/server/src/agentGateway/targetResolver.ts`

合同形状：

- `ProviderKind` / `ProviderDiscoveryKind` 增加 `"omp"`。
- 新增 `OhMyPiModelOptions`。W0 若确认 ACP thinking 是 select option，则字段使用 `thinkingLevel?: TrimmedNonEmptyString`；不要把 OMP 强行塞进 `PiModelOptions`。
- 新增 `OhMyPiModelSelection` 并加入 `ModelSelection` union。
- 新增 `OhMyPiProviderStartOptions`，Phase 1 只包含 `binaryPath?`。
- `ProviderStartOptions`、`ProviderModelOptions`、settings schema/patch 增加 `omp`。
- `OmpServerProviderSettings` 默认 `enabled=true`、`binaryPath="omp"`、`customModels=[]`。
- `MODEL_OPTIONS_BY_PROVIDER.omp=[]`；OMP 是 runtime-catalog provider，不伪造静态模型表。
- `ProviderWithDefaultModel` 排除 `omp`；模型 discovery 无结果时沿用 OMP 当前模型，不制造错误 slug。
- `PROVIDER_DISPLAY_NAMES.omp="Oh My Pi"`。
- mention aliases、autocomplete aliases、skill origins 在 Phase 1 使用空表。
- `PROVIDER_DESCRIPTORS` 增加 OMP，`supportsNativeTurnSteering=false`、`usage=null`。

兼容性要求：旧 settings 文件没有 `providers.omp` 和 `skills.disabled.omp` 时必须通过 decoding defaults 补齐；不能隔离或清空其他 provider 的既有设置。

完成标准：

- `ProviderKind`、ModelSelection、ServerSettings 和 discovery RPC 能 encode/decode `omp`。
- 旧 settings fixture 解码后得到默认 OMP settings。
- 所有 exhaustive maps 有显式 `omp` entry，没有通过 `as unknown as` 掩盖遗漏。
- 此提交只包含 contracts/shared/settings 及其测试，能够独立通过对应 focused tests。

### W2 — Binary discovery、版本兼容和自动启用

目的：实现“Synara 识别到 OMP 就启用”，同时保持探测轻量、可缓存、可解释。

主要文件：

- `apps/server/src/provider/Layers/ProviderHealth.ts`
- `apps/server/src/provider/Layers/ProviderHealth.test.ts`
- `apps/server/src/executableLookup.ts`（预计不改，只复用）
- `apps/server/src/provider/providerMaintenance.ts`（预计不改，只复用 version parser）
- `apps/server/src/serverSettings.test.ts`

行为：

1. binary 来源优先级：session start input `binaryPath` → server settings `binaryPath` → `omp`。
2. 使用统一 `resolveExecutable` 处理 PATH、`Path`、quoted PATH、PATHEXT、`.cmd/.CMD` 和显式含空格路径。
3. health 只执行有界 `omp --version`，解析版本并缓存 binary identity 对应的 verdict。
4. 状态矩阵：
   - missing：`available=false`，提示安装或配置路径。
   - below minimum：`available=false`，提示最低版本 `16.1.12`。
   - timeout/nonzero：`available=false` 或 warning，沿用现有 health 稳定策略，不把旧 ready 永久保真。
   - compatible：`status=ready`、`available=true`、`authStatus=unknown`。
5. Provider settings 默认 enabled；用户显式 disabled 时 health 不运行并返回 disabled projection。
6. 不把 OMP 加入自动 updater，除非实施时能从官方安装元数据确认稳定的 package/update contract；Phase 1 maintenance capabilities 返回不可自动更新。

完成标准：

- Windows `.cmd`、PATH casing、quoted Program Files、自定义绝对路径、missing、timeout、旧版本和版本更新后 cache invalidation 均有测试。
- 检测不会启动 `omp acp`、不会写 settings、不会触碰 `~/.omp`。
- compatible binary 在 Provider health 中变 ready；disabled setting 始终胜出。

### W3 — `OhMyPiAcpSupport` 和标准 ACP compatibility

目的：把 OMP-specific 协议适配集中在一个内部深模块。

新增文件：

- `apps/server/src/provider/acp/OhMyPiAcpSupport.ts`
- `apps/server/src/provider/acp/OhMyPiAcpSupport.test.ts`

必要时修改：

- `apps/server/scripts/acp-mock-agent.ts`，仅增加可复用的 OMP scenario；不要复制整套 mock agent。
- `apps/server/src/provider/acp/AcpSessionRuntime.ts` 及其测试，但仅限 W0 证明的通用 ACP 缺口。

实现要求：

- spawn command 为解析后的 `omp`，args 为 `["acp"]`；Phase 1 不追加高级功能 overlay。
- cwd 使用目标 project；不设置 `PI_CODING_AGENT_DIR`，从而共享 `~/.omp`。
- child env 使用 ACP 多模型 credential policy，并继续剥离 `SYNARA_*` control-plane secrets 和不允许的 native launcher env。
- auth resolver 只选择 initialize 实际广告且 Synara 能完成的方式。开发基线预期为 `agent`；未广告时给出可操作错误，提示用户先运行 OMP 完成登录。
- client capabilities 明确声明 Synara 真正实现的 fs、terminal、elicitation 和 permission handlers；不为未实现能力撒谎。
- model/thinking/mode 只使用 session 返回的 config options/modes：
  - 未指定模型时保留 OMP 当前值。
  - 指定值不在 options 中时返回明确 notice/error，不静默换模型。
  - 模型切换后重新读取 thinking options，避免使用旧模型的 option ladder。
  - Plan/default mode id 由 W0 fixture 确认；不存在 native Plan mode 时由 Synara permission policy fail closed。
- runtime model discovery 使用 disposable session，恢复原始 model/thinking 后关闭 scope。

完成标准：

- spawn、auth、capability、model、thinking、mode 都通过纯 helper 或 fake runtime 测试。
- missing auth、unknown model、unsupported thinking、missing plan mode 和 malformed config options 都有错误路径。
- support 模块不读取 OMP 私有数据库或解析 stdout 文案作为 ACP 状态。

### W4 — `OhMyPiAdapter`、canonical events 和生命周期

目的：满足 `ProviderAdapterShape`，把一个 ACP runtime 安全地接入 Synara session lifecycle。

新增文件：

- `apps/server/src/provider/Services/OhMyPiAdapter.ts`
- `apps/server/src/provider/Layers/OhMyPiAdapter.ts`
- `apps/server/src/provider/Layers/OhMyPiAdapter.test.ts`

参考但不复制：

- `apps/server/src/provider/Layers/DroidAdapter.ts`
- `apps/server/src/provider/Layers/GrokAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`

Adapter capabilities：

- `sessionModelSwitch: "in-session"`
- `conversationRollback: "restart-session"`
- `supportsRuntimeModelList: true`
- `supportsNativeSlashCommandDiscovery: true`
- `supportsTurnSteering: false`
- `supportsLiveTurnDiffPatch: false`，除非 W0 有标准 ACP unified diff 证据
- native plugins/agents/skill discovery 为 false；统一 Synara skill catalog 仍由 `ProviderDiscoveryService` 提供

生命周期顺序：

1. `startSession`
   - 校验 provider、cwd、binary path 和 thread ownership。
   - 同 thread 已有 session 时先走同一个 cleanup barrier。
   - 创建 session scope、ACP runtime、MCP servers 和 bounded event ingress。
   - 注册 event drain 与 process exit watcher，再调用 `runtime.start()`，避免丢 early updates。
   - resume cursor 存 OMP session id；runtime 决定 resume/load/new。
   - 应用 mode → model → thinking 的顺序以 W0 实测为准，并记录最终生效值。
2. `sendTurn`
   - 建立 turn context 和 pending interaction ownership。
   - 将文本、attachments、skills/mentions 按当前通用 composer helper 投影；OMP 不支持的 attachment kind 要在发送前拒绝。
   - 调用 `session/prompt`，把 stopReason 映射为 canonical completion/cancel/failure。
3. `respondToRequest` / `respondToUserInput`
   - 复用 `resolveAcpPermissionPolicy`、`selectAcpPermissionOptionId` 和 pending interaction store。
   - late request、无 active turn、Plan、default、full-access 全部 fail closed 或按既有策略 settle。
4. `interruptTurn`
   - 只取消匹配的 active turn；重复 cancel 为幂等 no-op。
5. `readThread` / `rollbackThread`
   - `readThread` 返回 Adapter 已投影的 turns。
   - ACP 无 native rewind 时，`rollbackThread` 返回明确的 restart-session 说明，不伪造已修改 OMP history。
6. `stopSession` / `stopAll`
   - 标记 stopped。
   - settle approvals 和 elicitation。
   - 中断 notification/event fibers。
   - 关闭 scope并等待 root process exit proof。
   - 删除 session map，最后发送一次 `session.exited`。

事件覆盖：

- assistant text/reasoning chunks
- tool call start/update/completion/failure
- plan/todo update
- permission request
- elicitation/user-input request
- session mode/config/available commands update
- prompt completed/cancelled/error
- process exit 和 transport failure
- unknown extension diagnostic

完成标准：

- new、resume、load、prompt、cancel、permission、elicitation、process exit、stop、stopAll 都有 Adapter tests。
- resume/load 失败测试断言没有发出 session/new。
- cleanup 测试证明 pending requests 已 settle、session map 已删除、子进程树已经退出。
- 2048 event burst 和慢 consumer 不产生无界内存增长。

### W5 — Models、commands 和 Provider discovery

目的：让 Composer 使用 OMP runtime 的真实选择，而不是硬编码 OMP 的模型目录。

主要文件：

- `apps/server/src/provider/Layers/OhMyPiAdapter.ts`
- `apps/server/src/provider/Layers/ProviderDiscoveryService.test.ts`
- `apps/server/src/provider/acp/OhMyPiAcpSupport.ts`
- `apps/server/src/provider/acp/OhMyPiAcpSupport.test.ts`

实现：

- models：从 disposable session 的 `category=model` config option 生成 `ProviderModelDescriptor`。
- thinking：把当前模型有效的 thinking select options 投影为 model option descriptors；切换模型后重新读取。
- commands：从 `getAvailableCommands` 读取；允许最多 500ms 的有界 early-update 等待。
- cache key 至少包含 resolved binary identity、cwd 和共享 OMP config identity；W0 无法取得廉价 config identity 时使用短 TTL 并支持 `forceReload`。
- model/command discovery 共用一把 lock 和一次 disposable session，避免同时 spawn 两个 OMP。
- discovery timeout 后返回明确 provider error；Web 保留 custom model/当前选择的可恢复路径。
- OMP native skills/plugins/agents 在 Phase 1 返回 unsupported；Synara catalog 仍提供统一 skill mentions。

完成标准：

- runtime model、thinking options、commands 能从 fixture 投影。
- empty/malformed options、timeout、cache hit、forceReload、binary/config identity 变化均有测试。
- disposable runtime 总是关闭，成功和失败分支都没有残留 `omp` 进程。

### W6 — Registry、runtime layer、Web surface 和端到端收口

目的：让 OMP 从 contracts 到 UI 和 runtime 真正贯通。

Server 接线：

- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts`
- `apps/server/src/provider/runtimeLayer.ts`
- `apps/server/src/provider/Layers/ProviderHealth.ts`
- `apps/server/src/provider/Layers/ProviderDiscoveryService.ts`（预计无需行为修改）
- `apps/server/src/provider/Layers/ProviderService.test.ts`

Web/共享接线：

- `apps/web/src/appSettings.ts`
- `apps/web/src/components/ProviderIcon.tsx`
- `apps/web/src/components/ProviderIcon.test.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.tsx`
- `apps/web/src/components/chat/composerProviderRegistry.test.tsx`
- `apps/web/src/components/chat/ProviderModelPicker.browser.tsx`
- `apps/web/src/components/PluginLibrary.tsx`
- `apps/web/src/hooks/useProviderModelCatalog.ts`
- `apps/web/src/hooks/useProviderModelCatalog.test.tsx`
- `apps/web/src/components/settings/ProvidersSettingsPanel.tsx`
- `apps/web/src/components/settings/ProvidersSettingsPanel.test.ts`
- `apps/web/src/providerModelOptions.test.ts`
- `apps/web/src/providerOrdering.test.ts`

要求：

- Registry 默认列表和 runtime layer 都注入 `OhMyPiAdapter`。
- OMP Adapter 获得与其他 gateway-capable providers 相同的 Agent Gateway MCP layer。
- persisted provider schema、custom model maps、runtime model sources、icons、composer registry 和 settings disclosure 全部有显式 `omp` entry。
- Composer 只在 health 判定 OMP `available=true` 时允许选中；missing/unsupported 状态只在 Settings 展示。
- OMP 使用通用 Provider card 和模型 picker；Phase 1 不新增高级功能 settings panel。
- Provider display order 由 `PROVIDER_DESCRIPTORS` 单一来源决定；建议把 OMP 放在 `pi` 附近但显示名必须明确区分。

完成标准：

- Registry list/get、ProviderService routing、ProviderDiscovery、health、settings 和 Web exhaustive fixtures 都包含 OMP。
- 未安装 OMP 时应用可正常启动，Settings 显示 unavailable，Composer 不提供可启动入口。
- 安装兼容 OMP 后刷新 health 即可选择，无需修改或重启 Synara settings。
- 选择 OMP 后模型/命令 discovery 和会话启动使用同一个 resolved binary/config identity。

## 7. 测试与验证

### 7.1 工作流内 focused tests

Contracts（workdir `packages/contracts`）：

```text
bun run test src/orchestration.test.ts src/providerDiscovery.test.ts src/rpc.test.ts src/agentMentions.test.ts
```

Shared（workdir `packages/shared`）：

```text
bun run test src/model.test.ts src/serverSettings.test.ts src/agentMentions.test.ts
```

Server ACP 与 Adapter（workdir `apps/server`）：

```text
bun run test src/provider/acp/OhMyPiAcpSupport.test.ts src/provider/Layers/OhMyPiAdapter.test.ts src/provider/acp/AcpSessionRuntime.test.ts src/provider/acp/AcpJsonRpcConnection.test.ts src/provider/acp/AcpSdkConformance.test.ts
```

Server wiring/discovery/health（workdir `apps/server`）：

```text
bun run test src/provider/Layers/ProviderAdapterRegistry.test.ts src/provider/Layers/ProviderDiscoveryService.test.ts src/provider/Layers/ProviderHealth.test.ts src/provider/Layers/ProviderService.test.ts src/executableLookup.test.ts src/serverSettings.test.ts
```

Web（workdir `apps/web`）：

```text
bun run test src/components/ProviderIcon.test.tsx src/components/chat/composerProviderRegistry.test.tsx src/hooks/useProviderModelCatalog.test.tsx src/components/settings/ProvidersSettingsPanel.test.ts src/providerModelOptions.test.ts src/providerOrdering.test.ts
```

严禁使用 `bun test`；统一使用 `bun run test`。

### 7.2 真实 OMP 手工场景

使用隔离 Synara home 和非默认端口，先 dry-run，并 unset `SYNARA_AUTH_TOKEN`。不得占用用户正在运行的 Synara 实例。

1. PATH 中无 `omp`：Settings 显示 missing，Composer 不可启动 OMP。
2. PATH 中存在 `omp`：health 显示版本与 ready，刷新后 OMP 自动可选。
3. 自定义 binary path 含空格且指向 Windows `.cmd`：能检测和启动。
4. 使用现有 `~/.omp` 登录启动 new session；Synara 不创建第二个 agent dir。
5. 发送普通 prompt，观察文本、reasoning、tool、plan 和完成事件。
6. default/plan/full-access 下分别触发文件、终端和 permission。
7. 触发 elicitation并完成/取消。
8. 切换 model/thinking；无效值给出可恢复错误。
9. prompt 中 cancel；OMP root 与 descendants 均退出或回到可复用 session 状态。
10. 保存 resume cursor，重启 Synara 后 resume/load；不得创建重复 OMP session。
11. 显式禁用 OMP：停止 health/discovery，现有 active session 按通用设置变更策略安全结束或继续到明确边界。
12. 关闭 Synara：所有 OMP ACP root processes 均有退出证明。

### 7.3 最终 workspace gate

本仓库要求 `bun fmt`、`bun lint`、`bun typecheck` 在任务末尾合并为一次 heavyweight verification。只有实施轮次得到操作者显式授权时才能运行；未获授权时必须报告为未执行，且不得宣称完成了全量 workspace gate。

运行前先确认只会格式化本任务文件，尤其关注 Windows 行尾变化。任何格式化产生的无关 diff 都不得 stage。

## 8. 验收标准

Phase 1 只有同时满足以下条件才可标为 DONE：

1. `omp` 是 contracts、settings、shared metadata、server registry 和 Web 的一等 Provider。
2. compatible `omp` 被自动识别为 ready；missing/old/disabled 状态准确且可恢复。
3. Synara 启动 OMP 时使用 `omp acp` 和共享 `~/.omp`，没有写入或复制 OMP Home。
4. new/load/resume、prompt/cancel、model/thinking/mode、permissions、elicitation、fs、terminal、MCP 都有测试和至少一次真实证据。
5. 标准 ACP events 完整投影到 canonical runtime events；未知 extension 不击穿会话。
6. resume/load 失败不会隐式 new；stop/stopAll 不遗留 OMP 进程或 pending interactions。
7. runtime model/command discovery 有 timeout、cache、forceReload 和 cleanup。
8. 未安装 OMP 时 Synara 其他 Provider 与启动流程无回归。
9. 所有行为改动都有 focused tests；已授权的最终 workspace gate 通过，或明确记录未授权项。
10. UI 和文档只宣称“标准 ACP Provider 可用”，不把 Phase 2/3 的高级能力描述为已完成。

## 9. 提交边界

保持每个提交可构建、可测试，只 stage 当前工作流文件：

1. `feat(contracts): add Oh My Pi provider identity`
   - W1 contracts/shared/settings + tests。
2. `feat(server): detect compatible Oh My Pi installations`
   - W2 health/version/binary tests。
3. `feat(server): add Oh My Pi ACP adapter`
   - W3/W4 support、Adapter、lifecycle tests。
4. `feat: wire Oh My Pi discovery and provider UI`
   - W5/W6 registry、discovery、Web + focused tests。
5. 若最终验证只产生文档或 fixture 修正，再单独提交；不要制造空的“cleanup”提交。

## 10. 风险与缓解

| 风险                                      | 缓解                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| OMP ACP schema/命令漂移                   | W0 fixture、最低版本、initialize capability negotiation；不根据版本号猜 capability                |
| `pi` 与 `omp` 混淆                        | 内部 id `omp`、类型/文件 `OhMyPi*`、UI 显示全名                                                   |
| 自动探测拖慢启动                          | 只做有界 `--version`、缓存 binary identity、health 并发执行                                       |
| discovery 反复 spawn OMP                  | model/command 共用 lock、cache 和 disposable runtime                                              |
| 共享 `~/.omp` 泄露或被改写                | Phase 1 不解析/写入配置；protocol logs 做 redaction；UI 明示共享状态                              |
| OMP 多模型凭据被错误剥离                  | 使用 ACP 多模型 credential policy，同时继续剥离 Synara control-plane secrets                      |
| resume 失败制造重复 session               | 保留 `AcpSessionRuntime` no-fallback-new 不变量并写回归测试                                       |
| Adapter 复制已有大量代码                  | 复用 `AcpSessionRuntime`/`AcpAdapterSupport`；只提取有真实重复且 interface 较小的 helper          |
| 高级功能普通事件被误判为正式支持          | Phase 1 UI/文档只承诺 ACP 可见范围；高级状态留到 typed extension 阶段                             |
| Auto-Learn/Advisor 在用户全局配置中已启用 | Phase 1 不抑制 OMP 原生行为，但 session stop 只承诺标准 ACP settle；Phase 2 再建立完整 drain/仲裁 |

## 11. 已考虑并否决

- **直接复制 DroidAdapter 并替换名称**：否决。会复制生命周期、权限和 cleanup 缺陷；OMP 只应复用稳定 seam 和必要模式。
- **把 OMP 当成现有 `pi` 的一个启动模式**：否决。两者的进程、协议、配置、身份和未来高级能力不同，合并会让 contracts 与 UI 语义含混。
- **检测到 binary 后写 `enabled=true` 到 settings**：否决。默认 true + health projection 已能达到自动启用；静默写 settings 会覆盖用户显式禁用。
- **通过读取 `~/.omp` 文件枚举模型/命令**：否决。内部文件格式不是 ACP contract，使用 disposable ACP session 的 advertised state。
- **Phase 1 顺便升级 ACP SDK**：否决。协议 conformance 与依赖升级的回归面不同，应拆分。
- **Phase 1 新增通用 ACP Adapter framework**：暂缓。现有 adapters 的 auth、model、extensions 和 lifecycle hooks 差异很大；没有经过删除测试的 interface 容易成为 shallow framework。
- **为了“全功能”提前解析 `<advisory>` 或 Launch tool 文本**：否决。字符串不是 typed contract，后续由 `_omp/*` 扩展解决。

## 12. Phase 1 完成后的下一步

Phase 2 以本计划产出的 `OhMyPiAdapter` 和 `OhMyPiAcpSupport` 为基础：

- 在 `~/.omp/synara/acp-provider.yml` 生成仅影响 Synara ACP session 的 overlay。
- 强制启用 Launch、Advisor、Memory（配置为 off 时回落 local）和 Auto-Learn/autoContinue。
- 关闭 OMP session 上的 Synara Advisor 与 `@Launch` ownership。
- 增加 Auto-Learn/Advisor 的 settle/drain 生命周期保护。

Phase 2 不得回头复制 ACP transport；OMP-specific 高级控制应进入新的 `OmpControlPlane` 深模块，并通过 `AcpSessionRuntime.request/notify/handleExt*` 使用同一条连接。
