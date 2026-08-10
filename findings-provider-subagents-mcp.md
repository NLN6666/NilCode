# Findings —— 子代理与 MCP 的 Provider 覆盖面扩展（子项目 B / C）

调研结论与实施过程中踩到的坑。最后更新：2026-08-10T09:00:58Z

---

## 0. 调研结论：九家 Provider 的真实磁盘格式

全部结论都经过**本机文件系统实测 + 官方文档双重确认**，不是靠记忆推断。

### 子代理（B）

| Provider | 磁盘格式 | 结论 |
|---|---|---|
| codex | `~/.codex/agents/*.toml` | 已有 |
| claudeAgent | `~/.claude/agents/**/*.md` + 插件目录 | 已有 |
| **cursor** | `~/.cursor/agents/*.md` + `.cursor/agents/*.md`，frontmatter `name`/`description`/`model` | **新增** |
| **droid** | `~/.factory/droids/*.md` + `.factory/droids/*.md`，官方明说"只扫顶层" | **新增** |
| **grok** | `~/.grok/agents/*.md` + `.grok/agents/*.md`，另有 `~/.grok/bundled/agents/*.md` 内置三个 | **新增** |
| opencode | 配置里的 `agent` 段 + `agents/*.md` | 跳过：`OpenCodeAdapter.listAgents` 已经从运行时 inventory 拿，比扫盘权威 |
| kilo | 同 opencode（同一个 adapter，`OpenCodeCompatibleProvider`） | 跳过：同上 |
| antigravity | 无 | 跳过：本机 `~/.antigravity` 只有 `extensions` |
| pi | npm 扩展包 `pi-subagents` | 跳过：无稳定磁盘格式 |

**踩坑：`~/.pi/agent` 不是 agents 目录。** 它是 Pi 的安装根目录（内含 `bin`/`extensions`/`npm`/`sessions`/`skills`）。仅凭目录名会误判成子代理目录。

### MCP（C）

| Provider | 配置文件 | 开关字段 | 结论 |
|---|---|---|---|
| codex | `CODEX_HOME/config.toml` | `[mcp_servers.x] enabled` | 已有 |
| claudeAgent | `~/.claude.json` | `mcpServers.x.disabled` | 已有 |
| **droid** | `~/.factory/mcp.json` | `mcpServers.x.disabled` | **新增**，与 Claude 完全同构 |
| **antigravity** | `~/.gemini/antigravity/mcp_config.json` | `mcpServers.x.disabled` | **新增**，带 BOM，且 `serverUrl` 与 `url` 混用 |
| **grok** | `~/.grok/config.toml` | `enabled` **且** 顶层 `disabled_mcp_servers[]` | **新增**，双开关 |
| **opencode** | `~/.config/opencode/opencode.json` | `mcp.x.enabled`（正极性） | **新增** |
| **kilo** | `~/.config/kilo/kilo.jsonc` | 同 opencode | **新增**，Kilo 是 OpenCode 的 fork，schema 一致 |
| cursor | `~/.cursor/mcp.json` | **没有** | 排除：开关只存在于编辑器 UI 状态，写文件不会生效 |
| pi | 经 `pi-mcp-adapter` npm 扩展 | — | 排除：没有可读写的配置文件 |

**Cursor 是唯一"看起来能做但实际不能"的一家**：文件格式和 Claude 一模一样，很容易照抄一份然后交付一个点了没反应的开关。官方文档明确说开关在 Customize 侧栏。

---

## 1. `jsonc-parser` 传了 `formattingOptions` 就会重排整个父对象

**现象：** 给 `mcp.<name>` 插入 `enabled` 键后，同级的 `"command": ["npx", "-y", "pkg"]` 从单行被炸成四行。

**为什么这次才暴露：** Claude 的 `~/.claude.json` 条目里 `args` 也是行内数组，但既有测试只覆盖了「替换已存在的 `disabled`」和「往没有数组的条目里插入」，从没测过「往含行内数组的条目里插入」。OpenCode/Kilo 的 `command` **永远**是数组，所以一改就必现。

**排查：** `keepLines: true` 没用（实测同样重排）。真正有效的是**完全不传 `formattingOptions`** —— 此时 `modify` 只产生最小编辑，往返逐字节一致，但插入的键会被挤成 `…],"enabled": false`。

**修法：** 不传 `formattingOptions`，然后只对「插入」这一种编辑（`length === 0 && content` 非空）自己补换行和缩进（`indentInsertedProperty`）。删除路径不用管，`modify` 会连分隔符一起删干净。既有的 Claude 逐字节往返测试全部仍然通过。

