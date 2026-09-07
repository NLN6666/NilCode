# Plan 019 — Oh My Pi Provider Phase 3（typed extensions）

- 状态：DONE WITH DOCUMENTED LIMITS
- 创建：2026-08-14
- NilCode 基线：`dev` / `59a5a48d2075770cc605a60a465735a0fb6b88f8`
- 前置：Phase 1 / Phase 2 已完成；stock OMP 17.3.2 缺少四项 typed status/control/drain
- 范围：NilCode contracts/server/web；必要时独立 OMP 官方 checkout 的 ACP upstream patch
- 排除：第二 transport、stdout/transcript/XML/tool 文案解析、ACP SDK 升级、用户全局 OMP 配置改写、push/PR/merge

## 1. 目标与不变量

1. OMP thread 的 Launch、Advisor、Memory、Auto-Learn 仍由 OMP-native runtime 唯一拥有；生产会话继续共享 `~/.omp`，只使用 `~/.omp/synara/acp-provider.yml` overlay。
2. Synara 通过现有 ACP extension request/notification convention 协商版本化 typed API，不改 NDJSON framing、不增加 wrapper、side transport 或 scraper。
3. stock/旧 OMP、method-not-found、超时、畸形响应和未知破坏性 schema 都安全降级到 Phase 2 configured-policy-only；普通 ACP 会话必须继续可用。
4. Synara server 拥有经过 schema 校验、generation/sequence 去重后的 typed effective state；Web 只消费 server projection，不猜运行状态。
5. OMP Advisor note 投影到现有 Advisor activity/card，明确来源为 OMP；不得启动 Synara Advisor reactor。OMP Launch 投影到现有 Services surface，明确 authority 为 OMP；不得写入 Synara daemon broker。
6. 所有 request/drain 都有 deadline/cancel；frame、队列、日志 chunk 与 notification backpressure 均有界；remote secret 与绝对敏感位置做结构化 redaction。

## 2. W0：官方证据与两仓边界

1. 核验本机真实 `omp` path/version/identity、官方当前 release/tag/commit 和官方当前源码是否已经包含目标 typed APIs。
2. 查找本机现有 `can1357/oh-my-pi` checkout；若不存在，只在 NilCode 外创建独立官方 checkout，并记录 path/remote/base/HEAD/cleanliness。
3. 优先验证官方 plugin/extension API 是否能在 ACP agent 的同一连接上注册 agent-side extension method/notification。只有真实 API 支持才制作 packaged extension；否则直接修改 OMP upstream ACP agent。
4. OMP patch 必须 schema/runtime-owner/ACP wiring 分层，并遵守上游 `AGENTS.md` / `CONTRIBUTING.md` 与至少三个相邻模式。

STOP：无法取得或安全修改 OMP 源码；官方架构无法从真实 owner 读取状态；只能依赖 stdout/transcript/XML/tool 文案；只能通过第二 transport；或 destructive Memory/Launch 验收无法隔离。命中时仅保留计划、fixtures、兼容 consumer 与明确限制，不宣称 Phase 3 完成。

## 3. 协议 v1

方法名可在 W0 后按官方 convention 微调，但 wire 语义固定。所有 request/response/event envelope 包含：

- `schemaVersion: 1`
- `sessionId`
- `generation`
- `sequence`（notification 单调递增）或 `correlationId`（request/operation 因果关联）
- `timestamp`
- typed `error`（code/message/recoverable/detail；detail 必须 redact）

### 3.1 Capability negotiation

- `_omp/capabilities`
- 返回 OMP version、协议 schema/version、method/event 列表和四项 feature matrix。
- 每项显式：`available`、`enabled`、`observable`、`controllable`、`recoverable`。
- additive fields 忽略；未知破坏性 major/version fail closed。method-not-found、timeout、malformed 返回 degraded，不使 ACP session 启动失败。

### 3.2 Advisor

