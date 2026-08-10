# Findings — Codex context compaction stops conversation

## Phase 1: reproduction and event boundaries

The manual `/compact` path is:

1. Web calls `ProviderService.compactThread`.
2. The Codex adapter calls `CodexAppServerManager.compactThread`.
3. The manager sends `thread/compact/start`; the RPC response acknowledges that compaction started, not that it completed.
4. Actual completion arrives later as the app-server `thread/compacted` notification and is normalized to `thread.state.changed` with state `compacted`.

The manager intentionally preserves an active turn across compaction. Existing ProviderService coverage also requires `thread.state.changed(compacted)` to preserve an active turn, so clearing active turn on every compaction notification would break valid automatic compaction inside a running turn.

## Phase 2: working pattern and difference

`reconcileRuntimeIdleTimer` already schedules idle cleanup when the real `thread.state.changed(compacted)` event arrives. Other runtime lifecycle transitions likewise let provider events drive terminal binding state.

`ProviderService.compactThread` differs: immediately after `adapter.compactThread` returns, it writes `status: "stopped"`, clears `activeTurnId`, and schedules idle cleanup. The adapter call returns after `thread/compact/start` is acknowledged, before the terminal notification. This can stop the Codex app-server while compaction or the current turn is still active.

## Phase 3: confirmed hypothesis

Root cause hypothesis: Synara treats the start acknowledgment as compaction completion. The premature stopped binding and idle timer terminate or detach the live Codex session before the real `thread/compacted` lifecycle event, which appears to the user as the conversation stopping after context compaction.

Minimal correction: the compact command should only initiate compaction. It must not synthesize a stopped binding or schedule success-time idle cleanup. The existing runtime event handler remains the single source for compacted status, active-turn preservation, resume-cursor refresh, and idle cleanup.

## Baseline noise

The full `codexAppServerManager.test.ts` suite has a known unrelated PATH-resolved Codex CLI version-gate failure on this machine. Compaction verification must use focused ProviderService/manager tests and must not modify that version-gate test.

## Phase 4: TDD regression coverage and correction

### RED

Added focused `ProviderService` idle-cleanup coverage for both boundaries:

1. A compact start acknowledgement while a turn is active must retain `status: "running"` and the exact `activeTurnId`, and must not call `stopSession` before a real lifecycle event.
2. An inactive compact start acknowledgement must retain its running binding and must not schedule idle cleanup until a normalized `thread.state.changed(compacted)` event arrives.

Before the production change, both tests failed with the expected assertion: `status` was `"stopped"` immediately after `provider.compactThread`, confirming that the acknowledgement path synthesized a terminal binding before the runtime event.

Command:

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "keeps an active turn bound after compact start acknowledgement|schedules idle cleanup only after an inactive compacted state event"
```

Result: 2 failed, each received `"stopped"` where `"running"` was required.

### GREEN

`ProviderService.compactThread` now validates/routes and invokes `adapter.compactThread` only. It no longer writes a stopped binding, clears `activeTurnId`, or requests success-time idle cleanup. The existing runtime event handler remains responsible for status, active-turn preservation, resume-cursor refresh, and idle reconciliation when `thread.state.changed(compacted)` actually arrives.

Updated the existing compact-idle test so it emits the real compacted runtime event before expecting cleanup. Also made the existing active-turn compacted-event test wait for persisted event handling instead of relying on a fixed sleep.

Verification:

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "compacted|compact start acknowledgement|compact work"
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts
```

Results: focused compact/idle suite passed (5 tests); full `ProviderService.test.ts` passed (82 tests).

## Phase 5: Pi synchronous compaction regression

### RED

The Codex acknowledgement fix changed the compact path for every provider, but Pi's adapter contract completes `compactThread` synchronously. Added a Pi-specific regression that requires a successful manual compact to persist `status: "stopped"`, `activeTurnId: null`, and `lastRuntimeEvent: "provider.compactThread"`, then schedule idle cleanup.

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "persists synchronous Pi compaction and schedules idle cleanup"
```

Result: failed as expected before the production correction. The binding remained `"running"` instead of `"stopped"`, proving the Codex-only asynchronous lifecycle change regressed Pi's synchronous completion semantics.

### GREEN

`ProviderService.compactThread` now treats only the Codex adapter as asynchronous: Codex waits for its real `thread.state.changed(compacted)` lifecycle event. For Pi and other synchronous providers, successful adapter completion restores the previous stopped binding (`activeTurnId: null`, `lastRuntimeEvent: "provider.compactThread"`) and schedules idle cleanup on success.

Verification:

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "persists synchronous Pi compaction and schedules idle cleanup|keeps an active turn bound after compact start acknowledgement|schedules idle cleanup only after an inactive compacted state event"
# PASS: 3 tests

bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts
# PASS: 83 tests
```

The test runner emitted Node's existing experimental SQLite warning only. `bun fmt`, `bun lint`, and `bun typecheck` were not run as explicitly prohibited by the task instructions.

## Phase 6: synchronous Pi binding-write race

### RED

The Pi-specific completion path read and wrote the binding outside `withBindingWriteLock`. Two controlled interleavings reproduced the resulting stale write:

1. A real `thread.state.changed(compacted)` binding update landing while synchronous Pi compaction held its old snapshot was overwritten with `provider.compactThread`.
2. A new `sendTurn` dispatched immediately after synchronous compact could persist `running` and its new `activeTurnId`, then be overwritten to `stopped`/`null`; the success callback also scheduled idle cleanup for that live thread.

The first focused run initially exposed two test-harness errors (a restoration closure was scoped outside the Effect generator, then the delayed `getBinding` wrapper discarded its Option). Both were corrected before evaluating behavior. The final RED run failed for the intended behavior: it timed out waiting for the compacted runtime binding and received `"stopped"` where the immediate next turn required `"running"`.

### GREEN

Synchronous compact now captures its pre-adapter binding, then enters `withBindingWriteLock` for its final re-read and write. It declines to synthesize a terminal binding or idle cleanup when provider/lifecycle/status/runtime-event/active-turn ownership changed, an active turn exists, or a turn dispatch is in flight or outstanding. The adapter invocation remains outside that lock, so it cannot wait on the runtime-event handler; a delayed runtime event simply acquires the lock after compact returns.

Verification:

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "does not let synchronous Pi compaction overwrite a compacted runtime binding|keeps an immediately dispatched Pi turn running after compaction|persists synchronous Pi compaction and schedules idle cleanup|keeps an active turn bound after compact start acknowledgement|schedules idle cleanup only after an inactive compacted state event"
# PASS: 5 tests

bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts
# PASS: 85 tests
```

The only runner output was Node's existing experimental SQLite warning. `bun fmt`, `bun lint`, and `bun typecheck` were intentionally not run.

## Phase 7: final fresh verification

After the concurrency fix received an independent APPROVED review, the final focused pass reran `ProviderService.test.ts`: 85/85 tests passed. The combined Codex manager and provider-runtime-ingestion run passed 228 tests, skipped 2, and retained the single unrelated PATH-resolved Codex CLI version-gate baseline failure documented above. Shared metadata, web presentation/transcript, and Chromium dock tests also passed (30/30, 210/210, and 6/6 respectively).

The heavyweight `bun fmt`, `bun lint`, and `bun typecheck` gate remains pending explicit user authorization.
