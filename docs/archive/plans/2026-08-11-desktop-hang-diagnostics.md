# Plan — 为 Synara Windows 卡死增加外部看门狗与可分析转储

## 目标

让下一次 Windows `AppHangB1` 不再只留下“Synara.exe 未响应”这一条结果日志：即使 Electron 主进程事件循环已经卡住，也由独立进程自动留下本地 minidump、最后心跳状态和诊断元数据，供 WinDbg/后续代码分析定位主线程或 renderer 卡在哪个原生/JavaScript 执行路径。

## 已确认事实与根因边界

- 2026-08-11 13:18:03 的 Windows Application 事件确认 `Synara.exe` 0.7.1 出现 `AppHangB1`，承载桌面窗口的进程停止响应 Windows 消息并被关闭。
- 同期 Provider reconciliation 与重启后残留子任务证明运行状态曾偏差，但 server 是独立子进程；现有证据不能证明它阻塞了 Electron 主线程。
- 当前 `webContents.on("unresponsive")` 只记录 renderer 边缘事件；主进程自己挂起时，它的定时器、日志回调和 `process.report.writeReport()` 都可能无法执行。
- WER 临时附件已被清理，当前没有 hang dump，因此无法从这次事件倒推出具体函数。此次改动是诊断基础设施，不宣称修复未知卡死原因。

## 验收标准

1. Windows packaged desktop 启动一个与 Electron 主事件循环隔离的 watchdog 子进程；非 Windows 平台行为不变。
2. 主进程每秒发送有界心跳。连续 6 秒未收到心跳时，watchdog 每个 incident 只捕获一次主进程转储；系统休眠/时钟大跳变不会误触发。
3. Chromium 报告 renderer `unresponsive` 时，主进程把 renderer PID 交给 watchdog；恢复时记录 `responsive`，不会重复生成转储风暴。
4. 转储由 watchdog 再启动独立 PowerShell，通过 Windows `MiniDumpWriteDump` 捕获；转储失败只写明错误，不阻塞、终止或重启 Synara。
5. 诊断目录只保留最近 3 个 incident；文件使用临时名完成后原子改名，不能误删目录外或不属于 Synara hang diagnostics 的文件。
6. 每个 incident 至少包含 `.json` 元数据与成功时的 `.dmp`：run id、应用/Electron 版本、commit、目标种类、PID、最后心跳、检测延迟、renderer/backend PID、dump 模式与捕获结果。不得写聊天正文、认证 token 或环境变量。
7. 默认生成适合线程/栈分析的 triage dump；仅显式设置 `SYNARA_HANG_DUMP_MODE=full` 时包含完整进程内存。所有文件仅保存在本机，不上传。
8. watchdog 异常退出、IPC 断开、PowerShell 缺失/超时、目标进程已退出、权限不足和 PID 无效均有测试覆盖，并且主应用继续运行。

## 设计

### 1. 独立 watchdog 进程

主进程使用 `child_process.fork` 启动 `dist-electron/desktopHangWatchdogProcess.js`，`execPath` 复用当前 Electron executable，并通过 `ELECTRON_RUN_AS_NODE=1` 作为独立 Node 进程运行。它只接收最小环境，不继承 Synara auth token；stdio 设为 ignore，避免日志管道背压反过来卡住 watchdog，通信只走 Node IPC。

选择普通 OS 子进程是为了复用当前 backend 已验证的 `process.execPath + ELECTRON_RUN_AS_NODE` 模式，并且能在 Electron `ready` 之前启动；`utilityProcess.fork` 只能在 `ready` 之后调用。真正写 dump 的 PowerShell 仍与目标分处不同进程，这也符合 Microsoft 对不稳定目标调用 `MiniDumpWriteDump` 的建议。现有 release 若未来关闭 Electron `runAsNode` fuse，必须把 watchdog 与 backend 一并迁移到 utility/native helper，不能静默失效。

主进程控制器负责启动、每秒发送最新状态、正常退出时 disconnect/kill，以及 watchdog 意外退出后的有界重启。发送失败只记录到现有 `desktop-main.log`，不加入无限消息队列。

### 2. 可测试的 hang 判定

watchdog 内部使用纯状态机决定 `wait`、`capture`、`rearm` 或 `reset-after-suspend`：

- 心跳间隔：1 秒；main hang 阈值：6 秒。
- watchdog 自身 tick 也出现大于阈值的时间跳变时，视为系统休眠/严重调度暂停，重置基线而不是立即抓 dump。
- 一个 incident 只抓一次；收到恢复心跳后才 rearm。
- renderer `unresponsive` 是显式 capture 请求，按 renderer PID 去重；`responsive` 结束该 incident。
- 捕获前验证 PID 为正整数且目标仍存在，元数据同时记录启动时传入的 main PID/run id，降低 PID 重用误抓风险。

### 3. Windows minidump

watchdog 使用绝对系统 PowerShell 路径启动一次性、隐藏、非交互进程，以 UTF-16LE `-EncodedCommand` 执行受控脚本。脚本 P/Invoke `DbgHelp!MiniDumpWriteDump`，调用者与目标分处不同进程。

默认 triage flags 包含线程信息、进程/线程数据、已卸载模块和栈间接引用内存；这能控制隐私与磁盘占用，并优先保留定位消息循环、native wait 和线程归属所需的证据。需要恢复更完整的 V8/Node JavaScript 上下文时使用显式 `full` 模式，元数据标记其可能包含敏感内容。

先写 `<name>.json.tmp` / `<name>.dmp.tmp`；dump 成功且非空后改为最终文件名。PowerShell 有硬超时，stderr 只保留有界、清洗后的错误摘要。retention 只匹配固定的 `synara-hang-` 前缀与允许扩展名，并在解析后再次验证路径仍在诊断目录内。

