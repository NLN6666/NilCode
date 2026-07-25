# Plan 010 — 集中列出并启停 Codex / Claude 的 MCP 服务器

Status: TODO
Priority: P2
Effort: M
Depends on: —
Executor: 服务端两个纯文本编辑器（TOML 行编辑、JSON 最小编辑）规格完整且陷阱已穷举，适合 gpt-5.6-sol；Web 面板是用户可见界面，需 taste ≥ 7 的模型或人工过目。动手前请完整阅读本计划，尤其是"已实测的事实"与"TOML 行编辑器的六个陷阱"两节。

## 目标

在设置里新增 **MCP Servers** 页，集中列出本机 Codex 与 Claude 各自配置的 MCP 服务器，并就地启用 / 禁用，无需手工编辑 `~/.codex/config.toml` 或 `~/.claude.json`。

与已有的 **External MCP**（`docs/external-mcp.md`）方向相反，二者互补：

| 设置页 | 方向 |
| --- | --- |
| External MCP（已有） | 外部 coding agent 把 Synara **当作** MCP 服务器接入 |
| MCP Servers（本计划） | Synara 管理这些 agent **各自使用**的 MCP 服务器 |

## 已锁定的决策

1. **只做全局开关**，单层。Claude 的项目级 `disabledMcpServers` 不参与，既不读也不写。
2. **外科式最小编辑**：只改目标那一个字段，其余字节原样保留。注释、引号风格、键序全部不动。
3. **按 provider 分组**：Codex 一组、Claude 一组，同名各占一行，与底层文件 1:1 对应。
4. **服务端脱敏**：env 值、header 值、URL 的 query 与 userinfo 在服务端就替换掉，明文凭据永不进 WebSocket 帧。这是硬约束——Synara 支持远程访问（`REMOTE.md`）。
5. **新建独立 section**，id `mcpServers`，标题 "MCP Servers"，与 "External MCP" 平级。
6. **引入 `jsonc-parser`** 做 JSON 侧的字节级保真编辑。
7. **写后回读校验 + 重试**，抵御与 Claude Code / Codex CLI 进程的并发写。

## 已实测的事实（2026-07-25，勿凭记忆改写）

### Codex：`enabled` 是原生字段

用临时 `CODEX_HOME` 实测：

```toml
[mcp_servers.alpha]
command = "echo"
enabled = false
```

`codex mcp list` 的 Status 列显示 `disabled`；`codex mcp list --json` 返回 `{"name":"alpha","enabled":false,"disabled_reason":null,"transport":{...},"auth_status":"unsupported"}`。

`codex mcp` 只有 `list` / `get` / `add` / `remove` / `login` / `logout`，**没有 enable / disable 子命令** —— 切换只能由我们改写 `config.toml`。

### Claude：`disabled` 是原生字段

`~/.claude.json` 顶层 `mcpServers` 中，已被 Claude Code 自己写入过 `"disabled": true` 的条目真实存在（如 `x64dbg`、`CAD`、`blockbench`）。`claude mcp` 子命令同样没有 enable / disable。

同文件另有两套项目级机制，**本计划完全不涉及**（既不读也不写，见"明确不做"）：

- `projects["<路径>"].disabledMcpServers: string[]` —— 按项目禁用全局 server
- `projects["<路径>"].disabledMcpjsonServers` / `enabledMcpjsonServers` —— 项目 `.mcp.json` 的批准状态

代价要说清楚：某个 server 在全局启用、却被当前项目的 `disabledMcpServers` 屏蔽时，面板会显示"已启用"而它在该项目里其实不生效。这是决策 1 换来单层 UI 的已知代价，不是缺陷。

### 两个文件的真实形态

| | 路径 | 规模 | 特征 |
| --- | --- | --- | --- |
| Codex | `resolveCodexHome()` + `config.toml` | 248+ 行 | 混用 `'` 与 `"` 字符串；内嵌明文 API key；有嵌套子表 `[mcp_servers.x.env]`、`[mcp_servers.x.http_headers]` |
| Claude | `~/.claude.json` | 214 KB / 6039 行 | 2 空格缩进标准 JSON，无注释；被 Claude Code 高频写入 `numStartups` / `toolUsage` / `tipsHistory` |

Codex home 路径必须走既有的 `resolveCodexHome()`（`packages/shared/src/codexConfig.ts`），它认 `CODEX_HOME` 环境变量，不能写死 `~/.codex`。

