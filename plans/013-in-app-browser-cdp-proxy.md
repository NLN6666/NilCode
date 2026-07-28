# 013 · 内置浏览器 CDP 代理（让 agent 控制内置浏览器）

- 状态：TODO —— 设计已定，实施计划待编
- 创建：2026-07-28T12:09:42Z
- 范围：`apps/desktop`（主体）、`packages/contracts`（状态字段与设置项）、`apps/web`（设置界面开关 + "agent 控制中"标记）
- 不在范围：Codex browser-use 管道的 Windows 支持（见 §8，另开计划）

## 1. 目标

让 agent 通过官方 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) 控制 **Synara 内置浏览器**，而不是另起一个 Chrome 进程。

做法是在 Electron 主进程内实现一个**浏览器级 CDP 端点**，使 `chrome-devtools-mcp --ws-endpoint ...` 能像连真实 Chrome 一样连上来，从而复用它现成的 50+ 工具（导航、点击、快照、网络、性能追踪等），而不必自己重造一套浏览器工具集。

## 2. 现状（实施前必读）

内置浏览器由 `apps/desktop/src/browserManager.ts` 管理，每个 thread/tab 一个 `WebContentsView` 运行时。

**CDP 能力已经存在**：

- `browserManager.executeCdp()` 走 `webContents.debugger.attach("1.3")` + `sendCommand`。
- `browserElementPicker.ts` 的元素拾取即基于它的 `Overlay.setInspectMode`。
- `browserUsePipeServer.ts` 已把这套能力包成 **Codex 私有的 browser-use 协议**，经 Unix domain socket 暴露。

**两个缺口**：

1. `browserUsePipeServer` 是 Codex 私有协议，不是标准 CDP 端点。chrome-devtools-mcp / Puppeteer / Playwright 都连不上——它们要的是浏览器级的 `Browser.*` / `Target.*` 域，而 Electron 的 `webContents.debugger` 是**进程内单 webContents** 的 session，拿不到这些域。
2. `resolveDefaultBrowserUsePipePath()` 在 `win32` 直接返回 `""`。Windows 上这条通路根本没启用，且**是刻意的**——`start()` 里写着 `"Browser-use native pipe is disabled without a proven private Windows ACL"`。

本计划解决缺口 1。缺口 2 见 §8。

## 3. 已核实的事实

以下均已核实，不依赖记忆：

| 事实                                                                                              | 来源                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| chrome-devtools-mcp 支持 `--browser-url`、`--ws-endpoint`、`--ws-headers`（可带认证头）           | 官方 README                                     |
| 官方 README 自陈：开 remote debugging port 后"机器上任何程序都能连上并控制该浏览器"               | 官方 README                                     |
| Electron 40.10.6 的 `debugger.sendCommand(method, params, sessionId)` 支持 sessionId              | `apps/desktop/node_modules/electron/electron.d.ts:7488` |
| `debugger.on("message", (e, method, params, sessionId))` 回传 sessionId                           | 同上 `:7394-7408`                               |
| `apps/desktop` 无 `ws` 依赖；`apps/server` 有 `ws@^8.21.0`                                        | 各 `package.json`                               |
| 现有 `browserManager.subscribeToCdpEvents` **丢弃** sessionId                                     | `browserManager.ts:1105-1120`                   |

**未核实、不得当作依据**：DeepWiki 关于 Codex IAB 管道的回答把 codex 的 **sandbox command-runner** 管道（`spawn_runner_transport` / `codex-command-runner.exe`）与 **IAB 浏览器管道**混为一谈，其"Windows 用命名管道且有 ACL"的结论不可用于本仓库决策。

## 4. 已确定的决策