- Methods：`_omp/advisor/status`、`_omp/advisor/set`、`_omp/advisor/drain`。
- Event：`_omp/advisor/note`。
- status：enabled/active/model/advisors/backlog/inFlight/lastFailure/usage 或字段级 unavailable；工具风险显式标识 write/exec。
- note：advisor id、severity、delivery、turn/session correlation、content、sequence/timestamp。
- set 只允许安全、明确可控字段；drain 有 deadline/cancel 和 typed outcome。

### 3.3 Auto-Learn

- Methods：`_omp/autolearn/status`、`_omp/autolearn/drain`。
- Event：`_omp/autolearn/lifecycle`（started/completed/failed/cancelled）。
- status：enabled/autoContinue/state/capture generation/turn/pending/last result/failure。
- drain：deadline/cancel；只在 typed completed 后宣称 capture 完成。

### 3.4 Memory

- Methods：`_omp/memory/status`、`_omp/memory/stats`、`_omp/memory/diagnose`、`_omp/memory/enqueue`、`_omp/memory/clear`。
- status/stats：backend/scope/storage kind/safe path id/queue/consolidation/error；remote endpoint/secret redact。
- clear/reset 必须返回 typed confirmation challenge，第二次携 challenge 才执行；真实共享 profile 禁止 destructive 测试。

### 3.5 Launch

- Methods：`_omp/launch/list`、`_omp/launch/describe`、`_omp/launch/logs`、`_omp/launch/send`、`_omp/launch/stop`、`_omp/launch/restart`。
- Event：`_omp/launch/lifecycle`。
- stable service id、cwd/command/state、pid optional、startedAt、restart、owner、bounded log cursor/sequence/failure。
- OMP registry 是 OMP thread 唯一权威；Synara Services projection 不注册到 daemon broker。

### 3.6 Managed skills

仅当 capabilities 宣布稳定 typed managed-skills catalog 且真实来源可验证时接入统一 catalog；否则 composer capability 明确 unsupported，不扫描私有目录猜测。

## 4. NilCode 实现边界

1. `OmpExtensionProtocol`：OMP-only Effect schemas、method/event constants、version/redaction/compatibility helpers；不污染通用 provider capability。
2. `OmpControlPlane`：协商结果、live typed state、generation/sequence 去重、bounded typed request/drain、Phase 2 fallback；Adapter/UI 不散落协议判断。
3. `OhMyPiAdapter`：start 后 negotiation；在通知 consumer 启动前注册 typed handlers；prompt/close 优先 typed Advisor/Auto-Learn drain，unsupported/error 回退 Phase 2 settle并发 degraded warning。
4. 生命周期：stopSession、stopAll/server stop、crash、resume/load 共用幂等 barrier；旧 generation 和重复/out-of-order sequence 丢弃并保留 bounded diagnostic。
5. 投影：Advisor activity、OMP-authoritative Services roster/log/control、settings 的 Memory/Auto-Learn/typed feature matrix；危险 Memory clear 必须确认。

## 5. OMP upstream 实现边界

1. schema/types 与 ACP wiring 分离；typed state 从 Advisor/Auto-Learn/Memory/Launch 真实 owner/runtime 读取，不复制私有状态。
2. status 只读；control 有权限、确认、typed error；handler 不得无界等待。
3. notification 带 session/turn/generation/sequence；Launch logs 有 cursor/limit；Memory secret/path 安全投影。
4. capability、每个 method/event、版本协商、malformed/error/deadline 均有 focused tests；不能只有字符串 fixture。

## 6. TDD seams 与矩阵

