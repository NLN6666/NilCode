# 设计 — 用 `&` 引用 MCP 工具

> 类型：**设计规格（design spec）**，非实施计划。实施计划另行产出。
> 创建于：2026-07-25T06:01:07Z

## 1. 目标

在 composer 中输入 `&`，弹出当前 provider **实际可用**的 MCP 工具候选；选中后以 chip 形式呈现，
发送时展开为模型可理解的工具声明，从而"告诉模型使用该工具"。

引用形态三种：

| 形态 | 含义 |
| --- | --- |
| `&context7` | 引用整个 server（等价于 `&context7:*`） |
| `&context7:query-docs` | 引用单个工具 |
| `&context7:*` | 引用该 server 的全部工具 |

## 2. 已有地基（`dev` 分支，commit `347e878c`）

`dev` 上已存在 `agentMcp` 模块（2394 行），本设计**建立在它之上**，不重写：

| 已有件 | 作用 |
| --- | --- |
| `apps/server/src/agentMcp/codexSource.ts` | 解析 Codex `config.toml` 的 `[mcp_servers.*]` |
| `apps/server/src/agentMcp/claudeSource.ts` | 解析 Claude `~/.claude.json` |
| `apps/server/src/agentMcp/codexTomlDocument.ts` | TOML 文档的外科式读写（454 行） |
| `apps/server/src/agentMcp/Services/AgentMcpService.ts` | Effect 服务接口 + `AgentMcpError` 错误码 |
| `packages/contracts/src/agentMcp.ts` | `AgentMcpServerDescriptor` / `AgentMcpCatalog` 等契约 |
| `packages/shared/src/mcp/redact.ts` | 凭据脱敏 |
| `apps/web/src/components/settings/AgentMcpSettingsPanel.tsx` | 设置面板 |
| RPC `serverListAgentMcpServers` / `serverSetAgentMcpServerEnabled` | 已注册 |

**关键约束**：现有契约**故意**只回传 `envKeys` / `headerKeys`（仅键名），并丢弃 URL 的 query 与
userinfo（`redact.ts` 注释："a WebSocket frame can cross a network"）。

**推论**：浏览器端拿到的配置**不足以连接 MCP server**。因此工具探测必须**整个跑在服务端**，
用未脱敏的原始配置连接，只将工具名与描述回传。这不是限制，而是正确的安全边界。

## 3. 已确认的决策

| # | 决策 | 取值 |
| --- | --- | --- |
| D1 | 候选来源 | 实时向 MCP server 发 `tools/list` 拉取 |
| D2 | 配置来源 | 跟随当前线程的 provider（复用 `agentMcp`，即 Codex + Claude） |
| D3 | 发送语义 | 展开成带工具说明的指令（非纯文本、非 provider 原生白名单） |
| D4 | 匹配语义 | 候选搜索对 **server 名与工具名双字段模糊匹配**；支持 `&server:*` 整包引用。不支持用户书写正则 |
| D5 | 拉取策略 | 懒加载（首次输入 `&` 才拉）+ 持久缓存 + 后台刷新 |
| D6 | 探测实现 | 手写最小 MCP client（不引入 `@modelcontextprotocol/sdk`）；**stdio 与 http 两条路径一起做** |
| D7 | 分支同步 | 当前 worktree `rebase` 到 `dev` |

### D6 的实证依据

用户真实的 Codex 配置中：`fastctx`、`node_repl`、`ida-pro-mcp` 为 stdio，`context7` 为 http
（stdio 3 : http 1）。只做 http 将导致首版仅覆盖 1/4 的 server，`&` 菜单近乎空置，故两条同做。

不引入官方 SDK 的理由：仓库已有三处手写 MCP JSON-RPC 先例
（`agentGateway/protocol.ts`、`postAgentGatewayJsonRpc()`、`stdioProxyScript.ts`），
本功能仅需 `initialize` + `tools/list` 两个方法，SDK 的完整性用不上，且会在仓库内并存两套范式。

## 4. 架构与数据流

```
Codex config.toml  ─┐
                    ├─→ mcpConfigParser ─┬─→ redact ──→ AgentMcpServerDescriptor ─→ 设置面板（已有）
Claude .claude.json ─┘   （统一解析）     │
                                         └─→ McpServerConnection（含凭据，永不出服务端）
                                                        │
                                                        ▼
                                            McpProbeClient   initialize → tools/list
                                                        │
                                                        ▼
                                        AgentMcpToolCatalog（落盘缓存 + TTL + 后台刷新）
                                                        │  RPC: serverListAgentMcpTools
                                                        ▼
                              web  &触发 → picker → chip → formatOutgoingComposerPrompt 展开
```

