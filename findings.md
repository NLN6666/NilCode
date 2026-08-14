# Findings —— Agent 后台守护进程会话（plan 016）

记录实施过程中踩到的坑与实测结论，供后续排查参考。

---

## 1. Windows 上 `detached: false` 的子进程活不过父进程（推翻来源实现）

**背景：** 设计移植自 `can1357/oh-my-pi`，其 `DAEMON_SPAWN_OPTIONS` 在 Windows 上用 `detached: false`。

**实测：** Node v24 / Windows 11，子进程每 300ms 向日志文件追加一行，父进程 400ms 后 `process.exit(0)`，3 秒后统计行数。

| spawn 选项                                         | 行数 |
| -------------------------------------------------- | ---- |
| `detached: false` + `unref()`                      | 1    |
| `detached: true` + `unref()` + `windowsHide: true` | 58   |

**结论：** 全平台使用 `detached: true`；Windows 上加 `windowsHide: true` 防止弹控制台窗口。

**根因：** oh-my-pi 用 `Bun.spawn`，与 Node `child_process.spawn` 的 Windows 进程组语义不同。

**危险性：** 这个 bug 是**静默**的——进程看似启动成功，Synara 一关全部消失，无任何错误输出。

---

## 2. Bash 工具会清理进程树，会污染存活性测试

测 detached 行为时，父进程由 Bash 工具启动；命令返回时工具可能清理整个进程树，导致"子进程死了"这一观测无法区分是 `detached: false` 所致还是工具清理所致。

**做法：** 必须跑 `detached: true` 对照组。两组在同一工具条件下对比，差异才归因于 spawn 选项。

**副作用：** `detached: true` 的探针进程会真的活下去，测完必须显式 `Stop-Process` 清理，否则留下孤儿进程。

---

## 3. 仓库根 `package.json` 是 `"type": "module"`，临时脚本要用 `.cjs`

在仓库内写 `require()` 风格的临时探针脚本时，`.js` 会被当成 ES module 而报 `require is not defined`。改用 `.cjs` 扩展名。

---

## 4. Bash 工具拒绝过于复杂的复合命令

worktree 隔离会话中，带 heredoc + 多级 `&&` 的长命令会被拒绝执行（无法验证是否越出 worktree）。

**做法：** 用 Write 工具建文件，用多条简单 Bash 命令分步执行。

---

## 5. 新建的 worktree 没装依赖，报错会伪装成代码问题

`packages/contracts` 的测试报 `Cannot find package 'effect'`。真因是**这个 worktree 从未跑过 `bun install`**，`node_modules/effect` 根本不存在。

**判别方法：** 先跑一个**既有的**测试（如 `packages/contracts/src/terminal.test.ts`）。它也失败 → 环境问题；它通过 → 才是新代码的问题。

**修复：** `bun install --frozen-lockfile`（按 lockfile 安装，不是升级依赖）。

---

## 6. 本仓库的 effect 是 effect-smol 预览版，自定义校验用 `Schema.makeFilter`

`Schema.refine(fn, { title })` 会在运行时炸 `TypeError: check.run is not a function`。

**正确写法：** `SomeSchema.check(Schema.makeFilter((value: string) => /* boolean */))`。参考 `packages/contracts/src/browserAutomationToolInputs.ts:69`。

---

## 7. 校验器写坏时，"拒绝非法输入"的测试会假通过

`DaemonName` 的过滤器写错导致**所有**解码都抛异常。此时 4 条"应当拒绝"的用例全部通过——但它们是因为错误的原因通过的。

**判别方法：** 正向用例（应当解码成功）与反向用例（应当拒绝）**必须同时存在**。只有两者并存且都通过，才能证明校验器真的在按预期区分输入。只写拒绝用例的 schema 测试是不可信的。

---

## 8. 既有失败（非本次改动引入）

`packages/shared/src/loginShellEnvironment.test.ts` → `anchors the cache in the Synara home both processes resolve`

```
expected 'D:\tmp\synara-home\cache\login-shell-…' to be '\tmp\synara-home\cache\login-shell-en…'
```

Windows 盘符前缀问题。`git log --name-only 6373224d..HEAD | grep -c loginShell` = 0，本分支从未触及该文件。**汇报测试结果时须把它算作既有失败，不得计入本次改动。**

