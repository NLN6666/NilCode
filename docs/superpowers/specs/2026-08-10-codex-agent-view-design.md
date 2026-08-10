---
name: codex-agent-view
status: approved
created: 2026-08-10T00:00:00+08:00
updated: 2026-08-10T00:00:00+08:00
---

# Codex Agent 查看与完整子对话 —— 设计文档

## 1. 目标

让 Codex 原生 Agent 在 Synara 中获得与现有 Claude 子代理一致的查看体验：父对话输入框上方出现子代理列表，点击后在右侧 dock 查看该 Agent 的完整时间线和运行详情。

每个列表项和详情上下文应在数据存在时展示：

- 模型名；
- reasoning effort；
- 角色；
- 运行状态；
- 前台或后台状态。

右侧时间线与主对话使用同一渲染路径，包含消息、推理摘要、工具调用和计划进度。

## 2. 非目标

- 不新增 Codex 专用 Agents 页面或常驻侧栏。
- 不建立 Codex 专用状态仓库、协议副本或时间线渲染器。
- 不展示上下文窗口、token 用量或原始 provider payload。
- 不新增 Agent 创建、模型切换或调度控制能力。
- 不改变普通线程、Claude 子代理或非 Agent 工具活动的导航语义。

## 3. 当前基础与缺口

Synara 已有可复用的通用子代理能力：

1. `ProviderRuntimeIngestion` 能把 provider 原生子会话物化为 `provider_native` 子线程，并保存父线程、来源 turn、agent ID、昵称和角色。
2. `ComposerSubagentStrip` 已在输入框上方展示运行中与已完成的子代理，并把点击行为路由到父线程的右侧 dock。
3. `SubagentDetailSections` 已支持按需订阅最近消息及打开完整子对话。
4. 子代理 presentation 层已经能从父活动解析模型、effort、身份和状态，并避免后续稀疏事件抹掉先前信息。
5. 子线程 dock 已复用完整 `MessagesTimeline`，无需新建对话详情 UI。

本次功能不重复这些组件，而是补齐 Codex app-server 事件进入上述通用链路时的完整性。重点核实并修复：

- `collab_agent_tool_call` 中 receiver、identity、requested model 与实际 model 的规范化；
- Codex 子会话的内容、推理、工具和计划事件是否稳定路由到正确子线程；
- 当前被过滤的子会话生命周期通知是否导致运行状态或终态缺失；
- 子代理缺少部分字段时，列表和 dock 是否保持可用且不显示误导信息。

## 4. 方案选择

### 4.1 采纳：复用通用子代理链路

Codex Agent 继续物化为普通子线程，复用 provider runtime、orchestration、work log、composer strip、dock 和完整时间线。只在 Codex 数据接入或通用规范化确有缺口的地方补丁。

该方案改动小，Claude 与 Codex 行为一致，也避免两套身份、状态和导航规则逐渐漂移。

### 4.2 否决：Codex 专用 Agent 模型与 UI

独立 contracts、store 和组件能表达更多 Codex 私有字段，但会复制现有能力，并扩大后续 provider 兼容成本。本次需求不需要这些字段。

### 4.3 暂不采用：全面升级统一 Agent 协议

把所有 provider 的 Agent 都提升为新的第一等协议，长期边界更明确，但需要迁移 contracts、持久化和多个 provider。当前通用子线程模型已覆盖本次交互，不值得扩大范围。

## 5. 交互设计

### 5.1 父对话中的 Agent 列表

- 仅当当前父对话存在子代理时显示 `ComposerSubagentStrip`。
- 运行中 Agent 保持直接可见；已完成、失败或中止的 Agent 收纳在现有 settled disclosure 中。
- 每行使用稳定昵称或角色作为主标签，并在可用时显示模型与 effort、状态、background 标记。
- 点击行调用现有 `onOpenSubagentThread`，在父线程右侧 dock 打开子线程；不替换父对话路由。
- 停止、转后台及 stop-all 继续沿用现有能力，不新增 Codex 特例。

### 5.2 右侧 Agent 对话

- dock tab 打开真实子线程，并使用与主线程相同的完整时间线。
- 消息、推理摘要、工具调用和计划进度按原有 timeline 规则展示。
- 标题上下文展示模型名与 reasoning effort；角色、状态和前后台状态继续由列表和活动详情提供。
- 已结束 Agent 的子线程仍可重新打开。
- 无法解析到真实子线程时保留基础活动信息，但禁用打开对话，避免误导航。

### 5.3 动画与性能

