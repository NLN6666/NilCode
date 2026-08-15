# Plan 020 — Oh My Pi Provider Phase 4（publication and adoption）

- 状态：IN PROGRESS
- 创建：2026-08-15
- NilCode 发布基线：`NLN6666/NilCode` `dev` / `c4c79f32fb4f672e0f49443a303c15605449f228`
- OMP 发布基线：`can1357/oh-my-pi` `main` / `ffd53ff92a6f575d499730475a73460dd7cc2eea`（`v17.3.4`）
- 前置：Phase 1–3 已在 NilCode `32653fb065a562995dd8f747f1840044d4a84f2c` 与 OMP `f7fd74b63b3037e412d2ae9ed124a46dee4cfd1b` 完成并验证
- 发布边界：只创建 scoped branches 与 Draft PR；不 merge、不 force push、不创建 tag/release、不覆盖用户全局 OMP 安装或配置

## 1. 目标与验收定义

1. 将 OMP typed ACP extension 以单一 scoped commit 移植到最新官方 `main`，通过 focused protocol/runtime gate、正式 native gate 或等价官方 CI 门禁，并创建面向 `can1357/oh-my-pi:main` 的 Draft PR。
2. 将 NilCode OMP Phase 1–3 的最小依赖闭包发布到 `NLN6666/NilCode:dev` 的独立 Draft PR，不携带本地 `dev` ahead 302 的其余提交。
3. 参考 Synara PR #496 的通用 ACP lifecycle、authentication 与 config-option wiring，但保留本地 control-plane、typed v1、stock fallback 和 OMP-native authority；明确披露重叠，不等待 #496。
4. 从 scoped OMP PR commit 构建可追溯 artifact，在隔离 prefix/profile/home/ports 中完成安装、切换、四项 typed smoke 与 stock rollback；全局 OMP 不作为试验目标。
5. 只有官方 upstream PR 已 merge 且官方 release/package 包含目标 commit，才标记 official release adoption；否则状态为 Draft PR + CI + isolated artifact adoption，并记录 `BLOCKED BY UPSTREAM`。

## 2. W0 发布拓扑与门禁

### 2.1 当前拓扑

| 仓库 | 原始 checkout | publication worktree | base | branch |
| --- | --- | --- | --- | --- |
| NilCode | `D:/Codes/NilCode`，`dev@58e538361`，clean，ahead `origin/dev` 302 | `D:/Codes/NilCode-phase4-publish` | `origin/dev@c4c79f32` | `agent/synara-omp-provider` |
| OMP | `D:/Codes/oh-my-pi-phase3`，`main@f7fd74b63b`，clean，ahead 1 / behind 31 | `D:/Codes/oh-my-pi-phase4-publish` | `origin/main@ffd53ff92a` | `agent/omp-acp-typed-extensions` |

- GitHub 账户：`NLN6666`；认证 scope 已核验包含 `repo` / `workflow`。
- OMP 官方仓库无 push 权限；使用 `NLN6666/oh-my-pi` fork remote 发布 head branch。
- 当前全局 `omp --version` 为 `17.3.4`，但 `f7fd74b63b` 不是 `v17.3.4` 或 `origin/main` 祖先；版本号不能代替 schema capability negotiation。

### 2.2 已知重叠与用户决策

- Synara PR #496 已实现 stock OMP ACP provider；用户于 2026-08-15 明确授权本 PR 独立发布到 `NLN6666/NilCode`，不等待 #496。
- 参考 #496：通用 teardown/cancellation、`agent` auth、model → thinking 设置顺序、仅设置 advertised mode、provider runtime wiring。
- 不复制 #496：完整 OMP Adapter、私有 skills 目录扫描、catalog 作为运行态真源、unsupported optional feature 导致普通 ACP session 失败。
- OMP 邻近 PR 修改 ACP settled metadata、Advisor extension、Auto-Learn 或 Memory 时，PR body 明确关系；不声称替代或合并其工作。

### 2.3 STOP 条件

- 任一原始或 publication worktree 出现非本任务变更。
- 远端 publication branch 已存在且 owner/history 不可证明安全复用。
- push 需要 force、出现 non-fast-forward，或 fork/PR policy 阻止安全发布。
- scoped commit 需要携带整个 NilCode `dev`、upstream v0.7.2 merge，或无法逐项证明的非 OMP 依赖。
- OMP typed runtime 无法在最新 main 通过协议/types/focused gate，或只能通过降低测试/CI/native 门禁。
- destructive Memory/Launch smoke 无法与用户 profile、memory、service 和全局安装隔离。

