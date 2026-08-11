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

**追加（2026-08-08，dev 合到 c4c79f32 之后实测）：**

| 既有失败                                         | 表现                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| `orchestration/Layers/CheckpointReactor.test.ts` | 30 用例中 6 失败，单跑仍失败（非负载所致），每例 10–27s |
| `git/Layers/GitCore.test.ts`                     | `expected 'origin-1' to be 'origin'`                    |

**基线对比方法（这是判定既有失败的唯一可信手段，依赖推理不够）：**

```bash
git stash push -u -m "<唯一tag>"                      # 规则要求带 tag，worktree 间共享栈
git stash list --format='%H %gs'                      # 立刻捕获 SHA
npx vitest run <file> -t "<单个最快的失败用例>"        # 只跑一例，别跑整文件
git stash apply <SHA>                                 # apply 不是 pop
git stash drop stash@{n}                              # 按 tag 重新定位后再 drop
```

实测 `restores turn zero from the persisted checkpoint family` 在**基线上同样失败**（10.2s），故 CheckpointReactor 的 6 例与 advisor/services 改动无关。

**注意别被负载骗了。** 后台跑 server 全量的同时跑 web 全量，会让 `ChatMarkdown.test.tsx` 和 `Sidebar.import.test.ts` 双双超时（web import 阶段耗时 562s）；两者单独重跑 24 例全通过、耗时 5.2s。**超时类失败必须在机器空闲时单独复跑**再下结论，否则会把负载问题误记成回归。

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

## 17. #16 的约束已生效，但面板依旧空白 —— 剩下的是纯可发现性问题

**现象：** 用户报「Synara 接管的 Background 服务依旧看不到」。

**关键对比（同一台实机，同一套判别方法）：**

| 检查                       | #16 那次   | 本次（2026-08-08 20:08）    |
| -------------------------- | ---------- | --------------------------- |
| `<stateDir>/daemons/` 目录 | **不存在** | `daemons/purpur-1218/` 存在 |
| `output.log`               | —          | **1.2 MB，20:08 仍在写入**  |

`4d6220b8`（后台服务约束改为可检测）**确实起作用了**：Agent 这次真的走了 `synara_start_daemon`，broker 侧完全正常。

**所以「看不到」不在后端。** 用户确认的实际情况是**根本找不到入口**：

1. `ServicesPanel` 只作为右侧 dock 的一个页签存在，唯一入口是 dock 的 `+` 添加菜单
2. `rightDockPaneMeta.tsx` 的 `RIGHT_DOCK_LAUNCHER_ORDER` **不含 `services`** —— 空 dock 时的快捷启动器列表里没有它
3. 有 daemon 在跑时，UI 上没有任何地方提示这件事

**鸡生蛋的结构问题：** 想「有 daemon 时才显示入口」就得先知道有没有 daemon，但 `useDaemonFeed`（`ServicesPanel.tsx:56`）把订阅**限定在面板挂载期间**。不打开面板 → 拿不到名单 → 无从显示入口 → 用户永远打不开面板。原注释的权衡（「不开面板的用户不付流的代价」）在可发现性面前站不住：那条流是每个 daemon 状态变化一个事件，代价远小于功能完全不可达。

**判别方法沿用 #16：** 后端有没有干活看 `daemons/` 目录，不要翻 `server.log` —— broker 与 WS 订阅**两处都不打日志**，`grep -c daemon server.log` 恒为 0，对判断 UI 侧是否订阅过毫无用处。

---

## 18. Advisor「不显示」的诊断必须按会话切分日志，否则会诊断到已被删掉的代码

**现象：** 用户报「Advisor 依旧没有显示在对话里面」。

**第一轮（错误的）结论：** 全量 grep `server.log` 得到 6 次 `advisor shadow session reported a failure`、1 次 `advisor disabled for thread after consecutive failures`，失败原因是 `Claude Code process exited with code 127` 与 `Claude is not authenticated`。据此判定「advisor 因 CLI 认证失败被自动禁用」。

**这个结论是错的。** `bb629754`（advisor 改为一次性推理通道）已经把 shadow session 和 consecutive-failure kill switch **整个删掉了** —— `AdvisorSession.ts` 顶部注释明写「There is no state here. No session to prime, no consecutive-failure kill switch」。那些日志行来自旧构建，是历史沉积。

**按最后一次 `advisor reactor started` 切分后的真实情况：**

| 指标                        | 全量（含历史） | 末次会话（11:46:14Z 起） |
| --------------------------- | -------------- | ------------------------ |
| advisor evaluating          | 29             | 8                        |
| advisor evaluation resolved | 19             | **8（零失败零超时）**    |
| shadow session failure      | 6              | **0**                    |
| verdict = silent            | 18/19          | **8/8**                  |

