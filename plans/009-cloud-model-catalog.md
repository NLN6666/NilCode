# Plan 009 — 从云端目录加载模型列表，取代硬编码表

Status: IMPLEMENTED — 实测通过（codex 27 / claudeAgent 15 / grok 4，含 `gpt-5.6-sol`）。`bun fmt` / `bun lint`（0 error）/ `bun typecheck` 全绿。
Priority: P1
Effort: M
Depends on: —
Executor: 服务端抓取/投影/缓存与 capability 兜底规格完整，可交 gpt-5.6-sol；Web 侧合并层改动小但影响模型选择器，需人工过目。动手前请完整阅读本计划。

## 目标

模型清单从云端目录加载，而不是写死在 `packages/contracts/src/model.ts` 的 `MODEL_OPTIONS_BY_PROVIDER` 里。新模型发布后用户无需等 Synara 发版即可选用。

实测差距（2026-07-25，models.dev）：

| provider      | 硬编码表                      | 云端多出来的                                                                               |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `codex`       | 7 个（`gpt-5.5` … `gpt-5.2`） | `gpt-5.6-sol`、`gpt-5.6`、`gpt-5.6-luna`、`gpt-5.6-terra`、`gpt-5.5-pro`、`gpt-5.4-pro` 等 |
| `claudeAgent` | 8 个                          | `claude-opus-5`、`claude-sonnet-4-5`、`claude-opus-4-1` 等                                 |
| `grok`        | 2 个                          | `grok-4.5`、`grok-4.3`、`grok-4.20-*`                                                      |

`gpt-5.6-sol` 是 `CLAUDE.md` 指定的批量作业模型，却不在硬编码表里——这就是本计划要解决的问题的具体形态。

## 已锁定的决策

1. **数据源 = models.dev**（`https://models.dev/api.json`，无需鉴权）。
2. **拉不到时静默回落到硬编码表**，不在 UI 报错。

### 为什么不是官方接口（已实测排除）

操作者最初倾向"官方拉"，实测后放弃：

| 端点                       | 实测结果                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anthropic `GET /v1/models` | 用 Claude Code 的订阅 OAuth token 三种鉴权头（`Bearer` / `Bearer`+beta / `x-api-key`）**全部 403 `Request not allowed`**。该端点只认 console API key，订阅用户没有 |
| OpenAI `GET /v1/models`    | `~/.codex/auth.json` 里 `OPENAI_API_KEY` 为空，只有 OAuth token；且响应仅 `{id, created, owned_by}`，无 capabilities / 上下文窗口，还混入 embedding/TTS/image 模型 |
| xAI                        | 官方 API reference 未公开 model-list 端点                                                                                                                          |

结论：官方接口只对**持有控制台 API key** 的用户可用，而 Synara 的用户是 CLI 订阅用户。走官方等于功能对绝大多数人恒为休眠。

models.dev 反而给得更多——它带 `limit.context` 和 `reasoning_options[].values`，正好对得上 Synara 的 `contextWindowTokens` 与 `reasoningEffortLevels`。

## 云端目录的真实结构（实测）

`https://models.dev/api.json`，3.2 MB，172 个 provider。形状为 `Record<providerId, { id, name, env, doc, models: Record<modelId, Model> }>`。

单个模型（`anthropic.models["claude-sonnet-4-6"]`）：

```json
{
  "id": "claude-sonnet-4-6",
  "name": "Claude Sonnet 4.6",
  "description": "...",
  "reasoning": true,
  "reasoning_options": [{ "type": "effort", "values": ["low", "medium", "high", "max"] }],
  "tool_call": true,
  "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] },
  "limit": { "context": 1000000, "output": 128000 },
  "cost": { "input": 3, "output": 15 }
}
```

### provider 映射

只映射 slug 命名空间一致、且云端目录确有增量的三家：

| Synara `ProviderKind` | models.dev id |
| --------------------- | ------------- |
| `codex`               | `openai`      |
| `claudeAgent`         | `anthropic`   |
| `grok`                | `xai`         |

其余 provider（`cursor` / `droid` / `kilo` / `opencode` / `pi` / `antigravity`）**不映射**：它们是路由型/聚合型运行时，其模型集由各自 CLI 的 runtime discovery 给出，比通用目录准确。强行映射会引入 CLI 实际不支持的 slug——用户选了却起不了会话，比缺模型更糟。

### 必须的噪音过滤

`xai` 下混有 `grok-imagine-video`、`grok-imagine-image` 等非文本模型。过滤规则：

- `modalities.output` 必须含 `"text"`
- `tool_call === true`（编码代理必须能调工具）
- `reasoning === true`

第三条是实测后补的：仅前两条时 `openai` 会带进 `gpt-4` / `gpt-4o` / `gpt-4.1` 整族（Codex CLI 跑不了），而这一族在目录里恰好全是 `reasoning: false`，gpt-5.x 与 o 系全是 `true`，Anthropic 15 个全是 `true`。加上后 codex 从 38 降到 27，Anthropic 无损。

过滤不可能精确——只有 CLI 知道自己收什么，所以 runtime discovery 在任何它作答的地方都压过这份清单。

## 架构

### A. 契约层 —— `packages/contracts`

新增 `CloudModelDescriptor`（`slug` / `name` / `description?` / `contextWindowTokens?` / `reasoningEffortValues?`）与 WS 方法 `provider.listCloudModels`。

### B. 服务端 —— `apps/server/src/provider/cloudModelCatalog.ts`（新建）

