# Agent 后台守护进程会话 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实施。步骤用 `- [ ]` 复选框跟踪。

**目标：** 让 Agent 能以稳定名字启动、监管、读取、驱动长期运行的服务器进程（Minecraft 服务端、dev server 等），进程可在 Synara 退出后继续存活。

**架构：** 新增 `apps/server/src/daemon/` 守护进程监管子系统，移植自 [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi)（MIT）的 `hub` 工具与 `DaemonBroker`。核心是 `DaemonBroker`（记录表 + 状态机 + 就绪探针 + 重启退避 + detached 认领）与 `DaemonLog`（文件落盘 + 轮转 + 字节游标）。工具层照本仓库惯例拆成 8 个独立 `synara_*` 工具。

**技术栈：** TypeScript、Effect（Schema / ServiceMap / Layer）、node-pty、node:child_process、Vitest。

**设计文档：** `docs/superpowers/specs/2026-08-07-agent-background-server-sessions-design.md`
**踩坑记录：** `findings.md`
**致谢：** `THIRD-PARTY-NOTICES.md`

## 全局约束

- 完工前 `bun fmt`、`bun lint`、`bun typecheck` 必须全过；合并成**一次**最终验证。
- 绝不用 `bun test`，一律 `bun run test`（Vitest）。Windows 上跑单包测试绕开 turbo 直接调 vitest。
- `packages/contracts` **只放 schema，不放运行时逻辑**。
- `packages/shared` 用显式 subpath 导出，新模块须在 `packages/shared/package.json` 的 `exports` 登记。
- 每个移植自 oh-my-pi 的模块，**文件头须标注来源**（见 Task 3 的示例头注释）。
- 阻塞类工具超时上限复用 `SYNARA_GATEWAY_MAX_WAIT_MS = 60_000`。
- **spawn detached 进程全平台用 `detached: true`**，Windows 上加 `windowsHide: true`。**不要**照抄 oh-my-pi 的 `detached: false`——实测在 Node 上会让子进程随父进程死（findings.md 第 1 条）。
- 正则（`ready.log` / `wait.pattern` / `logs.grep`）只对**有界缓冲区**匹配，绝不放进无界流式热路径。
- 测试里凡是起了 `detached: true` 的真实进程，**必须在 afterEach 显式 kill**，否则留孤儿进程。

## 已完成（可直接复用）

| 提交 | 内容 |
|---|---|
| `c6ea542f` | `packages/shared/src/backgroundServiceSession.ts` —— 字节游标切片 + UTF-8 边界对齐。**与 oh-my-pi 的 `cursor = outputBytes` 语义一致，直接复用** |
| `5e4c3d99` | `packages/shared/src/backgroundServiceMatch.ts` —— 跨块子串匹配、回显剥离、控制字符。Task 2 会在其上扩展按键表 |

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/contracts/src/daemon.ts` | 新建。`DaemonSpec` / `DaemonSnapshot` / `DaemonState` / `DaemonReadySpec` / `DaemonRestartPolicy` schema |
| `packages/shared/src/daemonKeys.ts` | 新建。终端按键名 → 转义序列、信号名白名单 |
| `packages/shared/src/daemonRestart.ts` | 新建。指数退避时长计算（纯函数） |
| `apps/server/src/daemon/DaemonLog.ts` | 新建。日志文件落盘、轮转、按游标读取 |
| `apps/server/src/daemon/readiness.ts` | 新建。就绪探针（log 正则 / port 连接 / readyPending 计算） |
| `apps/server/src/daemon/spawnOptions.ts` | 新建。跨平台 spawn 选项（detached 的唯一权威处） |
| `apps/server/src/daemon/Services/Broker.ts` | 新建。`DaemonBrokerShape` 接口 + ServiceMap tag |
| `apps/server/src/daemon/Layers/Broker.ts` | 新建。broker 实现：记录表、launch、settle、waitUntil、refreshDetached |
| `apps/server/src/agentGateway/daemonTools.ts` | 新建。8 个工具 |
| `apps/server/src/agentGateway/Services/AgentGatewaySessionRegistry.ts` | 改。加 `daemon:control` |

拆分理由：`spawnOptions.ts` 单独成文件，是因为 findings.md 第 1 条那个静默 bug 的唯一防线就是"detached 选项只有一处定义、且有测试盯着"。`DaemonLog` 与 `readiness` 独立是因为两者都能脱离进程完整测试。

---

## Task 1: 守护进程契约 schema

**Files:**
- Create: `packages/contracts/src/daemon.ts`
- Test: `packages/contracts/src/daemon.test.ts`
- Modify: `packages/contracts/src/index.ts`（照既有方式 re-export）

**Interfaces:**
- Produces: `DaemonState`、`DaemonRestartPolicy`、`DaemonReadySpec`、`DaemonSpec`、`DaemonSnapshot`、`DAEMON_NAME_MAX_LENGTH = 48`、`DAEMON_LOGS_DEFAULT_LINES = 100`、`DAEMON_LOGS_MAX_LINES = 1000`

- [ ] **Step 1: 写失败测试**

```ts
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DaemonSpec, DaemonSnapshot, DAEMON_NAME_MAX_LENGTH } from "./daemon";