## 架构

两个 provider 的差异只有三件事：读哪个文件、怎么解析、怎么改那一个字段。其余（脱敏、聚合、并发重试、RPC、UI、错误处理）完全共享。收敛为一个端口 + 两个适配器：

```
AgentMcpSettingsPanel.tsx                       UI，按 provider 两组
      │ WS RPC
AgentMcpService                                 聚合 / 回读重试 / 原子落盘
      ├── codexSource.ts  ──▶ codexTomlDocument.ts    纯字符串函数
      └── claudeSource.ts ──▶ claudeJsonDocument.ts   纯字符串函数
contracts/agentMcp.ts · shared/mcp/redact.ts    Schema 与脱敏
```

两个 `*Document.ts` 不碰文件系统，输入文本输出文本 —— 整个功能最易出错的部分因此可被穷举测试。

### 新增文件

| 文件 | 职责 |
| --- | --- |
| `packages/contracts/src/agentMcp.ts` | Schema：descriptor / source / catalog / setEnabled 输入 |
| `packages/shared/src/mcp/redact.ts` | URL 脱敏、env 与 header 只留键名 |
| `apps/server/src/agentMcp/codexTomlDocument.ts` | `[mcp_servers.<name>]` 段内 upsert / 删除 `enabled` 行 |
| `apps/server/src/agentMcp/claudeJsonDocument.ts` | 设置 / 删除 `mcpServers.<name>.disabled` |
| `apps/server/src/agentMcp/codexSource.ts` | 解析 TOML → descriptor[]，就地脱敏 |
| `apps/server/src/agentMcp/claudeSource.ts` | 解析 JSON → descriptor[]，就地脱敏 |
| `apps/server/src/agentMcp/Services/AgentMcpService.ts` | Service tag 与接口 |
| `apps/server/src/agentMcp/Layers/AgentMcpService.ts` | 实现：聚合、回读重试、原子写 |
| `apps/web/src/components/settings/AgentMcpSettingsPanel.tsx` | 面板 |

对应 `.test.ts` 与仓库既有布局一致（同目录同名）。

## 契约

`packages/contracts/src/agentMcp.ts`，effect Schema，无运行时逻辑：

```ts
// provider 复用既有 ProviderKind 的子集：仅 "codex" | "claudeAgent"
AgentMcpProvider = Schema.Literal("codex", "claudeAgent")

AgentMcpTransport =
  | { _tag: "stdio"; command: string; args: ReadonlyArray<string>; envKeys: ReadonlyArray<string> }
  | { _tag: "http";  url: string /* 已脱敏 */; headerKeys: ReadonlyArray<string> }

AgentMcpServerDescriptor = {
  provider: AgentMcpProvider
  name: string
  enabled: boolean            // 两边统一为正向语义
  transport: AgentMcpTransport
}

AgentMcpSourceView = {
  provider: AgentMcpProvider
  configPath: string          // 展示用，绝对路径
  available: boolean          // 配置文件是否存在
  parseError: Schema.optional(string)
  servers: ReadonlyArray<AgentMcpServerDescriptor>
}

AgentMcpCatalog = { sources: ReadonlyArray<AgentMcpSourceView> }

AgentMcpSetEnabledInput = { provider: AgentMcpProvider; name: string; enabled: boolean }
```

`setEnabled` 的 success 返回**该 provider 的最新 `AgentMcpSourceView`**（不是整个 catalog），让 UI 只替换受影响的一组。

### RPC 注册

沿用 External MCP 的既有模式，四处都要加：

1. `packages/contracts/src/ws.ts` — `WS_METHODS.serverListAgentMcpServers: "server.listAgentMcpServers"`、`serverSetAgentMcpServerEnabled: "server.setAgentMcpServerEnabled"`，并在 `tagRequestBody` 表登记
2. `packages/contracts/src/rpc.ts` — 两个 `Rpc.make`，加进导出的 RPC 组
3. `apps/server/src/wsRpc.ts` — 路由到 `AgentMcpService`，两个方法**都要 `requireOwner`**（读会暴露本机配置结构，写会改用户主目录文件）
4. `apps/server/src/serverLayers.ts` — 挂 Layer

## 开关语义：一个必须显式处理的反转

