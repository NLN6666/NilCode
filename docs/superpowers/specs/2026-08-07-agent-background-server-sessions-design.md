---
name: agent-background-server-sessions
status: approved
created: 2026-08-07T10:16:40Z
updated: 2026-08-07T10:52:00Z
---

# Agent 后台服务器会话 —— 设计文档

## 0. 致谢与来源

本设计**移植自 [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) 的 `hub` 工具与 `DaemonBroker` 实现**（MIT 许可）。守护进程规格、状态机、就绪探针、重启退避、detached 存活、日志游标与工具 op 划分均沿用其设计。

oh-my-pi 以 MIT 许可发布，许可要求在软件的副本或实质性部分中保留版权与许可声明：

```
MIT License — Copyright (c) can1357 (oh-my-pi)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

本仓库为**在不同技术栈上的重新实现**（Effect + node-pty + 既有 TerminalManager），而非逐行复制。每个移植模块的文件头须标注来源。上述声明另需写入 `THIRD-PARTY-NOTICES.md`。

## 1. 目标

让 **Agent** 能够启动并监管长期运行的服务器进程（Minecraft 服务端、dev server、`docker compose up`），具体是：

1. 以稳定名字启动守护进程，并声明**就绪条件**（日志匹配 / 端口可连接 / 超时）
2. 按游标增量读取日志，或阻塞等待新输出 / 就绪 / 退出 / 特定日志模式
3. 向其发送 stdin 文本、终端按键、或进程信号
4. 停止、重启、查看状态
5. 进程可**在 Synara 退出后继续存活**（`detached`），并在重启后重新认领

**主语是 Agent，不是人。** 本期不做面向人的监控面板。

### 为什么现有工具不够

Agent 已有 bash 工具，但 bash 是一次性阻塞的：`java -jar server.jar` 一跑，该 tool call 永不返回，Agent 拿不回控制权，更无法向其 stdin 写入。

## 2. 边界：不移植的部分

oh-my-pi 的 `hub` 工具还包含 agent 间消息传递（`op: "send"` 带 `to`/`message`、`op: "inbox"`、`op: "wait"` 带 `from`、`op: "jobs"`、`op: "cancel"`）。这些在 Synara 中由 **automations 与 threads 子系统**承担，移植会造成功能重复。

本设计只移植**进程管理的 8 个 op**：`start` / `ps` / `logs` / `send` / `wait` / `stop` / `restart` / `describe`。

## 3. 架构

新增 `apps/server/src/daemon/` 子系统，对应 oh-my-pi 的 `packages/coding-agent/src/launch/`。

```
DaemonBroker (Effect Layer)
  ├── #records: Map<name, ManagedDaemon>
  ├── #launch / #launchDetached      进程启动
  ├── #settle                        退出处理 + 重启策略
  ├── #waitUntil                     条件阻塞
  ├── #refreshDetached               detached 存活探测
  └── DaemonLog                      文件落盘 + 轮转 + 游标
```

### 3.1 三个核心类型（沿用 oh-my-pi 命名）

| 类型 | 含义 |
|---|---|
| `DaemonSpec` | 不可变启动规格：`name` / `application` / `args` / `env` / `cwd` / `pty` / `ready` / `restart` / `persist` / `detached` |
| `DaemonSnapshot` | 可序列化的对外状态：`name` / `id` / `state` / `pid` / `createdAt` / `startedAt` / `readyAt` / `exitedAt` / `exitCode` / `exitReason` / `restartCount` / `outputBytes` / `readyPending` |
| `ManagedDaemon` | broker 内部记录：`spec` + `snapshot` + `dir` + `log` + `process` / `input` / `pty` + `generation` + `logReady` / `portReady` / `readinessBuffer` / `readyPattern` + `restartTimer` / `consecutiveFailures` |

`generation` 是防竞态计数器：重启时递增，旧进程的 exit 回调若 generation 不匹配则丢弃，避免"上一代的退出事件把新一代标记成 exited"。

### 3.2 状态机

```
starting ──(就绪条件满足)──> ready ──> running
    │                                    │
    │ (无 ready 规格)                    │ (进程退出)
    └──────────> running                 ▼
                                    ┌─ exitCode 0  且无重启策略 ──> exited
                                    ├─ exitCode ≠0 且无重启策略 ──> failed
                                    └─ 重启策略命中 ──> restarting ──> starting