| 决策点       | 结论                                                            | 理由                                                                                                     |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 消费方       | chrome-devtools-mcp                                             | 复用其 50+ 成熟工具，避免自建浏览器工具集                                                                |
| 路线         | **自建浏览器级 CDP 代理**，不开 `--remote-debugging-port`       | 见下方"被否决的方案"                                                                                     |
| target 范围  | 只暴露**当前活跃 thread** 的 tab                                | agent 控制的就是用户此刻看得见的会话；无跨会话误操作                                                     |
| 可见性       | **会话级租约**：attach 时唤醒一次，之后不抢焦点                 | chrome-devtools-mcp 一次高层操作背后是十几条 CDP 命令，命令级激活既吵又有开销                            |
| 传输         | `ws` over TCP，绑 `127.0.0.1`，固定路径 `/synara/cdp`           | MCP 配置是静态 JSON，端点必须跨重启稳定                                                                  |
| 端口         | 默认 `9333`，设置内可改                                         | 同上                                                                                                     |
| 认证         | WS **upgrade 阶段**校验 `Authorization: Bearer`                 | 让未授权在协议状态机建立**之前**终结；chrome-devtools-mcp 的 `--ws-headers` 原生支持                     |
| HTTP 发现    | **不提供** `/json/version`                                      | `--ws-endpoint` 已够用；少一个未认证端点、少一条认证路径（YAGNI）                                        |
| 默认开关     | 默认**关闭**，设置内开启并持久化                                | 毕竟开了本地端口；配"复制 MCP 配置"按钮解决可发现性                                                      |
| WS 库        | 给 `apps/desktop` 加 `ws`，版本对齐 `apps/server`               | 代理必须活在主进程（`browserManager` 持有 `WebContentsView`）；CDP 高频往返，绕 `desktopWsBridge` 多一跳不可接受 |

### 被否决的方案

| 方案                                            | 否决理由                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 直接 `app.commandLine.appendSwitch("remote-debugging-port", ...)` | 一行即可，100% 兼容，但**整个 app（含 Synara 自身 UI）对本机任意进程全开**。Synara 渲染进程持有到后端的 WS 桥与各 provider 凭据。端口上没有认证这一说 |
| 上述端口 + 前置过滤代理                         | 底层端口仍在，绕过代理直连即可——安全收益不成立，却付出了自建代理的大部分工作量                                                          |
| 在 `apps/server` 侧实现代理                     | server 够不着 `WebContentsView`，需经 `desktopWsBridge` 多一跳，与"Performance first"冲突                                                 |
| 自建一套 Synara 浏览器工具集（不走 CDP 协议）   | 等于重造 chrome-devtools-mcp 的 50+ 工具（含 a11y 快照、性能追踪），工作量与维护成本都不划算                                             |

## 5. 架构

沿用仓库已有的**窄 host 接口**模式（`browserElementPicker.ts` 即"由 DesktopBrowserManager 提供一个窄 CDP host 接口"），把协议逻辑与 Electron 彻底隔开。

### 5.1 新增模块（`apps/desktop/src/`）

全部带仓库现有的 `// FILE: / Purpose: / Layer: / Depends on:` 头注释。

| 文件                          | 职责                                                                                       | 依赖             |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| `browserCdpTargetRegistry.ts` | **纯逻辑**。`ThreadBrowserState` + 活跃 threadId → target 列表；diff 出 `targetCreated` / `targetInfoChanged` / `targetDestroyed` | 无               |
| `browserCdpProtocol.ts`       | **纯逻辑**。合成 `Browser.*` / `Target.*` 应答；flatten 模式 sessionId 信封编解码           | 无               |
| `browserCdpSessionRouter.ts`  | sessionId ↔ (runtimeKey, Electron 上游 sessionId) 路由表与 attach/detach 生命周期           | 上两者           |
| `browserCdpProxyServer.ts`    | `ws` 服务器：握手鉴权、连接数上限、背压、in-flight 上限、dispose                            | 以上 + 窄 host   |
| `browserAutomationLease.ts`   | **共享**：引用计数 attach/detach、保活、首次唤醒、UI"agent 控制中"标记                     | 窄 host          |

前三者零 Electron 依赖——最高风险的协议逻辑因此可纯单测覆盖，无需起 Electron。

### 5.2 改动（克制，不顺手重构）

`browserManager.ts`：

1. `subscribeToCdpEvents` 补透传 `sessionId`（当前被丢弃，flatten 嵌套 session 必需）。
2. 新增**不强制激活**的 `sendCdpCommand`。**现有 `executeCdp` 语义原样保留**，Codex pipe 继续用它。
3. 新增 target 变化订阅。
4. 接入 `browserAutomationLease` 的引用计数 attach/detach（见 §7）。

`browserElementPicker.ts`：改为经 `browserAutomationLease` 取得 attach，不再自行 attach。

`main.ts`：起停代理，接入现有 shutdown 序列（参照 `disposeBrowserUsePipeServerForShutdown`）。

`packages/contracts` + `apps/web`，两处：

- `ThreadBrowserState` 增加"agent 控制中"标记字段，`BrowserPanel` 显示之。
- 应用设置增加 CDP 代理项（开关 + 端口），设置界面提供开关与"复制 MCP 配置"按钮（按钮输出 §5.6 的完整命令行片段，含当前端口与 token）。开关状态持久化。

