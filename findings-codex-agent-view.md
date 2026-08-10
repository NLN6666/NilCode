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
