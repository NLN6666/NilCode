# Plan 018 — Oh My Pi Provider Phase 2（宿主能力仲裁）

- 状态：IMPLEMENTED — FOCUSED VERIFIED；typed lifecycle guarantee 命中 STOP 边界
- 创建：2026-08-14
- 基线：`dev` / `4aab0ef6c23ebdf56b02f58e0f01769521691a41`
- 前置提交：`3e95adc30`、`e51d0f109`、`e2af468fc`、`e23e6b981`、`4aab0ef6c`
- 范围：`packages/contracts`、`apps/server`、`apps/web`、本计划与 `findings.md`
- 排除：OMP upstream/fork、ACP transport/SDK 升级、Phase 3 `_omp/*` typed methods/events、安装/升级/usage/login

## 1. 目标与产品不变量

Synara 启动的 OMP ACP session 必须使用 OMP-native Launch、Advisor、Memory 与 Auto-Learn，同时由宿主消除双 Advisor 与双进程 registry：

1. OMP session 使用共享 `~/.omp`，不设置 `PI_CODING_AGENT_DIR`。
2. Synara 只写 `~/.omp/synara/acp-provider.yml`，不改 `~/.omp/agent/config.yml`。
3. overlay 强制 `launch.enabled=true`、`advisor.enabled=true`、`autolearn.enabled=true`、`autolearn.autoContinue=true`。
4. 用户显式且可用的 `memory.backend`（`local|hindsight|mnemopi`）保持；`off`、缺失或非法值回落 `local`。Synara 不生成远端地址或凭据。
5. OMP thread 不启动 Synara Advisor reactor，不获得 Synara Agent Gateway/daemon ownership，也不注入 `@Launch`/daemon harness policy。其他 providers 行为不变。
6. stock ACP 无四项功能 typed status/control；Phase 2 只投影配置策略、有效 backend、warning/degraded 与可观察边界，不从 transcript/XML/tool 文案推断状态。
7. session 关闭采用有界 queued-event drain + quiet window + process-exit-aware fallback；超时继续关闭并返回可解释结果，不宣称 Auto-Learn capture 已完成。

## 2. 当前实现证据

- `OhMyPiAcpSupport.buildOhMyPiAcpSpawnInput` 当前只产生 `args: ["acp"]`，child env 经过 ACP provider 清洗且不设置 `PI_CODING_AGENT_DIR`。
- `OhMyPiAdapter` 当前在 prompt 结束后对已排队 ACP update 做最多 1 秒计数 drain；没有 OMP-specific quiet window、timeout outcome 或 process-aware settle。
- OMP 已不在 `PROVIDERS_WITH_THREAD_SCOPED_SYNARA_MCP` 中，因此 prompt 只收到 identity-only harness policy；但 Adapter 仍会申请 Agent Gateway lease 并向 OMP ACP 注入 MCP transport，必须从 server-owned spawn/session seam 切断。
- `AdvisorReactor.evaluateThread` 在取得 thread snapshot 后只解析全局/thread override，没有 provider ownership guard。
- Web OMP settings 只有 binary path，并已通过 `CollapsiblePanel` 复用 `disclosureMotion`。

## 3. 已实测的 OMP 17.3.x 配置契约

本机真实版本为 `omp/17.3.2`；Phase 1 的锁定 fixture 为 bunx `17.3.3`。本轮在临时 overlay 上实测：

- `omp acp --config <path>` 与 `omp --config <path> acp` 均接受存在/不存在的 overlay；不存在时明确报 `Config overlay not found`。
- 采用 canonical spawn args `["acp", "--config", overlayPath]`，与帮助中 `omp acp` 子命令及派发决策一致。
- `--config` 可重复。OMP `Settings` 按参数顺序 deep-merge，后一个 overlay 胜出；未覆盖 sibling 保留。
- 只读 `Settings.loadReadOnly` 实测 `memory.backend`、`advisor.enabled`、`launch.enabled`、`autolearn.*` 与 `modelRoles.advisor` 的有效值。

OMP 17.3.2 官方源码 schema：

| 路径 | 类型/默认 | Phase 2 行为 |
| --- | --- | --- |
| `launch.enabled` | boolean / `true` | overlay 强制 `true` |
| `advisor.enabled` | boolean / `false` | overlay 强制 `true` |
| `modelRoles` | `Record<string,string>` | 只读 `advisor`；不制造当前模型 fallback |
| `memory.backend` | `off|local|hindsight|mnemopi` / `off` | usable 显式值保留，否则 overlay 写 `local` |
| `autolearn.enabled` | boolean / `false` | overlay 强制 `true` |
| `autolearn.autoContinue` | boolean / `false` | overlay 强制 `true` |

