---
name: findings
description: Synara「发送对话没反应」故障排查记录
created: 2026-08-06T11:11:38Z
updated: 2026-08-07T03:30:20Z
---

# Findings

## 2026-08-06 Synara 发送对话无反应（UI 静止，后端正常）

### 现象

所有会话发送消息后 UI 毫无反应：只显示用户消息本身，助手回复、工具调用、子代理全部不出现。
应用版本：安装版 app.asar，构建于 2026-08-06 13:08（含 `9bb93008` 那批前端改动）。

### 关键排查手法（可复用）

1. **两份日志时区不同**：`~/.synara/userdata/logs/server.log` 记 UTC，`server-child.log` 记本地时间，
   同一事件差 8 小时。对齐时间线前必须先统一，否则会得出完全错误的因果顺序。
2. **`orchestration_events` 是黑匣子**：仅追加表，UI 再静止它也逐条记下后端真实做过的事。
   判断"前端问题还是后端问题"查这张表最直接，比读日志快。
   ```js
   // bun 内置 sqlite，只读打开安全
   import { Database } from "bun:sqlite";
   const db = new Database("C:/Users/kingt/.synara/userdata/state.sqlite", { readonly: true });
   db.query(
     "SELECT sequence, event_type, occurred_at, stream_id FROM orchestration_events WHERE sequence > ? ORDER BY sequence",
   ).all(seq);
   ```
   注意：heredoc 里写 Windows 路径要用正斜杠，反斜杠会被吃掉导致语法错误。
3. **`orchestration_consumer_state.last_acked_sequence` 是投影滞后的单一指标**。
   它等于 `MAX(sequence)` 即可一次性排除整条服务端投影链路。
4. 落库内容看 `projection_thread_activities`（列：activity_id/thread_id/turn_id/tone/kind/summary/
   payload_json/created_at/sequence，**没有 `type` 列**）和 `projection_thread_messages`。

### 已确认事实

- 后端**完全正常**：thread `221146fa` 在 10:59:12Z 收到消息，10:59:28 助手已回复并派出子代理
  `toolu_019qdKRy`，到 11:01:04 主线程 32 条活动 + 子代理 67 条活动持续写入。
- 同时段第二个会话 `a537152c` 也在正常跑，各自的子代理都在工作。
- 投影消费者位点 `17654` = `MAX(sequence) 17654`，**零积压**。
- 关停后刷屏的 `Orchestration command admission is stopped` 不是故障原因，
  而是故障的证据——它证明关窗那一刻后端仍有事件在源源不断流入。
- Codex CLI 认证被吊销（401 `token_invalidated` / `refresh_token_invalidated`），
  只影响 `generateThreadTitle`（文本生成 provider 是 codex/gpt-5.4-mini），
  **不影响 claudeAgent 主对话**，不是本故障的原因，但会让新会话拿不到标题。

### 故障边界

UI 精确停在 `10:59:12.509Z`（`context-window.configured` + `runtime.warning` 两条）。
其后 UI 一条都没渲染。断点紧邻处有：

- `10:59:15.367` `thread.meta-updated`（标题生成被 Codex 401 打挂之后）
- `10:59:20.147` / `10:59:21.035` / `10:59:21.037` 三条 `thread.session-set`

推测：session 切换那一刻实时推送订阅断开且未恢复。每个会话开始都会走 session-set，
故表现为"所有会话都这样"。**尚未验证**，需复现并抓 renderer console。

### 已排除的假设（三条都被证据推翻）

1. **投影滞后** —— `last_acked_sequence` == `MAX(sequence)`，零积压。
2. **`THREAD_SNAPSHOT_NOT_FOUND` 重试耗尽** —— 隔离实例上草稿流确实会 fail
   （console 有 `WebSocket RPC stream failed`），但发消息后前端会重新订阅并成功，UI 正常更新。
