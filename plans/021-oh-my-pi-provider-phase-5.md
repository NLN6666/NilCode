# Plan 021 — Oh My Pi Provider Phase 5（review, native closure, official adoption）

- 状态：IN PROGRESS — readiness 可执行；formal native / official adoption 受上游状态约束
- 创建：2026-08-15
- NilCode publication：`NLN6666/NilCode:agent/synara-omp-provider@1e2dbd256`
- OMP publication：`NLN6666/oh-my-pi:agent/omp-acp-typed-extensions@591eaaa21e`
- 权限边界：不得 merge、tag、release；不得改写 upstream base；不得 force push；只向现有 scoped branches 普通 push

## 1. Phase 5 目标

1. 将 OMP PR #8609 从 Draft/no-checks 推进到正文、scope、安全说明与本地门禁完整的 Ready for review 状态，并让 upstream maintainer 能一次性批准 fork workflows。
2. 逐条处理两个 PR 的真实 actionable review/CI finding；question/out-of-scope/stale 只澄清，不扩 scope。
3. 以本地 `bun run build:native` 的 fresh Windows source build，或官方 PR CI native matrix terminal success，正式关闭 native gate。
4. 仅当 typed extension 已进入 official main 且 official release/npm package 明确包含该 commit 时，执行 official package adoption、NilCode 适配和生产全局升级/回滚。
5. 上游未 merge/release 时诚实停在 READY / BLOCKED BY UPSTREAM，不把 PR head、fork artifact 或 cached native addon称为 official release。

## 2. 实时基线（2026-08-15，已重新核验）

| 项目 | 当前事实 |
| --- | --- |
| OMP PR | `can1357/oh-my-pi#8609`，Draft/OPEN/MERGEABLE，base `main@ffd53ff92a`，head `591eaaa21e`，0 comments/reviews/threads，`statusCheckRollup=[]` |
| OMP Actions | CI `31863300837`、OMP Nix `31863300824` 均 `completed/action_required`，0 jobs、无日志；fork approval gate 证据成立，未见 workflow/schema 执行错误 |
| NilCode PR | `NLN6666/NilCode#1`，Draft/OPEN/MERGEABLE，base `dev@c4c79f32`，head `1e2dbd256`，0 comments/reviews/threads |
| NilCode CI | run `31864772534` 的 main job 仅在 unchanged base 文件 `docs/superpowers/specs/2026-08-08-launch-mention-design.md` 失败；PR changed-files 不含该文件；其他独立 jobs PASS |
| Official OMP | main/release/npm 均为 `ffd53ff92a` / `v17.3.4` / `17.3.4`；#8609 head 不是 official main 祖先 |
| Native 本地 | pinned `nightly-2026-07-28` 与 Bun `1.3.14` 可用；`zip` 缺失；workspace `.node` 与 cached official 17.3.4 addon hash 相同，不具备 source-build provenance |
| 原 checkout | NilCode `dev@58e538361` clean；OMP `main@f7fd74b63b` clean；本 Phase 不切换、不提交、不 push |

## 3. PR follow-through

1. 每次 GitHub mutation 前重新核验 repo/PR/head/base；异常即 STOP。
2. OMP正文必须保留 schema v1、stock method-not-found fallback、generation/sequence、Memory confirmation、Launch authority、bounded redaction、notification backpressure、breaking-change判断、native真相和 downstream dependency。
3. OMP local focused gates与scope审计通过后 mark Ready；Ready不构成 merge授权。
4. 先读现有 comments 防重复；最多发送一条 OMP maintainer comment，请求批准 fork CI/Nix workflows，并附 local verification 与 formal-native未关闭事实。
5. NilCode在 official release dependency未满足时保持 Draft；base-only format blocker只记录，不修改 base 文件、不建第三个 PR。

## 4. Formal native gate

