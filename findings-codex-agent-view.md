# Findings — Codex Agent 查看

记录本任务探索、设计与实施期间遇到的错误和已验证结论。

## 1. 当前会话未提供 LCC MCP 或 FastCtx MCP

仓库规则要求优先使用 LCC/FastCtx，但当前工具注册表没有对应工具。探索阶段只能使用只读 PowerShell 命令和只读子代理作为兜底。

## 2. 工作区已有大量未提交 provider/Agent MCP 改动

任务开始时 `git status` 显示 `apps/server/src/agentMcp`、provider adapters、settings 和 contracts 等已有修改。这些改动归用户所有；本任务不得覆盖、回退或混入提交。

## 3. 通用子代理查看基础已经存在

现有代码已具备 `provider_native` 子线程、composer strip、活动详情、按需对话预览、右侧 dock 和模型/effort presentation。设计因此选择补齐 Codex 事件接入，而不是新建 Codex 专用 UI。

## 4. Codex 子会话生命周期通知当前会被提前过滤

`codexAppServerManager.ts` 的 `shouldSuppressChildConversationNotification` 会过滤 child thread 与 turn 的 started/completed/aborted 等通知。实施前必须用现有 ingestion 和 UI 测试确认这是否造成状态或时间线缺口；不得直接全量放行，以免污染父 session 生命周期。

## 5. FastCtx 恢复

实施计划阶段 FastCtx 已重新出现在工具注册表中。后续本地文件读取、搜索和命令执行继续使用 FastCtx；此前 PowerShell 兜底仅发生在工具尚未暴露时。

## 6. 根目录聚焦测试命令不能直接接文件路径

基线命令 `bun run test <test-files>` 失败，因为根脚本是 `turbo run test`，Turbo 会把文件路径解释为任务名并报 `Missing tasks in project`。正确方式是按 workspace 运行，例如 `bun run --cwd apps/server test -- src/codexAppServerManager.test.ts`；实施计划中的所有聚焦命令已据此更正。

## 7. Codex manager 全文件基线存在无关 PATH 版本门控失败

实施前运行 `bun run --cwd apps/server test -- src/codexAppServerManager.test.ts`：124 项中 121 通过、2 跳过，唯一失败是 `codex CLI version gate > re-probes when a PATH-resolved codex is replaced behind the same bare name`，其 promise 在当前机器解析到的 Codex 环境中未按测试预期拒绝。`collab child conversation routing` 组全部通过；本功能使用该 describe 的 `-t` 聚焦命令作为干净基线，不修改无关版本门控测试。

## 8. Codex agent-state 元数据 shape 与请求模型兼容性

已通过共享解码测试验证：实际模型使用 `model`、`modelName` 或 `model_name`，请求提示使用 `requestedModel` 或 `requested_model`；前者优先。执行信息使用 `effort`、`reasoningEffort`、`reasoning_effort` 与显式 boolean `background`。请求模型仍在通用 identity hint 中保留，用于后续实际模型缺失时的内部关联；UI work-log 投影会隐藏该未确认模型，避免把请求值显示为实际运行值。
