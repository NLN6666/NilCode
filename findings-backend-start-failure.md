---
name: findings-backend-start-failure
description: Synara 后端连续启动失败「Service not found: ServerSettingsService」排查记录
created: 2026-08-07T14:23:10Z
updated: 2026-08-07T14:23:10Z
---

# Findings

## 2026-08-07 后端连续 5 次启动失败：Service not found: ServerSettingsService

### 现象

桌面版弹窗「Synara's backend failed to start 5 times in a row.」，`server-child.log` 每次启动都是同一条：

```
ERROR (#62): Error: Service not found: synara/serverSettings/ServerSettingsService
```

100% 必现。日志时间线固定为：migrations → projection pipeline bootstrapped →
orchestration engine started → `shutdown.runtimeEvents.*` → ERROR → 退出码 1。
没有 `Synara running`，说明失败发生在 Layer 构建阶段，后面的 shutdown 日志是已构建
layer 的回滚，不是正常关停。

### 根因

`apps/server/src/serverLayers.ts` 里 `advisorReactorLayer` 没有拿到 `ServerSettingsLive`：

```ts
const advisorReactorLayer = AdvisorReactorLive.pipe(
  Layer.provideMerge(AdvisorSessionLive.pipe(Layer.provideMerge(runtimeServicesLayer))),
  Layer.provideMerge(OrchestrationLayerLive),
  // ← 缺 ServerSettingsLive
);
```

`AdvisorReactor.make` 里 `yield* ServerSettingsService`（读每线程 advisor 开关）。
`ServerSettingsLive` 只作为 `Layer.mergeAll(...)` 的同级项存在，
**`mergeAll` 的同级 layer 在运行时不会互相供给依赖**，于是构建 advisor 时找不到该服务。

同文件里 `providerCommandReactorLayer`、`automationServiceLayer`、`agentGatewayLayer`
都显式 `Layer.provideMerge(ServerSettingsLive)`，只有新加的 advisor 漏了。

### 为什么 typecheck 没拦住（重要，会再犯）

`bun typecheck` 全绿。类型层本身是能保留未满足依赖的（最小实验验证过：
`Layer.mergeAll(SettingsLive, ReactorLive)` 的 `R` 里确实保留了 `Settings`）。
放行是被 `main.ts` 的组装链闭环掩盖的：

```ts
Layer.empty.pipe(
  Layer.provideMerge(runtimeServicesLayer),        // RIn 含 ServerSettingsService
  Layer.provideMerge(providerLayer),
  Layer.provideMerge(providerSessionReaperLayer),  // 它 provideMerge 了 runtimeServicesLayer，
  ...                                             // ROut 因此含 ServerSettingsService
)
```

`providerSessionReaperLayer` 的 ROut 里带着 `runtimeServicesLayer` 的全部输出，
类型上刚好"消解"掉前面遗留的 `ServerSettingsService`；运行时这是个循环——
构建 `runtimeServicesLayer` 时外层 context 里并没有它。
**结论：这类缺失在本仓库的 layer 组装下类型检查抓不到，只有真实启动能暴露。**

### 复现与验证手法（可复用）

- 最小实验隔离 `mergeAll` 语义（几行代码，比读 Effect 源码快）：
  一个 `Layer.effect` 依赖某服务，同级放它的 Live layer，`mergeAll` 后运行 → 必现 Service not found。
- 验证修复只能靠真实启动。Windows 上用 `node apps/server/dist/index.mjs`
  （`bun run src/index.ts` 会因 PTY 报错退出），先 `bun run --cwd apps/server build`。
  判据：出现 `Synara running` 且进程不退出。
- `apps/server` 的包名是 `@synara/cli`，turbo 输出里找 `@synara/cli:typecheck`，
  别以为 server 没跑类型检查。

### 已加的防护

`apps/server/integration/serverLayers.integration.test.ts` 真实构建启动用的整张 layer 图。
为了复用真实链条而不是复制一份组装代码：`main.ts` 导出了 `LayerLive` 与 `CliRuntimeLayer`
（后者从 `index.ts` 提取，入口改为导入它），测试按入口同样的两段式组合 provide。

验红过：撤掉 `provideMerge(ServerSettingsLive)` 后，该测试精确复现
`Service not found: synara/serverSettings/ServerSettingsService`。

跑法：`bunx vitest run --config apps/server/vitest.config.ts apps/server/integration/serverLayers.integration.test.ts`
（约 7s，其中真实构建 ~350ms，会在临时目录建一次 SQLite 并跑全部 migration）。

### 另一个坑

`index.ts` 里 `program as Effect.Effect<void, unknown, never>` 会吃掉残留的 R。
所以这条链上的类型安全本来就是断的，别指望 typecheck 兜底 layer 组装。