---

## 9. UTF-8 字节游标的起始与结束边界对齐方向相反

`sliceHistorySince` 首版两端都用"向前对齐到下一个字符起始"，导致 `maxBytes` 截断时**超出**上限（要 7 字节却返回了 9 字节）。

**正确做法：** 起始偏移向前跳过残续字节；结束偏移向后退回上一个字符边界（因为它受 `maxBytes` 约束，向上取整会超额）。测试 `backs off to a character boundary when maxBytes truncates` 固化了该行为。

---

## 10. effect-smol 的 `Effect.gen` / `Effect.suspend` 不捕获同步 throw

`daemonTools.ts` 里参数解析抛 `ToolInputError`，下面两种写法都**捕不到**：

```ts
Effect.suspend(() => handler(args)).pipe(Effect.catch(...))               // 捕不到
Effect.gen(function* () { yield* handler(args) }).pipe(Effect.catch(...)) // 也捕不到
```

同步 throw 变成 **defect**，而 `Effect.catch` 只接错误通道，defect 直接穿透，整个 JSON-RPC 请求失败 —— Agent 只知道"炸了"，不知道是自己参数写错。

**正确写法：**

```ts
Effect.try({ try: () => handler(args), catch: (error) => error }).pipe(
  Effect.flatMap((effect) => effect),
  Effect.map(mcpToolResultJson),
  Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error)))),
);
```

**同一模式在 `agentGateway/automationTools.ts` 也存在**（`Effect.gen` 内 `readStringArg(..., {required:true})` + 尾部 `Effect.catch`），属既有代码，本次未改。若要修，须先补一条"缺参数返回 `isError` 而非整个请求失败"的测试。

---

## 11. 进程句柄的监听器必须缓冲

`brokerCore` 是在 `await launcher.launch(...)` **之后**才 `onExit` / `onOutput`。秒退的进程（例如可执行文件不存在）在这个窗口里就死了，`settle()` 打进空处，守护进程**永远卡在 `starting`**。

测试 `delivers an exit that happened before the listener was attached` 的失败症状不是断言不符，是**超时挂死**。

**解法：** `BaseHandle` 里用 `pendingOutput` / `pendingExit` 缓冲，`onOutput` / `onExit` 注册时立即回放。

---

## 12. detached 子进程自己写日志，broker 不能再 append

detached 的 stdout/stderr 直接指向 `output.log` 的 fd。若 broker 把 tailer 回放的内容再 `log.append()` 一遍，**每行都会翻倍**。

`DaemonProcessHandle.writesOwnLog` 标记这类句柄；且该标记必须在 `launch` 时**捕进闭包**，不能在回调里读 `record.process?.writesOwnLog` —— `settle()` 会把 `record.process` 置空，退出后最后一次 flush 就会漏判成"要 append"。

---

## 13. reclaim 时不能轮转日志

`DaemonLog.open` 默认把 `output.log` 移成 `output.prev.log`。认领一个还活着的 detached 守护进程时这样做，会让它继续往一个**已被改名、没人读**的 fd 里写。故 reclaim 必须走 `DaemonLog.open(dir, { reuseExisting: true })`。

---

## 14. node-pty 在 Windows 上不解析 PATH

真实 Purpur 服务端验收时，`application: "java"` 直接失败：

```
File not found: java
```

`child_process.spawn` 在 Windows 上会按 PATH + PATHEXT 找 `java.exe`，**node-pty 不会**，它要完整路径。而"写裸命令名"恰恰是 Agent 的默认行为。

**解法：** launcher 在交给 node-pty 前用仓库既有的 `executableLookup.resolveExecutable(command, { env })` 解析；解析不到就原样传下去，让平台自己报错，不要自造错误信息。piped / detached 两条路走 `child_process`，本来就会解析，无需改动。

回归测试：`launcher.test.ts` 的 `resolves a bare command through PATH before handing it to node-pty`。

---

## 15. detached + 有状态服务器 = 危险组合（推翻 plan 016 Task 11 的验收脚本）

plan 016 Task 11 原本写的验收命令用 `detached: true` 起 Minecraft。**那是错的**：

detached 把 stdio 重定向到日志文件，**没有 stdin**，于是发不了 `stop`；唯一的关停手段是信号，而 Windows 上 Node 的 `process.kill(pid, 'SIGTERM')` 走 `TerminateProcess`，等同硬杀 —— 正是会损坏世界存档的那件事。