## 5. 服务端设计

新增件全部落在已有的 `apps/server/src/agentMcp/` 下。

### 5.1 `mcpConfigParser.ts` — 解析与脱敏解耦（顺带重构）

当前 `codexSource.ts` 的 `describeTransport()` 将**解析**与**脱敏**耦合在一起。本功能需要同一份
配置的两种投影，故拆分为：

```
parseCodexMcpServers(text)  →  McpServerConnection[]        // 含 env 值、完整 URL、headers
                                      │
                                      └─ redactConnection() → AgentMcpServerDescriptor  // 现有 UI 路径
```

`McpServerConnection` **刻意不进 `packages/contracts`**，仅存在于服务端模块内部——类型系统层面
杜绝凭据被序列化进 WebSocket 帧的可能。`claudeSource.ts` 同样处理。

**行为不变性要求**：重构后脱敏路径的产出必须与 `dev` 上现有测试逐字节一致。

### 5.2 `probe/McpProbeClient.ts` — 最小 MCP 客户端

两条 transport 共用一套握手序列，仅在字节收发处分叉：

```
runProbeSession(transport):
  → initialize                  （protocolVersion + clientInfo）
  → notifications/initialized
  → tools/list
  ← ToolDescriptor[]            （name / description）
```

- **stdio**：`spawn` 子进程；newline-delimited JSON 分帧逻辑照搬
  `agentGateway/stdioProxyScript.ts:75-92`（buffer + `indexOf("\n")` + 串行队列保序）；
  `finally` 中必杀进程并 `unref`。
- **http**：照 `agentGateway/mcpInjection.ts` 中 `postAgentGatewayJsonRpc()` 的形状实现。

单次探测硬超时 **10 秒**。

### 5.3 `Layers/AgentMcpToolCatalog.ts` — Effect Layer

- **缓存键**：`provider + serverName + entryHash`。`entryHash` 为**该 server 单条配置条目**
  （command / args / env / url / headers）序列化后的 hash，**非整个配置文件的 hash**——否则改动
  任一 server 会连带作废全部缓存。
- **TTL**：**24 小时**。工具清单变动极少，且 `entryHash` 已覆盖"用户改了配置"这一主要失效场景，
  TTL 仅用于兜底捕获 server 自身升级导致的工具增减。
- **落盘**：server state dir。
- **stale-while-revalidate**：先返回旧数据，后台刷新完成后静默更新。
- **单飞**：同 key 的并发请求合并为一次探测。
- **并发闸门**：同时进行的探测上限 **4 个**，避免进程风暴。

### 5.4 契约与 RPC

- `packages/contracts/src/agentMcp.ts` 扩展：`AgentMcpToolDescriptor`（`provider` / `serverName` /
  `toolName` / `description`）、`AgentMcpToolCatalog`（`tools` / `errors` / `staleAt`）。
- 新增 RPC `serverListAgentMcpTools`，与已有 `serverListAgentMcpServers` 并列。

## 6. Web 端设计

### 6.1 触发检测 — `apps/web/src/composer-logic.ts`

`ComposerTriggerKind` 新增 `"mcp-tool"`；`detectComposerTrigger()` 中于 `$skill` 分支旁并列：

```
if (token.startsWith("&")) → { kind: "mcp-tool", query: token.slice(1), rangeStart: tokenStart, rangeEnd: cursor }
```

`&context7:query-docs` 本身不含空格，现有的 whitespace-bounded `tokenStartForCursor()`
天然圈对范围，无需改动边界逻辑。

### 6.2 Token 正则与仲裁 — `apps/web/src/composer-editor-mentions.ts`

```
/(^|\s)&([a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.*-]+))?(?=\s)/g
```

**与 URL 的冲突**：`&` 是 URL query 的分隔符，`https://x.com/a?b=1&c=2` 中的 `&c=2` 形似 MCP 引用。
现有机制已双重防护：

1. `collectInlineTokenMatches()` 中 link **最先**匹配并占据 `reservedRanges`，后续 token 命中
   `isReserved()` 即跳过；
2. 上述正则要求 `&` 前为行首或空白，而 URL 内部的 `&` 前恒为字符。

新增 `ComposerPromptSegment` 类型 `mcp-tool`，chip 复用 `InlineChip`。

### 6.3 候选菜单

复用 `ComposerPickerMenuPopup`；数据源为新增的 `useAgentMcpTools()` React Query hook。

