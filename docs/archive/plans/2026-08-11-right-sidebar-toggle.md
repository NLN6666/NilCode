# Plan — 修复 Windows 右侧栏按钮无响应并生成安装包

## 目标

修复共享 Browser 项目中顶部“切换右侧边栏”按钮看似无响应的问题，保持 isolated Browser 与其他 dock 标签行为不变，并生成可安装的 Windows x64 NSIS 包。

## 已确认根因

- `SingleChatSurface` 使用 `resolveActivePane(dockState)` 判断当前是否为 Browser 标签；该 helper 在 dock 关闭时必然返回 `null`。
- dock 关闭但仍保留 Browser 为 `activePaneId` 时，点击顶部按钮先把 `open` 设为 `true`，却没有同步项目级 Browser visibility。
- 随后的共享 Browser reconciliation 仍读到 `false`，立即把 Browser dock 重新关闭，因此用户看不到任何变化。
- 真实 Windows 客户端已复现按钮点击后界面无变化；回归来自 `6b635ca39` 引入的项目级 Browser visibility 同步，而普通 sidebar toggle 与窗口 caption controls 不是根因。

## 实施

1. 在 `apps/web/src/rightDockStore.logic.test.ts` 增加失败测试，固定“dock 关闭但 Browser 仍是选中标签时，重新打开必须同步 visibility=true”的行为。
2. 在 `apps/web/src/rightDockStore.logic.ts` 增加纯派生 helper，按 `activePaneId` 读取选中标签，不受当前 `open` 影响，并返回 Browser visibility 的同步意图。
3. 在 `apps/web/src/components/chat/SingleChatSurface.tsx` 的顶部按钮、collapse 和 open-change 路径复用该 helper；非 Browser 标签不触碰项目级 Browser visibility。
4. 更新 `findings.md`，运行聚焦测试、Web build、diff check，独立审查后提交本轮直接相关文件。
5. 运行 `bun run dist:desktop:win`，检查 `release/` 中 NSIS `.exe`、blockmap/update metadata，并运行 packaged startup smoke。

## 验收标准

- 隐藏但已选中的 Browser dock 可通过顶部按钮重新打开。
- 关闭 Browser dock 仍把共享 Browser visibility 同步为 `false`。
- 选中 diff/file/terminal 等非 Browser 标签时，打开或关闭 dock 不改共享 Browser visibility。
- focused tests 与 Web build 通过；Windows x64 NSIS 产物生成并通过 packaged startup smoke。

## 约束与回滚

- 不改 dock 持久化格式，不迁移用户数据，不改变 Browser sharing 默认值。
- 本地包默认未签名；Azure Trusted Signing 仅用于正式发布流水线。
- 回滚只需撤销新增派生 helper 与 `SingleChatSurface` 接线，持久化状态无需处理。
