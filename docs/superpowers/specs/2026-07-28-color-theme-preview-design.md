---
name: color-theme-preview
status: approved
created: 2026-07-28T12:11:55Z
updated: 2026-07-28T12:11:55Z
---

# 配色主题 / 颜色预览模式 —— 设计文档

## 1. 目标

让用户能在对话里直接看见 Agent 提出的配色方案并一键采用，而不必把十六进制色值抄进设计工具里比对。

两件独立但互补的事：

1. **配色主题预览** —— Agent 输出约定格式的围栏，Synara 渲染成可确认的色板卡片。
2. **hex 内联色块** —— Agent 在正文里写的十六进制色值，前面自动带一个对应颜色的小方块。

第 2 项不依赖第 1 项，任何对话里都生效。

## 2. 非目标

- 不做主题持久化。采用配色后由 Agent 写代码落地，Synara 不存储任何主题。
- 不做明暗双主题、不做色板分组。Agent 想表达多套就输出多个围栏。
- 不改 Synara 自身的界面主题。这个功能是给用户的**项目**配色用的。
- 不在代码块内部渲染色块（见 4.1 的范围决定）。

## 3. 触发与提示词注入

### 3.1 `@Preview` mention

用户在 composer 里写 `@Preview`，本轮启用配色预览模式。不写就完全不注入——零常驻 token 成本。

实现为 **composer mention 的一个新 token 类别**，而非内置 skill 文件或斜杠命令：

- 不选内置 SKILL.md 落盘：提示词会脱离代码版本，出现"旧 skill 文件 + 新渲染器"的静默错位。
- 不选 `/preview` 斜杠命令：`skillMentionPrefix` 已经占用 `/` 前缀，语义会撞车。

`@Preview` 在 `composerMentions.ts` 的 tokenizer 里开一条分支，渲染成 chip，并在 `sendTurn` 载荷上置一个布尔字段（如 `colorPreview: true`）。

### 3.2 服务端注入

新增 `apps/server/src/provider/colorPreviewPromptInjection.ts`，与 `skillPromptInjection.ts` 并列。

接入点是 `ProviderCommandReactor.ts` 现有的两处（bootstrap 路径约 1489 行、steer 路径约 1301 行）。

**预算约束（硬要求）**：注入长度必须走与 skill 注入相同的
`PROVIDER_SEND_TURN_MAX_INPUT_CHARS − 已用长度 − PROVIDER_INPUT_SAFETY_MARGIN_CHARS`
计算。两个注入源竞争同一预算，该计算应抽成共用函数，不得各算各的。

注入内容说明两种围栏格式，并明确引导：**优先 ```theme，只在需要展示排版或组件效果时才用 ```html theme**。

## 4. 渲染

### 4.1 hex 内联色块

按位置差异化匹配：

| 位置 | 接受长度 | 理由 |
|---|---|---|
| 普通正文 | 6 位、8 位 | `#123` 是合法 3 位 hex，但正文里几乎总是 issue 引用；`#abc` 常是锚点 |
| 行内代码 `` `…` `` | 3、4、6、8 位 | 反引号本身即"这是个值"的显式信号，误判风险为零 |
| 代码块 | 不渲染 | 需后处理 Shiki 输出的 HTML 字符串，对长代码块有真实性能开销 |

匹配要求前后为非词字符边界，避免命中 `#deadbeef00` 这类长串的前缀。

**实现**：remark 插件，与现有 thread marker 插件同一层。**顺序有依赖——色块插件必须排在 marker 插件之后**，否则 marker 的字符偏移会被插入的节点打乱。

**性能**：文本不含 `#` 直接返回，不进正则。转录每帧重新解析，此短路是必要的。

**呈现**：文字前一个 0.75em 圆角方块，`inline-block`，基线对齐，**带半透明描边**——否则纯白色块在浅色主题、纯黑色块在深色主题下完全隐形。原 hex 文本保持不变。

### 4.2 结构化 `theme` 围栏

契约放 `packages/contracts`（schema-only），作为渲染器与注入提示词的单一事实源。两处分头维护必然漂移，后果是每个色板静默降级成代码块且无任何报错。

````
```theme
{
  "name": "Warm Dusk",
  "colors": [
    { "token": "background", "hex": "#1B1412", "note": "页面底色" },
    { "token": "foreground", "hex": "#F4E8E1" },
    { "token": "accent",     "hex": "#E2725B" }
  ]
}
```
````

`name`、`colors[].token`、`colors[].hex` 必填；`note` 可选。

**解析失败一律静默降级为普通代码块。** 这不是防御性编程：流式输出时围栏内容每一帧都是残缺 JSON，任何报错 UI 都会在打字过程中闪烁。仅解析成功才升级为卡片。JSON 合法但字段缺失属于真异常，dev 下 warn。