- 双字段模糊：输入 `&doc` 时，工具名含 `doc` 的（如 `context7:query-docs`）与 server 名含 `doc` 的
  一并出现。
- 首次打开显示骨架态（探测进行中）。
- 探测失败的 server 单独一行灰显，不阻断其余候选。

### 6.4 发送展开 — `apps/web/src/lib/composerSend.ts:178`

在 `formatOutgoingComposerPrompt()` 内新增一步变换。该函数是发送前 prompt 变换的**唯一入口**
（注释："Provider-specific prompt massaging"）。

## 7. 展开格式规范

**正文保留原 token，消息末尾追加统一工具块。**

输入：

```
帮我查一下 React 19 的用法 &context7:query-docs
```

发送给模型：

```
帮我查一下 React 19 的用法 &context7:query-docs

<available-mcp-tools>
context7:query-docs — Fetch up-to-date documentation for a library by ID.
</available-mcp-tools>
Please use the MCP tools listed above.
```

规则：

1. 正文中的 `&server:tool` **原样保留**，不做就地替换——多个引用不会把正文冲散。
2. 末尾块**合并**本条消息的全部引用，只出现一次。
3. **单个工具引用**带 `— description`。
4. **整包引用（`&server` / `&server:*`）恒只列工具名，不列描述**，无论工具多少。
   （`ida-pro-mcp` 一个 server 即有 40+ 工具，带描述会瞬间吃掉数千 token。）
5. 无有效引用时不追加任何内容。

## 8. 错误处理与降级

| 失败 | 处理 |
| --- | --- |
| 配置文件不存在 | 复用 `AgentMcpError` 的 `unavailable`；picker 显示"未配置 MCP" |
| 配置解析失败 | 复用 `parse-failed`；该 provider 的候选整体不可用 |
| 单个 server 探测超时（10s） | **该 server 单独标记失败，其余照常返回**——一个坏 server 不得拖垮整个菜单 |
| stdio 进程起不来或崩溃 | 同上；`finally` 中必杀进程 + `unref`，绝不泄漏 |
| 缓存陈旧 | stale-while-revalidate：先渲染旧数据，后台刷新后静默更新 |
| 发送时引用的工具已消失 | **照常发送**：末尾块只含仍存在的工具，失效引用以纯文本留在正文（模型仍可见用户意图）；编辑器内该 chip 标灰提示。不阻断发送，不静默删除 |

## 9. 安全约束

探测会 `spawn` 用户 `config.toml` 中配置的任意命令。这**不是新增攻击面**——Codex 本就在运行这些
进程，配置亦由用户自行书写；但它是**新的触发时机**：此前需用户主动开启 Codex 会话才启动，此后在
composer 中输入 `&` 亦会触发。因此以下两条为硬性约束：

1. 探测**只**发送 `initialize`、`notifications/initialized`、`tools/list`，**永不**发送 `tools/call`。
2. **只探测 `enabled !== false` 的 server**——用户在设置面板中关闭的，探测必须跳过。

此外，`McpServerConnection` 不得进入 `packages/contracts`（见 5.1）。

## 10. 测试策略

使用 Vitest。**注意：`bun run test`，绝不使用 `bun test`**（见 CLAUDE.md）。

- `&` 正则的三种形态解析；**URL 中的 `&` 不被误判**（最易回归处，必测）。
- 双字段模糊匹配的命中与排序。
- 展开格式化：单引用带描述、整包只列名字、多引用合并为单一末尾块、无引用时不追加、失效引用的处理。
- `mcpConfigParser` 拆分后，脱敏路径产出与 `dev` 上现有测试逐字节一致。
- `McpProbeClient`：以假 transport 驱动握手序列；stdio 以假子进程验证分帧与必杀。
- 缓存层：TTL、单飞合并、`configHash` 变更即失效。

不做 E2E——真实 MCP 探测依赖用户机器上的具体 server，不适合进 CI。

## 11. 前置动作

当前 worktree（分支 `worktree-MCPs`，HEAD `ea136916`）落后 `dev` **9 个提交**且不含 `agentMcp` 模块。
`git rev-list --left-right --count dev...HEAD` 为 `9  0`，即本分支无独有提交，`rebase` 等同快进，
无冲突风险。

**实施前须先 `git rebase dev`。**

## 12. 非目标（YAGNI）

- 不支持用户书写正则表达式（D4）。
- 不实现 provider 原生工具白名单/强制调用（D3）。
- 不覆盖 Codex 与 Claude 之外的 7 个 provider——受限于 `agentMcp` 现有覆盖面。
- 不实现 `tools/call`（安全约束 9.1）。
- 不做 E2E 测试。