OMP 官方实现明确：Advisor enabled 但 `modelRoles.advisor` 无法解析时 Advisor inactive。标准 ACP session config 只暴露 mode/model/thinking，不能安全推断“当前模型可作为 Advisor fallback”；因此 Phase 2 不生成 fallback role，返回 recoverable degraded warning。

## 4. 目标深模块：`OmpControlPlane`

新增 `apps/server/src/provider/omp/OmpControlPlane.ts`，集中拥有以下职责：

- 定位共享 OMP agent/global config 与固定 overlay 路径。
- 窄解析用户 config 中 `memory.backend` 和 `modelRoles.advisor`，绝不复制未知字段或 secret。
- 生成 deterministic 最小 YAML：只含四项强制 policy 及必要的 `memory.backend: local` fallback。
- 创建父目录并以同目录临时文件、flush/close、rename 原子落盘；已有同内容时 no-op。
- 返回 provider-specific policy projection：owner、forced configuration、effective memory backend、advisor ready/degraded warning、shared home、overlay path、typed observability boundary。
- 为 spawn 提供 overlay path/args，不把逻辑散落到 Adapter/UI。
- 提供可单测的有界 settle：queued target drain、quiet window、timeout、abort/process-exit outcome。

`OhMyPiAcpSupport` 继续拥有 stock ACP auth/config/model 语义，只消费 control-plane 已准备好的 overlay path。

## 5. 最小 contract

在 `packages/contracts` 新增 OMP-only policy projection，并作为 `ServerProviderStatus` 的可选 provider-specific 字段承载；不扩充通用 `ProviderAdapterCapabilities`，不新增四项 `supportsX/isRunning` 假能力。

投影只允许表达：

- owner：Launch/Advisor=`omp-native`
- configured：四项 forced true
- memory effective backend 与 shared home
- Advisor `ready|degraded` 及无 role/不可解析 warning
- Auto-Learn experimental、额外 token/磁盘写入提示
- observability=`configured-policy-only`、recoverability=`bounded-process-settle`

## 6. 接线顺序

### W1 — overlay 与 spawn

1. 先写 `OmpControlPlane` 纯/临时目录测试，覆盖 deterministic、atomic、no-secret、global untouched、backend 决策、missing advisor role。
2. session/discovery 启动前 prepare overlay。
3. spawn 改为 `["acp", "--config", overlayPath]`；Windows 含空格路径保持单一 argv，不设置 `PI_CODING_AGENT_DIR`。
4. Provider health 只做 read-only policy inspection/status projection；不得因 health probe 写 overlay。

### W2 — Advisor/Launch 仲裁

1. `AdvisorReactor` 在 server-owned thread provider seam 对 `omp` fail closed 跳过；非 OMP 保留现有 global/thread override。
2. OMP Adapter 不申请 Agent Gateway session lease、不注入 MCP servers、不发布 daemon ownership policy。
3. OMP 仍接收 Synara identity-only host context；不得宣称有 Synara resource mutation。

### W3 — lifecycle settle

1. prompt result 后保留 queued target counter drain。
2. drain 后等待短 quiet window；新 update 重新计时。
3. bounded hard deadline 到期返回 `timed-out` warning outcome并继续 canonical completion/close。
4. process exit/abort 立即结束等待；process watcher 与 manual stop 共用幂等 teardown。
5. stock ACP 没有 Auto-Learn typed drain，因此 outcome 只能描述 host settle heuristic，不描述 capture 成功。

### W4 — Web

在现有 OMP provider disclosure 内展示：

- 四项强制启用、OMP owned；共享 `~/.omp` 与 overlay path。
- Memory effective backend。
- Advisor ready/degraded warning。
- Auto-Learn experimental，可能增加 token 和磁盘写入。
- typed observability/control 留到 Phase 3。

不新增实时状态卡，不解析 transcript，不把 OMP Launch 映射成 Services registry。

## 7. STOP 条件

命中任一项时保留已验证可用部分、停止扩大声明，并记录 Phase 3/upstream 缺口：

1. `--config` 无法在真实 `omp acp` 生效或会改写用户全局配置。
2. 无法在不读取/复制 secret 的前提下确定 memory fallback 或 Advisor role warning。
3. OMP session 仍可获得 Synara daemon MCP ownership，或 Synara Advisor 仍会评估 OMP thread。
4. settle 只能通过解析 transcript/XML/tool 文案实现。
5. bounded close 仍可能无限等待或留下 ACP root/descendant。
6. 要满足 UI 声明必须新增未经版本化的 private `_omp/*` schema。

## 8. TDD 测试矩阵

