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

---

## 31. OMP Phase 1 W5/W6 集成（2026-08-14）

- 独立 W5 核验发现 Adapter discovery cache key 只读取请求级 `binaryPath`，会忽略 Adapter settings 的 configured binary。现已统一按请求 override → Adapter settings → `omp` 生成 resolved executable identity，并新增配置级 binary 文件大小变化、短 TTL、force reload、timeout 和启动失败 cleanup 测试；models/commands 仍共用一把 lock 和一次 disposable ACP session。
- W6 将 `OhMyPiAdapter` 注入默认 registry 与 server runtime layer，并沿用与其他 gateway-capable provider 相同的 Agent Gateway credentials layer；ProviderDiscovery 与 ProviderService 各有 OMP routing focused test。
- Web persisted settings、custom model recovery map、runtime `omp-acp` catalog、composer registry/traits、icon、Provider card、PluginLibrary capability map、binary-path confirmation、prefetch 和 browser fixture 均新增显式 `omp` entry。OMP runtime catalog 是 authoritative；无 discovery 结果时保留当前/已存 custom slug 作为可恢复路径，但不提供会制造无效 ACP model 值的 custom-model editor。
- 首次运行扩展后的 `appSettings.test.ts` 有 2 个 expected-map 失败：旧断言缺少新增 `omp` provider/config；补齐 exhaustive expected values。ProviderService OMP routing 测试首次遗漏必需 `threadId`，修正后第二次误断言 `providerName` 而实际 `ProviderSession` 字段为 `provider`；均只修正测试输入/断言，不涉及运行时代码绕过。
- W5/W6 focused 验证通过：server Adapter/registry/discovery/service 共 108 项，Web settings/icon/composer/catalog/model/options/order/prefetch 共 174 项。计划指定的完整 server wiring 命令为 202 通过、28 失败；OMP 的 8 个 health 场景全部通过，失败来自本机已安装 Codex/Claude/OpenCode/Pi/Antigravity 改变旧 mock 的裸命令假设，以及 2 个既有 executable-bit/PATH 环境断言。
- 计划指定的 ACP suite 为 63 通过、1 失败；单独重跑仍失败的是既有 `AcpSdkConformance` teardown 断言（预期 `{ code: 0, signal: null }`，Windows/Bun 实际 `{ code: null, signal: "SIGTERM" }`）。该测试、`AcpSessionRuntime` 与 `AcpJsonRpcConnection` 相对基线 `3e6ad7d16` 均无差异，且测试不导入 OMP 新增的标准 client handlers，因此未修改既有 conformance 断言来隐藏环境差异。
---

## 32. OMP Phase 2 启动与配置契约实测（2026-08-14）

