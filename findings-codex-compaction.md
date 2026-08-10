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