**正确分工：**

| 模式                            | 适用                        | 关停方式                       |
| ------------------------------- | --------------------------- | ------------------------------ |
| `pty: true`（默认，supervised） | Minecraft 等有状态服务器    | 发自身命令（`stop`），优雅落盘 |
| `detached: true`                | 无状态服务（dev server 等） | 信号 / 强杀，无所谓            |

实测（`minecraftAcceptance.test.ts`）：supervised PTY 下 `Done (9.981s)!` 命中就绪、`list` 有回应、`stop` 后三个维度 `All chunks are saved`。

---

## 16. 实机上 Agent 仍用 PowerShell 起服务，服务面板空白（纯 prompt 约束不成立）

**现象：** 面板功能上线并装到实机后，Agent 依旧在 Bash 里用 PowerShell 起长驻服务，服务面板里什么都没有。

**排查结论：不是 UI bug，不是构建陈旧，是唯一入口被绕过且无人察觉。**

证据（实机 `C:\Users\kingt\.synara`，打包版 `app.asar` 构建于 2026-08-08 17:58）：

| 检查                                                    | 结果                                                    |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `grep -a -c synara_start_daemon app.asar`               | 6 —— 工具在打包产物里                                   |
| `grep -a -c "Never background it from a shell instead"` | 2 —— 策略原文也在                                       |
| `serverLayers.ts` 的 `DaemonBrokerLive`                 | 无条件提供，工具必然被 advertise                        |
| `.synara/userdata/`、`.synara/dev/` 下的 `daemons/`     | **不存在**                                              |
| `server.log` 中 "daemon" 出现次数                       | **0**                                                   |
| `server.log` 末次会话                                   | `claudeAgent` / `claude-opus-5` / `hasMcpServers: true` |

**判别方法：** 想确认实机跑的是不是新构建，别问、别看 git，直接 `grep -a` 打包后的 `app.asar` 找特征字符串。想确认某个 daemon 是否真被启动过，看 `<stateDir>/daemons/` 目录在不在 —— broker 启动任何 daemon 都要建目录写 `output.log`，目录不存在即"一次都没成功调用过"，比翻日志强。

**三个结构性弱点（都不是实现 bug，是约束强度不够）：**

1. **零运行时约束。** 整条规则只是 system prompt 里的一行字。Agent 在 Bash 里跑 PowerShell 时，没有任何东西检测、阻止或回一句提示 —— 它不知道自己违规，用户也收不到告警。
2. **规则被稀释。** daemon 规则是 `controlPolicy` 数组第 7 条，前后被 browser\_\*、automation、thread 创建等约 20 条挤着；而 Claude Code preset 本身在强推它自己的 Bash `run_in_background`。宿主的一行字对抗的是 provider 原生习惯。
3. **枚举漏了 Windows 惯用法。** `harnessPolicy.ts:25` 点名了 `&`、`nohup`、`start /b`、run-in-background flag，**唯独没有 PowerShell 的 `Start-Process`** —— 而这正是 Windows 上 Agent 的首选写法。

**次生缺口（本次不触发，但会咬别的 provider）：** `takeSynaraHarnessPolicyForSession`（`harnessPolicy.ts:96`）只判断 `harnessPolicyDelivered` 布尔值，**不比对 `SYNARA_HARNESS_POLICY_VERSION`**。claudeAgent 走 `systemPrompt.append`（`ClaudeAdapter.ts:5257`）每次会话都带，不受影响；codex / cursor / grok / droid / pi / opencode / antigravity 走一次性投递，策略版本升级后，同一 server 进程里已开着的会话永远收不到新规则。
---

## 28. OMP ACP Provider 调研（2026-08-14）

