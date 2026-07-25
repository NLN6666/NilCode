# Plan 008 — 在 Composer 中 @ 提及真实的 Claude / Codex 子代理

Status: IN PROGRESS — 六条验收标准均已实现，审查通过（0 CRITICAL / 0 HIGH），审查提出的 M1 已修。剩余：全量 `bun fmt` / `bun lint` / `bun typecheck` 与提交。
Priority: P1
Effort: M
Depends on: —
Executor: 服务端发现、解析与派发（A/B/C 段）交 gpt-5.6-sol via `codex exec`，规格已完整；Web 菜单分组（D 段）属用户可见改动，需 taste ≥ 7 的模型。动手前请完整阅读本计划。

## 目标

让用户能够 `@` 提及**自己实际定义的子代理**，而不是只能用四个硬编码别名。

参考机器上的真实规模：`~/.claude/agents/` 下 42 个条目，`~/.codex/agents/` 下 53 个 `.toml`（其中 51 个有效）。目前这些在 Synara 里一个都提及不到。Codex 侧是首次获得子代理提及能力。

## 现状（已核实）

`@alias(task)` 语法的骨架已经存在并跑通，缺口集中在**发现层**和 **Codex 侧入口**。

| 环节                    | Claude (`claudeAgent`)                                                      | Codex                                                                        |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@` 菜单中的 agent 条目 | 有。`dynamicAgents` 优先，取不到则回落到 4 个硬编码别名                     | 无子代理；菜单里的 `@5.5` / `@spark` 是**模型切换**别名                      |
| 数据来源                | `listAgents` RPC → SDK `supportedAgents()`                                  | 硬编码模型表                                                                 |
| 插入语法                | `@alias()`，光标落在括号内（`apps/web/src/components/ChatView.tsx:9249`）   | 同上                                                                         |
| 发送时改写              | `buildClaudeSubagentPrompt()`（`packages/shared/src/agentMentions.ts:103`） | 无                                                                           |
| chip 渲染               | `ComposerAgentMentionNode`                                                  | 同一组件                                                                     |
| 运行时事件展示          | 已完备（`packages/shared/src/subagents.ts`，13 个导出）                     | 已完备（`apps/server/src/codexAppServerManager.ts:3093` 解码 subagent 线程） |

结论：**运行时展示层两侧都已成熟，本计划不触碰它。** 工作集中在发现、提及解析、派发指令、菜单呈现。

## 探测得到的事实（codex-cli 0.145.0，实测）

通过 `codex exec -s read-only` 直接询问模型自身的工具面，得到：

```
agents.spawn_agent      参数: agent_type, fork_turns, message, model, reasoning_effort, task_name
agents.wait_agent       参数: timeout_ms
agents.list_agents      参数: path_prefix
agents.send_message     参数: message, target
agents.followup_task    参数: message, target
agents.interrupt_agent  参数: target
```

关键结论：

1. **`agent_type` 对模型可见且可指定**，实测枚举出 51 个合法值。参考机器 `config.toml` 中的 `hide_spawn_agent_metadata = true` 并未屏蔽它，但实现仍需对该参数缺失的情况容错。
2. **`agent_type` 取自 TOML 的 `name` 字段，不是文件名。** 缺少非空 `name` 的文件会被 Codex 静默忽略并打印告警：
   ```
   warning: Ignoring malformed agent role definition: agent role file at
   ...\.codex\agents\docs-researcher.toml must define a non-empty `name`
   ```
   53 个文件 − 2 个缺 `name` = 51 个可用。**扫描逻辑必须复刻这条规则**，否则菜单会列出根本 spawn 不了的 agent。
3. **`agents.list_agents` 是面向模型的工具，不是 app-server 的 JSON-RPC 方法。** 服务端无法调用它，因此对 Codex 而言文件系统扫描是唯一可行的服务端发现路径。
4. Codex 与 Claude 的派发语义同构（主代理调工具 + 指定类型 + 传任务），因此 `@alias(task)` 这层抽象可以真正共用，仅在最终生成的指令措辞上分叉。

## 已锁定的决策

与操作者逐项确认，实现时不要擅自更改：

1. **范围**：Claude 与 Codex 两侧都做。
2. **发现来源**：文件系统扫描（保证立即可用）+ SDK `supportedAgents()` 结果合并（补齐 plugin 提供的 agent）。
3. **菜单形态**：保持单一 `@` 触发符，增加分组标题，并把 agent 从末位提前。不引入新触发符。
4. **内置项**：保留 Claude 四个内置（explore/review/build/plan）与 Codex 模型别名，用分组区分三种语义。
5. **同名优先级**：项目 > 用户 > SDK/plugin > 内置。与 Claude Code / Codex 自身的覆盖语义一致，越局部越优先。

## 架构

### A. 新增服务端模块 `agentCatalog`

新建 `apps/server/src/provider/agentCatalog.ts`，对标已有的 `apps/server/src/provider/skillsCatalog.ts`。

| Provider | 扫描路径                                                                 | 解析                                                                                                              | 有效性规则            |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| Claude   | `~/.claude/agents/**/*.md`、`<cwd>/.claude/agents/**/*.md`               | YAML frontmatter → `name` / `description` / `model` / `tools`                                                     | 需有 `name`           |
| Codex    | `~/.codex/agents/*.toml`（实测 Codex 不支持项目级目录，见开放项 1 结论） | TOML → `name` / `description` / `model`；`model_reasoning_effort` 已解析但暂不下发到 descriptor（无验收标准依赖） | `name` 非空，否则跳过 |

要求：

- 带 mtime 失效的缓存，避免每次打开菜单都遍历磁盘。
- 目录遍历与 frontmatter 解析逻辑从 `skillsCatalog.ts` **抽取为共享工具**，不要复制粘贴。若 `skillsCatalog.ts` 的对应逻辑不便直接复用，先做小幅提取再接入。
- 解析失败的单个文件不得让整次发现失败，跳过并记录即可。

### B. 打通 `listAgents`

- **ClaudeAdapter**：文件扫描结果**立即返回**；SDK `supportedAgents()` 异步返回后合并。合并方向严格遵循决策 5——**SDK 只补充扫描未覆盖的条目（典型即 plugin agent），同名时不得覆盖项目级或用户级的磁盘定义**。删除当前"无活跃 session 就返回 `{agents: [], source: "pending"}`"的静默降级（`apps/server/src/provider/Layers/ClaudeAdapter.ts:5389`）。
- 合并需在同一处集中实现，来源标记（project / user / sdk / builtin）随条目下发，供 Web 侧分组与调试使用。
- **CodexAdapter**：新增 `listAgents`，纯文件扫描。
- 两侧共用 `agentCatalog`，不各写一套。

### C. 提及解析与派发

`packages/shared/src/agentMentions.ts` 有两处**不改则功能不成立**：

1. `parseAgentMentionInvocations` 目前用硬编码表校验别名：
   ```ts
   const resolved = resolveAgentAlias(alias, provider);
   if (!resolved) continue; // 真实 agent 的 @coder(task) 在此被静默丢弃
   ```
   需改为接受动态 agent 名单（由调用方注入已发现的目录）。
2. `isAliasChar` 的字符集 `[a-zA-Z0-9._-]` **不含冒号**，plugin agent（如 `ecc:security-reviewer`）会被从冒号处截断。需扩展字符集并补测试。

派发指令按 provider 分叉：

- **Claude**：沿用现有 `buildClaudeSubagentPrompt`，指示主代理通过 Agent 工具委派。
- **Codex**：新增 `buildCodexSubagentPrompt`，指示主代理调用 `agents.spawn_agent(agent_type=..., message=...)`，并用 `agents.wait_agent` 回收结果。措辞需处理 `agent_type` 不可见时的降级路径。

两者共享同一份解析结果，只在最后的指令渲染上分开。

### D. Web 菜单分组

`apps/web/src/hooks/useComposerCommandMenuItems.ts` 中，条目增加 `group` 字段；`ComposerCommandMenu` 渲染分组标题；调整 `:358` 的拼接顺序，把 agents 从末位提前。

分组：

- **我的 Agents** — user / project / SDK / plugin 来源
- **Synara 内置** — explore / review / build / plan
- **模型** — Codex 的 `@5.5` / `@spark` 等模型别名

## 本计划需要修掉的既有缺陷

1. `ClaudeAdapter.listAgents` 的静默降级：首次调用必然返回空且要求已有活跃 session，导致新会话里 `@` 菜单只显示 4 个硬编码项，而界面看不出异常。
2. `isAliasChar` 不含冒号，plugin agent 名被截断。
3. `parseAgentMentionInvocations` 丢弃未知别名，使真实 agent 的提及无声失效。

## 实现期需要验证的开放项（已实测，结论如下）

### 1. Codex 不支持项目级 `<cwd>/.codex/agents/` —— 已证伪，实现已按结论收敛

在 `/tmp/codex-agent-probe/.codex/agents/synara-probe-project.toml` 放置一个合法的 role 文件（含非空 `name`），以该目录为 cwd 运行 `codex exec -s read-only`：

- 让模型枚举 `agent_type` 的全部合法值：返回 51 个用户级条目 + 内置 `worker`，**不含** `synara-probe-project`。
- 补测：`git init` 后在真实 git 仓库中重问 "`agent_type` 是否接受 `synara-probe-project`"，回答 `NO`。

结论：codex-cli 0.145.0 只从 `~/.codex/agents` 加载 role 文件，项目级目录不生效。`agentCatalog` 已通过 `AGENT_ROOT_SPECS.codex.supportsProjectRoots = false` 让 Codex 只扫用户级根目录；Claude 侧保留项目级扫描。

### 2. `hide_spawn_agent_metadata = true` 并未隐藏 `agent_type`

参考机器 `~/.codex/config.toml:227` 确实设置了该项（位于 `[features.multi_agent_v2]`，同段 `enabled = true`、`tool_namespace = "agents"`）。直接询问 `agents.spawn_agent` 的参数属性名，返回：

```
agent_type, fork_turns, message, model, reasoning_effort, task_name
```

即该配置声称要隐藏的 `agent_type` / `model` / `reasoning_effort` 全部仍然暴露。结论：在 0.145.0 + `multi_agent_v2` 下该开关对 `spawn_agent` 的 schema 不起作用。`buildCodexSubagentPrompt` 仍保留降级措辞（`agent_type` 不可见时改为在 message 开头声明角色），作为版本差异的兜底。

### 3. SDK `supportedAgents()` 确实包含 plugin agent —— 决策 2 成立

用 `@anthropic-ai/claude-agent-sdk` 直接驱动一个临时 query 并调用 `supportedAgents()`（`settingSources: ["user","project","local"]`）：返回 **117** 条，其中包含大量磁盘上 `~/.claude/agents` 根本不存在的 plugin agent：`ecc:*`（约 68 个）、`fable-advisor:codex-implementer`、`fable-advisor:fable-advisor`、`fable-advisor:grok-implementer`、`grok-build:grok-delegate`，以及 Claude Code 自带内置 `Explore` / `Plan` / `general-purpose` / `claude` / `statusline-setup`。同一台机器磁盘上只有 42 个 `.md`。

结论：纯文件扫描会漏掉近 2/3 的可用子代理，"扫描 + SDK 合并"是必需的，决策 2 无需重议。

附带发现：SDK 返回的 `Explore` 与 Synara 注入的 `explore` 仅大小写不同。合并按小写去重，故两者会被视为同名并按"SDK/plugin > 内置"的既定优先级由 SDK 条目胜出。这符合决策 5，但意味着内置分组里可能显示 `Explore` 而非 `explore`。若不希望如此，需另立"运行时内置"分组——属于决策变更，未擅自实施。

## 验收标准

1. 在无任何历史会话的全新 Synara 会话中输入 `@`，Claude 与 Codex 两侧都能列出各自磁盘上定义的真实子代理，而非只有硬编码项。
2. Codex 侧对缺少非空 `name` 的 `.toml` 不列出。
3. 含冒号的 plugin agent 名可被完整提及，不被截断。
4. `@<真实 agent>(任务)` 发送后，Claude 侧生成 Agent 工具委派指令，Codex 侧生成 `agents.spawn_agent` 指令，且 `agent_type` 与磁盘定义的 `name` 一致。
5. 同名 agent 按"项目 > 用户 > SDK/plugin > 内置"解析。
6. 菜单按三个分组呈现，agent 不再排在末位。

## 验证

- 单元测试覆盖：TOML/frontmatter 解析（含 malformed 跳过）、优先级合并、含冒号别名解析、两侧指令渲染。
- 按 `AGENTS.md`：使用 `bun run test`，禁止 `bun test`。
- 收尾时一次性通过 `bun fmt`、`bun lint`、`bun typecheck`，不在迭代中反复全量跑。

## 已考虑并否决的方案

- **为子代理引入独立触发符（`@@` / `#`）**：否决。会增加记忆成本，且偏离 Claude / Codex 的原生习惯；分组标题已足以消除菜单内的语义混淆。
- **只扫文件系统、不合并 SDK**：否决。参考机器安装了大量 plugin 提供的 agent，纯扫描会让它们全部提及不到。
- **只修官方 API 时序、不扫文件**：否决。Codex 的 `agents.list_agents` 是模型侧工具，服务端调不到，该路径在 Codex 侧根本不成立。
- **删除 Claude 四个硬编码内置**：否决。它们由 Synara 注入 SDK、真实可用，且是未配置过 agent 的新用户唯一能提及到的对象。