## 3. Branch 与依赖闭包策略

### 3.1 OMP

1. 以 `origin/main@ffd53ff92a` 建立 `agent/omp-acp-typed-extensions`。
2. cherry-pick `f7fd74b63b`；其与 base 后续提交的 changed-file 交集为空，`git merge-tree --write-tree` 已得到无冲突结果，但仍需 fresh types/tests/build。
3. 最终 diff 只允许 Phase 3 的 schema/runtime/ACP owner wiring/tests/changelog 必需项；不得引入 cached addon。
4. push 到 `NLN6666/oh-my-pi:agent/omp-acp-typed-extensions`，Draft PR base 为 `can1357/oh-my-pi:main`。

### 3.2 NilCode

1. 以 `origin/dev@c4c79f32` 建立 `agent/synara-omp-provider`；绝不 push 原始 `dev`。
2. 按父序列 cherry-pick OMP Phase 1–3 的 15 个 scoped commits：
   - `7eea8ecf3`, `3e6ad7d16`, `3e95adc30`, `e51d0f109`, `e2af468fc`
   - `4aab0ef6c`, `e23e6b981`, `c50245fe9`, `207f9bf66`, `c1ea229ec`
   - `42c0ef654`, `c6bb6b2a8`, `59a5a48d2`, `f271bf925`, `32653fb06`
3. `4aab0ef6c` 是 ACP terminal environment 安全边界的真实依赖；明确列入。
4. 排除 `a191dd8eb`、`a17ebcb6d`、`58e538361` 及其余 302 个本地提交。
5. Phase 4 adoption/文案只做必要增量 commit；协议兼容性以 `schemaVersion` 为第一真源，不硬编码未发布版本。

## 4. 协议、兼容与安全不变量

- 协议：`omp-acp-extensions` schema v1；所有 envelope 保留 session/generation/sequence/correlation/timestamp/typed error。
- 能力：Advisor、Auto-Learn、Memory、Launch 的 available/enabled/observable/controllable/recoverable 显式声明。
- Advisor：status/set/drain/note；drain 同时等待真实 Advisor 与 notification queue。
- Auto-Learn：status/drain/lifecycle；未收到 typed completed 不宣称 capture 完成。
- Memory：status/stats/diagnose/enqueue/clear；clear 必须 challenge + confirm，验收只使用隔离 profile。
- Launch：list/describe/logs/send/stop/restart/lifecycle；OMP registry 是唯一 authority，日志/请求有界。
- backpressure：dropped/send-failed 按 generation 计数；任一丢失使 `settled=false`；`notificationBackpressure.recoverable=false`；保留 257-event regression。
- stock/旧 OMP：method-not-found、timeout、malformed、未知破坏 schema 均降级 configured-only，普通 ACP 仍可 prompt/read/stop。
- additive fields 可忽略；版本号仅用于诊断，不覆盖 schema negotiation。

## 5. 正式 native 与 CI 门禁

1. 先运行固定 nightly 的 `cargo metadata --format-version 1 --no-deps`，记录耗时和进度，确认过去 metadata 卡顿是否仍存在。
2. Windows host 正式 addon 使用仓库 `bun run build:native`，后台运行并保存日志；不得把 `packages/natives/native` 缓存或官方 leaf addon 当作本地 formal build 成功。
3. 若本地环境仍无法完成：保留真实诊断证据，依赖上游 GitHub Actions 的 native/release gate；不改 workflow 跳过 gate、不降低检查。
4. OMP Draft PR 初始 CI 等待到 terminal state，记录每个 check/job URL。scope 内失败集中修一次；base/infra 失败提供对照。
5. NilCode Draft PR CI 同样等待 terminal state；本地不运行未授权的 `bun fmt`、`bun lint`、`bun typecheck`，远端自动执行则如实区分。

## 6. 本地验证矩阵

### 6.1 OMP

- focused protocol/runtime/Advisor/Auto-Learn tests。
- types/check、package build、`git diff --check`。
- Windows native host build，或官方 CI native gate terminal evidence。

### 6.2 NilCode