抓取 → 过滤 → 投影 → 缓存。

- 走 `@synara/shared/outboundHttp` 的 `outboundHttp.request`（仓库既定的出站通道：origin 白名单、pin 解析地址、拒绝私网、大小上限）。**注意 `providerUsage/http.ts` 的 `fetchJson` 把 `maxResponseBytes` 写死 1 MB，装不下 3.2 MB，本模块须用自己的策略（8 MB）而不是复用 `fetchJson`。**
- 内存缓存 + TTL（6 小时）。抓取失败时继续吐上一次的成功结果（stale-while-error）。
- **永不抛出**：任何失败都返回空目录，由调用方回落到硬编码表。这是决策 2 的落点。

### C. capability 兜底 —— 起草时误判，实施中撤回

起草时的判断是：`getModelCapabilities` 对未知 slug 返回 `EMPTY_MODEL_CAPABILITIES`，云端拉来的 `gpt-5.6-sol` 会「没有 effort 选项」，因此需要 per-provider 兜底模板。

**这个判断是错的**，写完兜底后被既有测试推翻（`composerProviderRegistry.test.tsx`「preserves a stored runtime Codex effort for dispatch before discovery resolves」）。真实设计是刻意的两分：

- **已知模型** → 按其阶梯校验 effort，不支持的拒绝
- **未知模型** → 空阶梯即「不校验」，放行已存储的 effort

第二条是为运行时发现留的口子——`CodexReasoningEffort` 在契约里就是 `string`，注释写明「Codex app-server can add model-specific efforts through runtime discovery」。

而且兜底会给出**错误**的阶梯：`gpt-5.6-sol` 实际支持 `none/low/medium/high/xhigh/max`（云端目录自报），`gpt-5.5` 模板只有 `low/medium/high/xhigh`——兜底反而会否掉该模型真正支持的 `none` 与 `max`。

结论：撤回，`getModelCapabilities` 保持原状（含 `grok` 既有的 provider 级兜底）。未知模型可正常选中并以 provider 默认 effort 运行，等 runtime discovery 描述它时补齐真实阶梯。契约里保留的 `reasoningEffortValues` 目前不参与能力解析，留作后续把云端阶梯接入 `runtimeModelCapabilities` 桥接层的输入。

### D. Web 合并层 —— `useProviderModelCatalog`

云端条目形状与 `mergeDynamicModelOptions` 的 `dynamicModels` 入参一致，直接并入同一条合并管线，不新增合并逻辑。

优先级：**runtime discovery > 云端目录 > 硬编码表**。runtime 反映的是本机 CLI 真实支持的集合，最权威。

## 范围边界

- 不删除 `MODEL_OPTIONS_BY_PROVIDER`。它是离线基线，也是 `ModelSlug` 字面量类型的来源。
- 不动 `customModels`（用户自填 slug）。
- 不做磁盘缓存（操作者选的是"静默回落"，内存缓存 + 硬编码基线已足够；磁盘缓存留待有实际冷启动诉求时再加）。
- 不做 UI 提示角标。

## 验证

- `cd apps/server && bun run test src/provider/cloudModelCatalog.test.ts`
- `cd packages/shared && bun run test src/model.test.ts src/outboundHttp.test.ts`
- `cd apps/web && bun run test src/providerModelOptions.test.ts src/hooks/useProviderModelCatalog.test.tsx`
- 端到端：启动后模型选择器中 `codex` 下应出现 `gpt-5.6-sol`；断网重启后应仍显示硬编码的 7 个，无报错。

## 实施中发现的阻塞缺陷（已修）

`packages/shared/src/outboundHttp.ts` 的地址 pin 回调在 **Node 24 上让全部出站 HTTP 失效**，与本功能无关但挡住了它。

Node 以 `{ hints: 0, all: true }` 调用自定义 `lookup`，该形态要求回调**回数组**；原代码回的是 `(address, family)`，socket 于是把 `undefined` 当主机名，在发出任何字节前抛 `ERR_INVALID_IP_ADDRESS`。models.dev 走 Cloudflare、DNS 首个结果是 IPv6，因此必然命中。

影响面不止本功能：`providerUsage` 的 Claude / Codex / Cursor 用量拉取走同一条通道，同样是坏的。

修法是按 `options.all` 分派回调形态，并把这段整形逻辑提为具名的 `createPinnedLookup` 以便直接回归测试（`packages/shared/src/outboundHttp.test.ts`，4 项）。

## 已考虑并否决

- **用官方 provider API**：实测 403 / 无 key / 无端点，见上表。
- **把 capabilities 也从云端读**：通用目录不含 CLI 私有的 effort 概念，读了会覆盖掉正确的本地定义。
- **映射全部 9 个 provider**：聚合型 provider 会被塞进 CLI 起不了会话的 slug。
- **复用 `providerUsage/http.ts` 的 `fetchJson`**：其 1 MB 上限装不下 3.2 MB 目录。
- **删掉硬编码表**：离线不可用，且 `ModelSlug` 类型会塌成 `string`。
- **给未知模型配兜底 capability 模板**：见上文 C 段，写完被既有测试推翻并撤回。
- **改成"runtime 有结果就不显示云端条目"**：那样在 CLI 正常应答时（多数情况）本功能等于隐形，与"从云端加载模型列表"的诉求相悖。当前取并集，代价是可能列出 CLI 不支持的 slug——与仓库已允许的 `customModels` 自填 slug 属同一类可恢复错误。