新构建下 advisor **完全健康**，只是 100% 判 `silent`。且评估时机是混合的（4 次 `workInProgress: false` 的 turn 边界，nit/concern 均可通过），并非「只在 mid-turn 评估所以只能报 blocker」。

**根因：不是 bug，是设计与期望的落差。** `ADVISOR_SYSTEM_PROMPT` 明确写着 _"Silence is the expected answer... Do not narrate, do not confirm that things look good - that is noise"_。advisor 在严格执行指令；用户看到的「没显示」就是它按设计沉默。

**判别方法：** `server.log` 是跨构建追加的。任何「功能 X 没生效」的诊断，都必须先 `grep -n "<X> started" server.log | tail -1` 拿到末次启动行号，再 `tail -n +<行号>` 切出当前构建的区间。不切分就统计，等于拿已删代码的错误日志去诊断现有代码。

---

## 19. 浏览器预览下方控制台的 `Add to chat` 被空回调静默吞掉

**现象：** 在浏览器预览下方的服务控制台选中文字，菜单正常显示 `Add to chat`；点击后菜单关闭，但聊天编辑器没有新增 terminal context。

**根因：** `BrowserPaneTerminalSplit.tsx` 给 `ThreadTerminalDrawer` 传入了 `onAddTerminalContext={() => {}}`。`ThreadTerminalDrawer` 只用“回调是否存在”判断是否展示菜单，因此空函数同时造成了两个行为：按钮可见，点击却必然丢弃选区。

**对照：** 独立 dock 控制台 `DockTerminalPane.tsx` 已通过 `terminalContextComposerRegistry` 订阅 `SINGLE_CHAT_PANE_SCOPE_ID` 对应的 composer target，并把真实 target 传给 `ThreadTerminalDrawer`。浏览器服务控制台没有复用这条已存在的接线。

**修复边界：** 浏览器服务控制台应订阅相同 pane scope 的 composer target；target 不存在时传 `undefined`，使菜单能力与真实可用性一致。补测试覆盖 target 注册前不可用、注册后点击可转发、注销后再次不可用。

**执行记录：** `subagent-driven-development/scripts/task-brief ... 1` 返回 `task 1 not found`，因为本计划的实施步骤是编号列表而不是 `Task 1` 标题。后续按同一计划内容手工生成单任务 brief，未改变需求或实现范围。

**实施结果：** 新增共享 `useTerminalContextComposerTarget` hook，浏览器服务控制台与独立 dock 控制台均通过 `SINGLE_CHAT_PANE_SCOPE_ID` 获取当前 composer target；无 target 时传 `undefined`。唯一一次 review 仅发现 SDD 临时报告被误纳入提交，已从最终实现提交中移除。最终聚焦验证为 3 个测试文件、10 个用例全部通过。

---

## 20. Actions 服务状态与 Browser 页面共享只完成了半条状态链

**现象（2026-08-10）：** 同一项目中通过 Action 启动声明了端口的服务后，终端与 Browser 已显示服务页面，但顶部 Action 仍显示 Run；切换到同项目的其他任务后，Browser 的可见状态/页面也没有完整延续。

**Actions 根因：** `ProjectScriptsControl` 完全依赖 `runningScriptIds`。该集合只由项目 synthetic terminal scope 的 `runningTerminalIds + serviceScriptIdsByTerminalId` 推导；终端子进程活动探测漏报时，即使 `server.listLocalServers()` 已通过监听端口确认服务存活，Actions 仍不知道。现有项目级 `projectRunStore`/`DevServerManager` 是另一套 server-owned registry，不覆盖从 Actions 终端启动的服务。

**Browser 根因：** 底层已有 `project-browser:<projectId>` 共享 surface 和单 owner claim；但共享仍受 `browserSharing`（默认 isolated）控制，而且 `rightDockStore` 的 open/panes/activePaneId 仍按 thread 持久化。因此“同页面”和“同面板状态”分属两条状态链，前者可共享、后者切任务即更换。

**排查错误/约束：** LCC 索引停在 `823ee638`，当前 HEAD 为 `eb7affe3`，检索结果明确标记 `index_stale`；关键结论均使用 FastCtx 对当前文件复核。子代理最初给出的 `BrowserDockPane.tsx` 与 `browserSurface.ts` 路径缺少真实子目录，实际分别位于 `apps/web/src/components/chat/` 与 `packages/shared/src/`。

**实施边界：** Actions 只在“项目级 Action 启动身份 + 声明端口监听”同时成立时用本地进程扫描补齐运行态；不能只凭端口或缺失的 Windows cwd 认领进程，否则会串到其他项目，同端口的多个 Action 也会同时误亮。终端活动真实存在时仍发 Ctrl-C 并保留日志，activity 漏报时才按已确认的 pid/port 停止进程。Browser 同时统一项目 surface 与按 projectId 持久化的 Browser dock 可见/激活状态，isolated 模式保持原有 thread 隔离。