### 4.3 `html theme` 围栏

关键词形式 ` ```html theme `——`theme` 是 fence info 的第二个 token。`codeFence.ts` 的 `parseCodeFenceInfo` 需扩一条识别尾随修饰符，语言仍解析为 `html`，这样预览未启用时代码块照常高亮。

**无关键词的 ```html 行为完全不变**，仍是纯 Shiki 代码块。关键词是渲染开关。

**沙箱三层收紧，缺一层都不行：**

1. `<iframe sandbox="">` —— 空值最严格：禁脚本、禁同源、禁表单、禁导航、禁弹窗。不给任何 `allow-*`。
2. srcdoc 内注入 `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` —— sandbox 挡不住 `<img src="https://tracker...">` 和外链字体，那是实打实的信息泄露通道。CSP 必须走 srcdoc 内的 `<meta>`，因为 srcdoc 文档没有自己的 HTTP 响应头。
3. `referrerpolicy="no-referrer"`。

**已知后果**：Agent 写的 `<img src="https://...">` 会静默变空白。这是接受的取舍。

**仅在围栏闭合后挂载 iframe。** 流式期间 HTML 逐字符到达，每帧重建 iframe 会闪烁并造成真实开销。未闭合时显示代码，闭合后切预览。

**高度受限**：预览区 `max-height` 约 360px，超出滚动，卡片提供展开动作。禁脚本意味着 iframe 无法 postMessage 汇报高度——固定高度反而防住 Agent 写一个 3000px 页面冲垮对话。展开/收起**必须复用 `apps/web/src/lib/disclosureMotion.ts`**（仓库 UI 约定）。

### 4.4 共用卡片外壳

两种围栏共用同一个卡片组件，"配色主题"这个身份只有一处定义：

```
┌─────────────────────────────────┐
│ 配色主题 · Warm Dusk            │
├─────────────────────────────────┤
│ ███  background  #1B1412  页面底色│
│ ███  foreground  #F4E8E1        │
│ ███  accent      #E2725B        │
├─────────────────────────────────┤
│                      [ 采用 ]   │
└─────────────────────────────────┘
```

中间内容：结构化路径是原生色板行，HTML 路径是 sandbox iframe。

复用 `ChatThreadSurfacePrimitives` 既有表面样式，不新造视觉语言。色块点击复制单个 hex，卡片提供复制全部。

## 5. 「采用」行为

无持久化。点击后前端拼一条消息，走现有 composer 发送链路发给当前会话，后续落地由 Agent 写代码完成。

**结构化路径**：

```
已确认配色方案「Warm Dusk」：
background #1B1412
foreground #F4E8E1
accent #E2725B
请应用到项目。
```

**HTML 路径**：扫描 HTML 源文本内所有 hex，按出现顺序去重。无 token 名，回发文本退化为：

```
已确认配色方案：
#1B1412 #F4E8E1 #E2725B
请应用到项目。
```

这一路径明显弱于结构化路径，正是保留 ```theme 作为主路径并在注入里优先引导它的理由。

## 6. 改动清单

**新增**

| 文件 | 职责 |
|---|---|
| `packages/contracts` 内新增 schema | theme 围栏契约 |
| `apps/web/src/lib/colorSwatch.ts` | hex 匹配与解析（纯函数） |
| `apps/web/src/lib/themeFence.ts` | theme 围栏解析与降级判定（纯函数） |
| `apps/web/src/components/chat/ThemePreviewCard.tsx` | 共用卡片外壳 |
| `apps/server/src/provider/colorPreviewPromptInjection.ts` | 注入文本构建 |

**修改**

| 文件 | 改动 |
|---|---|
| `apps/web/src/lib/composerMentions.ts` 及 composer tokenizer | `@Preview` token 分支 |
| `apps/web/src/lib/codeFence.ts` | 识别 `theme` 修饰符 |
| `apps/web/src/components/ChatMarkdown.tsx` | 挂载色块插件、theme 围栏分流 |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | 两处注入点接入 |

解析逻辑抽成 `lib/` 纯函数而非写在组件里，使误判边界（`#123` vs `` `#123` ``）可用普通单测穷举，无需起 React。与仓库既有的 `codeFence.test.ts`、`composerMentions.test.ts` 模式一致。

## 7. 验证

- `bun run test`（**不是** `bun test`）覆盖解析层与注入层：hex 匹配边界、围栏解析与降级、注入预算计算。
- `bun fmt` / `bun lint` / `bun typecheck` 收尾一次性跑完。
- UI 部分实际起应用确认渲染效果，包含流式过程中的降级行为。
