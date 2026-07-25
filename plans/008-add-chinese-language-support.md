# 008 · 中文语言支持（原生 i18n）

- 状态：IN PROGRESS —— 第 1 期已完成，2–8 期待办
- 创建：2026-07-25T13:55:29Z
- 范围：`apps/web`（全部 UI）、`apps/desktop`（原生对话框与菜单）、`apps/server`（错误与状态消息）
- 不在范围：`apps/marketing`（官网独立成期）

## 1. 目标

为 Synara 增加原生的多语言能力，首发英文（`en`）与简体中文（`zh-CN`），在 **设置 → 常规（General）** 提供语言切换。

「原生」是相对社区已有两种外挂方案而言的明确取舍：

| 已有方案                             | 形态                                                  | 为什么不采用                                                                  |
| ------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| 上游 issue #202                      | DOM 注入 userscript，`createTreeWalker` 遍历文本节点  | 运行时遍历整棵 DOM 有持续开销，且依赖 DOM 结构，与「Performance first」冲突   |
| `tttnny/synara-chinese-localization` | 解包 `app.asar` → 对压缩 bundle 做字符串替换 → 重打包 | 每次版本升级即失效，需用户手动重跑；改动安装目录，与「Reliability first」冲突 |

两者都是在成品外面打补丁。本计划把语言能力做进构建产物本身。

## 2. 已确定的决策

| 决策点       | 结论                                                       | 理由                                                                           |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 覆盖范围     | 全量国际化 Web 应用                                        | 实测 UI 文案约 1300 条量级，并非 9.1 万行代码那个数字，全量可行                |
| i18n 运行时  | 轻量自建，不引第三方库                                     | 零新依赖；与项目自建 `useLocalStorage` / `appSettings` 归一化的既有风格一致    |
| 词条访问方式 | 对象属性访问，非字符串路径                                 | 类型安全天然成立、零解析开销、IDE 重命名有效                                   |
| 中文语料     | 采用 `tttnny/synara-chinese-localization`，README 署名致谢 | 术语已成体系，省去重译与术语反复；**该仓库无 LICENSE，采用属已知并接受的风险** |
| 默认语言     | 跟随系统，识别不了回落英文                                 | 中文用户装完即中文                                                             |
| server 侧    | 改为返回结构化错误码，由 web 查词条                        | server 无需感知用户语言，分层更干净                                            |

## 3. 架构

### 3.1 词条形态

英文词条同时承担两个职责：定义 key 结构、提供英文原文。中文词条以类型标注对齐它。

```ts
// apps/web/src/i18n/locales/en/settings.ts
export const settings = {
  general: {
    title: "General",
    defaultProvider: {
      title: "Default provider",
      description: "Choose the provider used for new chats.",
    },
  },
};
// 注意：**不可**加 `as const`。那会把 title 的类型收窄成字面量 "General"，
// 中文词条赋任何别的值都将报错。普通推导得到 `string`，正是所需：结构受约束，值自由。

// apps/web/src/i18n/locales/zh-CN/settings.ts
import type { Settings } from "../en/settings";
export const settings: Settings = {
  general: {
    title: "常规",
    defaultProvider: {
      title: "默认提供商",
      description: "选择新建对话时使用的提供商。",
    },
  },
};
```

**这是本方案的核心价值**：`settings: Settings` 这一处类型标注，使「中文漏译」成为编译错误，而非运行时静默回退英文。迁移数百个文件时，`bun typecheck` 就是安全网。

调用方式为对象访问：

```ts
const m = useMessages();
return <span>{m.settings.general.title}</span>;
```

不采用 `t("settings.general.title")` 字符串路径：推导 key 联合类型需要递归类型运算，拖慢编译且使 IDE 重命名失效；对象访问在运行时仅是一次属性读取。

需要参数的词条写成函数，插值与复数由词条自身承担：

```ts
pendingApprovals: (count: number) => `${count} pending approvals`,   // en
pendingApprovals: (count: number) => `${count} 项待审批`,             // zh-CN
```

### 3.2 分层落点

| 层         | 位置                                                         | 内容                                                                                                                                               |
| ---------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行时核心 | `packages/shared/src/i18n.ts`，经 `@synara/shared/i18n` 导出 | 仅框架无关部分：`Locale` 类型、`normalizeLocale`、`detectSystemLocale`。**不含 React**——该包被 server 与 desktop 消费，其依赖仅 contracts + effect |
| React 层   | `apps/web/src/i18n/`                                         | `I18nProvider` / `AppI18nProvider` / `useMessages` / `catalogs`                                                                                    |
| Web 词条   | `apps/web/src/i18n/locales/{en,zh-CN}/`                      | 按域分文件：`settings` / `chat` / `sidebar` / `dialogs` / `shortcuts` / `thread`，单文件不超 800 行                                                |
| 桌面词条   | `apps/desktop/src/i18n/`                                     | 仅原生 `dialog` / 菜单 / 托盘文案                                                                                                                  |
| Server     | 不放词条                                                     | 见 3.4                                                                                                                                             |

