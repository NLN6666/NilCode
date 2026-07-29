---
name: outbound-proxy
status: approved
created: 2026-07-29T09:00:43Z
updated: 2026-07-29T09:00:43Z
---

# 出站 HTTP 代理支持 —— 设计文档

## 1. 目标

让 NilCode 服务端自身发出的 HTTP 请求能经用户配置的本地代理（Clash / v2ray / Surge 一类）到达目标 endpoint，从而在直连受阻的网络环境下，**用量与限额**面板等功能仍能正常取数。

代理的**网络实现**收口在 `packages/shared/src/outboundHttp.ts` 一个模块（配置 schema 与设置界面另有改动，见第 5、8 节）。它是全仓唯一的出站 HTTP 权威层，现有消费者：

| 消费者                                | 文件                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| 用量与限额（Claude / Codex / Cursor） | `apps/server/src/providerUsage/http.ts`                                           |
| 云端模型目录                          | `apps/server/src/provider/cloudModelCatalog.ts`                                   |
| Grok adapter                          | `apps/server/src/provider/Layers/GrokAdapter.ts`                                  |
| 站点 favicon 缓存                     | `apps/server/src/siteFaviconCache.ts`                                             |
| 语音转写                              | `apps/server/src/voiceTranscription.ts`、`apps/desktop/src/voiceTranscription.ts` |

在该层加代理，上述全部功能一次性获得代理能力。

## 2. 非目标

明确排除，不在本次范围内：

- **provider CLI 子进程的代理注入**。codex / claude / cursor 等 CLI 是独立子进程，自己发模型请求，只能通过 `buildProviderChildEnvironment` 注入 `HTTPS_PROXY` 环境变量生效。那是与 `outboundHttp` 完全无关的第二条出站路径，另案处理。
- **SOCKS5**。只做 HTTP/HTTPS 代理。Clash 的 mixed 端口（默认 7890）同时接受 HTTP 和 SOCKS5，填 mixed 端口即可覆盖。
- **代理认证**（`Proxy-Authorization`）。目标场景是本机无认证代理。
- **PAC 自动配置**。

## 3. 架构：配置如何送进 `outboundHttp`

`outboundHttp.ts` 结尾是 `export const outboundHttp = new OutboundHttpClient()` —— 模块级单例，无依赖注入；而代理配置活在服务端的 `ServerSettingsService`（Effect service）与 `process.env` 中。

**采用方案：注册 resolver。**

```ts
// packages/shared/src/outboundHttp.ts
export type OutboundProxyResolver = () => OutboundProxyConfig | undefined;
export function setOutboundProxyResolver(resolver: OutboundProxyResolver | undefined): void;
```

默认 resolver 为空（返回 `undefined`），此时全部行为与现状逐字节一致。服务端启动时注册一个读 `ServerSettings` + `env` 的 resolver；`request()` 每次调用时现读，因此设置面板改完立即生效，无需重启。

### 3.1 为何不选另外两条路

- **policy 字段透传**（`OutboundHttpPolicy` 加 `proxy?`，各调用点自己传）：无全局状态，但配置读取逻辑扩散到 6 处；且 `apps/desktop/src/voiceTranscription.ts` 拿不到 `ServerSettings`，必然分裂成两套配置来源。
- **工厂函数**（`createOutboundHttpClient({proxy})`）：干净，但旧单例仍被广泛引用，形成双轨制——"新代码走代理、漏改的旧代码静默直连"正是最危险的失败模式。

选 resolver 的理由不止改动小：`outboundHttp` 的定位本就是**进程级**出站网络策略权威（origin 白名单、DNS 钉死、并发闸门都是进程级），代理同属进程级网络策略，放在同一层是概念对齐；另两个方案都把进程级策略降格成了调用点参数。

代价是模块级可变状态，测试需在 `afterEach` 复位 resolver。

## 4. CONNECT 隧道与安全模型

### 4.1 请求路径

`requestHop` 按有无代理分叉。无代理时路径完全不变。有代理时：

```
resolvePinnedAddress(proxyUrl, ...)        ← 钉住的是代理地址，不是目标地址
  ↓
http.request({ method: 'CONNECT',
               path: 'api.anthropic.com:443',
               lookup: pinnedProxyLookup })
  ↓ 'connect' 事件拿到裸 socket
tls.connect({ socket, servername: 'api.anthropic.com' })   ← 仅 https: 目标需要
  ↓
https.request({ createConnection: () => tlsSocket, agent: false })
```

目标为 `http:` 时省去 `tls.connect`，直接 `http.request({ createConnection: () => socket, agent: false })`；隧道建立方式相同。

`http:` 与 `https:` 目标**统一走 CONNECT**，不使用绝对 URI 形式。分支最少，且 Clash / v2ray / Surge 均支持对非 443 端口 CONNECT。（标准 squid 默认只对 443 放行 CONNECT，但本设计的目标场景是本机代理软件，不受此限。）

### 4.2 安全后果（不可逆，需明确记录）

走代理时，**目标 host 的 `requirePublicAddress` 检查失效**。原因是域名由代理解析，本地根本不做解析；本地再解析一次去校验，其结果与代理实际连接的地址无关，属于安全剧场（security theater），因此不做。