```

`terminalState` = `exited | failed`；`settledState` 额外包含 `restarting`（子进程已退出、重启定时器已武装）。

### 3.3 命名与作用域

守护进程按 **project 作用域的稳定 `name`** 寻址（`name` 长度上限 48，与 oh-my-pi 一致），而非我们原先的合成 ThreadId。这与既有的 `project-service:<projectId>` 作用域理念一致：一个声明了端口的服务是项目级单例。

`name` 同时是磁盘目录名：`<runtimeDir>/daemons/<name>/`。

### 3.4 与既有 TerminalManager 的关系

| 场景 | 走哪条路 |
|---|---|
| `detached: false` + `pty: true` | 复用既有 PTY adapter 与 `TerminalManager`，会话以 `streamOutput: false` 打开，用户仍可在 UI 里接管 |
| `detached: true` | **不能**走 TerminalManager（PTY 随父进程死）。走独立 spawn，stdio 重定向到日志文件，`unref()` |

`detached` 蕴含 `persist`，并**禁用 PTY 输入**（stdio 已重定向到文件，没有 stdin 通道）——这是 oh-my-pi 的既定约束，照搬。

## 4. 工具面

沿用本仓库 `automationTools.ts` 的惯例：**独立的 `synara_*` 工具**，而非单个带 `op` 判别式的工具。oh-my-pi 把三个工具合并成 `hub` 是为解决其自身的工具爆炸问题；本仓库既有 7 个独立的 automation 工具，为一族破例会让 API 自相矛盾。**op 语义逐个照搬，封装形态随本地惯例。**

| 工具 | 对应 oh-my-pi op | 参数 |
|---|---|---|
| `synara_start_daemon` | `start` | `name` / `application` / `args` / `env` / `cwd` / `pty` / `ready` / `restart` / `persist` / `detached` |
| `synara_list_daemons` | `ps` | — |
| `synara_describe_daemon` | `describe` | `name` |
| `synara_read_daemon_logs` | `logs` | `name` / `lines`(默认 100，上限 1000) / `head` / `grep` / `follow` / `cursor` / `timeout`(默认 30s) |
| `synara_send_daemon_input` | `send` | `name` / `text` / `enter`(默认 true) / `keys` / `signal` |
| `synara_wait_daemon` | `wait` | `name` / `for`(`ready`\|`exit`，默认 exit) / `pattern`(优先于 for) / `timeout`(默认 30s) |
| `synara_stop_daemon` | `stop` | `name` / `timeout`(默认 5s) |
| `synara_restart_daemon` | `restart` | `name` |

### 4.1 就绪探针 `ready`

`{ log?: string, port?: number, host?: string, timeout?: number }`

- `log`：**正则**，对 `readinessBuffer`（有界窗口）匹配，命中置 `logReady`
- `port`：周期性 TCP 连接尝试，连通置 `portReady`
- 两者都声明时**必须都满足**；超时未满足则保持 `starting` 并报告 `readyTimedOut`
- `readyPending` 字段向 Agent 明示还差哪个条件

把就绪声明在 start 上，最高频的"启动 MC → 等 `Done (`"从两次调用压成一次。

### 4.2 重启策略

`"no"`（默认）/ `"on-failure"` / `"always"`。命中时按**指数退避**重启，上限 `RESTART_MAX_DELAY_MS`；`consecutiveFailures` 每次失败递增、成功启动归零。

### 4.3 `send` 的三条通道

| 参数 | 语义 |
|---|---|
| `text` + `enter`（默认 true） | 写 stdin。`enter: false` 用于 REPL 半截输入、或读单字符的 y/n 提示 |
| `keys: string[]` | 终端按键（`CTRL_C` / `ENTER` / `TAB` / 方向键等），在 `text` 之后发送 |
| `signal` | 进程树信号（`SIGINT` / `SIGTERM` 等），**不经终端行规程** |

PTY 里的 Ctrl+C 与直接投递 SIGTERM 不是一回事，MC 服务端对两者处理路径不同。保留两条独立通道是刻意的。

`synara_stop_daemon` 的 description 须警告它是强制终止，对有状态服务器应先发优雅停止命令。

### 4.4 正则的使用范围

`ready.log`、`wait.pattern`、`logs.grep` 三处使用**正则**，照搬 oh-my-pi。

风险与缓解：模型提供的正则无法审查，病态模式可造成 ReDoS。oh-my-pi 的缓解是**只对有界缓冲区匹配**（`readinessBuffer`），而非对每一块流式输出无限匹配。本实现照搬该缓解：正则只作用于有界窗口与有界的读取结果，绝不放进 PTY drain 的无界热路径。

## 5. 日志与游标

### 5.1 `DaemonLog`：文件落盘 + 轮转

- 每个守护进程一个目录 `<runtimeDir>/daemons/<name>/`
- 当前日志 `output.log`，轮转后为 `output.prev.log`
- `append()` 写入；超过 `MAX_LOG_BYTES` 触发 `#rotate`
- `read()` 同时读当前与上一个文件，提供连续视图；单次读取受 `LOG_READ_BYTES` 限制
- `fileTextSlice` 支持从头部或尾部读取（对应 `logs.head`）

### 5.2 游标语义

**`cursor` = `outputBytes` = 该守护进程累计写入日志的总字节数**，单调递增。

`follow: true` 时，等待 `snapshot.outputBytes > cursor` 或超时。

字节偏移落在多字节字符中间时须退回合法 UTF-8 边界，否则会吐出 U+FFFD 并让 Agent 以为服务器输出了乱码。（已实现于 `packages/shared/src/backgroundServiceSession.ts`。）

### 5.3 截断告知

输出超限时告知 Agent 漏看了多少，绝不假装内容连续。oh-my-pi 的做法是把完整输出溢出为 artifact 并追加 `Read artifact://<id> for full output` 提示；本仓库无 artifact 子系统，改为返回 `droppedBytes: N` 并在结果中明示。**这是本设计相对来源实现的一处降级，记录在案。**

## 6. detached 实现

| 环节 | 做法 |
|---|---|
| spawn | `stdio: ["ignore", logFd, logFd]`——stdin 丢弃，stdout/stderr 直接重定向到日志文件描述符 |
| 平台差异 | **全平台 `detached: true`**，Windows 上同时 `windowsHide: true` 避免弹出控制台窗口。**此处刻意偏离来源实现**，理由见下方实测 |
| 脱离事件循环 | spawn 后调用 `child.unref()`，使 Node 事件循环可独立退出 |
| 元数据持久化 | `DaemonSpec` + 最后已知 `pid` 落盘到 `<dir>/daemon.json` |
| 重启后认领 | `#refreshDetached`：先 `#readDetachedOutput` 从 `outputOffset` 增量读日志文件，再用持久化的 pid 探测存活；不存活则 `#settle` 标记退出 |

### 6.1 偏离来源实现：Windows 上必须 `detached: true`（已实测）

oh-my-pi 的 `DAEMON_SPAWN_OPTIONS` 在 Windows 上使用 `detached: false`。**该选择在 Synara 的技术栈上不成立**，实测如下（Node v24，Windows 11，子进程每 300ms 追加一行到日志文件，父进程 400ms 后退出，3 秒后计数）：

| spawn 选项 | 结果 |
|---|---|
| `detached: false` + `unref()` | 1 行——父进程一退子进程即死 |
| `detached: true` + `unref()` + `windowsHide: true` | 58 行——持续存活 |

差异根源：oh-my-pi 使用 `Bun.spawn`，与 Node 的 `child_process.spawn` 在 Windows 进程组语义上不同。照搬 `detached: false` 会让 detached 功能**在主力平台上静默失效**——进程看似启动成功，Synara 一关全部消失，且无任何错误。

`windowsHide: true` 已覆盖 `detached: true` 会弹出控制台窗口的问题，两者可兼得。

**实现须在测试中固化这一行为**：起真实子进程、杀父进程、验证日志文件继续增长。

## 7. 权限

新增能力 `daemon:control`，加入 `AgentGatewayCapability`（`apps/server/src/agentGateway/Services/AgentGatewaySessionRegistry.ts:4`）。与 `browser:control` 同级授予。

阻塞类工具（`wait`、`logs` 带 `follow`）最长 60s（`SYNARA_GATEWAY_MAX_WAIT_MS`）。网关写权限钉在 ingress 时的 running turn 上；阻塞期间不重新校验，但 **turn 被中断时等待者必须被唤醒并返回**，不得挂死请求。

## 8. 测试

Vitest。Windows 上须绕开 turbo 直接调 vitest。

- **纯函数层**：游标切片与 UTF-8 边界、日志轮转下的连续读取、`readyPending` 计算、退避时长计算、按键/信号映射
- **Broker 层**：状态机全部迁移、`generation` 防竞态（旧进程 exit 不污染新一代）、就绪探针（log/port/双条件/超时）、重启退避与 `consecutiveFailures` 归零、`#refreshDetached` 存活探测
- **detached 集成**：**真实**起一个子进程，杀掉父进程，验证子进程存活且日志文件继续增长（Windows 上必测）
- **工具层**：mock broker，验证入参解码、错误分支、返回 JSON 形状

## 9. 明确不做

- agent 间消息（`send to:` / `inbox` / `jobs` / `cancel`）—— 由 automations 与 threads 承担
- Minecraft 特化逻辑（RCON、玩家列表解析）
- artifact 溢出子系统（降级为 `droppedBytes`，见 5.3）
- `terminalPattern` 自动化触发器（跨 turn 唤醒）—— 下一期
- 新的 UI 面板
