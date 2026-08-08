---
name: daemon-visibility-panel
status: approved
created: 2026-08-08T07:26:50Z
updated: 2026-08-08T07:26:50Z
---

# 后台服务可见性与生命周期面板 —— 设计文档

## 0. 与前一期的关系

本设计是 [`2026-08-07-agent-background-server-sessions-design.md`](./2026-08-07-agent-background-server-sessions-design.md) 的后续。那一期第 9 节「明确不做」的最后一条正是 **新的 UI 面板**——底层 `DaemonBroker` 已完整落地，但只服务 Agent，人看不见也管不着。

本期补齐的就是这一条，外加两个在上一期实现中留下的缺口。

## 1. 目标

1. **可见**：用户能在 UI 里看到所有正在运行的后台服务（如 Agent 启动的 Minecraft 服务端）
2. **可预览**：实时跟随服务日志，并向其发送控制台命令
3. **不被对话终结**：对话结束、线程删除都不影响后台服务
4. **可终结**：用户随时手动停止/重启；软件退出时按既定策略收尾

## 2. 现状勘察

### 2.1 后端已完备

`DaemonBroker`（`apps/server/src/daemon/`）提供 `start / list / describe / logs / send / wait / stop / restart / reclaimDetached / dispose`，含日志文件轮转、字节游标、就绪探针、重启退避、detached 跨重启重认领，以及 Minecraft 验收测试。

### 2.2 三个确认的缺口

| 缺口 | 证据 |
| --- | --- |
| **前端完全没有 daemon 通道** | `grep -ril daemon apps/web/src` 命中数为 0 |
| **`DaemonSpec.persist` 是死字段** | 全仓库唯一读取处是 `packages/contracts/src/daemon.test.ts` 的默认值断言；`daemonTools.ts` 甚至没把它暴露给 Agent |
| **`broker.dispose` 从无调用点** | `serverShutdown.ts` 里不存在，服务器退出时不做任何 daemon 收尾 |

### 2.3 需求第 3 点其实已成立，但有个真实漏洞

`DaemonBroker` 是 server 级单例，**完全不认识 threadId**——对话终止本来就不会终结 daemon。

真正会被杀的是另一条路径：如果 Agent 图省事，直接在 Claude CLI 的 Bash 工具里后台运行 `java -jar server.jar`，该进程是 provider CLI 的子进程，会随 `apps/server/src/provider/supervisedProcessTeardown.ts` 的进程树清理一起消失，而且面板也看不到它。

`apps/server/src/agentGateway/harnessPolicy.ts` 目前**一个字都没提 daemon 工具**。所以本期的 prompt 引导不是锦上添花，而是需求第 3 点真正生效的前提。

## 3. 架构决策：UI 如何拿到实时日志

`brokerCore` 没有观察者机制，只有 per-call 的 `waiters` 和阻塞式 `logs(follow)`。

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| **A. broker 订阅 + WS 推送通道** | `brokerCore.subscribe(listener)`，新增 `WS_CHANNELS.daemonEvent` | **采纳。** 与既有 `terminalEvent` / `projectDevServerEvent` 完全同构；状态变化与输出走同一条流，低延迟 |
| B. 前端长轮询 `logs(follow)` | 不动 broker | 驳回。每个面板一条阻塞请求，游标要前端管，状态变化还得另开轮询，等于并行维护第二套机制 |
| C. 桥接进既有 terminal session 系统 | 复用 `terminalOpen/Write` | 驳回。daemon 有 restart policy、readiness、detached，terminal session 都没有；揉在一起正是知识库反复警告的抽象混淆 |

## 4. 契约层

### 4.1 新增推送事件（`packages/contracts/src/daemon.ts`）

判别联合，风格对齐 `ProjectDevServerEvent`：

```
DaemonEvent =
  | { type: "state",  snapshot: DaemonSnapshot }
  | { type: "output", name: DaemonName, chunk: string, cursor: number }
```