| | 字段 | 方向 | 字段缺失时 |
| --- | --- | --- | --- |
| Codex | `enabled` | 正向，`false` = 禁用 | 启用 |
| Claude | `disabled` | 反向，`true` = 禁用 | 启用 |

descriptor 对外统一暴露正向的 `enabled`。

**启用时删除该字段，而不是写 `enabled = true` / `disabled = false`。** 让文件回到用户原本的样子，而不是留下一堆我们写的噪声。这条对两个 provider 都适用。

## TOML 行编辑器的六个陷阱

`codexTomlDocument.ts` 是本计划风险最集中的地方。签名：

```ts
export function applyCodexMcpEnabled(text: string, name: string, enabled: boolean): string
```

逐字节保留除目标行外的一切。必须处理：

1. **同名前缀**：定位 `[mcp_servers.foo]` 时不能命中 `[mcp_servers.foobar]`，也不能命中子表 `[mcp_servers.foo.env]`。段头需精确匹配到闭合 `]`。
2. **带引号的段名**：`[mcp_servers."ida-pro-mcp"]` 与 `[mcp_servers.ida-pro-mcp]` 指向同一个 server，两种写法都要能定位。
3. **段边界**：一个段止于下一个 `[` 开头的行（含它自己的子表 `[mcp_servers.foo.env]`）。`enabled` 行必须插在**子表之前**，否则会落进子表变成 `env.enabled`，静默失效。
4. **已存在 `enabled`**：替换那一行，而非追加第二行。
5. **注释与空行**：段内注释、行尾注释、空行原样保留。删除 `enabled` 行时不留空行残骸。
6. **换行风格**：文件用 CRLF 时保持 CRLF（本项目主要在 Windows 上运行）。

用 `smol-toml`（已是依赖）**只做校验**：编辑后 parse 一次新文本，确认仍是合法 TOML 且目标值符合预期，parse 失败就放弃写入并报错。不要用它序列化 —— 它会丢注释、重排键序、统一引号。

`name` 在 config 中不存在时抛明确错误，不要静默创建新段。

## JSON 最小编辑

`claudeJsonDocument.ts`：

```ts
export function applyClaudeMcpDisabled(text: string, name: string, enabled: boolean): string
```

用 `jsonc-parser` 的 `modify(text, ["mcpServers", name, "disabled"], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })` + `applyEdits`。`enabled === true` 时传 `undefined` 作为 value 以删除该键。

`mcpServers[name]` 不存在时抛错，不创建。

依赖：`jsonc-parser@^3.3.1`（VS Code 官方，零传递依赖），加到根 `package.json`。

## 脱敏规则

`packages/shared/src/mcp/redact.ts`，纯函数：

- **URL**：保留 scheme、host、port、path；**丢弃** query 与 fragment 全部内容；丢弃 userinfo（`user:pass@`）。解析失败时返回 `"<invalid url>"` 而不是原串。
- **env**：只返回排序后的键名数组，值一律不出服务端。
- **http_headers**：同上，只返回键名。
- **command / args**：原样保留（诊断价值高，且本身不是凭据）。

对照：`codex mcp list` 自己就把 env 渲染成 `KEY=*****`，只露键名。同样的取舍在 Web UI 里权重更高，因为终端输出停在本机，WebSocket 帧会跨网络。

## 并发写与回读重试

Claude Code 与 Codex CLI 都不使用文件锁，**无法彻底消除**竞态。缓解策略在 Service 层共享，两个 provider 共用同一段逻辑：

```
for attempt in 1..3:
    text = readText()                       // 不存在 → NotAvailable，不重试
    descriptors = parse(text)
    if name not in descriptors → NotFound，不重试
    next = applyEnabled(text, name, enabled)
    writeFileStringAtomically(next)         // 复用 apps/server/src/atomicWrite.ts
    verified = parse(readText())            // 回读
    if verified[name].enabled === enabled → 返回 verified 构成的 SourceView
    backoff(25ms · attempt)
throw ConcurrentModification
```

原子替换保证文件永不半写；回读把"被对方进程覆盖"从静默失败变成可重试的显式失败。窗口压到 1ms 量级但不为零 —— 这是不加锁能做到的上限，实现时不要声称更强的保证。

## 数据流

**读**：面板挂载 → `serverListAgentMcpServers` → 并发读两个文件 → 各自解析 + 脱敏 → 返回 catalog。任一 source 失败不影响另一个。