describe("DaemonSpec", () => {
  it("decodes a minimal spec and applies defaults", () => {
    const spec = Schema.decodeUnknownSync(DaemonSpec)({
      name: "minecraft",
      application: "java",
    });
    expect(spec.args).toEqual([]);
    expect(spec.pty).toBe(true);
    expect(spec.restart).toBe("no");
    expect(spec.persist).toBe(false);
    expect(spec.detached).toBe(false);
  });

  it("rejects a name longer than the cap", () => {
    expect(() =>
      Schema.decodeUnknownSync(DaemonSpec)({
        name: "x".repeat(DAEMON_NAME_MAX_LENGTH + 1),
        application: "java",
      }),
    ).toThrow();
  });

  it("rejects a name with path separators", () => {
    // name doubles as an on-disk directory name.
    expect(() =>
      Schema.decodeUnknownSync(DaemonSpec)({ name: "../escape", application: "java" }),
    ).toThrow();
  });

  it("accepts a readiness spec with both log and port", () => {
    const spec = Schema.decodeUnknownSync(DaemonSpec)({
      name: "minecraft",
      application: "java",
      ready: { log: "Done \\(", port: 25565, timeout: 120 },
    });
    expect(spec.ready?.log).toBe("Done \\(");
    expect(spec.ready?.port).toBe(25565);
  });

  it("rejects an unknown restart policy", () => {
    expect(() =>
      Schema.decodeUnknownSync(DaemonSpec)({
        name: "a",
        application: "java",
        restart: "sometimes",
      }),
    ).toThrow();
  });
});