3. **`STREAM_DUPLICATE_SUBSCRIPTION` 重试耗尽** —— 服务端拒绝重复订阅时会打
   `Rejected streaming RPC admission { reason: 'duplicate' }`，用户本次会话日志里**一条都没有**
   （只有更早某次 20:45 的记录）。
4. **游标损坏** —— `projection_thread_activities.sequence` 连续、全库无 NULL。
5. **每 turn 两批 session-set 不是异常** —— 另一线程 `a537152c` 是同样模式。

### 复现尝试（未复现）

隔离实例：`SYNARA_HOME=%TEMP%/synara-verify-home`，server 3899 / vite 5899。
用 Claude Sonnet 5 发"派子代理数 .ts 文件"，**全程正常**：43 秒跑完并显示答案。

隔离实例踩坑：

- Claude 显示 Unavailable：正式实例在 `settings.json` 里显式配了
  `providers.claudeAgent.binaryPath = C:\Users\kingt\.local\bin\claude.exe`，
  裸 `claude` 会被 PATH 里的 clawgod shim 截走。把 settings.json 复制过去即可。
- provider 检测结果缓存在 `<home>/dev/provider-status/*.json`，改配置后要删掉才会重测，
  且检测是**前端打开页面时触发**，不是 server 启动时。
- 模型选择器是二级菜单：先 hover provider（Claude），再点具体模型。
- **UI 文本长度下降不等于内容丢失**：推理过程跑完会折叠成「Worked for 43s」，长度自然变短。
  用长度采样判断"UI 冻结"会误判，必须结合截图。

### 用户侧确认结果（2026-08-06T13:48Z 重开后）

- **内容全部出现**：助手回复、子代理痕迹都在 → 排除渲染层问题。
- **发新消息恢复正常** → 故障不是持久性的，重启即愈。
- 重开时 UI 显示"还在思考、过一会停了"：turn 状态在关窗时停留在 `running`，
  启动时的 `reconciling restart-stuck turns` 把它收尾。**预期行为，非故障**。

### 结论

一次**实时推送订阅的间歇性失效**：订阅在会话中途失效且不会自愈，直到重启应用。
根因未定位（不可复现）。后端、投影、数据落库全程无恙。

### 暴露出的真实缺陷（与根因无关，独立成立）

`apps/web/src/wsTransport.ts:1496-1507`：流失败且不属于可重试类别时，
只执行 `console.warn("WebSocket RPC stream failed", error)` ——
既不重试、也不重连、**UI 无任何提示**。
用户面对的是一个看起来正常、实际已死的界面，唯一线索在 DevTools 里，
而桌面版用户不会去开。静默降级 → 表现为"发送没反应"。

注：`emitThreadStreamFailure` 确实会发出失败信号（1500-1506 行），
但需要确认前端是否真的把它渲染成用户可见的提示。

---

## 2026-08-06 @ 提及列表里出现不存在的代理（已修复）

### 现象

@ 列表里有 `ecc:code-explorer` 等代理，选中后 Claude 说"这个代理在当前环境里不存在"，
只能自己兜底改用 Explore。

### 根因

`installed_plugins.json` 记的是**已下载安装**，`settings.json.enabledPlugins` 记的是**已启用**。
`agentCatalog.ts` 的 `claudePluginAgentRoots` 只读前者，无条件拼 `installPath + "/agents"`，
于是把**已安装但未启用**插件的代理也塞进了 @ 菜单。

ECC 插件（67 个 agents）根本不在 `enabledPlugins` 里 → Claude Code 不加载 →
SDK 的 `supportedAgents()` 不报告 → 但磁盘文件俱全 → 67 个幽灵条目。

### 排查中被推翻的假设（记录以免重走）

1. **扫错目录（marketplaces）** —— 否。`code-explorer.md` 确实在已安装目录
   `cache/everything-claude-code/ecc/2.0.0/agents/` 下，扫描路径没错。