**写**：点开关 → 乐观更新 → `serverSetAgentMcpServerEnabled` → 上述重试循环 → 返回值替换该组；失败回滚 + toast。

**不做文件 watch**：`.claude.json` 被 Claude Code 高频写入无关字段，watch 会被噪声淹没。改为面板可见时 react-query 重取，外加一个手动刷新按钮。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 配置文件不存在 | `available: false`，UI 显示"未检测到 Codex 配置" —— 这不是错误 |
| 解析失败 | `parseError` 带原因，该组只读，**拒绝任何写入** |
| 目标名已被外部删除 | 明确错误 + 自动刷新列表 |
| 三次重试后仍被覆盖 | 报"配置文件正被其他程序修改，请重试" |
| 写入失败 | 原子替换保证原文件完好，UI 回滚开关 |

## UI 接入清单

1. `apps/web/src/settingsNavigation.ts` — `SETTINGS_SECTION_IDS` 加 `"mcpServers"`；`SETTINGS_NAV_ITEMS` 中新条目排在 `integrations` **之前**（决定侧边栏渲染顺序，让两个 MCP 页相邻）：

   ```ts
   {
     id: "mcpServers",
     group: "synara",
     label: "MCP Servers",
     description: "Enable or disable the MCP servers your Codex and Claude agents use.",
     icon: "api-connection",
     eyebrow: "Agent tooling",
   }
   ```

   图标刻意不用 `plugin-1` —— 那是 Integrations（External MCP）在用的，两个 MCP 页必须一眼可分。
2. `apps/web/src/settingsSearchIndex.ts` — 加 `mcpServers:*` 条目，keywords 覆盖 "MCP server enable disable codex claude config.toml claude.json"
3. `apps/web/src/routes/_chat.settings.tsx` — 渲染 `<AgentMcpSettingsPanel active={activeSection === "mcpServers"} />`
4. 面板本体复用 `SettingsPanelPrimitives`（`SettingsSection` / `SettingsListRow`）与 `ui/switch`，与 `ExternalMcpSettingsPanel` 视觉一致
5. 任何展开/折叠交互**必须**走 `apps/web/src/lib/disclosureMotion.ts`（见 `CLAUDE.md` 的 UI Conventions），不得自写高度动画

每组标题下以小字展示该 source 的 `configPath`，让用户清楚开关改的是哪个文件。

## 测试

**`codexTomlDocument`（重点）**：上述六个陷阱各一例；另加 —— 段内有 `[mcp_servers.x.env]` 子表时 `enabled` 插入位置正确、`enabled` 已存在时替换不重复、启用时整行删除且不留空行、编辑后文本仍能被 `smol-toml` parse、非目标段字节完全不变。

**`claudeJsonDocument`**：2 空格缩进保持、除目标字节外其余行完全不变、`disabled` 已存在 / 不存在两条路径、删除键后 JSON 仍合法。

**`redact`**：query token、fragment、userinfo、header 值、env 值、非法 URL。

**两个 source 解析**：以本文"已实测的事实"中的真实结构为样本，含 http / stdio 两种 transport 与嵌套子表。

**Service**：回读重试（用可控 stub 模拟第一次被覆盖）、名字不存在、文件不存在、解析失败时拒绝写入。

## 明确不做

- 不启动 MCP 进程做健康检查或列工具（用户只要"列出并启停"）
- 不做 MCP 的增 / 删 / 改配置
- 不做 Claude 的项目级 `disabledMcpServers` 写入（只读展示都不做，见决策 1）
- 不做文件 watch
- 不覆盖 Cursor / Droid / OpenCode 等其余 provider 的 MCP 配置 —— 架构上留了扩展位（再加一个 source 即可），但本计划不实现

## 验收

- `bun fmt`、`bun lint`、`bun typecheck` 全绿
- `bun run test` 新增测试全通过
- 手工验证：在面板中禁用某个 Codex MCP 后，`codex mcp list` 的 Status 列变为 `disabled`，且 `config.toml` 的 diff **只有新增的那一行**
- 手工验证：禁用某个 Claude MCP 后，`.claude.json` 的 diff 只有目标 server 内新增的 `"disabled": true`
- 手工验证：面板任何位置都不出现 `ctx7sk-` 前缀的 key 或其他明文凭据