1. 在 OMP publication HEAD 记录 branch/status、toolchain、cache/artifact pre-hash/mtime。
2. 先运行 `cargo metadata --format-version 1 --no-deps` 并保存耗时、日志、进程/CPU/cache/mtime证据。
3. 后台执行官方 `bun run build:native`；T+5 无输出且无活动判为疑似卡顿，T+10 介入保存现场，不盲等、不杀用户 Rust 进程。
4. 成功验收必须证明生成 addon 的 mtime/hash在本次运行变化，source/head为 `591eaaa21e`，且不是 cached `@oh-my-pi/pi-natives-win32-x64@17.3.4` 的复制品。
5. 本地未成功时，只有 official PR native job PASS 可关闭；cached addon只允许 focused non-formal tests。

## 5. Official release adoption gate

只有以下全部成立才进入安装：

- #8609或等价 upstream commit 已 merge 到 `can1357/oh-my-pi:main`；
- official GitHub release tag 与 npm package 的 commit ancestry/metadata证明包含该实现；
- official artifact/native matrix可验证。

若成立：

1. 记录 tag/commit/package/integrity/tarball与native addon hashes/changelog。
2. 临时 prefix/profile/cwd先安装 official package，完成普通 ACP、typed capability、Advisor/Auto-Learn/Memory/Launch safe smoke，再回滚 previous stock。
3. 生产升级前记录 global `omp` path/version/binary hash/package/config hash，准备精确回滚至原 `17.3.4`；不改 config/profile/memory。
4. 仅使用官方 package manager正常安装；失败立即回滚并验证普通 ACP恢复。
5. Synara先用隔离 home/ports和official global binary验证；Memory clear不confirm，Launch不操作用户服务。

若未成立：不修改 global OMP，不重复 Phase 4 patched artifact adoption；状态写 `BLOCKED BY UPSTREAM`。

## 6. STOP 条件

- publication/original worktree、PR head/base、remote topology与本计划基线不符。
- push需要 force或出现 non-fast-forward。
- GitHub mutation目标不是精确 PR #8609 / #1，或会产生重复 maintainer comment。
- 需要修改 upstream/base、workflow permissions、跳过 native、降低测试或扩大协议 scope才能变绿。
- official package不能证明包含 merged extension commit。
- global安装无法在不改 config/profile/memory的前提下准备精确回滚。

## 7. 验收台账

| 项目 | 状态 | 证据/下一步 |
| --- | --- | --- |
| auth/remotes/head/base | DONE | `NLN6666` scopes含 `repo`,`workflow`；两 publication worktree clean并匹配 PR head |
| PR comments/reviews triage | DONE | 两 PR 当前均 0 comments/reviews/threads，无 actionable finding |
| OMP body/scope/security | READY | 当前body已披露 protocol、安全、backpressure、breaking/native边界；待 fresh gate 后 mark Ready |
| OMP maintainer request | PENDING | mark Ready后最多发送一条批准 fork workflows请求 |
| OMP CI/Nix | EXTERNAL BLOCKER | runs `31863300837` / `31863300824` 为 `action_required`, 0 jobs |
| NilCode CI | BASE BLOCKER | run `31864772534`；唯一失败为 unchanged base-only fmt drift |
| formal native | OPEN | fresh local build或official native matrix二选一关闭 |
| official main/release/npm | BLOCKED BY UPSTREAM | `v17.3.4` 不含 `591eaaa21e` |
| official temp/global adoption | NOT ENTERED | release gate未满足前禁止执行 |
| Phase 5 unique review/fix | PENDING | 新增 Phase 5 diff完成后只做一次双仓review与一次集中fix |
| NilCode heavyweight local | NOT RUN (UNAUTHORIZED) | 禁止本地 `bun fmt` / `bun lint` / `bun typecheck` |

## 8. 完成边界

- OMP Ready + 唯一维护者请求 + 可执行本地验证完成后，不长期空转等待外部审批。
- 未获得 formal native success、upstream merge和official release时，Phase 5最终状态只能是 `READY / BLOCKED BY UPSTREAM`，不能写 DONE。
- 不自行 merge任何 PR，不创建 tag/release，不触碰原 checkout，不用本地绿色结果冒充官方 CI或生产验证。