`apps/desktop/package.json`：加 `ws` / `@types/ws`；加 `puppeteer-core` 作 devDependency（仅供集成测试）。

### 5.3 协议分流

**核心规则**：消息**不带 `sessionId`** → 浏览器级，由代理自行合成，**永不下发** Electron；**带 `sessionId`** → 路由到对应 `webContents.debugger`。

这条规则本身就是安全边界：Synara 自己的渲染进程从不进入 registry，因而在**协议层面不可寻址**，而非靠过滤挡住。这是本路线相对"端口 + 过滤代理"的本质区别。

合成的浏览器级命令：

| 命令                                                     | 处理                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Browser.getVersion`                                     | 用 `process.versions.chrome` + `app.userAgentFallback` 拼真实值，`protocolVersion: "1.3"` |
| `Target.setDiscoverTargets` / `getTargets` / `getTargetInfo` | 由 `browserCdpTargetRegistry` 供数                                              |
| `Target.attachToTarget`                                  | 分配合成 sessionId，登记路由，回 `{sessionId}` 并发 `Target.attachedToTarget`     |
| `Target.setAutoAttach`（浏览器级）                       | 记录开关；对现存/新增 target 自动补发 `attachedToTarget`                          |
| `Target.createTarget`                                    | → 新建 tab；面板未开时复用 pipe server 已有的 `requestOpenPanel` + 轮询等待        |
| `Target.closeTarget`                                     | → 关 tab                                                                          |
| `Target.activateTarget`                                  | **唯一会切 UI 的入口**——与"会话级租约"一致：agent 想让用户看见，须显式请求        |
| `Target.getBrowserContexts`                              | 只报告 default（Synara 全用单一 `BROWSER_SESSION_PARTITION`）                     |
| `Target.createBrowserContext`                            | **明确报错**，不假装成功                                                          |
| `Browser.close`                                          | **拒绝**——否则 agent 一条命令即可关掉整个 Synara                                 |

拒绝而非静默忽略，是因为 puppeteer 对"成功但无效果"容错极差，明确报错反而让上层能正确降级。

### 5.4 嵌套 session

Electron 的 `sendCommand(method, params, sessionId)` 直接接受 Chromium 原生 sessionId。因此：

- **仅顶层 page session 需要合成 id**（Electron 侧它是空串）。
- page 内 OOPIF/worker 的子 session 由 Chromium 分配 id，**原样透传**，不做重映射。

事件回流时：`sessionId` 为空 → 套上该 runtime 的合成 id；非空 → 直传，并在 `Target.attachedToTarget` / `detachedFromTarget` 上增删路由表。

`targetId` 用每个 (threadId, tabId) 一个稳定的随机 32-hex，不泄漏 threadId。

### 5.5 租约生命周期

```
连接（通过鉴权） ──► 建 lease
   └─ Target.attachToTarget ──► 租约覆盖该 tab
        ├─ 取消挂起定时器 / ensureLiveRuntime / 若已挂起则 load   ← 唯一一次唤醒
        ├─ UI 标记"agent 控制中"
        └─ 后续所有命令：直发，不再 activate
   └─ detach / 断连 / target 消失 ──► 释放租约，恢复正常挂起策略
```

### 5.6 目标 MCP 配置形态

端点跨重启稳定，用户配一次即长期有效。"复制 MCP 配置"按钮输出：

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": [
      "-y",
      "chrome-devtools-mcp@latest",
      "--ws-endpoint",
      "ws://127.0.0.1:9333/synara/cdp",
      "--ws-headers",
      "{\"Authorization\":\"Bearer <token>\"}"
    ]
  }
}
```

token 生成一次后持久化于 `app.getPath("userData")`，权限 0600。

## 6. 已知且接受的后果

**切换 thread 会使 agent 已 attach 的 session 失效。** 因为只暴露当前活跃 thread，用户切 thread 时代理会规范地发出 `targetDestroyed` + `detachedFromTarget`；chrome-devtools-mcp 侧表现为"页面没了"，下次调用需重新选 target。

这是"只暴露活跃 thread"的诚实代价，不是缺陷。实施时不得为掩盖它而保留跨 thread 的僵尸 target。

## 7. 失败模式

### 7.1 debugger attach 是单例（必须引用计数）

**Electron 的 `webContents.debugger` 每个 webContents 只能被 attach 一次。** 届时将有**三个**消费者 attach 同一 tab：