| Seam                | Red/green 行为                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| ACP extension wire  | capability v1 decode；method-not-found/timeout/malformed/unknown version degrade；notification schema 与有界 frame |
| control-plane state | generation/sequence dedupe；stale resume/new 拒绝；redaction；typed error；feature matrix                          |
| Advisor             | typed status/note/drain；severity/delivery/correlation；write/exec risk；现有 activity/card 来源标识               |
| Auto-Learn          | started/completed/failed/cancelled；deadline/cancel drain；fallback settle不假称完成                               |
| Memory              | status/stats/diagnose；enqueue；confirmation challenge；共享 profile destructive guard                             |
| Launch              | list/describe/logs/send/stop/restart；bounded cursor；lifecycle；OMP authority；不进 daemon broker                 |
| lifecycle           | stopSession/stopAll/server stop/crash/resume/load 幂等、无 stale、无无限等待                                       |
| Web                 | live typed、degraded stock fallback、scope/backend/queue/error、authority/source、危险确认                         |

NilCode 只用 `bun run test` 的 focused 命令。`bun fmt`、`bun lint`、`bun typecheck` 未授权，最终必须标 `NOT RUN`。

## 7. 真实双端验收

1. fake/fixture 先闭环，再构建运行 patched OMP 或官方 packaged extension。
2. Synara 使用隔离 home、非默认端口、unset `SYNARA_AUTH_TOKEN`，先 dry-run。
3. 生产 policy 仍共享 `~/.omp`；Memory clear/enqueue 与 Launch start/stop/restart 使用临时隔离 OMP agent dir/profile、隔离 cwd、可识别进程，最终证明 root/descendant 为零。
4. 必须保留真实 frame/schema/server/UI projection 证据：capability + stock fallback；Advisor note/drain；Auto-Learn lifecycle/drain；Memory status/stats 与隔离写/清；Launch 完整控制；kill/restart/resume generation/sequence 去重。

## 8. 验收台账

| 项目                              | 状态                   | 证据                                                                                 |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| W0 官方 current/release/binary    | DONE                   | current `ad318c7` / release 17.3.3；stock 17.3.2 无 typed API                        |
| OMP checkout/base/remote          | DONE                   | `D:/Codes/oh-my-pi-phase3` / official remote / `ad318c7`                             |
| 协议 v1 schemas + negotiation     | DONE                   | 同一 ACP connection；strict v1 + additive fields；unknown major fail closed          |
| Advisor typed + projection        | DONE                   | real blocker note seq=2；drain seq=4；Synara Advisor source=OMP                      |
| Auto-Learn typed + projection     | DONE                   | real started/completed + typed drain/status                                          |
| Memory typed + projection         | DONE                   | status/stats/diagnose + isolated enqueue/clear challenge                             |
| Launch typed + projection         | DONE                   | isolated full lifecycle + bounded logs；Services authority=OMP                       |
| stock fallback/version drift      | DONE                   | 17.3.2 method-not-found -> Phase 2 configured-only                                   |
| fake/fixture focused tests        | DONE                   | OMP/NilCode protocol, control-plane, contracts, Web projection suites                |
| patched OMP focused tests/build   | DONE WITH LIMIT        | TS build + official cached 17.3.3 native addon；formal native build metadata stalled |
| isolated real dual-end validation | DONE                   | raw ACP probes + isolated Synara browser/server projection                           |
| root/descendant cleanup           | DONE                   | temp removed；58919/8891 listeners=0；patched OMP processes=0                        |
| one independent review            | DONE                   | 双仓只读 review；1 个 queue-full/drain truthful P1                                   |
| one consolidated fix              | DONE                   | per-generation dropped backpressure + red→green regression                           |
| fresh verification + diff check   | DONE                   | OMP 33/33 + types/build；NilCode 58+1+11+3 + 3 builds；两仓 diff check               |
| heavyweight gates                 | NOT RUN (UNAUTHORIZED) | `bun fmt` / `bun lint` / `bun typecheck`                                             |

## 9. 提交与发布边界

- 两仓分别创建 scoped commits，只 stage 明确文件，提交前核对 staged diff。
- 不 stage 用户/并行任务的既有变更；若出现重叠改动立即 STOP。
- 不 push、不创建 PR、不 merge、不安装 patched OMP、不修改用户全局 OMP 配置。