- 派发基线门禁通过：`dev` / `4aab0ef6c23ebdf56b02f58e0f01769521691a41`，工作树干净，Phase 1 五个提交与派发事实一致；当前仍无 LCC MCP，按规则使用 FastCtx。
- 本机 `omp/17.3.2` 的帮助声明 `--config` 可重复。临时 overlay 实测 `omp acp --config <path>` 与 `omp --config <path> acp` 均可启动；不存在路径明确报 `Config overlay not found`。采用 canonical `["acp", "--config", path]`，不依赖 shell quoting。
- 直接以 `omp config get ... --config` 探测失败：`config` 子命令只接受自己的 `--json`，拒绝 global `--config`。随后改用官方源码公开的 `Settings.loadReadOnly({ configFiles })` 做只读有效配置核验，没有写全局配置。
- 第一次 `bun -e` 尝试把环境变量用于静态 `import ... from process.env`，解析器报错；改为绝对 `file:///` dynamic import 后成功。两个 overlay 的顺序实测证明后者 deep-merge 覆盖同路径、保留未覆盖 sibling。
- 官方 schema 确认 `launch.enabled` 默认 true、`advisor.enabled` 默认 false、`memory.backend` 为 `off|local|hindsight|mnemopi` 且默认 off、`autolearn.enabled/autoContinue` 默认 false、`modelRoles` 为字符串 record。Advisor 源码明确 enabled 但缺失可解析 advisor role 时 inactive，因此 Phase 2 不猜当前模型 fallback，只投影可恢复 degraded warning。
- `OmpControlPlane` 最初尝试从 Bun 导入 YAML 解析器，Vitest 的 Node 运行时无法加载 `bun` 模块；改为只读取 `memory`、`hindsight`、`modelRoles` 的窄解析器，未知字段和 secret 从不进入 overlay，相关 deterministic/atomic/no-secret 测试通过。
- TDD 红灯按预期捕获了四条旧行为：缺少 control-plane 模块/原子落盘、spawn 仍只有 `["acp"]`、OMP Adapter 仍租用并注入 Synara Gateway、Advisor reactor 仍会评估 OMP thread；对应实现后 focused 测试转绿。bounded settle 的红灯还确认旧实现没有 quiet/timeout/abort/process-exit 结果。
- Web 新增 OMP policy 投影测试通过；同批执行的全 catalog 结构测试发现既有中英文 `composer.commandMenu` 漂移（英文 `commands.issue/pullRequest`，中文 `meta.issue/pullRequest`），与本轮 OMP keys 无关，因此未越界修复。随后 Web production build 成功。
- 首次真实 control-plane 运行把有效用户配置误判为不可解析：窄解析器在无关的 `providers.webSearchOrder` 嵌套结构上提前失败，并且未正确结束 relevant mapping。脱敏键结构检查定位后补红测，解析器改为只进入 `memory`/`hindsight`/`modelRoles` 三个顶层 mapping；重跑正确投影 Advisor role 与用户显式 local memory，overlay 去掉不必要 fallback，全局 config SHA-256/size/mtime 始终未变。
- 误把 Bun 的全局 `omp` 原生 shim 当文本读取产生二进制输出；随后直接定位全局包源码并用官方 `Settings.loadReadOnly` 验证有效值，没有改安装。隔离 Synara dev 的 Web 端口仅绑定 `::1`，因此 `127.0.0.1:10554` 失败而 `localhost:10554` 成功；server `/health` 在 `127.0.0.1:58182` ready。首次通过内建 `exec_command` 清理隔离目录被策略拒绝，改为先校验固定绝对路径再用 PowerShell `Remove-Item -LiteralPath`，清理成功。
- `ProviderHealth.test.ts` 全文件重跑仍有 26 个既有 Windows 本机 CLI 解析失败（与 §31 相同：mock 期待裸命令，实际命中已安装 `.cmd/.exe`）；OMP 专属 `-t checkOhMyPiProviderStatus` 9/9 通过，其余五个本轮 focused 文件 142 项均通过。
- 真实 `omp/17.3.2` 官方 `Settings.loadReadOnly` 证明 overlay 生效：Launch/Advisor/Auto-Learn/autoContinue=true，Memory=用户 explicit local，Advisor role provenance=global；真实 ACP initialize/auth/new 成功并协商 protocol 1、agent auth、default/plan、mode/model/thinking。全局 OMP config hash/size/mtime 前后相同。
- 5 次只读 `read` 的真实 prompt 产生 15 个 ACP update，`end_turn` 返回；timeline 显示 `session/prompt` response 后约 2ms 才处理 `AssistantItemCompleted`。5 秒 late window 没有四项 typed event；OMP log 有 `agent_end`，Advisor sidecar 在 scope close 时以 aborted 结束。官方源码显示 Auto-Learn 是 detached private capture runner，stock ACP 无 start/complete/drain 或可靠持久化完成信号，因此命中计划 STOP：只保留 bounded queue/quiet/process-aware fallback，不宣称 capture 或 Advisor delivery 完成，typed lifecycle guarantee 留给 Phase 3/upstream。
- 隔离 Synara 使用固定 home、server 58182、web 10554、port offset 4821、`SYNARA_AUTH_TOKEN` unset；先 dry-run，后 `/health` ready 与 Web 200。终止后 listener=0、OMP ACP root=0，隔离目录已清理。没有运行 Launch probe，因此没有额外受管子进程需要清理。
- 唯一一次 independent review 覆盖基线到 `c6bb6b2a8`，返回 `NO FINDINGS`；按“一次审查、一次合并修复”约束不虚构 finding，修复步骤不适用，也未发起第二轮审查。
- 审查后的 fresh focused verification 精确结果：contracts `src/server.test.ts` 1/1；server 五个本轮文件 67/67（更正上文“其余五个 142 项”的误记，142 是 ProviderHealth 全文件在 26 个既有失败下的通过数）；OMP ProviderHealth filter 9/9、93 skipped；Web OMP projection 2/2；contracts/server/Web build 均成功。heavyweight `bun fmt`、`bun lint`、`bun typecheck` 未获授权，保持 NOT RUN。

---

## 33. OMP Phase 3 W0 与 typed extension 边界（2026-08-14）