| Seam | 必测行为 |
| --- | --- |
| overlay | deterministic、atomic、mode 0600（平台允许时）、no-secret、global untouched、同内容 no-op |
| memory | explicit local/hindsight/mnemopi 保留；off/missing/invalid → local；不生成 remote credentials |
| advisor | role present → configured；missing/blank/unparseable → recoverable degraded warning |
| spawn | args/order、Windows 空格 path、overlay missing error、无 `PI_CODING_AGENT_DIR` |
| host policy | OMP Advisor reactor 不评估；OMP 无 gateway lease/MCP/daemon policy；Codex/其他 provider 不变 |
| settle | queued success、quiet success、timeout、abort、process exit、late activity resets quiet |
| lifecycle | stopSession、stopAll/server stop、process crash、重复 stop、无残留 pending interaction |
| contract/UI | OMP-only projection roundtrip；四项 ownership/backend/warning/experimental/Phase 3 边界文案 |

测试只走 `bun run test` 包级 focused 命令；禁止 `bun test`。本轮未授权 `bun fmt`、`bun lint`、`bun typecheck`。

## 9. 真实验收

1. 使用隔离 Synara home、非默认端口、`SYNARA_AUTH_TOKEN` unset，先 `--dry-run`。
2. 不修改 `~/.omp/agent/config.yml`；验证前后 hash/mtime。
3. 真实 `omp/17.3.2` ACP initialize/auth/new/prompt/close，证明 overlay 被读取且普通会话可用。
4. 读取 typed/config-source 证据确认 effective Launch/Advisor/Memory/Auto-Learn；无法 typed 观察的部分明确标为 configured-only/degraded。
5. 停止后按 PID/command line 检查无本次 OMP ACP root/descendant；若 Launch probe，使用隔离 cwd、短命可识别命令并清理。

## 10. 验收标准与提交边界

- overlay、spawn、四项策略 projection、Advisor/Launch 仲裁、bounded settle、settings UI 与 focused tests 全部落地。
- 真实验证至少证明 overlay 读取、普通 ACP 会话可用、关闭无残留；不把无 typed 证据的内部 capture 宣称完成。
- 一次 independent review；只做一次合并修复；修复后 fresh focused verification。
- 相关 build 与 `git diff --check` 通过；heavyweight gates 明确 `NOT RUN`，因此不宣称 full workspace gate/DONE。
- 分阶段只 stage 本任务明确文件；不 push、不创建 PR、不 merge。

建议提交：

1. `docs(plan): define Oh My Pi provider phase 2`
2. `feat(server): add Oh My Pi control plane`
3. `feat(server): arbitrate Oh My Pi host capabilities`
4. `feat(web): show Oh My Pi native capability policy`
5. 审查修复若有真实代码变化，单独 scoped commit；否则不制造空提交。

## 11. 实施与真实验证记录

- `OmpControlPlane`、OMP-only status contract、overlay spawn、ProviderHealth 投影、Advisor/Launch server arbitration、bounded quiet settle 与 Web policy disclosure 已落地。
- 真实 `omp/17.3.2` 通过官方 `Settings.loadReadOnly` 读取固定 overlay：Launch/Advisor/Auto-Learn/autoContinue 均为 true，Memory 为用户显式 local，Advisor role 来自 global config。全局 config 验证前后 SHA-256、size、mtime 不变。
- 标准 ACP runtime 完成 initialize/auth/session-new；stable protocolVersion=1、auth=agent、default/plan、mode/model/thinking 均可用。5 次只读 tool-call 回合以 `end_turn` 返回，session scope 正常关闭。
- prompt lifecycle 实测中，ACP `session/prompt` response 后约 2ms 才收到 canonical `AssistantItemCompleted`；5 秒 late window 没有 Advisor/Auto-Learn typed event。OMP log 可见 `agent_end`，Advisor sidecar 在 session close 时为 aborted；Auto-Learn 使用 detached private capture runner，stock ACP 没有 capture-start/complete/drain schema，也没有可靠持久化完成信号。
- 因而命中 STOP：Phase 2 保留 configured-policy 与 bounded queued/quiet/process-aware fallback，但不保证或宣称 Advisor delivery/Auto-Learn capture 在关闭前完成。可靠 typed completion/drain 必须留给 Phase 3 或 OMP upstream 版本化扩展。
- 隔离 Synara home `D:\Codes\NilCode\.synara-omp-phase2-verify`、server 58182、web 10554、`SYNARA_AUTH_TOKEN` unset，先 dry-run 后启动；`/health` ready、Web 200。停止后两端口 listener=0、OMP ACP root=0，隔离目录已按固定绝对路径清理。
- 唯一一次 independent review 覆盖 `4aab0ef6c..c6bb6b2a8`，结果为 `NO FINDINGS`；因此合并修复不适用，没有制造空修复或开启第二轮审查。
- 审查后 fresh verification：contracts 1/1、server focused 67/67、OMP ProviderHealth 9/9（93 skipped）、Web OMP projection 2/2；contracts/server/Web build 均成功，`git diff --check` 作为最终提交后门禁执行。`bun fmt`、`bun lint`、`bun typecheck` 明确 `NOT RUN`。