describe("DaemonSnapshot", () => {
  it("round-trips a running snapshot", () => {
    const snapshot = Schema.decodeUnknownSync(DaemonSnapshot)({
      name: "minecraft",
      id: "d1",
      state: "running",
      pid: 4242,
      createdAt: "2026-08-07T10:00:00Z",
      startedAt: "2026-08-07T10:00:01Z",
      readyAt: "2026-08-07T10:00:30Z",
      exitedAt: null,
      exitCode: null,
      exitReason: null,
      restartCount: 0,
      outputBytes: 1024,
      readyPending: [],
    });
    expect(snapshot.state).toBe("running");
    expect(snapshot.outputBytes).toBe(1024);
  });

  it("rejects an unknown state", () => {
    expect(() =>
      Schema.decodeUnknownSync(DaemonSnapshot)({ name: "a", id: "d1", state: "zombie" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/contracts && npx vitest run src/daemon.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 schema**

照 `packages/contracts/src/launchConfig.ts` 的风格（`Schema.Struct`、`Schema.optional`、`Schema.withDecodingDefault`、`TrimmedNonEmptyString`、`LocalServerPort`）。要点：

- `DaemonState = Schema.Literals(["starting","ready","running","exited","failed","restarting"])`
- `DaemonRestartPolicy = Schema.Literals(["no","on-failure","always"])`
- `name` 除长度上限外，须 `Schema.check` 拒绝 `/[\\/]|\.\./`——它是磁盘目录名，路径穿越必须在 schema 层挡掉
- 默认值全部用 `Schema.withDecodingDefault`：`args: []`、`pty: true`、`restart: "no"`、`persist: false`、`detached: false`
- `DaemonReadySpec = Schema.Struct({ log: optional(String), port: optional(LocalServerPort), host: optional(String), timeout: optional(Int) })`

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/contracts && npx vitest run src/daemon.test.ts`
Expected: PASS，7 个用例

- [ ] **Step 5: 提交**

```bash
git add packages/contracts/src/daemon.ts packages/contracts/src/daemon.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add daemon spec and snapshot schemas"
```

---

## Task 2: 按键表、信号白名单、重启退避

**Files:**
- Create: `packages/shared/src/daemonKeys.ts`
- Create: `packages/shared/src/daemonRestart.ts`
- Test: `packages/shared/src/daemonKeys.test.ts`、`packages/shared/src/daemonRestart.test.ts`
- Modify: `packages/shared/package.json`

**Interfaces:**
- Produces:
  - `resolveTerminalKey(name: string): string | null` —— `"CTRL_C"` → `"\x03"`，未知名返回 `null`
  - `TERMINAL_KEY_NAMES: readonly string[]` —— 供工具 schema 生成 enum
  - `isAllowedSignal(name: string): name is AllowedSignal`
  - `restartDelayMs(consecutiveFailures: number): number`
  - `RESTART_BASE_DELAY_MS = 500`、`RESTART_MAX_DELAY_MS = 30_000`

- [ ] **Step 1: 写失败测试**

```ts
// daemonKeys.test.ts
import { describe, expect, it } from "vitest";
import { isAllowedSignal, resolveTerminalKey, TERMINAL_KEY_NAMES } from "./daemonKeys";

describe("resolveTerminalKey", () => {
  it("maps control keys to their bytes", () => {
    expect(resolveTerminalKey("CTRL_C")).toBe("\x03");
    expect(resolveTerminalKey("CTRL_D")).toBe("\x04");
    expect(resolveTerminalKey("ENTER")).toBe("\r");
    expect(resolveTerminalKey("TAB")).toBe("\t");
    expect(resolveTerminalKey("ESC")).toBe("\x1b");
  });

  it("maps arrow keys to CSI sequences", () => {
    expect(resolveTerminalKey("UP")).toBe("\x1b[A");
    expect(resolveTerminalKey("DOWN")).toBe("\x1b[B");
  });

  it("is case insensitive", () => {
    expect(resolveTerminalKey("ctrl_c")).toBe("\x03");
  });

  it("returns null for an unknown key rather than passing it through", () => {
    // Passing unknown names through would let the model inject arbitrary bytes
    // under the guise of a key name.
    expect(resolveTerminalKey("CTRL_ALT_DEL")).toBeNull();
    expect(resolveTerminalKey("rm -rf /")).toBeNull();
  });

  it("exposes every mapped name for schema generation", () => {
    for (const name of TERMINAL_KEY_NAMES) expect(resolveTerminalKey(name)).not.toBeNull();
  });
});

describe("isAllowedSignal", () => {
  it("allows the graceful and forceful termination signals", () => {
    expect(isAllowedSignal("SIGINT")).toBe(true);
    expect(isAllowedSignal("SIGTERM")).toBe(true);
    expect(isAllowedSignal("SIGKILL")).toBe(true);
  });

  it("rejects anything outside the whitelist", () => {
    expect(isAllowedSignal("SIGSTOP")).toBe(false);
    expect(isAllowedSignal("not-a-signal")).toBe(false);
  });
});
```

```ts
// daemonRestart.test.ts
import { describe, expect, it } from "vitest";
import { restartDelayMs, RESTART_BASE_DELAY_MS, RESTART_MAX_DELAY_MS } from "./daemonRestart";

describe("restartDelayMs", () => {
  it("uses the base delay for the first failure", () => {
    expect(restartDelayMs(1)).toBe(RESTART_BASE_DELAY_MS);
  });

  it("doubles with each consecutive failure", () => {
    expect(restartDelayMs(2)).toBe(RESTART_BASE_DELAY_MS * 2);
    expect(restartDelayMs(3)).toBe(RESTART_BASE_DELAY_MS * 4);
  });

  it("saturates at the ceiling instead of overflowing", () => {
    expect(restartDelayMs(100)).toBe(RESTART_MAX_DELAY_MS);
    expect(Number.isFinite(restartDelayMs(1000))).toBe(true);
  });

  it("treats zero or negative counts as the base delay", () => {
    expect(restartDelayMs(0)).toBe(RESTART_BASE_DELAY_MS);
    expect(restartDelayMs(-5)).toBe(RESTART_BASE_DELAY_MS);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && npx vitest run src/daemonKeys.test.ts src/daemonRestart.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

`daemonKeys.ts` 用一张 `Record<string, string>` 常量表 + 大写归一化查表；未命中返回 `null`（**绝不透传**，否则模型可借按键名注入任意字节）。信号白名单只放 `SIGINT` / `SIGTERM` / `SIGKILL` / `SIGHUP`。

`daemonRestart.ts`：

```ts
export const RESTART_BASE_DELAY_MS = 500;
export const RESTART_MAX_DELAY_MS = 30_000;

/**
 * Exponential backoff for consecutive daemon failures.
 *
 * Exponent is clamped before the shift so a long-running crash loop cannot
 * overflow into Infinity and arm a timer that never fires.
 */
export function restartDelayMs(consecutiveFailures: number): number {
  const failures = Math.max(1, Math.floor(consecutiveFailures));
  const exponent = Math.min(failures - 1, 20);
  return Math.min(RESTART_BASE_DELAY_MS * 2 ** exponent, RESTART_MAX_DELAY_MS);
}
```

两个模块都要在 `packages/shared/package.json` 的 `exports` 登记。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/shared && npx vitest run src/daemonKeys.test.ts src/daemonRestart.test.ts`
Expected: PASS，11 个用例

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/daemonKeys.ts packages/shared/src/daemonRestart.ts packages/shared/src/daemonKeys.test.ts packages/shared/src/daemonRestart.test.ts packages/shared/package.json
git commit -m "feat(shared): add daemon key table, signal whitelist, and restart backoff"
```

---

## Task 3: 跨平台 spawn 选项（detached 的唯一权威处）

**Files:**
- Create: `apps/server/src/daemon/spawnOptions.ts`
- Test: `apps/server/src/daemon/spawnOptions.test.ts`

**Interfaces:**
- Produces: `daemonSpawnOptions(input: { detached: boolean; platform: NodeJS.Platform; logFd: number }): SpawnOptions`

这是全仓**唯一**决定 detached 行为的地方。findings.md 第 1 条那个静默 bug 的防线就是这个文件加它的测试。

文件头须包含来源标注：

```ts
// FILE: spawnOptions.ts
// Purpose: Cross-platform spawn options for daemon processes. Single source of the
//          detached decision.
// Layer: Daemon infrastructure
//
// Ported from can1357/oh-my-pi (MIT) — see THIRD-PARTY-NOTICES.md.
//
// DELIBERATE DIVERGENCE FROM THE SOURCE: oh-my-pi sets `detached: false` on Windows.
// That holds for Bun.spawn but not for node:child_process — measured on Node v24 /
// Windows 11, a `detached: false` child dies the moment its parent exits, which makes
// the whole detached feature fail *silently*. See findings.md.
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { daemonSpawnOptions } from "./spawnOptions";

describe("daemonSpawnOptions", () => {
  it("detaches on Windows — the source implementation does not, and that is a bug here", () => {
    const options = daemonSpawnOptions({ detached: true, platform: "win32", logFd: 7 });
    expect(options.detached).toBe(true);
    expect(options.windowsHide).toBe(true);
  });

  it("detaches on POSIX", () => {
    expect(daemonSpawnOptions({ detached: true, platform: "linux", logFd: 7 }).detached).toBe(true);
  });

  it("does not detach for a supervised daemon", () => {
    expect(daemonSpawnOptions({ detached: false, platform: "win32", logFd: 7 }).detached).toBe(
      false,
    );
  });

  it("routes stdout and stderr to the log fd and discards stdin", () => {
    const options = daemonSpawnOptions({ detached: true, platform: "linux", logFd: 7 });
    expect(options.stdio).toEqual(["ignore", 7, 7]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/server && npx vitest run src/daemon/spawnOptions.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**（带上上面的文件头）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/server && npx vitest run src/daemon/spawnOptions.test.ts`
Expected: PASS，4 个用例

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/daemon/spawnOptions.ts apps/server/src/daemon/spawnOptions.test.ts
git commit -m "feat(server): add cross-platform daemon spawn options"
```

---

## Task 4: 真实存活性集成测试

**Files:**
- Create: `apps/server/src/daemon/detachedSurvival.test.ts`
- Create: `apps/server/src/daemon/testFixtures/tickingChild.cjs`

这个测试是 findings.md 第 1 条的回归防线：起真实子进程 → 杀父进程 → 验证日志文件继续增长。

> 注意：仓库根 `package.json` 是 `"type": "module"`，fixture 必须用 `.cjs` 扩展名，否则 `require` 未定义。
> 注意：测试起的是 `detached: true` 的真实进程，**必须在 afterEach 显式 kill**，否则每跑一次测试就留一个孤儿。

- [ ] **Step 1: 写 fixture**

`tickingChild.cjs`：接收目标文件路径，每 200ms 追加一行 `tick <n> pid=<pid>`。

- [ ] **Step 2: 写测试**

用 `child_process.spawn` 起一个**中间父进程**（`process.execPath -e "..."`），由它用 `daemonSpawnOptions({detached:true})` 起 `tickingChild.cjs` 并立即退出。断言：中间父进程退出后 2 秒，日志文件行数仍在增长。`afterEach` 里按记录的 pid `process.kill`。

同时写一个 `detached: false` 的对照用例，断言它**不**存活——两个用例并列，才能证明差异归因于 spawn 选项而非测试环境（findings.md 第 2 条）。

- [ ] **Step 3: 跑测试**

Run: `cd apps/server && npx vitest run src/daemon/detachedSurvival.test.ts`
Expected: PASS。若 detached 用例失败，**停下来**——后面所有 detached 功能都建立在它之上。

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/daemon/detachedSurvival.test.ts apps/server/src/daemon/testFixtures/
git commit -m "test(server): pin detached child survival across parent exit"
```

---

## Task 5: DaemonLog —— 文件落盘、轮转、游标读取

**Files:**
- Create: `apps/server/src/daemon/DaemonLog.ts`
- Test: `apps/server/src/daemon/DaemonLog.test.ts`

**Interfaces:**
- Consumes: `sliceHistorySince` from `@synara/shared/backgroundServiceSession`
- Produces:
  - `DaemonLog.open(dir: string): Promise<DaemonLog>` —— 打开 `output.log`，已存在则先移为 `output.prev.log`
  - `append(text: string): void` —— 超过 `MAX_LOG_BYTES` 触发轮转
  - `read(input: { cursor: number; lines: number; head: boolean; grep: string | null }): Promise<DaemonLogRead>`
  - `readonly outputBytes: number` —— 累计写入字节数，即对外的 `cursor`
  - `close(): Promise<void>`
  - `interface DaemonLogRead { content: string; nextCursor: number; droppedBytes: number; truncated: boolean }`
  - `MAX_LOG_BYTES`、`LOG_READ_BYTES`、`LOG_FILE = "output.log"`、`PREVIOUS_LOG_FILE = "output.prev.log"`

文件头须标注移植来源。

- [ ] **Step 1: 写失败测试**

覆盖（每条写成可运行用例，用 `node:fs/promises` + `os.tmpdir()` 建临时目录，`afterEach` 清理）：

1. `append` 后 `outputBytes` 等于写入字节数（含多字节字符）
2. `read({cursor: 0})` 返回全部内容
3. `read({cursor: n})` 只返回增量，`nextCursor` 推进
4. 超过 `MAX_LOG_BYTES` 触发轮转后，`read` 仍能连续读到轮转前的内容（跨 `output.prev.log` 与 `output.log`）
5. 轮转两次后，最早的内容丢失，`read({cursor: 0})` 返回 `droppedBytes > 0` 而非假装连续
6. `lines: 5` 只返回最后 5 行
7. `head: true` + `lines: 5` 返回最前 5 行
8. `grep: "ERROR"` 只返回匹配行
9. `grep` 用正则而非子串（`"ERROR|WARN"` 能同时命中两类）
10. `open` 时若 `output.log` 已存在，其内容被移入 `output.prev.log` 且不丢失
11. 多字节字符不会被游标从中间切开（复用 `sliceHistorySince` 即得，加一条回归即可）

- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通过 → 提交

Run: `cd apps/server && npx vitest run src/daemon/DaemonLog.test.ts`

```bash
git add apps/server/src/daemon/DaemonLog.ts apps/server/src/daemon/DaemonLog.test.ts
git commit -m "feat(server): add rotating daemon log with byte-cursor reads"
```

---

## Task 6: 就绪探针

**Files:**
- Create: `apps/server/src/daemon/readiness.ts`
- Test: `apps/server/src/daemon/readiness.test.ts`

**Interfaces:**
- Produces:
  - `createReadinessTracker(spec: DaemonReadySpec | null): ReadinessTracker`
  - `interface ReadinessTracker { feedOutput(chunk: string): void; markPortReady(): void; readonly isReady: boolean; readonly pending: readonly ("log"|"port")[]; }`
  - `connectPort(input: { host: string; port: number; timeoutMs: number }): Promise<boolean>`

要点：
- `log` 正则只对**有界 `readinessBuffer`**（保留最近 N KB）匹配，绝不对全量历史反复跑
- 正则编译失败时不得抛穿到进程外——视为该条件永不满足，并记录原因
- 两个条件都声明时**必须都满足**；`pending` 报告还差哪些

- [ ] **Step 1: 写失败测试**

覆盖：单 log 条件命中 / 单 port 条件命中 / 双条件必须都满足 / 无 ready 规格时 `isReady` 恒真 / `pending` 内容正确 / `readinessBuffer` 有界（灌入远超缓冲的输出后仍能匹配到最新内容，且内存不无限增长）/ 非法正则不抛异常且该条件永不满足 / `connectPort` 对未监听端口返回 false 且不超时挂死。

- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通过 → 提交

```bash
git add apps/server/src/daemon/readiness.ts apps/server/src/daemon/readiness.test.ts
git commit -m "feat(server): add daemon readiness probes for log and port"
```

---

## Task 7: DaemonBroker —— 记录表、状态机、launch/settle

**Files:**
- Create: `apps/server/src/daemon/Services/Broker.ts`（接口 + ServiceMap tag）
- Create: `apps/server/src/daemon/Layers/Broker.ts`（实现）
- Test: `apps/server/src/daemon/Layers/Broker.test.ts`

**Interfaces:**
- Consumes: Task 1 的 schema、Task 2 的退避、Task 3 的 spawn 选项、Task 5 的 `DaemonLog`、Task 6 的就绪探针
- Produces `DaemonBrokerShape`：
  - `start(spec: DaemonSpec): Effect<DaemonSnapshot, DaemonError>`
  - `list: Effect<readonly DaemonSnapshot[], never>`
  - `describe(name: string): Effect<DaemonSnapshot, DaemonError>`
  - `logs(input: {name, lines, head, grep, follow, cursor, timeoutMs}): Effect<DaemonLogRead & {snapshot: DaemonSnapshot}, DaemonError>`
  - `send(input: {name, text, enter, keys, signal}): Effect<DaemonSnapshot, DaemonError>`
  - `wait(input: {name, for: "ready"|"exit", pattern: string|null, timeoutMs}): Effect<{snapshot: DaemonSnapshot; matched: boolean; timedOut: boolean}, DaemonError>`
  - `stop(input: {name, timeoutMs}): Effect<DaemonSnapshot, DaemonError>`
  - `restart(name: string): Effect<DaemonSnapshot, DaemonError>`

**关键实现点：**

- `generation` 防竞态：每次 `#launch` 递增；exit 回调闭包捕获当时的 generation，回调触发时若与当前不符则**整个丢弃**——否则上一代的退出会把新一代标记成 exited
- `#settle` 按 `restart` 策略决定 `exited` / `failed` / `restarting`；`restarting` 时用 `restartDelayMs(consecutiveFailures)` 武装定时器；成功启动后 `consecutiveFailures = 0`
- `#waitUntil` 是所有阻塞的统一入口（`wait`、`logs` 的 `follow`、`stop` 的优雅等待）
- 无 `ready` 规格时 `starting` 直接转 `running`；有则等就绪后转 `ready` 再转 `running`
- **`detached: true` 蕴含 `persist: true` 且禁用 PTY 输入**（stdio 已重定向到文件，没有 stdin 通道）——`send` 带 `text`/`keys` 时须明确报错说明原因，而不是静默丢弃

- [ ] **Step 1: 写失败测试**

覆盖：状态机每条迁移 / generation 防竞态（构造"旧进程 exit 在新进程启动后才到达"）/ 无 ready 规格直达 running / 有 ready 规格经 ready / ready 超时保持 starting 且报 `readyTimedOut` / restart 策略三种取值行为 / 退避递增且 `consecutiveFailures` 成功后归零 / `stop` 先优雅后强制 / 向 detached 进程 `send` 文本时报错 / 重名 `start` 的处理（返回现有记录，不报错）。

- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通过 → 提交

```bash
git add apps/server/src/daemon/
git commit -m "feat(server): add daemon broker with state machine and restart policy"
```

---

## Task 8: detached 元数据持久化与重启认领

**Files:**
- Modify: `apps/server/src/daemon/Layers/Broker.ts`
- Test: `apps/server/src/daemon/Layers/Broker.detached.test.ts`

**Interfaces:**
- Produces（`DaemonBrokerShape` 新增）：`reclaimDetached: Effect<readonly DaemonSnapshot[], never>`

**关键实现点：**
- `DaemonSpec` + `pid` + **进程身份**（`startedAt` + `commandLine`）+ `outputOffset` 落盘到 `<dir>/daemon.json`
- `#refreshDetached`：先从 `outputOffset` 增量读日志文件，再校验进程身份；不匹配则 `#settle`
- `reclaimDetached` 在 broker 启动时调用一次，重建记录表

**pid 复用防护（照 omp 的做法）：** oh-my-pi 在 macOS 上持久化 `start_tvsec`/`start_tvusec` 并在 `status()` 里比对，Linux 用 `pidfd`（天然免疫）。**Windows 两边都没覆盖**——本仓库既有的 `processTreeKiller.readCurrentCommands` 用 `ps`，在 Windows 上直接返回 `null`。

新建 `apps/server/src/daemon/processIdentity.ts`：

| 平台 | 取身份的方式 |
|---|---|
| POSIX | `ps -p <pids> -o pid=,lstart=,command=`（沿用既有 `spawnSync` + 解析 + 可注入依赖的写法） |
| Windows | 一次 PowerShell CIM 批量查询：`Get-CimInstance Win32_Process -Filter "ProcessId=N or ..."`，取 `ProcessId` / `CreationDate` / `CommandLine` |

- **批量查询**：一次调用覆盖所有被跟踪的 pid。PowerShell 启动约 200–400ms，逐个查会随守护进程数线性劣化；该检查只在 `list`/`describe`/`wait` 路径上跑，不在热路径
- 纯函数 `processIdentityMatches(persisted, current): boolean` 单独导出并测试，平台查询作为可注入依赖 mock 掉
- **查询失败（命令不可用/超时）时必须返回"未知"而非"已退出"**——把一个活着的 MC 服务器误判成已退出，会让 Agent 去重启它，于是同一个世界存档被两个进程同时写入

- [ ] **Step 1: 写失败测试**

覆盖：落盘后重建 broker 能认回运行中的 detached 进程 / 进程已死时认领后状态为 exited / 日志从 `outputOffset` 继续读且不重复 / **pid 复用不会被误认**（构造一个 pid 相同但启动时间不同的记录）/ **身份查询失败时状态保持未知而不是 exited**（否则会导致同一存档被两个进程写入）。

- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通过 → 提交

```bash
git add apps/server/src/daemon/
git commit -m "feat(server): persist and reclaim detached daemons across restarts"
```

---

## Task 9: `daemon:control` 能力

**Files:**
- Modify: `apps/server/src/agentGateway/Services/AgentGatewaySessionRegistry.ts:4-9`
- Modify: 各签发点（`rg -n '"browser:control"' apps/server/src` 逐一比照）

- [ ] **Step 1:** 在 `AgentGatewayCapability` 加 `"daemon:control"`
- [ ] **Step 2:** `rg -n '"browser:control"' apps/server/src`，与 `browser:control` 同级授予
- [ ] **Step 3:** `cd apps/server && npx vitest run src/agentGateway/` → PASS
- [ ] **Step 4:** 提交

```bash
git commit -am "feat(server): add daemon:control agent gateway capability"
```

---

## Task 10: 8 个 Agent 工具

**Files:**
- Create: `apps/server/src/agentGateway/daemonTools.ts`
- Test: `apps/server/src/agentGateway/daemonTools.test.ts`
- Modify: 工具注册处（`rg -n "makeThreadReadTools" apps/server/src` 定位）

**Interfaces:**
- Consumes: `DaemonBrokerShape`（Task 7/8）、`resolveTerminalKey` / `isAllowedSignal`（Task 2）、`SYNARA_GATEWAY_MAX_WAIT_MS`
- Produces: `makeDaemonTools(input: { broker: DaemonBrokerShape }): ReadonlyArray<ToolEntry>`

| 工具 | 对应 op | annotations |
|---|---|---|
| `synara_start_daemon` | `start` | `WRITE_TOOL_ANNOTATIONS` |
| `synara_list_daemons` | `ps` | `READ_ONLY_TOOL_ANNOTATIONS` |
| `synara_describe_daemon` | `describe` | `READ_ONLY_TOOL_ANNOTATIONS` |
| `synara_read_daemon_logs` | `logs` | `readOnlyHint: false`（`follow` 会阻塞） |
| `synara_send_daemon_input` | `send` | `WRITE_TOOL_ANNOTATIONS` |
| `synara_wait_daemon` | `wait` | `readOnlyHint: false` |
| `synara_stop_daemon` | `stop` | `WRITE_TOOL_ANNOTATIONS` |
| `synara_restart_daemon` | `restart` | `WRITE_TOOL_ANNOTATIONS` |

`synara_stop_daemon` 的 description 必须含：

> Force-terminates the process tree after the grace period. For stateful servers (e.g. Minecraft), send a graceful shutdown command via `synara_send_daemon_input` first — force-killing can corrupt saved state.

- [ ] **Step 1: 写失败测试**

覆盖（mock broker）：每个工具的入参解码 / `timeout` 超过 `SYNARA_GATEWAY_MAX_WAIT_MS` 被钳到上限而非报错 / `lines` 超过 1000 被钳 / 未知按键名报错而非透传 / 非白名单信号报错 / `wait` 超时返回 `timedOut: true` 且 `isError` 为假 / `logs` 的 `droppedBytes` 透传到结果 / 向 detached 进程发文本的错误信息包含原因 / 未知 `name` 报错且不回退到任何默认守护进程。

- [ ] **Step 2–5:** 跑失败 → 实现 → 跑通过 → 提交

```bash
git add apps/server/src/agentGateway/
git commit -m "feat(server): expose daemon supervision tools to agents"
```

---

## Task 11: 接线与最终验证

- [ ] **Step 1:** 把 `DaemonBroker` Layer 接入服务端组装处，broker 启动时调用 `reclaimDetached`
- [ ] **Step 2:** 全量测试

Run: `cd apps/server && npx vitest run` 与 `cd packages/shared && npx vitest run` 与 `cd packages/contracts && npx vitest run`
Expected: 无新增失败（与合并前基线比对）

- [ ] **Step 3:** 一次性工作区检查

Run: `bun fmt && bun lint && bun typecheck`

> `bun fmt` 在 Windows 上会重写全仓行尾，`git status` 会显示 2000+ 假 modified。判断真实改动一律用 `git diff --numstat`，只提交本计划涉及的文件。

- [ ] **Step 4:** 手工验收：起一个真实的 Minecraft 服务端

```
synara_start_daemon { name: "mc", application: "java", args: ["-Xmx2G","-jar","server.jar","nogui"],
                      cwd: "<mc dir>", ready: { log: "Done \\(", timeout: 180 }, detached: true }
synara_read_daemon_logs { name: "mc", lines: 20 }
synara_send_daemon_input { name: "mc", text: "list" }
synara_send_daemon_input { name: "mc", text: "stop" }
synara_wait_daemon { name: "mc", for: "exit", timeout: 60 }
```
关闭 Synara，确认 MC 进程仍在；重启 Synara，确认 `synara_list_daemons` 认回它。

- [ ] **Step 5:** 提交

```bash
git commit -m "chore: wire daemon broker and verify agent daemon tools"
```

---

## 自查

**规格覆盖：** 设计 §3.1 类型 → Task 1；§3.2 状态机 → Task 7；§3.3 命名 → Task 1（name 校验）；§3.4 与 TerminalManager 关系 → Task 7；§4 工具面 → Task 10；§4.1 就绪 → Task 6 + Task 7；§4.2 重启 → Task 2 + Task 7；§4.3 send 三通道 → Task 2 + Task 10；§4.4 正则边界 → Task 5（grep）+ Task 6（ready.log）；§5.1 DaemonLog → Task 5；§5.2 游标 → 已完成 `c6ea542f` + Task 5；§5.3 截断告知 → Task 5 用例 5；§6 detached → Task 3 + Task 4 + Task 8；§6.1 平台偏离 → Task 3 + Task 4；§7 权限 → Task 9；§8 测试 → 各 Task。

**类型一致性：** `DaemonSnapshot` / `DaemonSpec` 在 Task 1 定义，Task 7 起全程复用；`DaemonLogRead` 在 Task 5 定义，Task 7 的 `logs` 返回；`ReadinessTracker` 在 Task 6 定义，Task 7 消费；`restartDelayMs` 在 Task 2 定义，Task 7 消费。名称已核对一致。

**遗留判断：** Task 5–8 的测试给的是断言清单而非完整代码——它们依赖临时目录 fixture 与真实子进程，脱离上下文写死会误导。实施者须补全成可运行代码，且 detached 相关测试必须在 `afterEach` 清理进程。