- Phase 1–3 focused contracts/server/web suites。
- contracts/server/web production builds。
- stock method-not-found fallback 与 typed state/projection regressions。
- `git diff --check` 与 base/head/changed-files scope audit。
- `bun fmt` / `bun lint` / `bun typecheck`：`NOT RUN (UNAUTHORIZED)`。

## 7. 唯一 review 与一次修复

1. 在最终 push 前固定两仓 base/head，分别生成 publication diff 与 commit list。
2. 只执行一次独立双轴 review：repo standards + 本计划/Phase 3 spec。
3. 汇总所有 findings 后只进行一次集中修复；若无 finding，不虚构修复。
4. 不执行第二轮 review；修复后只做 fresh verification 和 diff/scope check。
5. CI 失败诊断不计为第二轮 review，但同一 scope 的代码修复仍集中处理。

## 8. Draft PR 依赖与正文

### 8.1 OMP Draft PR

- 问题/用户价值；schema v1 与兼容降级；四项 methods/events；Memory confirmation；Launch authority；generation/sequence/redaction/bounds/backpressure。
- 明确 257-event P1 修复、测试、native build/CI、breaking-change 判断。
- 不写本地绝对用户路径、token、真实 memory/config/service 内容。

### 8.2 NilCode Draft PR

- base/head 和 15-commit 最小闭包；不含 upstream v0.7.2 merge与其余 302 commits。
- 链接 OMP upstream Draft PR，说明 typed capability 依赖 patched/upcoming OMP。
- 明确与 Synara #496 重叠且按用户决策独立发布；列出参考但未复制的边界。
- stock fallback 允许无 OMP upstream merge 时独立 review，不能宣称 stock release 已支持 typed extension。

## 9. Artifact、安装、切换与回滚

1. 从 OMP publication HEAD 构建/pack artifact，记录 package version、文件列表、native platform/variant、SHA-256、source commit 和构建命令。
2. 使用临时 Bun prefix/独立安装根，不覆盖全局 OMP；验证 install → upgrade/replace → uninstall/rollback。
3. Synara 使用隔离 home、非默认 ports、unset `SYNARA_AUTH_TOKEN`、先 dry-run；`binaryPath` 指向隔离安装。
4. 隔离 OMP profile/cwd 验收 capability、Advisor、Auto-Learn、Memory、Launch；Memory clear 和 Launch stop 只作用于临时数据/进程。
5. 证明当前 stock `17.3.4` 无 typed commit时仍 configured-only + 普通 ACP 可用；切换 patched artifact 后 typed 可用；回滚 stock 后恢复 configured-only。
6. 完成后证明 listener、OMP/Synara root/descendant 和 temp service 均为零；临时目录仅在 exact-root guard 后清理。

## 10. 验收台账

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| W0 auth/remotes/releases | DONE | `NLN6666`; official OMP `v17.3.4`; scoped bases above |
| #496 reference decision | DONE | 独立发布；仅参考通用 ACP lifecycle/config wiring |
| Plan 020 scoped commit | DONE | `978012821` |
| OMP rebase/cherry-pick | DONE | `origin/main@ffd53ff92a` → `bc07667437` |
| OMP focused/types/build | PENDING | fresh gate |
| formal native gate | PENDING | local Windows build or official CI terminal evidence |
| OMP Draft PR + CI | PENDING | no merge |
| NilCode 15-commit closure | DONE WITH ADAPTATION | 15 scoped commits; excluded provider-isolation/VCS/device/service-panel prerequisites |
| NilCode focused/build | PENDING | heavyweight checks remain unauthorized |
| NilCode Draft PR + CI | PENDING | links OMP PR and discloses #496 overlap |
| one review / one fix | PENDING | no second review |
| artifact provenance | PENDING | version/files/native/hash/source |
| isolated install/smoke/rollback | PENDING | no global overwrite |
| official release adoption | BLOCKED BY UPSTREAM | `v17.3.4` lacks `f7fd74b63b` |

## 11. 最终不变量

- 两个 PR 均保持 Draft/open；不 merge。
- 不 force push、不创建 tag/release、不修改 GitHub issue/comment。
- 不覆盖或改写用户全局 OMP binary、package、profile、memory 或 config。
- 不关闭用户现有 Synara/OMP/service；只管理隔离验收进程。
- 自动测试/build/CI 不证明官方 release adoption；未 merge/release 时明确 external blocker。