### 4. 主进程与 renderer 接线

`main.ts` 在 packaged logging 初始化后创建 watchdog controller；窗口创建后更新 renderer PID，并将现有 `unresponsive` / `responsive` 事件转成诊断请求。`render-process-gone`、watchdog spawn/exit/capture-result 继续写入现有 desktop log，便于把 `.dmp` 与业务时间线对齐。

watchdog 不自动重启或杀死 Synara；它只取证，避免诊断机制改变故障现场。

## 具体文件

- 新增 `apps/desktop/src/desktopHangWatchdog.ts`：协议、纯判定状态机、主进程 controller 与依赖注入接口。
- 新增 `apps/desktop/src/desktopHangWatchdog.test.ts`：状态机、IPC、重启/关闭、隐私字段与错误路径测试。
- 新增 `apps/desktop/src/desktopHangWatchdogProcess.ts`：Node watchdog entry、父进程/IPC 生命周期、tick 与 capture 编排。
- 新增 `apps/desktop/src/windowsHangDump.ts`：PowerShell 编码、`MiniDumpWriteDump` 调用、超时、原子完成和 retention。
- 新增 `apps/desktop/src/windowsHangDump.test.ts`：命令构造、路径安全、retention、成功/失败/超时的注入测试。
- 新增 `apps/desktop/src/windowsHangDump.windows.integration.test.ts`：Windows 上对临时测试进程生成真实小型 dump，并校验 `MDMP` 文件头；非 Windows 跳过。
- 修改 `apps/desktop/src/main.ts`：启动/停止 controller，发送主/renderer/backend 状态，并复用既有 crash/unresponsive 日志点。
- 修改 `apps/desktop/tsdown.config.mts`：把 watchdog process 加入独立 bundle entry。
- 修改 `apps/desktop/scripts/dev-electron.mjs`：把 watchdog bundle 加入 required/watched files，开发时变更会重启正确的 Electron 实例。
- 更新 `findings.md`：记录实现/验证错误和最终取证能力边界。

## 实施步骤

1. 先写 `desktopHangWatchdog.test.ts` 与 `windowsHangDump.test.ts` 的失败测试，固定阈值、休眠恢复、incident 去重、IPC 失败和路径/retention 安全语义。
2. 实现纯状态机与 minidump command/文件生命周期，使单元测试通过。
3. 实现 watchdog child entry，并用注入 parent channel、clock、timer、dump writer 测试断线、目标退出和单次捕获。
4. 实现 main-side controller；只传结构化白名单字段，加入有界重启与清理。
5. 在 `main.ts` 接入启动、心跳、renderer unresponsive/responsive、render-process-gone 与 graceful shutdown。
6. 更新 tsdown/dev bundle 清单，确认独立 entry 会进入开发和 release 的 `dist-electron` 目录。
7. 添加 Windows 真实 dump 集成测试，确认当前用户权限下可以捕获同完整性级别的测试进程；不提升权限、不写注册表。
8. 运行聚焦测试、desktop build 和 diff 检查，更新 findings。

## 验证命令

禁止使用 `bun test`；使用项目规定的 Vitest 入口：

```bash
bun run --cwd apps/desktop test -- src/desktopHangWatchdog.test.ts src/windowsHangDump.test.ts
bun run --cwd apps/desktop test -- src/windowsHangDump.windows.integration.test.ts
bun run --cwd apps/desktop build
git diff --check
```

本次用户没有显式要求 `bun fmt`、`bun lint` 或 `bun typecheck`，因此按仓库规则不自动运行这些重型检查，也不据此宣称完成了全仓验证。

## 错误处理、兼容性与回滚

- watchdog 和 dump 捕获完全 fail-open：初始化/IPC/PowerShell/权限/磁盘错误只留下日志和失败元数据，不能阻止 Synara 启动或退出。
- Windows 以外不启动 watchdog；现有 renderer crash recovery、backend supervision 和日志路径保持不变。
- 完整 dump 可能包含聊天、代码、token 等进程内存，只能显式 opt-in；默认 triage、本地保存、固定 retention、无网络上传。
- dump 可能仍需匹配版本的 Electron symbols；元数据中的 app/Electron/commit 用于下载符号与对应源码。诊断 release 可继续使用现有 `SYNARA_DESKTOP_SOURCEMAP=1`。
- 回滚只需移除 controller 接线与 watchdog bundle entry；诊断目录是旁路数据，不参与状态数据库和任务恢复。

## 拒绝的方案

- **只在 main 里 `setInterval` 后调用 `process.report.writeReport()`。** 主事件循环挂起时定时器和 API 都不会运行，正好覆盖不了本次故障。
- **只依赖 `webContents.on("unresponsive")`。** 它诊断 renderer；这次 WER 记录的是承载窗口的 Synara 主进程 AppHang。
- **只启用 Electron `crashReporter` 或 WER LocalDumps。** 两者主要覆盖 crash/termination，不是仍存活但不处理窗口消息的 AppHang；可作为未来 crash 补充，不能替代 hang watchdog。
- **打包 ProcDump。** 本机未安装，且 Sysinternals 有独立 EULA；未经许可把二进制塞进产品不合适。手工排障仍可用 `procdump -ma -h <pid>`。
- **调用未公开的 `comsvcs.dll MiniDump` 入口。** 接口不稳定、错误语义和兼容性不可控，不作为产品基础设施。
- **watchdog 自动杀死/重启 Synara。** 本轮目标是保留现场；自动恢复会改变用户数据与故障时间线，并扩大未经确认的行为范围。
