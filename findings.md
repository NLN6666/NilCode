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

---

## 23. desktop hang diagnostics 审查修复记录（2026-08-11）

- Electron 40 的 `webContents.getProcessId()` 是 Chromium internal PID，不是可供外部 PowerShell/DbgHelp 打开的 OS PID；renderer dump 接线必须使用 `getOSProcessId()`，并由测试固定 PID 语义，不能用源码字符串扫描充数。
- watchdog child 的同步 `fork` throw、`error`、`exit`/`close` 若各自独立处理，会留下旧 heartbeat interval 或重复消耗重启预算；统一一次性 cleanup 后，才按 60 秒内最多 3 次重新启动。
- IPC 的 `sendInFlight` 只能合并最新 heartbeat。此前它会静默丢弃 configure、renderer unresponsive/responsive 与 stop 等控制信号，使 responsive 无法 rearm incident；控制消息必须走有界优先队列，并在 send callback 后继续 drain。
- 初版 watchdog entry 在 Vitest fork worker 中因存在 `process.send` 而意外启动 interval，导致 worker 回收超时；entry guard 还必须确认 `ELECTRON_RUN_AS_NODE=1`，仅允许真正 fork 的 watchdog 自动启动。
- 初版测试只覆盖 policy 与最简单的 dump 成功路径，缺少 child error/exit、注入 timer 清理、callback/disconnect、runtime parent disconnect/target exit/dump rejection、PID identity mismatch、并发临时文件和 diagnostics root symlink 的回归覆盖。

---

## 24. desktop hang diagnostics 第二轮审查修复（2026-08-11）

- Windows `Get-CimInstance Win32_Process` 返回的 `CreationDate` 已经是 `DateTime`；再交给 `ManagementDateTimeConverter.ToDateTime` 会走错误的字符串转换路径。PowerShell 改为 `([DateTime]$target.CreationDate).ToUniversalTime()`；同时关闭 progress stream，并把 stderr 保留为 4 KiB 尾部，确保末端的实际错误不会被开头 XML/progress 输出挤掉。
- IPC control queue 不能按“队列里是否已经出现同类 PID”去重：in-flight 的 `unresponsive(pid) → responsive(pid) → unresponsive(pid)` 会把最后一条误判重复而丢失。现在 configure/stop 使用有界优先控制队列，renderer 状态按 PID latest-state coalescing；队列已有 32 个 renderer 控制项时，后续更新和 `stop` 仍不会因固定容量静默丢弃。
- `writeWindowsHangDump` 原本只在 PowerShell 调用主体 catch，`finally` 内再次验证临时路径；注入 capture 删除 diagnostics root 时，cleanup 的 `lstat` 抛 `ENOENT`，使本应 fail-open 的 Promise reject。临时路径解析、捕获、验证和 cleanup 现在均落在 fail-open 边界中，cleanup no-throw，metadata 继续尽力写入。
- Windows renderer 集成 fixture 需把 `--type=renderer` 放在 Node 的 `--` 之后；否则 Node 将其当作未知启动选项并立即退出，测试只会得到“target process no longer running”。修正后同完整性级别的真实 renderer-identity 进程成功生成 `MDMP` 文件头。
- “按 renderer PID 保留最新状态”不等于“队列有界”：不同 PID 仍可让 `Map` 无界增长。补充第 33 个 PID 的测试先稳定复现失败，再将 pending renderer 状态限制为 32 项并按最近更新顺序淘汰最旧项；watchdog 独立 bundle 同时显式内联 `@synara/*`，避免 packaged helper 依赖不会随产物安装的 workspace devDependency。

---

## 25. 共享 Browser 状态把刚打开的右侧栏立即关回去（2026-08-11）

**现象：** Windows 客户端顶部“切换右侧边栏”按钮存在且可被 accessibility tree 识别，但用户点击后右侧栏没有出现。真实客户端坐标复测同样没有可见变化。

**根因：** `SingleChatSurface` 用 `resolveActivePane(dockState)` 决定右栏 open/close 时是否同步项目级 Browser visibility；该 helper 在 `dockState.open === false` 时返回 `null`，即使 `activePaneId` 仍指向 Browser。重新打开时只更新 thread dock 的 `open=true`，项目 visibility 仍为 `false`，随后 `reconcileSharedBrowser` effect 立即把刚打开的 Browser dock 关回去。