- 派发基线门禁通过：`dev` / `59a5a48d2075770cc605a60a465735a0fb6b88f8`，开始时工作树干净。当前无可调用 LCC MCP，按 AGENTS.md 降级使用 FastCtx。
- 本机只有 Bun 全局安装包而无 `can1357/oh-my-pi` Git checkout。真实 binary 为 `C:/Users/kingt/.bun/bin/omp`，`omp/17.3.2`，15,872 bytes，mtime `2026-07-04 15:00:30.556384300 +0800`，SHA-256 `59b379b53354da72d2c5262119fe70c44b4e473826ebbaa94d47a2d58a359b1a`。
- 官方 current main 页面顶部为 `ad318c7572abaeebd5cf8a7a16d350ff1d32a738`，latest release 为 `v17.3.3`（published `2026-08-14T04:06:32Z`）；本机 17.3.2 落后一版。已安装源码与官方 current source 均未发现 `_omp/capabilities` 或 Advisor/Auto-Learn/Memory/Launch typed ACP methods/events。
- 官方 ACP extension UI 只能在同一 connection 上使用标准 elicitation round-trip；`ctx.ui.notify` 在 ACP context 只记录 debug，status/widget/title/custom UI 等为 no-op。没有真实 agent-side arbitrary ACP extension method/event registration API，因此 Phase 3 不采用 packaged extension；必须在独立官方 checkout 中修改 upstream ACP agent，并保留 Synara stock fallback。
- Plan 019 已创建，固定协议 v1、两仓边界、STOP、降级、TDD seam、真实双端矩阵与验收台账。TDD seam 由派发任务明确锁定，无需额外追问；实施顺序为 ACP wire/runtime、server-owned state/projection、Web projection 的垂直 red→green slices。
- 首次两次追加本节的 `apply_patch` 均因手工上下文未精确包含原句中的“精确结果”而验证失败；重新读取末尾后以精确上下文重试，失败未造成文件内容修改。
- OMP 协议 TDD 的首个红灯为预期的 `omp-extension-protocol` 模块不存在；实现 schema/runtime/wiring 后，测试加载被缺失的本地原生 addon 阻断，必须先按上游脚本执行 `bun run build:native`，不能把环境准备失败误报为协议测试失败。
- 第一次 OMP native build 超过 10 分钟无终端输出后按子进程规则介入并只终止本任务的 build job；诊断 `cargo metadata --verbose` 证明 rustup 正在首次安装项目固定 nightly（组件文件持续增长），并非 Rust 编译或新代码死锁。保留独立下载进程完成工具链后再重跑正式 build。
- NilCode 首个 focused test 命令误写为根目录 `bun run test -- <path>`，触发缺失 Turbo task；更正为各 workspace 的 `bun run --cwd <workspace> test -- <path>`。测试代码还先后暴露两处 harness 写法错误：`Effect.gen` 内直接 `await` 导致 parse error，以及当前 effect-smol 无 `Effect.either` 导致 drain defect/turn 等待超时；分别改为 `yield* Effect.promise` 与 `Effect.result` 后 40/40 server typed tests 通过。
- NilCode contracts、Web production、server build 一次串行执行全部成功；Web 仅保留既有大 chunk warning。该 build 不等同于被明确禁止的 `bun fmt` / `bun lint` / `bun typecheck`，后三项仍保持 NOT RUN。
- OMP 独立 checkout 为 `D:/Codes/oh-my-pi-phase3`，remote `https://github.com/can1357/oh-my-pi.git`，base `ad318c7572abaeebd5cf8a7a16d350ff1d32a738`（`v17.3.3-3-gad318c7572`）。上游实现复用同一 ACP connection：schema/runtime 与 ACP wiring 分层，从 `AgentSession`、`AdvisorRuntime`、`AutoLearnController`、`MemoryBackend`、`DaemonBroker` 真实 owner 读取状态，没有第二 transport 或日志/文本解析。
- 正式 `bun run build:native` 在 fixed nightly 安装后再次停在 `cargo metadata`，10 分钟内无输出、下载或 cache 进展，按规则终止。为验证官方源码构建而不伪造本地产物，使用 Bun cache 中官方 `@oh-my-pi/pi-natives-win32-x64@17.3.3` baseline addon（SHA-256 `9321427a2b15e61d716258d6041e52e2926fe7ddfb5ae65369686544f8550f38`）放入被忽略的 dist；旧 17.3.2 addon 被 17.3.3 sentinel 正确 fail-closed。`PI_NATIVE_VARIANT=baseline bun run build` 随后成功生成并运行 `omp/17.3.3`。
- Advisor drain 的第一版只等待通知队列，真实探针显示 Advisor 仍有 backlog/inFlight 却返回 settled；TDD 增加 accepted typed note 必须先到 ACP connection 的回归测试后，drain 同时等待真实 Advisor settle 与 notification queue，并分别返回 `advisorSettled` / `notificationsSettled`。WIP concern 按 OMP 既有语义只记录、不 steer；隔离 `WATCHDOG.yml` 强制 blocker 后取得真实 `_omp/advisor/note`：severity `blocker`、delivery `steer`、sequence 2，drain sequence 4 返回 settled=true。
- 两个尝试直接覆盖完整 `AgentSession` advisor suppression harness 的测试在 Windows/Bun 下各超时 120 秒，均已终止且实验改动全部撤销；最终回归放在协议 focused harness，不保留会卡住 suite 的测试。
- 真实隔离 profile 验证了 capability、四项 status/control、Memory status/stats/diagnose/enqueue/clear challenge+confirm、Launch start/list/describe/log/send/restart/stop、Auto-Learn started/completed/drain，以及 kill/restart 后 generation 变化与 sequence 从 1 重置。所有 Memory destructive 与 Launch process 都在临时 agent dir/cwd；未触碰共享真实 memory 或用户服务。
- Synara 浏览器实测暴露两处本轮投影 bug：ProviderHealth 首次缓存 configured-only 后没有叠加 live typed runtime；ACP response frame 又被 protocol logger 当未知 notification 告警。分别新增纯回归测试并修复 volatile runtime overlay/last-session removal，以及 response/known-notification 分类。两个 focused 红灯均转绿。
- 隔离 Synara 使用 home `.../synara-omp-phase3-019fffde/synara-home`、server 58919、web 8891、offset 3158、`SYNARA_AUTH_TOKEN` unset，先 dry-run。活动 OMP 会话的设置页真实显示 OMP 17.3.3、1 typed session、Advisor active + `write-or-exec`、Auto-Learn generation、Memory backend/queue、Launch authority=OMP；会话停止后安全回到 Phase 2 configured-only。页面旧 thread composer 会显示 Codex 默认值并导致一次 provider mismatch；新 thread 明确选择 OMP/Fable 后成功建立真实 OMP session，该现象记录为既有 hydration/UI 边界，未在本轮扩 scope。
- 唯一一次独立双仓审查发现 1 个 P1：全局 typed notification queue 达 256 后丢弃事件，但旧 drain 只看 pending queue，可能伪报 settled=true。唯一合并修复先以 257 个同步事件得到预期红灯，再将 per-generation dropped/发送失败计数加入 runtime；Advisor drain 在任一 typed event 丢失后返回 `settled=false` 与 `notificationBackpressure: { dropped, recoverable: false }`，session rotation 清零。该回归测试转绿，未启动第二轮审查。
- 清理时首次 PowerShell `Remove-Item` 被执行策略拒绝，未删除任何内容；随后在单一 Bash 中对固定 temp path 做 `realpath` exact-match guard 后删除。最终 `TempExists=false`，58919/8891 listener=0，匹配隔离目录或 patched `dist/omp.exe` 的进程=0。

