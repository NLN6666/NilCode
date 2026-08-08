# `@Launch` 后台服务模式 —— 设计文档

**日期：** 2026-08-08
**状态：** 待实施

## 目标

让用户能在 composer 里打 `@Launch`，显式告诉 Agent：**你可以起一个常驻终端来跑我的世界服务器这类长期服务，然后实时读日志、查日志、往里发命令。**

## 背景：能力已存在，缺的是引导

`apps/server/src/agentGateway/daemonTools.ts` 已经提供 8 个 `synara_*_daemon` 工具（start / list / describe / read_logs / send_input / wait / stop / restart），`daemon:control` capability 由 `AgentGatewaySessionRegistry.ts` 默认授予每个 provider session。Agent **现在就能**做这件事。

问题在于工具选择偏好：模型面对"帮我起个 MC 服务器看日志"，习惯性会用普通 shell 跑一条前台命令，然后把自己卡在那条命令上 —— 而不是想到用 `synara_start_daemon`。

这与 `@Preview` 的处境同构：模型本来就会写 HTML，但不知道仓库有 swatch fence 协议，所以需要一段本回合注入的指令把它拉到正确的做法上。

## 与 `.nilcode/launch.json` 的关系

仓库里 `Launch` 一词此前专指 `.nilcode/launch.json`（`packages/contracts/src/launchConfig.ts`，`LAUNCH_CONFIG_*`），语义是"项目可运行服务的**静态配置**"，镜像成顶栏的 project actions。

daemon 子系统则是"**运行时**进程监管"。两者是不同子系统，但在用户视角是同一件事 —— "启动我的服务"。因此 `@Launch` 同时接管两者：注入的快照既列出当前在跑的 daemon，也列出 `launch.json` 里已配置的服务，让 Agent 知道"这些是本项目已知的可运行服务，可以直接拿去起 daemon"。

代码层会出现 `LAUNCH_MENTION_*` 与既有 `LAUNCH_CONFIG_*` 并存，靠 `launchPromptInjection.ts` 的文件头注释说明这层关系。

## 架构

完全复用 `@Preview` 已验证的通路，不新增架构概念：

```
composer 打 @Launch
  → ChatView 发送时 promptIncludesLaunchMention() → 消息挂 launch: true
  → decider → projector（照 colorPreview 透传）
  → ProviderCommandReactor 取数 + 注入到本回合 prompt 尾部
```

### 注入内容：三段结构

```
<background_service_mode>
[静态] 能力陈述 + 两个易错点（ready 声明、有状态服务的优雅关服）
[动态] Currently supervised: mc-server (running, pid 4821, port 25565)
[动态] This project's configured services (.nilcode/launch.json):
       mc-server → java -Xmx4G -jar server.jar (cwd: server/)
</background_service_mode>
```

**语气：引导式，非强制。** 陈述能力与陷阱，不下 `You MUST NOT` 禁令。理由：用户打 `@Launch` 有时只是想看现有服务的日志，并不想起新东西；强制指令会让模型在这种场景下显得死板。

**预算策略：** 静态段 all-or-nothing（照 `buildColorPreviewInstructions` 的规矩 —— 截断的用法说明会教坏模型）；两段动态快照在预算不足时**按段整体丢弃**，因为少列几个服务只是信息变少，不会让模型学到错误契约。

## 分层与文件

| 文件 | 改动 | 职责 |
|---|---|---|
| `apps/server/src/provider/launchPromptInjection.ts` | 新建 | 纯函数 `buildLaunchInstructions({ maxChars, daemons, configurations })`。不碰 IO，可完整单测 |
| `apps/server/src/provider/launchPromptInjection.test.ts` | 新建 | 预算边界、按段丢弃、空快照 |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | 改 | 取数（`broker.list` + `readProjectLaunchConfig`）喂给纯函数；注入位置紧跟 `colorPreviewInlineText`，共用同一预算链。steer 与 dispatch 两条路径都要 |
| `packages/contracts/src/orchestration.ts` | 改 | 4 处 `colorPreview` 旁加 `launch: Schema.optional(Schema.Boolean)` |
| `apps/server/src/orchestration/decider.ts` / `projector.ts` | 改 | 照 `colorPreview` 透传 |
| `apps/web/src/lib/composerMentions.ts` | 改 | `LAUNCH_MENTION_TOKEN` / `_INSERT_TEXT` / `_ICON_NAME` / `isLaunchMentionToken` / `promptIncludesLaunchMention`；`MentionChipKind` 加 `"launch"`；`resolveMentionChipKind` 加分支 |
| `apps/web/src/hooks/useComposerCommandMenuItems.ts` | 改 | `buildLaunchMentionComposerItems`，复用同一 ranker 与关键词权重 |
| `apps/web/src/components/chat/ComposerCommandMenu.tsx` | 改 | `ComposerCommandItem` 加 `"launch"` 分支 + 图标 + 副文案 |
| `apps/web/src/components/chat/MentionChipIcon.tsx` | 改 | chip 图标 |
| `apps/web/src/components/ChatView.tsx` | 改 | 发送时检测并挂字段（`:8266` 附近）；`:10341` 附近的插入入口 |
| `apps/web/src/i18n/locales/{en,zh-CN}/composer.ts` | 改 | 菜单文案 + 搜索关键词。中文需能被「启动」「服务器」「后台」「日志」命中 |

**分层理由：** 注入文本的构造是纯函数（好测、是这个功能的实际产物、会反复调优），取数留在 Reactor（那里已在 Effect 上下文中，`broker.list` 与 `resolveProjectedThreadWorkspaceCwd` 都可直接 `yield*`）。这与 `colorPreviewPromptInjection.ts` 的既有分法一致。

## 错误处理

- `readProjectLaunchConfig` 读失败 → 降级为不带该段快照，**不阻断发送**。照 Reactor 里 skill inline 的 `Effect.catch` + `logWarning` 现成写法。
- `broker.list` 失败 → 同上。
- `resolveProjectedThreadWorkspaceCwd` 返回 null（无工作区的 chat 线程）→ 跳过 launch.json 段，daemon 段仍注入。

## 测试

- `launchPromptInjection.test.ts`：纯函数单测 —— 预算刚好/不足时静态段的 all-or-nothing、动态段按段丢弃、daemon 与配置均为空时的输出。
- `composerMentions` 既有测试文件补 `@Launch` 的 token 识别与大小写不敏感。
- `ComposerCommandMenu.test.ts` 照 `@Preview` 的 `label: "@Preview"` 断言补一条。

## 不做的事

- 不碰 "Detect services" 按钮（它继续往草稿塞完整 prompt，与 `@Launch` 共存）。
- 不改 daemon 工具本身，不加新 capability。
- 不做 `@Launch:<name>` 这类引用具体服务的形式 —— `@Launch` 是模式标记，不是引用。