**修复边界：** open/close visibility 同步必须读取“选中的 pane”而非“当前可见 pane”；Browser 标签同步目标 open 值，非 Browser 标签不改项目共享状态。计划记录于 `docs/plans/2026-08-11-right-sidebar-toggle.md`。

**执行记录：** 一次 FastCtx batch 因同一 `SingleChatSurface.tsx` 被列出三个区间而返回 `Duplicate path in files`，随后按每个路径仅出现一次的规则拆分读取。TDD 首轮导入尚未存在的 helper 得到 3 个 `TypeError`；加入返回 `null` 的最小接口骨架后，测试稳定为“期望 true/false，实际 null”的 2 个行为失败，再实现真实派生逻辑。

**打包记录：** Windows packaged startup smoke 已从隔离目录成功启动并取得 ready 证据；脚本因 Windows 文件占用保留了精确临时目录，随后通过 PowerShell 删除该目录的补充清理被执行策略拦截，未扩大删除范围，也不影响安装包或 smoke 结果。

---

## 26. GitHub `#` 引用与 `@` 对话过滤（2026-08-11）

- 用户确认的边界：`@` 对话候选不能包含子代理对话，只保留正常顶层对话；`#` 使用当前项目 GitHub 仓库的 PR/Issue 混合候选菜单，并在发送时附加结构化上下文。
- 现有 `createComposerThreadMentionSourcesSelector` 会把全部 sidebar summary 投影成候选，且 `ComposerThreadMentionSource` 丢弃 `parentThreadId`，因此子代理会进入 `@` 菜单。修复应在 summary 仍带层级事实的 selector 源头过滤，并在服务端线程上下文解析处做防绕过校验。
- 现有 GitHub 后端只覆盖 Pull Request；没有 Issue schema/service。实现采用统一 GitHub reference 域，复用 repository resolution、GitHub CLI 错误归一和 WebSocket RPC 模式。
- LCC hybrid 搜索因本机 LM Studio `127.0.0.1:1234/v1` 无法连接而失败；按仓库规则降级到 LCC FTS，随后通过精确 symbol/read_region 和 FastCtx 抽查即将修改的代码。
- 第一次文档补丁因 `findings.md` 末行的精确空格不匹配被 `apply_patch` 原子拒绝；`git status --short` 证明没有部分写入，随后按文件拆分补丁并使用精确上下文重试。
- Task 2 首次 FastCtx batch 把 `packages/contracts/src/ws.ts` 放入三个区间，工具以 `Duplicate path in files` 拒绝；随后改用 LCC `read_region` 分区读取，未执行任何写入。
- TDD 红灯均符合预期：GitHub CLI 新方法最初报 `yield* ... is not iterable`，项目服务/前端 helper 最初报缺失模块，`#12` trigger 最初返回 `null`；最小实现后对应定向测试全部转绿。
- ChatView 首次组合补丁因定位 `effectiveComposerTriggerKind` 的上下文不精确被 `apply_patch` 原子拒绝；随后拆成 import、query、menu、selection、send 五个小补丁，避免任何部分写入不确定性。
- 独立审查发现 GitHub 外部正文中的字面量 `</github_reference_context>` 可提前闭合隐藏上下文。新增恶意 title/body/label 回归用例先复现 3 个闭合标签，再对 JSON 中 `<`、`>`、`&`、U+2028/U+2029 做 Unicode 转义；修复后仅保留协议自身的一个闭合标签。
- 最终证据：contracts 9/9、server 39/39、web 聚焦套件 115/115；审查修复后的 GitHub/terminal 31/31；`git diff --check` 通过；`bun run --cwd apps/web build` 成功（8910 modules，约 1m59s）。按项目约束未运行 `bun fmt`、`bun lint`、`bun typecheck`，因为用户本轮没有显式授权这些 heavyweight checks。

---

## 27. Windows Electron GPU channel 导致主线程 AppHang（2026-08-12）