- `state` 覆盖启动、就绪、退出、重启、重认领——一律直接携带完整 `DaemonSnapshot`，前端做整体替换而非增量合并，避免两边状态机各推各的
- `output` 的 `cursor` 是发出该块之后的 `outputBytes`，让前端能识别自己是否漏收

### 4.2 删除死字段 `DaemonSpec.persist`

`persist` 语义是「活过最后一个客户端断开」，但 daemon 从来就不挂在客户端上，字段从未被读取，也未暴露给 Agent。退出策略（§6）确定后它更无立足之地。

一并删掉 `daemon.test.ts` 里对它的默认值断言。这是本期改动区内的清理，不是顺手重构。

### 4.3 新增 WS 通道与 RPC

- 通道：`WS_CHANNELS.daemonEvent`，注册进 `WsPushPayloadByChannel` / `WsPushChannelSchema` / `WsPush` 三处（该文件要求三处同步）
- RPC（`WS_METHODS` + `rpc.ts` + `ws.ts`）：`daemonList` / `daemonLogs` / `daemonSend` / `daemonStop` / `daemonRestart`

五个 RPC 一一映射到 broker 已有能力，**不新增任何底层能力**。不提供 `daemonStart`：服务由 Agent 启动，用户负责监看与终结。

## 5. 服务端

| 文件 | 改动 |
| --- | --- |
| `daemon/brokerCore.ts` | 新增 `subscribe(listener): () => void`。在 `publish()`（状态）与 `handleOutput()`（输出）两处发事件。这是唯一的核心改动 |
| `daemon/Services/Broker.ts` | `DaemonBrokerShape` 增加 `subscribe` |
| `daemon/Layers/Broker.ts` | 透传 `subscribe` |
| `daemon/daemonRpcHandlers.ts`（新增） | 五个 RPC 处理器；订阅 broker 事件并泵到 WS 推送 |
| `serverShutdown.ts` | 见 §6 |

daemon 是全局对象，事件**广播给所有已连接客户端**，不做 per-thread 过滤。

## 6. 生命周期

| 事件 | 行为 |
| --- | --- |
| 对话结束 / 线程删除 | **无动作**。broker 不认识 threadId |
| 用户点「停止」 | `daemonStop` → 优雅信号，宽限期后杀进程树 |
| 用户点「重启」 | `daemonRestart` |
| **软件退出** | 优雅停止所有**非 detached** daemon，然后调用 `broker.dispose`（**首次真正接上这个一直没人调的方法**） |
| 下次启动 | `reclaimDetached` 重认领 detached 服务，面板立刻显示它们 |

**为什么 detached 不杀**：`detached: true` 的设计初衷就是活过 Synara 服务器进程，上一期为此在 Windows 上刻意偏离了来源实现（`detached: true` + `windowsHide`），并配了跨重启重认领。退出时一律杀掉会让那整套能力变成死代码。

**为什么非 detached 要杀**：它们是 server 的子进程，不主动收尾就会变成孤儿进程，用户在任务管理器里看到一堆没人管的 java 进程。

## 7. 前端

### 7.1 面板位置

`rightDockStore.logic.ts` 的 `RIGHT_DOCK_PANE_KINDS` 新增 `"services"`，**单例页签**（不加入 `MULTI_INSTANCE_PANE_KINDS`，会自动落进 `SINGLETON_PANE_KINDS`）。

复用既有 dock 的分页、头部、分屏基础设施。语义上要清楚：这是嵌在 per-thread dock 里的**全局内容**——同一个服务在任何对话打开都是同一份状态。

```
┌─ Chat ──────────────┬─ [browser][diff][services ●]──┐
│                     │ ● mc-server   ready   :25565  │
│                     │ ○ vite-dev    exited(1)  ↻2   │
│                     ├───────────────────────────────┤
│                     │ [xterm 只读日志视图]          │
│                     │ Done (12.3s)! For help, type… │
│                     ├───────────────────────────────┤
│                     │ > stop            [停止][重启]│
└─────────────────────┴───────────────────────────────┘
```