**教训：** 这个模块的头注释写着"leaving every other byte untouched"，而默认的 `formattingOptions` 正好破坏这个契约。改用户配置文件的代码，格式化选项要按"最小编辑"而非"输出好看"来选。

---

## 2. Antigravity 的配置带 UTF-8 BOM，`JSON.parse` 直接拒绝

本机 `~/.gemini/antigravity/mcp_config.json` 首字节是 `﻿`。不剥 BOM 的话，一个在 IDE 里工作正常的配置会被报成"无法解析"，整个 source 降级只读。

读路径（`parseJsonDocument`）和写路径（`splitByteOrderMark`）都要处理，且写完必须把 BOM 原样贴回去，否则 IDE 自己就读不了了。

---

## 3. Grok 的两个开关，数组优先级更高

`~/.grok/config.toml` 同时有 `[mcp_servers.<name>].enabled` 和顶层 `disabled_mcp_servers = [...]`，`grok mcp disable` 两个都写。

- **读**：只看表字段会把用户关掉的服务器显示成开启。
- **写（启用）**：只写 `enabled = true` 不清数组，服务器仍然是关的 —— 而 `setServerEnabled` 会回读校验，于是三次重试全部失败，最后报 `conflict`。**开关表现为"点了报错"而不是"点了没反应"**，这个失败模式反而比静默失效好排查。

数组的重写采用**整体重新序列化**而非逐元素手术：这个数组是 `grok mcp disable` 机器写的，重排格式没有代价；而行内/多行/尾逗号/夹注释的元素级编辑才是损坏的来源。名字超出 Grok 允许的字符集（字母数字连字符下划线）时直接抛错拒绝改写。

**本机现状：** 这台机器的 `disabled_mcp_servers` 里那六个名字（`cheatengine`、`x64dbg` 等）来自插件而非 `[mcp_servers.*]` 表，所以 Grok 面板在这台机器上会显示 0 个服务器。这是正确行为（面板只呈现配置文件里声明的东西），但值得知道。

---

## 4. 测试必须显式隔离**全部** provider 的配置路径

`AgentMcpService` / `AgentMcpToolCatalog` 的测试原来只传 codex 和 claude 两个路径。provider 从 2 家扩到 7 家之后，没传的那 5 家会去解析**开发者本机真实的** `~/.factory/mcp.json`、`~/.grok/config.toml`、`~/.gemini/antigravity/mcp_config.json`。

本机的 antigravity 配置真有 2 个服务器，会直接混进 `listServers()` 的断言。修法是 `beforeEach` 里把 `AGENT_MCP_PROVIDERS` 全部指向临时目录下的不存在路径，再覆盖需要的两个。

这和 `findings-skills-provider-isolation.md` 第 2 条是**同一类问题的不同表现**：扩大 provider 覆盖面时，任何"没配置就回落到真实 home"的默认值都会变成测试污染源。

---

## 5. 全量 server 测试的既有失败基线

`apps/server` 全量跑：**基线（干净 dev）107 个失败 / 32 个文件；本分支 106 个失败 / 32 个文件。**

- 修好 3 个（`ProviderDiscoveryService.test.ts`，子项目 A 带来的）
- 新增 2 个：`CodexTextGeneration.test.ts` 和 `AcpJsonRpcConnection.test.ts` —— 都是环境依赖的抖动，与改动无 import 关系。`generates PR content and trims markdown body` 单独跑同样失败，耗时 28 秒后超时（它会真的拉起 `codex` 进程）。

**判别方法**（比读代码快得多）：两侧都用 `--reporter=json --outputFile` 跑全量，然后按 `fullName` 做集合差。只比总数会漏掉"数量相同但成员不同"的情况。

---

## 6. `git stash` / `git stash pop` 会把工作树整个改成 CRLF

在 Windows 上用 `git stash -u` + `git stash pop` 做基线对比之后，37 个改动文件全部从 LF 变成 CRLF，`oxfmt --check` 报 35 个文件格式错误。

`git diff` 看不出来（git 按 `autocrlf` 归一化），只有读原始字节的工具才会发现。修法：对改动文件跑一次 `oxfmt`（路径限定，不要全仓库）即可归回 LF。

这是 `bun fmt` 那个已知坑的同源变体 —— 凡是让 git 重写工作树的操作（stash/checkout/merge）在这台机器上都会触发。