- `browserElementPicker`（元素拾取）
- `browserUsePipeServer`（Codex）
- 新增的 CDP 代理

而 detach 目前只在 runtime 销毁时发生一次（`browserManager.ts:1784`）。三方并存下，谁先 detach 就打断另外两个。**用户手动打开该页面的 DevTools 也会撞车**——DevTools 与 debugger attach 互斥。

因此 `browserAutomationLease.ts` 必须承担**引用计数的 attach/detach**：三个消费者统一经它，计数归零才真 detach。这不是顺手重构，是三方共存的正确性前提。

### 7.2 其余

| 场景                    | 处理                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| 鉴权失败                | upgrade 阶段拒绝握手，协议状态机不建立                            |
| 未知浏览器级命令        | 回 Chrome 同形状的 `-32601`，不静默吞                             |
| runtime 已销毁          | 回 `Session with given id not found.` + 补发 `detachedFromTarget` |
| 用户打开该页 DevTools   | 引用计数让位，发 `detachedFromTarget` 并在 UI 说明原因            |
| 切换 thread             | `targetDestroyed` + `detachedFromTarget`（§6）                    |
| 端口被占用              | **启动时大声失败**并在 UI 报出，绝不静默禁用                      |
| 应用退出                | 接入现有 shutdown 序列                                            |

### 7.3 背压

照搬 `browserUsePipeServer` 已验证的上限（连接数 / in-flight / 输出队列字节）。溢出时**沿用其现有处理**：发出 CDP detach 信号后断开，而非静默丢事件。

理由：静默丢 CDP 事件对 puppeteer 是灾难性的——它靠事件流维护内部状态机，丢一条 `Page.frameNavigated` 即可能永久卡在错误状态。`browserUsePipeServer.test.ts` 中"signals CDP detachment instead of silently dropping notifications at capacity"一条测试正为此存在，新通路不得重犯。

## 8. 不在范围：Codex 管道的 Windows 支持

补齐 `browserUsePipeServer` 的 Windows 传输**另开计划**，因其带有两个需调研才能消除的阻塞：

1. Codex IAB 客户端在 Windows 上的发现方式未知（命名管道？TCP？路径规则？）。本仓库 discovery 目录硬编码为 POSIX 路径 `/tmp/codex-browser-use`，方向相反。须读 Codex 源码确认，DeepWiki 不可信（§3）。
2. 即便确定，Node/libuv 建命名管道**无法设置 SecurityDescriptor，也无法加 `PIPE_REJECT_REMOTE_CLIENTS`**——这正是原作者拒绝上 Windows 的理由。绕过可能需要原生模块。

**另有一个可能使该计划整体消失的变数**：若 Codex 本身支持直连 CDP 端点，则本计划落地后 Codex 可直接复用，无需管道。该计划应以此调研 spike 开头。

## 9. 测试策略

1. **纯单测**（registry diff / protocol 合成 / session 路由）——无 Electron 依赖，覆盖风险最高的协议逻辑。
2. **真 puppeteer-core 集成测试**——`puppeteer-core` 真实 `connect()` 上代理（后端为 fake host），断言可列 target、attach、执行 `Page.navigate`。**这是兼容性的唯一硬证据**，合成协议正确与否不能靠人眼审阅。
3. 专项：鉴权拒绝、背压溢出 → 发 detach 信号、切 thread → detach、引用计数 attach 不误伤。

## 10. 验收标准

- chrome-devtools-mcp 以 `--ws-endpoint ws://127.0.0.1:9333/synara/cdp` + `--ws-headers` 连接成功，可列出当前活跃 thread 的 tab 并完成导航、快照、点击。
- Synara 自身渲染进程**不出现**在 target 列表中。
- 未带正确 token 的连接在 upgrade 阶段即被拒。
- 元素拾取、Codex pipe、CDP 代理三者可并存，互不打断（引用计数生效）。
- 上述新增测试全部通过。

**验证口径**：用 `bun run test`，**绝不** `bun test`。按 `AGENTS.md`，`bun fmt` / `bun lint` / `bun typecheck` 在实施完成前须全绿，收尾合并为一次验证。

⚠️ **不得以"整包绿"作为验收标准**：`apps/desktop` 存在与本计划无关的存量失败（vitest 缓存显示 `browserUsePipeServer.test.ts`、`desktopUserDataProfile.test.ts`、`macIconCacheRefresh.test.ts`、`updateArtifactIdentity.test.ts` 均为 failed）。本计划不修这些，验收须按测试文件逐一核对。