- 当前 OMP `main` 为 `17.3.3` / `ad318c7`。旧 RPC 文档中“host defaults 会复位 `memory.*` / `advisor.*`”不能直接用于当前设计：OMP `16.1.12` 已修复 RPC/ACP 覆盖显式 global/project/`--config` 配置的问题。
- OMP ACP `initialize` 只广告标准 session/MCP/prompt 能力，session config options 只提供 mode/model/thinking；ACP agent 与 event mapper 没有 Advisor、Auto-Learn、Memory 的专属 method/update，Launch 只会作为普通 tool activity。行为可运行不等于产品级可观察。
- Synara 已有自己的 Advisor 与从 OMP 移植增强的 daemon/`@Launch`。OMP provider 若同时启用两套 Advisor 或两套进程 registry，会产生重复 steer、状态分叉与所有权不明；正式设计必须加入互斥仲裁。
- 调研过程没有可用的 LCC MCP，按仓库规则降级到 FastCtx 并抽查当前文件。后台探子按 research skill 被要求生成调研文件，但只返回了线索而未落盘；主代理复核一手资料后创建 `docs/research/2026-08-14-oh-my-pi-acp-provider.md`。

---

## 29. OMP Phase 1 计划细化（2026-08-14）

- 产品决策锁定：OMP-native ownership；共享 `~/.omp`；compatible `omp` 被 Synara 探测后自动可用；Synara-launched OMP 的四项高级功能最终全部开启。
- Phase 1 收敛为标准 ACP Provider，不提前做高级 overlay、双 Advisor/Launch 仲裁或 `_omp/*` UI。内部 id 采用 `omp`，避免与现有 `pi` 混淆。
- 实现前门禁是用真实 OMP `17.3.3` 固定 initialize/auth/session config/command/turn fixtures；若 stable ACP v1、`omp acp` 或 headless auth 不成立，停止 Adapter 实现而不是加入字符串/版本猜测。
- 当前闭集传播面比 Adapter 本身更广：contracts/settings/shared metadata、ProviderHealth、registry/runtime layer、Agent Gateway target map、Web persisted schema/model maps/icon/settings/fixtures 都必须显式加入 `omp`。
- 本轮仍无可用 LCC MCP，按规则使用 FastCtx；一次 batch read 因同一大文件重复列入请求而被拒绝，改为按不重叠行窗口读取，没有影响仓库内容或调研结论。

---

## 30. OMP Phase 1 实施（2026-08-14）