2. **plugin.json 未声明 `agents` 字段所以不加载** —— 否。对照组 `hookify` /
   `code-simplifier` 同样未声明 `agents`、同样只有 `agents/*.md`，但它们**可用**。
   说明 Claude Code 默认就会扫 `agents/`，声明与否无关。
3. **blocklist.json 屏蔽** —— 否，里面只有两个测试条目。

判别关键：拿"能用的插件代理"当对照组，比只盯着坏样本快得多。

### 修复

`apps/server/src/provider/agentCatalog.ts`：

- 新增 `resolveEnabledClaudePlugins`，合并三层 settings 的 `enabledPlugins`
  （home → 各级 cwd 祖先，同目录内 `.local.json` 覆盖 `settings.json`）。
- `claudePluginAgentRoots` 改为对象参数并接收 cwd，只保留 `=== true` 的插件。
- **未列出即视为未启用**（用户决策）：Claude Code 会记录它加载的每个插件。
- **补充的防御**：若所有层都没有 `enabledPlugins` 这个字段，返回 `null` 表示
  "无人表态"，此时完全不过滤 —— 否则从没配过插件的用户会一次性丢光所有插件代理。

### 验证

- 单测 23 passed（新增 5 条：未列出/显式 false/无声明不过滤/local 覆盖/项目层覆盖）
- 真实配置：插件代理 74 → 5，滤掉 69 个（ecc 67、codex 1、grok-build 1），
  `hookify:conversation-analyzer` 等已启用的完整保留
- `bun run typecheck` 7/7 通过；`bun run lint` 0 errors
- **格式化只跑改动文件**（`bunx oxfmt <file>`），避免全仓库行尾污染

### 生效条件

修复在源码里。当前运行的是 13:08 构建的 app.asar，**需要重新构建安装版才会生效**。

---

## 2026-08-07 第二次复发：拿到了完整时间线（根因仍未定，但边界大幅收窄）

### 用户报告

「我发长句子它就没反应，甚至 @ 了子代理；发个你好就有反应。」

### 完整时间线（thread `355a714a`，事件 18348–18403）

| 时刻 (UTC)       | 事件                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| 03:05:56.425     | 用户发长消息（177 字，含 `@codebase-search`），`turn-start-requested`                  |
| 03:05:56.564     | `context-window.configured` + `runtime.warning`（6 条 `session-set` 夹杂其中）         |
| 03:06:14.776     | `task.progress`（后端开始产出）                                                        |
| **03:06:15.034** | **助手首字 `我先用 cod` 已落库**                                                       |
| 03:06:16.471     | 完整回复落库：`我先用 codebase-search 摸清仓库里载具数据的存储/持久化现状，再谈取舍。` |
| **03:06:31.061** | **`window-close shutdown start`（用户关窗）**                                          |
| 03:06:31–37      | in-flight runtime 事件被拒（`admission is stopped`），单个 eventId 重试 30 次后丢弃    |
| 03:06:37.801     | 关停完成                                                                               |
| 03:06:50.110     | 新进程 `orchestration engine started sequence=18374`                                   |
| 03:07:06.058     | 用户发「你好?」→ 03:07:14.884 助手首字，**一切正常**                                   |

### 关键结论：「长句子」是相关性，不是因果

后端对消息长短**没有任何分支差异**——两次的事件结构完全同构
（同样的 `context-window.configured` / `runtime.warning` / 多条 `session-set` / 同样的流式分片）。
真正的差别是**首字延迟**：长消息 19 秒，「你好」8.8 秒。
故障发生在这段等待里，长消息只是把窗口拉长到用户会察觉的程度。

**故障窗口 = 03:06:15（后端已有内容）→ 03:06:31（用户关窗）之间的 16 秒。**
后端产出了完整回复，UI 一个字都没显示。

### 本次被证伪 / 被证实的判断

