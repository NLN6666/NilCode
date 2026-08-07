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
