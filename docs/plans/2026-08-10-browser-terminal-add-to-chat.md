# Plan — 修复浏览器服务控制台 Add to chat 静默失效

## 目标

让浏览器预览下方的项目服务控制台与独立 dock 控制台行为一致：选择终端内容后点击 `Add to chat`，选区会作为 terminal context 插入当前聊天编辑器。

## 已确认根因

`apps/web/src/components/chat/BrowserPaneTerminalSplit.tsx` 当前向 `ThreadTerminalDrawer` 传入空实现 `onAddTerminalContext={() => {}}`。由于 drawer 以回调是否存在决定是否展示菜单，用户能看到按钮，但点击只调用空函数。

现有正确链路位于：

- `ChatView.tsx` 按 `paneScopeId` 注册 composer target；
- `terminalContextComposerRegistry.ts` 保存和通知 target；
- `DockTerminalPane.tsx` 订阅 `SINGLE_CHAT_PANE_SCOPE_ID` 并把 target 交给 `ThreadTerminalDrawer`。

## 范围

### 包含

1. 提取一个小型 React hook，封装按 pane scope 订阅 composer target 的 `useSyncExternalStore` 样板。
2. 让 `DockTerminalPane` 使用该 hook，保持现有行为不变。
3. 让 `BrowserPaneTerminalSplit` 使用同一 hook，并删除空回调。
4. 增加聚焦回归测试，验证 target 的注册、替换、注销会实时反映到消费者。
5. 增加浏览器服务控制台接线测试，证明 `ThreadTerminalDrawer` 收到真实 target，而不是空函数。

### 不包含

- 不修改 xterm 选区读取、菜单定位或选区清理逻辑。
- 不改变 terminal context 的展示文案、chip 样式或发送格式。
- 不改变 split chat、editor chat 或 terminal-only 页面能力策略。
- 不重构 composer draft store。

## 设计

新增 `apps/web/src/hooks/useTerminalContextComposerTarget.ts`：

```ts
useTerminalContextComposerTarget(paneScopeId: string): TerminalContextComposerTarget | undefined
```

hook 使用现有 `getTerminalContextComposerTarget` 与 `subscribeTerminalContextComposerTarget`，通过 `useSyncExternalStore` 返回当前 target。它不拥有注册生命周期，只负责消费 registry。

两个控制台面板都使用 `SINGLE_CHAT_PANE_SCOPE_ID`，因为它们都属于 `SingleChatSurface` 的右侧 dock，并应写入同一个主聊天 composer。target 尚未注册或已注销时，向 `ThreadTerminalDrawer` 传 `undefined`；drawer 因此不会提供一个无法工作的 `Add to chat` 动作。

## 实施步骤

1. 先新增失败测试：
   - hook 在 target 未注册时返回 `undefined`；
   - 注册 target 后同步返回该函数；
   - 新 target 替换旧 target时返回新函数；
   - 清理当前 target 后回到 `undefined`，旧注册的清理函数不能删除较新的 target。
2. 新增 `BrowserPaneTerminalSplit` 接线测试：mock `ThreadTerminalDrawer` 并捕获 props，断言 registry target 注册后成为 `onAddTerminalContext`，调用该 prop 会原样转发 selection。
3. 实现共享 hook。
4. 把 `DockTerminalPane` 的本地 `useCallback` / `useSyncExternalStore` 样板替换为共享 hook。
5. 把 `BrowserPaneTerminalSplit` 的空回调替换为共享 hook 返回值。
6. 运行聚焦测试并检查 diff。

## 测试与验收

聚焦命令（禁止使用 `bun test`）：

```bash
bun run test --run apps/web/src/hooks/useTerminalContextComposerTarget.test.tsx apps/web/src/components/chat/BrowserPaneTerminalSplit.test.tsx apps/web/src/lib/terminalContextComposerRegistry.test.ts
```

验收标准：

- 浏览器服务控制台选区的 `Add to chat` 调用当前主聊天 composer target。
- composer target 不可用时，不显示一个点击无效的动作。
- 独立 dock 控制台既有行为保持不变。
- target 替换和注销不会留下陈旧回调。

根据项目约束，本次未获用户明确授权，不运行 `bun fmt`、`bun lint`、`bun typecheck`；完成实现后将报告这些重型检查未执行，不能据此宣称全仓验证完成。

## 错误处理、兼容性与回滚

- registry 无 target 是合法状态，hook 返回 `undefined`，不抛错、不显示失效菜单。
- 不修改 registry 的公共语义，不影响已有注册方。
- 回滚只需恢复两个消费者的接线并删除新 hook/test；draft 数据结构与持久化格式均未改变。

## 备选方案

- **拒绝：只把空函数替换成一次性的 `getTerminalContextComposerTarget(...)`。** 组件不会在 target 注册、替换或注销时重渲染，容易持有陈旧值。
- **拒绝：在 `BrowserPaneTerminalSplit` 复制 `DockTerminalPane` 的订阅样板。** 这是第二个相同消费者，应抽出单一 hook，避免两处生命周期逻辑继续漂移。
- **拒绝：直接把 callback 从 `SingleChatSurface` 层层透传。** composer target 已有按 pane scope 设计的 registry；再增加一条 prop 链会制造并行机制。