### 7.2 模块划分

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `daemonStore.ts` | 全局 snapshot 表 + 每个 daemon 的日志环形缓冲；订阅 `daemonEvent` | WS 传输 |
| `components/services/ServicesPanel.tsx` | 列表（状态点、名称、PID、重启次数）+ 选中态 + 操作按钮 | store |
| `components/services/DaemonLogView.tsx` | 轻量只读 xterm 视图 + 输入行 | `terminalRuntimeAppearance` |

**store 不挂在 thread 上。** daemon 是 server 全局的，切换对话不该丢日志缓冲。

### 7.3 日志视图为什么不复用 `terminalRuntime.ts`

`terminalRuntime.ts` 与 `TerminalSessionSnapshot`、`terminalOpen/Write/Resize` RPC 深度绑定（1200+ 行，含会话恢复、ack 背压、链接解析）。硬套需要给它开一条假的数据源分支，把两个生命周期模型拧在一起。

改为新建一个精简组件：直接创建 `@xterm/xterm` 的 `Terminal`，**复用 `terminalRuntimeAppearance.ts` 导出的主题与字体函数**（`terminalThemeFromApp` / `getTerminalFontFamily` / `getTerminalFontSizePx` / `getTerminalFontWeight`），保证与普通终端观感完全一致。这是共享该共享的、隔离该隔离的。

### 7.4 输入

输入行走 `daemonSend` RPC（`text` + `enter: true`），不接 xterm 的 `onData`。

**detached 的 daemon 输入框禁用**，并显示原因：它的 stdio 已重定向到日志文件，没有 stdin 通道——这是上一期照搬来源实现的既定约束，UI 必须如实呈现而不是让用户对着无效输入框敲。

### 7.5 UI 约定

- 展开/折叠一律走 `apps/web/src/lib/disclosureMotion.ts`，禁止自写高度/透明度过渡
- 全部文案进 i18n 并提供中文

## 8. Prompt 引导

`apps/server/src/agentGateway/harnessPolicy.ts` 新增一段，写法参照既有的 `browser_*` 条目：

> 任何需要活过本次对话的长期进程（游戏服务器、dev server、数据库）必须通过 `synara_*_daemon` 工具启动，不要用 Bash 后台运行。Bash 起的进程是 provider CLI 的子进程，会随会话进程树清理一起终止，用户也无法在后台服务面板中看到或控制它。

## 9. 测试

| 层 | 用例 |
| --- | --- |
| `brokerCore` | `subscribe` 在状态变化与输出时发射、退订后不再收到、多订阅者互不影响 |
| 退出策略 | 非 detached 被优雅停止、detached 被保留、`dispose` 被调用 |
| RPC | 五个处理器的入参解码、`daemon_not_found` 错误分支、返回形状 |
| `daemonStore` | 事件归约、日志环形缓冲上限、`droppedBytes` 截断如实呈现 |
| dock | `"services"` 落在 `SINGLETON_PANE_KINDS`、持久化状态校验放行该 kind |
| i18n | 新增文案键中文齐备 |

Windows 上绕开 turbo 直接调 vitest。

## 10. 明确不做

- **从 UI 新建 daemon**：服务由 Agent 启动；用户侧只监看与终结
- **内嵌浏览器预览**：对声明了端口的服务开 `localhost:<port>` 对 web dev server 有用，对 MC 服务器无意义，不在本期需求内
- **把 `.nilcode/launch.json` 项目服务并进本面板**：它已有 `project-service:<projectId>` 终端作用域和 Stop 按钮，两套模型差异不小，统一是独立议题
- **迁移 Agent 已在终端里跑的长任务**：本期用 prompt 引导从源头避免，不做既有进程的提升