- 基线为 `dev` / `3e6ad7d16`，开始时工作树干净。W0 解析到 `C:\\Users\\kingt\\.bun\\bin\\omp.exe`，`omp --version` 为 `17.3.2`，文件大小 `15872` bytes，mtime `2026-07-04 15:00:30.556384300 +0800`，SHA-256 `59b379b53354da72d2c5262119fe70c44b4e473826ebbaa94d47a2d58a359b1a`；版本满足最低 `16.1.12`，但不是计划的 `17.3.3` fixture 基线。
- 当前环境仍无 LCC MCP，按 AGENTS.md 降级使用 FastCtx。W0 探测复用 `AcpSessionRuntime` 与官方 ACP SDK，使用临时 cwd、`omp acp`、共享现有 OMP home，未设置 `PI_CODING_AGENT_DIR`，未改写 OMP 全局配置。
- W0 探针第一次执行在启动 OMP 前失败：当前 Effect build 没有 `Effect.fork`，`Pipeable.js` 报 `args[0] is not a function`；改为仓库现用的 `Effect.forkScoped` 后重试。
- W0 结果抽取时发现环境没有 `jq`（`bash: jq: command not found`），改用只读 `bun -e` 解析探针日志；未修改仓库数据。
- 为满足开发 fixture 的 `17.3.3` 锁定基线，使用 `bunx --package @oh-my-pi/pi-coding-agent@17.3.3 omp --version` 在临时 bunx 目录解析出独立 `omp.exe`；没有升级或覆盖全局 `17.3.2`。随后直接以该临时 binary 的 `["acp"]` 参数完成真实 initialize → authenticate(`agent`) → session/new → prompt(`end_turn`) → cancel(`cancelled`) → session/close(`{}`)，并由 runtime scope 证明进程退出。
- OMP 17.3.3 协商 `protocolVersion=1`；`agentInfo` 为 `oh-my-pi` / `Oh My Pi` / `17.3.3`；仅广告可由 Synara 完成的 `agent` 本地认证；capabilities 包含 load、session list/fork/resume/close、MCP http/sse、prompt embeddedContext/image。session/new 返回字符串 session id、`default`/`plan` modes，以及 select config options `mode`、`model`、`thinking`（category `thought_level`）。600ms 内收到结构化 commands inventory。未命中任何 W0 STOP 条件，`AcpSessionRuntime` 无需通用修复。
- 已写入脱敏 deterministic fixture `apps/server/src/provider/acp/fixtures/ohMyPiAcp17_3_3.ts`：只保留协议 schema 字段与虚构 model/session/message/command 值，不含 prompt、usage/cost、token、用户绝对路径、凭据、真实模型目录或用户 skills。
- W1 contracts/shared/server 的 focused tests 分别通过 50、108、20 项，并形成 scoped commit `3e95adc30`（`feat(contracts): add Oh My Pi provider identity`）。
- W2 首次 FastCtx batch 因同一路径 `ProviderHealth.ts` 被列入多个行区间而原子拒绝，随后改为单路径连续读取；另一次把 `providerMaintenance.ts` 误写在 `src` 根下，工具提示真实路径后改读 `src/provider/providerMaintenance.ts`，均未修改文件。
- W2 TDD 首轮按整个 `ProviderHealth.test.ts` 执行，OMP 新测试如预期因 `makeCheckOhMyPiProviderStatus` 尚不存在而失败；同时暴露本机已安装的 Codex/Claude/OpenCode/Pi/Antigravity `.cmd/.exe` 会让若干既有 mock 对裸 command/args 的假设失败。该环境噪声不属于 OMP 变更，后续使用测试名过滤执行 OMP 与 disabled-provider focused slices。
- W2 健康探测只解析统一 `resolveExecutable` 的实际路径并执行一次有界 `--version`；兼容/过旧 verdict 以 `size:mtime` binary identity 缓存，文件替换后重探测。探测使用 ACP 多模型 credential policy，但不启动 `omp acp`、不设置 `PI_CODING_AGENT_DIR`、不读写 `~/.omp`，也没有注册 OMP updater。
- W3 TDD 首轮因 `OhMyPiAcpSupport.ts` 尚未创建而按预期红灯；实现后 fixture 驱动的 spawn/auth/config/model discovery 12 项测试通过。两次 FastCtx batch read 因把同一路径列成多个区间而被原子拒绝，均改为单路径窗口读取；没有产生文件修改。
- W3/W4 新增通用标准 ACP filesystem/terminal client handlers；读写只接受绝对路径，terminal output 有 1 MiB 默认、16 MiB 硬上限和 UTF-8 边界保留，session scope finalizer 使用现有 process-tree teardown 证明退出。对应 2 项 focused tests 通过。
- W4 交互测试第一次误用当前 Effect build 不存在的 `Effect.fork`，复现 `args[0] is not a function`；修正后测试又发现重复 cancel 会在首个 prompt interruption 清理完成前重复发送，Adapter 增加 turn-local idempotence 标记。
- W4 permission/elicitation 测试曾因在 PubSub publish 后才建立一次性订阅而等待 90 秒超时。按本文件既有 Effect fork 记录，改为在 session/turn 前启动 scoped 持续 consumer，并将调试超时缩短到 10 秒；最终 8 项 Adapter focused tests 通过，覆盖 new/resume/load、prompt/cancel、permission、elicitation、未知 extension、process exit、stop/stopAll、2048 burst 以及 discovery cache/cleanup。
- 唯一一次独立审查中，Web/contracts 核验无 finding；server 核验发现标准 ACP `terminal/create` 直接合并 `process.env` 与 agent 参数，会把 `SYNARA_AUTH_TOKEN` 等控制面权限泄漏给 terminal descendants。回归测试先复现 `secret: "must-not-leak"` 红灯，再让 terminal 环境统一经过 `buildProviderChildEnvironment({ provider: "acp" })` 清洗，保留普通 agent 请求变量而剥离 `SYNARA_*`/native launcher capabilities；修复后 3 项 client-capability 测试通过。
- 审查修复后的 fresh focused verification：contracts 50/50、shared 108/108、server OMP ACP/client-capability/adapter/registry/discovery/service 153/153、OMP health 9/9、Web settings/provider/composer/catalog 174/174。`git diff --check` 无 whitespace error（Git 仅提示 Windows checkout 的 LF→CRLF warning）。按本轮明确约束未运行 `bun fmt`、`bun lint`、`bun typecheck`，也未把隔离 Synara UI 的 12 项真实手工场景伪称为已执行。