- 所有展开/收起继续使用共享 disclosure motion（220ms `ease-out` 与 reduced-motion fallback）。
- 预览只在展开时保留子线程详情订阅，收起后释放。
- 子代理工具行不计为新的 transcript message，不得重新触发主时间线的 auto-stick。
- 不把 virtualizer measurement 与 bottom-follow 建立双向循环。

## 6. 数据流与合并规则

```text
Codex app-server notification
  -> Codex provider event + provider thread references
  -> normalized provider runtime event
  -> ensure provider_native child thread
  -> route child content/lifecycle to that thread
  -> project parent collaboration activity
  -> work log / subagent presentation
  -> composer strip + right dock timeline
```

合并规则：

1. 用 provider child thread ID 作为父活动与本地子线程之间的主要关联键，agent ID 作为身份辅助键。
2. 已知身份值保留，较新的非空事实覆盖旧值；稀疏更新不能清空 nickname、role、model 或 effort。
3. 实际运行模型优先于 requested model。只有请求提示时，不将其标为已确认的实际模型。
4. 模型未知时省略字段，不回退到父线程模型。
5. 子 Agent 的 started、completed、failed、aborted 必须得到可观察终态；父 turn 结束不能删除已物化子线程。
6. 重复或乱序事件必须依赖既有幂等 command ID 和线程去重规则，不创建重复子线程。
7. 保留每个父 turn 的原生子线程物化上限；超限通过父活动报告明确错误。

## 7. 错误与降级行为

- 缺少模型、effort、昵称或角色：只省略对应字段，其余列表和对话能力正常。
- 缺少可解析 child thread ID：展示不可打开的活动信息，并提供可访问性说明。
- 子线程事件早于父协作事件：先按 provider refs 物化最小子线程，之后再增量补齐身份。
- 子线程终态通知缺失：允许使用父协作活动中的 agent state 收敛展示状态；不得伪造完成状态。
- provider 返回未知事件形状：保留现有 schema 边界与安全降级，不把原始内容直接渲染为可信模型详情。

## 8. 测试设计

### 8.1 Server 与 shared

- 解码 Codex receiver agents、agent states、snake/camel aliases、model/effort/background。
- 从 `collab_agent_tool_call` 创建唯一子线程，并保存正确父线程和来源 turn。
- 子内容、推理、工具与计划事件按 provider refs 路由到子线程。
- started、completed、failed、aborted 状态正确收敛。
- requested model 不冒充实际模型；后续稀疏状态不丢失已知身份。
- 重复、乱序、无法关联和超过物化上限的事件安全降级。

### 8.2 Web

- Codex Agent 出现在通用 composer strip，显示模型、effort、角色、状态和 background。
- 运行中与 settled 分组正确，失败状态保持醒目。
- 点击列表优先调用 `onOpenSubagentThread` 并在父线程 dock 打开。
- dock 使用完整时间线，覆盖消息、推理摘要、工具调用和计划进度。
- 对话预览展开/收起的 retain/release 次数平衡。
- 缺少模型或真实线程时不显示误导标签，也不执行错误导航。
- transcript 保持简单路径与既有 auto-scroll 性能约束。

### 8.3 验证命令

实施阶段先运行相关 Vitest 文件，使用 `bun run test`，不得使用 `bun test`。最终只集中运行一次重量级 workspace 检查：

```text
bun fmt
bun lint
bun typecheck
```

## 9. 兼容性与回滚

- 不改变持久化 schema 时无需迁移；若实施证据表明必须新增持久字段，应先回到设计审批，不在实现中静默扩大范围。
- 通用 UI 的新增字段均为可选，历史线程和非 Codex provider 保持原行为。
- Codex 路由修复应以小型、可独立回滚的变更提交；回滚后仅失去 Codex Agent 可见性，不影响普通对话。

## 10. 验收标准

1. Codex 在父 turn 中启动一个或多个 Agent 后，输入框上方实时出现对应列表项。
2. 列表在数据可用时准确展示模型、effort、角色、状态和前后台状态。
3. 点击 Agent 不离开父对话，而是在右侧 dock 打开对应子线程。
4. 子线程显示与主对话同级的完整时间线，包括消息、推理摘要、工具调用和计划进度。
5. 完成、失败和中止 Agent 均保留可查看记录并显示正确终态。
6. 缺失或乱序 provider 数据不会产生重复线程、错误模型或错误导航。
7. Claude 子代理和普通线程行为无回归，目标测试及最终 workspace 检查通过。