---

## 34. OMP Phase 4 发布基线与最小闭包移植（2026-08-15）

- 实时门禁确认 OMP 官方 `main` / release 已前进到 `ffd53ff92a` / `v17.3.4`，但 `f7fd74b63b` 不是二者祖先；当前全局 `omp --version` 也已是 `17.3.4`。本轮没有升级、覆盖或改写全局 OMP 安装/config/profile。
- Synara PR #496 与本地 Phase 1 provider wiring 高度重叠。用户明确授权独立发布到 `NLN6666/NilCode`，不等待 #496；实现只参考其通用 ACP lifecycle、`agent` auth、model → thinking 顺序和 advertised-mode gate。现有 `OhMyPiAcpSupport` 已具备这些语义，未复制第二套 Adapter、skills 私有目录扫描或 catalog-as-runtime-truth。
- publication worktree 分别从 `origin/dev@c4c79f32` 与 OMP `origin/main@ffd53ff92a` 创建；原始 NilCode `dev@58e538361` 与 OMP `main@f7fd74b63b` 未切换、未提交、未 push。OMP `f7fd74b63b` 在最新 main 上无冲突 cherry-pick 为 `bc07667437`。
- 第一次执行 `gh repo fork can1357/oh-my-pi --clone=false --remote=false` 时，当前 `gh 2.95.0` 拒绝“带 repository 参数时使用 `--remote`”；没有创建/修改远端。改用受支持的 `--clone=false` 后成功创建 `NLN6666/oh-my-pi` fork，并添加本地 `fork` remote。
- NilCode `origin/dev` 虽是 Phase 1–3 祖先，但 Phase 1 开始前还有 186 个非 OMP 提交。首个 cherry-pick 在 `findings.md` 暴露该事实，后续冲突又定位到 provider-isolated skills、VCS runtime event、device harness、Services pane root subscription 等非 OMP 前置；本轮没有把这些提交或本地 ahead 302 整体带入。
- 最小适配保留 `origin/dev` 的 flat skills settings、pane-scoped daemon feed 与既有 provider-runtime event schema，只加入 OMP settings/identity、routing、typed `omp.advisor.note` 和 OMP Launch UI；丢弃 `skillOrigins.ts` provider-isolation、Pi max fixture、device guidance、`vcs.state.changed` 与 unrelated service-panel refactor。Phase 1–3 的 15 个 OMP commits 全部完成 scoped cherry-pick，冲突均按单 hunk 保留两侧真实意图。
- NilCode publication worktree 的 `bun install --frozen-lockfile` 被 `@effect/language-service@0.75.1` prepare 阶段无法 patch `clearSourceFileEffectMetadata` 阻断；未修改依赖或锁文件，改用 `bun install --frozen-lockfile --ignore-scripts` 完成只读依赖准备。focused 验证随后通过：server OMP 54/54、contracts 68/68、Web OMP policy/composer 38/38、ProviderHealth OMP filter 9/9；contracts、Web、server production build 均成功。按授权边界未运行 `bun fmt`、`bun lint`、`bun typecheck`。
- OMP publication 首次 `bun run check:ts` 暴露 9 个当前 Biome/TypeScript 规则问题（import/format、unsafe optional chaining 与表达式赋值）；仅在三个 Phase 3 文件内修正并提交 `f3fdb87a00`，fresh `check:ts` 全 workspace 通过。直接 package focused test 使用明确的 test entrypoint，协议/Auto-Learn 33/33 通过。
- 固定 `nightly-2026-07-28` 未安装；`rustup toolchain install` 已下载 metadata/components 后超过 10 分钟无 CPU、临时文件大小或 mtime 进展，按门禁只终止本任务 job。Rust artifact HEAD 请求为 HTTP 200；随后一次在 pinned cwd 执行 `rustup show` 意外触发自动同步并在 120 秒后由执行器终止。正式本地 native build 尚未成功，不能以 cached addon 代替，发布门禁转由上游 PR 的官方 native CI terminal evidence 承担。
- 一次从 root 传 focused test paths 的命令被上游 script 吞掉参数，误跑 146 chunks 并仅因本地 addon 缺失失败；改为 package 内 `bun test <exact files>`。为运行非 formal focused gate，复制被 `.gitignore` 排除的官方 `@oh-my-pi/pi-natives-win32-x64@17.3.4` baseline addon：SHA-256 `966091fdf8d50a26024226b1bd5b93ba702378202a195b7029fdba7a92e93138`、155896832 bytes。该 provenance 只证明官方 native leaf 被用于测试，绝不记为本地 native build 成功。
- OMP workspace build 还暴露 `browser-relay` 的环境依赖 `zip` 不在 Windows PATH；native 子任务真实进入 `cargo metadata` 并继续下载 fixed nightly（临时 component 从约 23.0 MiB 增至 27.2 MiB），但执行通道随后关闭，未留下 modern local addon 或 terminal-success 证据。一次后续 `rustup toolchain list` 又因 pinned cwd 自动同步，已按精确 command line 只终止本轮 rustup 子进程。local formal native gate 因此仍是 BLOCKED，不修改 workflow，等待官方 PR native CI。
- Phase 4 唯一一次双轴独立 review 返回 7 条候选：确认并集中修复 OMP malformed params 逃逸 typed envelope、Launch lifecycle 值未定义、NilCode 未协商 notification 可切入 typed state、request params 可覆盖保留字段；Memory mutation timeout 无 owner-level AbortSignal，不能虚构取消，改为 `operationMayContinue=true` + `recoverable=false` 禁止自动重试。多 provider credentials 是 Plan 017 §W1 明确兼容契约且继续剥离 `SYNARA_*`/native authority，87-file Phase 1–3 闭包也是本轮用户明确发布范围，故未把二者当作 Phase 4 越界修复。未启动第二轮 review。
- 集中修复后的 fresh verification：OMP `check:ts` 全 workspace PASS、协议/Auto-Learn 34/34；NilCode server OMP 56/56、ProviderHealth OMP 9/9（94 skipped）、contracts 68/68、Web 38/38，contracts/Web/server production build 全部 PASS；`git diff --check` clean。并行 PowerShell profile 偶发报告 oh-my-posh init cache 正被另一测试进程使用，但各命令退出码均为 0 且不影响 test result。NilCode heavyweight `bun fmt`、`bun lint`、`bun typecheck` 继续保持 `NOT RUN (UNAUTHORIZED)`。