剩余防线依然是硬的：`assertOutboundUrlAllowed` 的 **origin 白名单逐条把关**（例如 Claude 的 fetcher 只允许 `api.anthropic.com`，白名单写死在调用点）。代理能被指使连接的目的地，仍然只有白名单内的那几个 origin，SSRF 面保持封闭。

代码与文档中必须写明这一点，避免后续维护者误以为代理路径下 IP 层防护仍然生效。

### 4.3 代理地址自身的门槛

代理地址不沿用 `requirePublicAddress`，而是单独校验：**仅放行回环地址（127.0.0.0/8、::1）或公网地址**，其余私网段（10.x、172.16-31.x、192.168.x、链路本地等）一律拒绝。

这比笼统地"关掉私网检查"窄得多，与"本机代理软件"的实际场景精确匹配；将来若需支持局域网代理，再显式放宽。

### 4.4 新增错误码

`OutboundHttpErrorCode` 增加 `"proxy"`，与既有 `"request"` 区分，使调用方能判别"代理不可用"与"目标不可达"。

## 5. 配置来源与优先级

`ServerSettings`（`packages/contracts/src/settings.ts`）新增一节：

```ts
network: {
  proxy: {
    mode: "off" | "env" | "manual",   // 默认 "env"
    url: string,                       // mode === "manual" 时生效，例：http://127.0.0.1:7890
    noProxy: string,                   // 逗号分隔
  }
}
```

三态语义：

- **`env`（默认）** —— 读取 `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` / `ALL_PROXY` / `all_proxy` / `NO_PROXY` / `no_proxy`。命令行启动的用户零配置即可用。同名大小写变体同时存在时，小写优先（遵循 curl 等工具的惯例）。
- **`manual`** —— 使用面板中填写的 `url` 与 `noProxy`，**忽略环境变量**。这是桌面版从开始菜单 / Dock 启动、继承不到 shell 环境变量时的解法。
- **`off`** —— 强制直连，即使环境变量中存在代理。

采用三态而非"空字符串代表关闭"，是为了让 `off` 与"未配置"可区分：否则 shell 中已设 `HTTPS_PROXY` 的用户无法让 NilCode 不走代理。

### 5.1 新增纯函数模块

`packages/shared/src/outboundProxy.ts`，全部为纯函数，无 I/O：

- `parseProxyUrl(raw: string)` —— 校验 scheme 必须为 `http:`，拒绝路径、query、fragment 与内嵌凭据；端口缺省按 80 处理。
- `parseNoProxy(raw: string): readonly string[]`
- `shouldBypassProxy(targetUrl: URL, noProxy: readonly string[]): boolean` —— 支持 `example.com`、`.example.com`（含子域）、`*`（全部绕过）、以及 `host:port` 形式。
- `resolveProxyFromEnv(env: NodeJS.ProcessEnv)` —— 按 5 节的优先级从环境变量解析。

## 6. 失败行为：fail-closed

代理连接失败、CONNECT 返回非 2xx、隧道中途断开 —— 一律抛 `OutboundHttpError("proxy", ...)`，**绝不回退直连**。

理由：静默回退会造成两个后果——在受阻网络下多等一个完整超时才失败；以及用户无法分辨请求究竟走没走代理。二者都违背项目的可预测性原则。

`apps/server/src/providerUsage` 侧将该错误映射为可展示的失败态，使用量面板显示"代理不可用"及原因，而不是空白或误报为"未登录"。

## 7. 测试

- **`packages/shared/src/outboundProxy.test.ts`** —— 纯函数全覆盖：URL 校验（含各类非法输入）、`NO_PROXY` 匹配（含子域与通配）、环境变量优先级、三态切换。
- **`packages/shared/src/outboundHttp.test.ts`（扩展）** —— 用 `net.createServer` 起一个假 HTTP 代理，验证：
  - CONNECT 隧道建立并成功取回响应；
  - 代理拒绝 / 不可达时 fail-closed，错误码为 `"proxy"`；
  - `NO_PROXY` 命中时绕过代理直连；
  - 代理地址被 DNS 钉死；
  - 私网（非回环）代理地址被拒绝；
  - **目标 origin 白名单在代理路径下仍然生效**。
- **回归** —— resolver 未注册时，现有全部测试与行为不变。

## 8. UI

设置面板新增"网络"一节：模式三选 + 代理 URL 输入 + `NO_PROXY` 输入。`manual` 之外的模式下后两项禁用。

i18n 需同时提供 `en` 与 `zh-CN` 文案。

## 9. 验收标准

1. 在 `mode: "manual"`、`url: http://127.0.0.1:7890`、Clash 运行的前提下，用量与限额面板能取到 Claude / Codex / Cursor 的实时数据。
2. 关闭 Clash 后，面板显示明确的"代理不可用"错误，且**不**发生直连回退。
3. `mode: "off"` 时，即使 shell 中存在 `HTTPS_PROXY`，请求也直连。
4. 未配置代理时（resolver 未注册或返回 `undefined`），既有行为与测试全部不变。
5. `bun fmt`、`bun lint`、`bun typecheck` 全部通过。