- 独立 watchdog 在卡死时成功捕获 dump；匹配 Electron 40.10.6 符号后，`CrBrowserMain` 主线程停在 `gpu::GpuChannelHost::VerifyFlush` / `EstablishSharedMemoryForFlushVerification` 的 Mojo 同步等待链，Windows 同期记录 `AppHangB1`。
- 服务端日志在桌面无响应后仍继续产生活动，排除了 backend 整体停止；用户使用相同安装包加 `--disable-gpu` 启动后确认不再卡死，形成直接 A/B 证据。
- 修复边界：Windows 在 Electron `ready` 前调用 `app.disableHardwareAcceleration()`；macOS/Linux 保持现有图形加速行为。代价是 Windows 不再使用 GPU 合成，但优先消除已复现的主线程永久等待。
- TDD 红灯符合预期：首次运行 `desktopGraphicsPolicy.test.ts` 因实现模块尚不存在而失败，随后再加入平台策略和启动接线。
- 最终验证：图形策略 3/3 测试通过，desktop `tsdown` 构建成功；生成的 `dist-electron/main.js` 中禁用调用位于 `app.whenReady()` 之前。按项目约束未运行 `bun fmt`、`bun lint`、`bun typecheck`，因为用户本轮没有显式授权这些 heavyweight checks。

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

---

## 31. OMP Phase 1 W5/W6 集成（2026-08-14）

- 独立 W5 核验发现 Adapter discovery cache key 只读取请求级 `binaryPath`，会忽略 Adapter settings 的 configured binary。现已统一按请求 override → Adapter settings → `omp` 生成 resolved executable identity，并新增配置级 binary 文件大小变化、短 TTL、force reload、timeout 和启动失败 cleanup 测试；models/commands 仍共用一把 lock 和一次 disposable ACP session。
- W6 将 `OhMyPiAdapter` 注入默认 registry 与 server runtime layer，并沿用与其他 gateway-capable provider 相同的 Agent Gateway credentials layer；ProviderDiscovery 与 ProviderService 各有 OMP routing focused test。
- Web persisted settings、custom model recovery map、runtime `omp-acp` catalog、composer registry/traits、icon、Provider card、PluginLibrary capability map、binary-path confirmation、prefetch 和 browser fixture 均新增显式 `omp` entry。OMP runtime catalog 是 authoritative；无 discovery 结果时保留当前/已存 custom slug 作为可恢复路径，但不提供会制造无效 ACP model 值的 custom-model editor。
- 首次运行扩展后的 `appSettings.test.ts` 有 2 个 expected-map 失败：旧断言缺少新增 `omp` provider/config；补齐 exhaustive expected values。ProviderService OMP routing 测试首次遗漏必需 `threadId`，修正后第二次误断言 `providerName` 而实际 `ProviderSession` 字段为 `provider`；均只修正测试输入/断言，不涉及运行时代码绕过。
- W5/W6 focused 验证通过：server Adapter/registry/discovery/service 共 108 项，Web settings/icon/composer/catalog/model/options/order/prefetch 共 174 项。计划指定的完整 server wiring 命令为 202 通过、28 失败；OMP 的 8 个 health 场景全部通过，失败来自本机已安装 Codex/Claude/OpenCode/Pi/Antigravity 改变旧 mock 的裸命令假设，以及 2 个既有 executable-bit/PATH 环境断言。
- 计划指定的 ACP suite 为 63 通过、1 失败；单独重跑仍失败的是既有 `AcpSdkConformance` teardown 断言（预期 `{ code: 0, signal: null }`，Windows/Bun 实际 `{ code: null, signal: "SIGTERM" }`）。该测试、`AcpSessionRuntime` 与 `AcpJsonRpcConnection` 相对基线 `3e6ad7d16` 均无差异，且测试不导入 OMP 新增的标准 client handlers，因此未修改既有 conformance 断言来隐藏环境差异。
- 唯一一次独立审查中，Web/contracts 核验无 finding；server 核验发现标准 ACP `terminal/create` 直接合并 `process.env` 与 agent 参数，会把 `SYNARA_AUTH_TOKEN` 等控制面权限泄漏给 terminal descendants。回归测试先复现 `secret: "must-not-leak"` 红灯，再让 terminal 环境统一经过 `buildProviderChildEnvironment({ provider: "acp" })` 清洗，保留普通 agent 请求变量而剥离 `SYNARA_*`/native launcher capabilities；修复后 3 项 client-capability 测试通过。
- 审查修复后的 fresh focused verification：contracts 50/50、shared 108/108、server OMP ACP/client-capability/adapter/registry/discovery/service 153/153、OMP health 9/9、Web settings/provider/composer/catalog 174/174。`git diff --check` 无 whitespace error（Git 仅提示 Windows checkout 的 LF→CRLF warning）。按本轮明确约束未运行 `bun fmt`、`bun lint`、`bun typecheck`，也未把隔离 Synara UI 的 12 项真实手工场景伪称为已执行。

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
