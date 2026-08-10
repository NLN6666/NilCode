# Codex compaction lifecycle fix report

## Status

Complete. The compact command no longer treats the `thread/compact/start` acknowledgement as terminal runtime completion.

## Root cause

`ProviderService.compactThread` called `adapter.compactThread`, then immediately persisted a stopped binding, cleared `activeTurnId`, and scheduled an idle stop. For Codex, that adapter call only acknowledges compaction start. Completion is emitted later as normalized `thread.state.changed` with `state: "compacted"`. The premature binding/timer could stop the live Codex app-server while compaction or its active turn was still running.

## RED

Added two regression tests before changing production code:

- An active turn remains `running` with its exact `activeTurnId` after compact start acknowledgement, and no `stopSession` occurs before the lifecycle event.
- An inactive runtime does not receive idle cleanup until the real compacted state event.

The RED command failed as expected: both assertions received `status: "stopped"` directly after compact acknowledgement.

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "keeps an active turn bound after compact start acknowledgement|schedules idle cleanup only after an inactive compacted state event"
```

## GREEN

Removed only the acknowledgement-path binding upsert and `scheduleIdleStopOnSuccess` option. `compactThread` now delegates to the adapter; the existing runtime-event handler owns the real `compacted` transition and idle reconciliation.

The pre-existing active-turn compacted-event test now waits for event persistence rather than a fixed sleep. The pre-existing compact-idle test now emits `thread.state.changed(compacted)` before it expects cleanup.

## Commands and results

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "compacted|compact start acknowledgement|compact work"
# PASS: 5 tests

bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts
# PASS: 82 tests
```

`bun fmt`, `bun lint`, and `bun typecheck` were intentionally not run: task instructions explicitly prohibit them for this request.

## Commit

`fd61a70c7 fix: wait for Codex compaction lifecycle event`

## Self-review

- Production change is limited to removing premature terminal state and idle scheduling from `ProviderService.compactThread`.
- Tests cover active and inactive compaction acknowledgement boundaries plus event-driven cleanup.
- No manager active-turn-preservation code or unrelated runtime lifecycle behavior was changed.

## Concerns

No known functional concerns. The server test process emits Node's existing experimental SQLite warning; all requested tests passed.

## Pi regression follow-up — RED

Independent review found that the Codex-only acknowledgement model was applied to Pi. Added a focused Pi manual-compaction test before changing production code. It requires successful Pi compaction to persist `stopped`, clear `activeTurnId`, record `provider.compactThread`, and perform idle cleanup.

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "persists synchronous Pi compaction and schedules idle cleanup"
```

Result: expected failure — received `status: "running"` where `"stopped"` was required.

## Pi regression follow-up — GREEN

Restricted the asynchronous completion behavior to `provider === "codex"`. Pi and other synchronous adapters again persist the original completion state and schedule idle cleanup after a successful compact. No Pi adapter event protocol changed.

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "persists synchronous Pi compaction and schedules idle cleanup|keeps an active turn bound after compact start acknowledgement|schedules idle cleanup only after an inactive compacted state event"
# PASS: 3 tests

bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts
# PASS: 83 tests
```

`bun fmt`, `bun lint`, and `bun typecheck` were intentionally not run per the task instruction. The only output warning was Node's existing experimental SQLite warning.

## Important review follow-up: serialize synchronous completion

The prior Pi regression restored synchronous completion semantics but left its `getBinding`/`upsert` terminal transition outside the per-thread binding lock. A compacted runtime event or immediately dispatched turn could therefore win briefly and then be overwritten by Pi's old snapshot.

`compactThread` now captures the expected binding before invoking the synchronous adapter, then makes its final decision inside `withBindingWriteLock`. It re-reads the binding and refuses to clear `activeTurnId`, write `stopped`, or schedule idle cleanup if the provider/lifecycle/status/runtime event changed, an active turn exists, or a dispatch is in flight/outstanding. The adapter call remains outside the lock, avoiding a wait cycle with runtime event handling. Codex continues to wait exclusively for its asynchronous lifecycle event.

TDD evidence:

```sh
bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts -t "does not let synchronous Pi compaction overwrite a compacted runtime binding|keeps an immediately dispatched Pi turn running after compaction|persists synchronous Pi compaction and schedules idle cleanup|keeps an active turn bound after compact start acknowledgement|schedules idle cleanup only after an inactive compacted state event"
# PASS: 5 tests

bun run --cwd apps/server test -- src/provider/Layers/ProviderService.test.ts
# PASS: 85 tests
```

`bun fmt`, `bun lint`, and `bun typecheck` were not run as directed. Node emitted only its existing experimental SQLite warning.