**测试命令坑：** `bun run test <file...>` 会把文件路径传给 Turbo 当成 task，报 `Missing tasks in project`；Web 聚焦测试必须使用 `bun run --cwd apps/web test -- <file...>`。

---

## 21. Synara 真实挂起：Windows `AppHangB1` 与 Provider 残留状态同时出现

**已确认的故障（2026-08-11）：** Windows Application 日志在本地时间 13:18:03 记录 `Application Hang` 1002：`Synara.exe` 0.7.1.0（PID `0xcf58`）停止与 Windows 交互并被关闭；同一 ReportId `d89e5feb-718a-41ed-815c-d7733767e1ee` 的 WER 事件名是 `AppHangB1`。这证明用户感知的“卡死”是桌面主进程真实挂起，不只是任务 UI 长时间显示 working。

**同一时间线：** 上一轮桌面实例 12:27 启动，13:14:33 server 记录 `provider.runtime_reconciliation.started`；13:18:03 Windows 关闭挂起的桌面进程，13:18:07 新实例启动，13:18:08 又发现并清理 1 个 restart-stuck 子代理任务。上一轮 `desktop-main.log` 没有 window close/shutdown，符合被 Windows/用户强制关闭；但 reconciliation 本身不能直接定性为挂起原因：实现只记录 started 与 failed，没有 completed 日志，而且 13:14 后 advisor 和内存采样仍继续运行。

**排除项与当前状态：** 挂起前 server child 的 RSS 约 161 MB、heap 约 68 MB（1.7%），没有 OOM、transport error、writer overload、orchestration queue overload 或 reconciliation failed。新实例的主进程、renderer、GPU 与 server 均为 Responding，`/health` 约 4 ms 返回全部 readiness 为 true。前一日有两次独立的 GPU process crash（exit code 34），但本次时间点没有 GPU crash 事件，不能用历史 GPU 故障解释本次挂起。

**最合理的判断与证据边界：** 确定的是 Electron/Synara 桌面主进程消息循环失去响应；Provider 父任务状态偏差与重启后残留子任务是同期异常信号，可能让 UI 一直处于 working，但现有日志无法证明它阻塞了主进程。当前配置关闭了 provider event 与 WebSocket event 日志，WER 临时附件也已清理，且没有 hang dump/renderer long-task trace，因此还不能从日志定位到具体函数、IPC 或渲染路径。

**排查错误：** 外部只读打开 `state.sqlite` 两次得到 `SQLITE_BUSY`；源码确认服务进程有意设置 `PRAGMA locking_mode = EXCLUSIVE` 并终身持锁，不能把这个预期锁误判为卡死原因。第一次 Windows 事件查询只按 1000/1001/1002 过滤，混入大量 G HUB 事件；后续改为精确 ProviderName 后才找到 Synara 的 1002/`AppHangB1`。两次 PowerShell `foreach ... | Format-List` 写法产生空管道解析错误，改为先收集 `$events`/`$rows` 后再格式化。

---

## 22. AppHang 取证必须脱离已挂起的 Electron 主事件循环

**问题边界（2026-08-11）：** `AppHangB1` 只能证明 Synara 主窗口进程停止处理 Windows 消息；当前日志没有 hang dump，无法事后还原具体同步 I/O、native wait、V8 执行或 Chromium IPC 调用栈。同期 Provider reconciliation 发生在独立 server 子进程，只能算伴随状态异常，不能据此猜成 Electron 主线程根因。

**现有模式：** desktop 已有 `RotatingFileSink` 日志轮转、backend 子进程监督与 `RendererCrashPolicy`，也监听 renderer `unresponsive` / `render-process-gone`；缺口是这些诊断都依赖 main process 回调继续运行。Microsoft 明确建议从独立进程调用 `MiniDumpWriteDump`，因此计划使用独立 Node watchdog 收心跳，再由外部 PowerShell P/Invoke 生成本地 dump，而不是让 main 自己打印 stack。

**方案边界：** 默认 triage dump、本地保存、只保留最近 3 个、无上传、每个 incident 一次；完整内存必须显式 opt-in。watchdog 只取证，不自动杀进程或重启。计划记录于 `docs/plans/2026-08-11-desktop-hang-diagnostics.md`，代码实施需用户明确批准。

**探索错误：** 第一次通过动态工具注册表列出全部 LCC 描述导致输出被截断，后续只提取目标工具 schema；一次 FastCtx batch 为读取多个 `main.ts` 区间重复传入相同路径，被 `Duplicate path in files` 拒绝，改为逐区间读取。并行 LCC region 输出也因总量过大截断，所有拟修改现有文件均再用 FastCtx 精确窗口亲读。