- ❌ **`large-prompt` 警告** —— 阈值是 200k tokens，长句子够不着，与本故障无关。
- ❌ **server 崩溃/自动重启** —— 是 `window-close`，用户主动关的窗；重启是用户的**应对**，不是原因。
- ✅ **`Orchestration command admission is stopped` 是关停噪音** —— 上一轮的判断正确。
  它只在 `shutdown: stop signal received` 之后出现，是"关停时后端仍有事件在流入"的证据。
- ✅ **后端全程健康** —— 投影零积压（18602/18603），故障窗口内**无任何** `Rejected streaming RPC admission`。

### 根因（已证实并修复）：`startStream` 的 TDZ 引用错误

`apps/web/src/wsTransport.ts` 原代码：

```ts
const cancel = this.getClientRuntime(client).runCallback(stream, {
  onExit: (exit) => {
    const wasReplacedOrStopped = this.streamCleanups.get(key) !== cancel;  // ← 读 cancel
    ...
  },
});
this.streamCleanups.set(key, cancel);   // ← 在 runCallback 之后才登记
```

`ManagedRuntime.runCallback` 在流**未经挂起就失败或完成**时**同步**调用 `onExit`
（服务端直接拒绝订阅就是这种情况）。此时 `const cancel` 尚未初始化，
`!== cancel` 命中暂时性死区 → **`ReferenceError: Cannot access 'cancel' before initialization`**。

后果链：`onExit` 抛错 → 清理与重启调度全部没跑 → 随后 `streamCleanups.set(key, cancel)`
把一个**已死的 cancel** 写进表 → `startThreadStream` 的 early-return
（`streamCleanups.has(key) && activeThreadStreamInputs.get(key) === input`）**永久命中**
→ 该 thread 再也不会重新订阅。界面看着正常、实际收不到任何推送，只有重启应用能恢复。

**为什么之前查不出来**：`makeBareTransport` 测试替身把 `onExit` 包进
`Promise.resolve().then(...)` 强制异步化，整条同步路径在测试里根本不存在
（36 个既有用例全绿）。**替身的时序偏离真实实现时，不会让测试变红，只会让测试变瞎。**

### 修复

先注册身份、再启动流，让同步/异步两条路径走同一套逻辑：

```ts
const handle: { cancel?: () => void } = {};
const cleanup = () => handle.cancel?.();
this.streamCleanups.set(key, cleanup);      // 启动前就登记
this.streamSettled.set(key, settled);
handle.cancel = this.getClientRuntime(client).runCallback(stream, {
  onExit: (exit) => {
    const wasReplacedOrStopped = this.streamCleanups.get(key) !== cleanup;  // 不再读 cancel
    ...
  },
});
```

`cleanup` 是稳定的身份标识，`onExit` 无论同步还是异步触发都能认出自己是当前 owner，
正确释放条目并调度重启；死 cancel 也不会再被写回它刚清掉的条目上。

### 验证

- 新增 2 条红灯测试（`wsTransport.test.ts`），用真实的同步 `runCallback`：
  修复前双双抛 `ReferenceError`，修复后通过。
- `apps/web` 全量：**3844 passed**；`ChatMarkdown` / `Sidebar.import` 两条 15s 超时
  单独重跑均通过（全量并发下的资源竞争，非回归）。
- `bun run lint` 0 errors / 381 warnings（回到基线）；`bun run typecheck` 7/7。

**生效条件**：需重新构建安装版。

### 下次复发时的最快诊断路径

1. **先别关窗**（关窗会销毁唯一的现场）。
2. 开 DevTools Console，看有没有 `WebSocket RPC stream failed` /
   `WebSocket RPC thread stream failed to restart` / `stream reconnect failed`。
3. 查 `orchestration_events` 确认后端是否仍在写（见上文查询）。
4. 查 server 日志有没有 `Rejected streaming RPC admission`。
5. 确认日志里**没有** `window-close shutdown start` —— 有的话说明是关窗，不是故障。