运行时核心放 `packages/shared` 而非新建包：它符合该包「双端共享运行时工具 + 显式 subpath 导出」的既有定位，词条则就近放在各消费方，避免任一进程打包进无关语言资源。

### 3.3 语言状态与生效

- `AppSettingsSchema`（`apps/web/src/appSettings.ts:173`）新增 `language` 字段，写法对齐既有的 `timestampFormat`：`Locale.pipe(withDefaults(() => detectSystemLocale()))`
- 持久化沿用 `synara:app-settings:v1`，并同步至 server settings，供主进程读取
- 切换语言**不重载页面**：`I18nProvider` 依 `settings.language` 选定词条对象，React 重渲染即可完成
- 唯一例外是 Electron 原生菜单，需经 IPC 通知主进程重建（照搬 `appSnapIpc.ts` 既有的 `ipcMain.handle` 模式）
- 副作用：同步更新 `<html lang>`；挂 `translate="no"` 与 `notranslate` meta，防浏览器自动翻译二次篡改 UI

### 3.4 server 错误消息

`apps/server` 现有约 157 处面向用户的硬编码 `message`。目标形态是 server 返回 `{ code, params }`，由 web 端查词条渲染，server 因此完全无需感知用户语言。

该改动涉及协议，排在最后一期，且保留原 `message` 字段作为 fallback，避免阻塞前序工作。

## 4. 永不翻译清单

以下内容不进词条表，迁移与扫描脚本均须排除：

终端与 xterm、diff 面板、Monaco 与 CodeMirror 编辑器、`pre` / `code` / `kbd` / `samp`、**AI 回复正文**、用户输入与 `contenteditable`、provider 名（Codex / Claude / Cursor / Antigravity / Grok / Droid / Kilo / OpenCode / Pi）、model ID 与 slug、主题名、文件路径、环境变量、Git 分支名、API key 与 token。

## 5. 分期

| 期  | 内容                                                           | 可独立验证的成果                     |
| --- | -------------------------------------------------------------- | ------------------------------------ |
| 1   | i18n 骨架、语料转换脚本、`language` 设置项、General 面板切换器 | 切到中文，设置页首行变中文           |
| 2   | Settings 全 14 分区 + 侧边栏导航 + `settingsSearchIndex`       | 整个设置界面中文化，中文关键词可搜到 |
| 3   | 主界面：Sidebar、顶栏、会话列表                                | 主框架中文化                         |
| 4   | 聊天区：composer、消息、审批、计划                             | 日常主路径中文化                     |
| 5   | 对话框、toast、空状态、`aria-label`                            | 次级界面与无障碍文案中文化           |
| 6   | 快捷键页、会话详情页                                           | 长尾页面中文化                       |
| 7   | Electron 主进程 + IPC 语言同步                                 | 原生对话框与菜单中文化               |
| 8   | server 错误码化                                                | 服务端错误提示中文化                 |

第 1 期须产出**语料转换脚本**：将 `tttnny/synara-chinese-localization` 的 `localize-patch.js`（1534 行、约 1285 条替换规则，形如 ``'label:`General`' → 'label:`常规`'``）还原为 `英文原文 → 中文` 的纯映射，供后续各期按 key 取用。**取用时逐条复核**，不盲信：已知需要修正的一类是产品功能名，例如 `AppSnap` 不应译作「应用快照」。

## 6. 验收标准

1. `bun fmt`、`bun lint`、`bun typecheck` 全绿
2. 中文词条缺任一 key 时 `bun typecheck` 报错（负向验证：故意删一条，确认编译失败）
3. **硬编码文案扫描脚本**：扫描 JSX 文本节点及 `aria-label` / `placeholder` / `title` 中的英文字面量，按第 4 节清单过滤后，各期目标目录零残留。该脚本既是进度表也是验收依据——全量迁移缺了它就是盲干
4. 单元测试：运行时校验 `zh-CN` 与 `en` 的 key 结构一致（防 `as any` 绕过类型检查）
5. 单元测试：切换 `language` 后 `useMessages` 返回对应语言词条
6. 组件测试：General 面板切换语言后，界面文案随之改变
7. 手工验证：终端、diff、代码编辑器、AI 回复在中文模式下**保持原样未被翻译**

## 7. 风险

| 风险                                              | 应对                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 语料仓库无 LICENSE                                | 已知并接受；README 署名致谢 `tttnny` 与上游 issue #202 作者 `a1072970354-code`       |
| 改动面覆盖几乎全部组件，与上游 rebase 冲突剧烈    | 严格分期、每期独立可合并；词条集中存放，组件内改动仅为「字面量 → `m.x.y`」的机械替换 |
| Windows 上 `bun fmt` 重写全仓库行尾，掩盖真实改动 | 一律以 `git diff --stat` 判断真实改动面                                              |
| 中文文案长度与英文不同，可能撑破固定宽度布局      | 每期完成后对该期界面做一次中文态视觉走查                                             |
| 漏译在运行时静默回退                              | 由 3.1 的类型标注在编译期拦截；再加验收标准 4 的运行时结构校验兜底                   |
