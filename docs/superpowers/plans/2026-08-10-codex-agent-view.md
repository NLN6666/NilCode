# Codex Agent View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex native agents appear in Synara's existing subagent strip and open as full right-dock conversations with truthful model, effort, role, status, and foreground/background details.

**Architecture:** Keep Codex agents on the existing provider-native child-thread path. Normalize Codex collaboration metadata in shared helpers, forward child turn lifecycle notifications without mutating the parent provider session, and prove the existing ingestion/presentation/dock pipeline receives and renders the resulting child thread correctly.

**Tech Stack:** TypeScript, Effect, React, Vitest, Bun, Codex app-server JSON-RPC notifications.

## Global Constraints

- Reuse `provider_native` child threads, `ComposerSubagentStrip`, the existing right dock, and `MessagesTimeline`; do not create a Codex-specific store, protocol, route, or renderer.
- Actual model facts outrank requested-model hints. A requested model alone must never be displayed as the confirmed runtime model.
- Sparse updates preserve known nickname, role, model, effort, background state, prompt, and status.
- Child `turn/started`, `turn/completed`, and `turn/aborted` notifications must reach provider runtime ingestion, but must never mutate the parent Codex session's active turn or status.
- Keep child thread/session lifecycle notifications other than turn lifecycle suppressed unless a failing acceptance test proves they are required.
- Missing model, effort, role, or resolved child thread degrades by omitting the field or disabling navigation; never borrow the parent model or navigate to the wrong thread.
- Child tool/work rows must not count as transcript messages or retrigger parent transcript auto-stick behavior.
- All disclosure UI continues to use the existing shared disclosure motion; this plan adds no animation implementation.
- Preserve user-owned dirty changes. Stage and commit only files named by this plan and only when their diff belongs to this feature.
- Use `bun run test`; never use `bun test`.
- Do not run `bun fmt`, `bun lint`, or `bun typecheck` unless the user explicitly authorizes those heavyweight checks in the current conversation.

## File Map

- `packages/shared/src/subagents.ts`: provider-neutral parsing and merge truth rules for receiver agents and agent states.
- `packages/shared/src/subagents.test.ts`: alias, requested-versus-actual model, effort/background, and sparse-merge coverage.
- `apps/web/src/workLog.ts`: converts normalized collaboration metadata into UI-facing `WorkLogSubagent` records.
- `apps/web/src/workLog.test.ts`: verifies requested models are hidden and actual metadata survives later sparse states.
- `apps/server/src/codexAppServerManager.ts`: decides which child app-server notifications are emitted and protects the parent session lifecycle.
- `apps/server/src/codexAppServerManager.test.ts`: verifies child lifecycle routing and parent-session isolation.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`: proves child creation, full event routing, terminal status, and parent projection isolation.
- `apps/web/src/components/chat/ComposerSubagentStrip.logic.test.ts`: proves Codex-derived rows expose identity/model/status and partition correctly.
- `apps/web/src/components/chat/SubagentDetailSections.browser.tsx`: protects right-dock callback precedence and lazy child transcript subscription.
- `findings-codex-agent-view.md`: records execution errors and verified implementation conclusions.

---

### Task 1: Normalize truthful Codex agent metadata

**Files:**
- Modify: `packages/shared/src/subagents.ts`
- Test: `packages/shared/src/subagents.test.ts`
- Modify: `apps/web/src/workLog.ts`
- Test: `apps/web/src/workLog.test.ts`
- Modify: `findings-codex-agent-view.md`

**Interfaces:**
- Consumes: `decodeSubagentReceiverAgents`, `decodeSubagentAgentStates`, `extractSubagentIdentityHints`, and `buildSubagentIdentityDirectory`.
- Produces: `ParsedSubagentAgentState` with optional `effort`, `background`, and `modelIsRequestedHint`; UI work-log entries that expose only confirmed models while retaining effort/background metadata.

- [ ] **Step 1: Add failing shared decoder tests**

Add test cases that pass both camelCase and snake_case Codex agent-state shapes. The assertions must distinguish actual and requested models:

```ts
expect(decodeSubagentAgentStates({
  agentStates: {
    "child-1": {
      model: "gpt-5.6-codex",
      requestedModel: "gpt-5.5-codex",
      reasoningEffort: "high",
      background: true,
    },
    "child-2": {
      requested_model: "gpt-5.5-codex",
      reasoning_effort: "medium",
    },
  },
})).toMatchObject({
  "child-1": {
    model: "gpt-5.6-codex",
    effort: "high",
    background: true,
  },
  "child-2": {
    model: "gpt-5.5-codex",
    effort: "medium",
    modelIsRequestedHint: true,
  },
});
```

Also extend identity-directory coverage so a later requested-model hint cannot replace an earlier actual model and a sparse status update cannot erase effort/background.

- [ ] **Step 2: Run shared tests and confirm the new assertions fail**

Run:

```text
bun run --cwd packages/shared test -- src/subagents.test.ts
```

Expected: failure because agent-state records do not yet expose effort/background/requested-hint provenance.

- [ ] **Step 3: Implement the shared metadata fields and merge rules**

Extend `ParsedSubagentAgentState` with:

```ts
effort?: string | undefined;
background?: boolean | undefined;
modelIsRequestedHint?: boolean | undefined;
```

In `buildSubagentAgentState`, parse `model`/`modelName`/`model_name` separately from `requestedModel`/`requested_model`, prefer the direct value, and set `modelIsRequestedHint: true` only when the chosen value came from the requested field. Parse effort from `effort`, `reasoningEffort`, or `reasoning_effort`; preserve explicit boolean background values. Pass all three fields through `extractSubagentIdentityHints` so `mergeSubagentIdentityHints` applies its existing actual-over-requested and sparse-update rules.

- [ ] **Step 4: Add failing work-log truthfulness tests**

In `apps/web/src/workLog.test.ts`, construct `collab_agent_tool_call` activities for these cases:

```ts
receiverAgents: [{
  threadId: "child-requested",
  requestedModel: "gpt-5.5-codex",
  reasoningEffort: "high",
  background: true,
}]
```

Assert the resulting subagent has `effort: "high"` and `background: true` but no `model`. Add a second activity with direct `model: "gpt-5.6-codex"`, followed by a sparse `agentStates` status update, and assert the merged entry retains the actual model, effort, and background while gaining the terminal status.

- [ ] **Step 5: Run work-log tests and confirm the requested model currently leaks into UI metadata**

Run:

```text
bun run --cwd apps/web test -- src/workLog.test.ts
```

Expected: the requested-only case fails because `extractCollabSubagents` currently copies hinted models into `WorkLogSubagent.model`.

- [ ] **Step 6: Filter requested hints at the UI projection boundary**

When mapping receiver agents, agent states, and fallback identity hints in `extractCollabSubagents`, assign `model` only when `modelIsRequestedHint !== true`. Copy `effort` and `background` from agent states just as receiver-agent fields are copied. In the singular fallback branch, split direct model aliases from requested aliases and expose only direct model aliases.

- [ ] **Step 7: Run focused metadata tests**

Run:

```text
bun run --cwd packages/shared test -- src/subagents.test.ts
bun run --cwd apps/web test -- src/workLog.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 8: Record findings and commit the metadata slice**

Append the verified provider shapes and any compatibility caveat to `findings-codex-agent-view.md`, then stage only the five Task 1 files and commit:

```text
git add packages/shared/src/subagents.ts packages/shared/src/subagents.test.ts apps/web/src/workLog.ts apps/web/src/workLog.test.ts findings-codex-agent-view.md
git commit -m "fix: normalize Codex agent metadata"
```

---

### Task 2: Forward child turn lifecycle without mutating the parent session

**Files:**
- Modify: `apps/server/src/codexAppServerManager.ts`
- Test: `apps/server/src/codexAppServerManager.test.ts`
- Modify: `findings-codex-agent-view.md`

**Interfaces:**
- Consumes: `resolveCollaborationRoute`, `handleServerNotification`, and provider refs emitted by `CodexAppServerManager`.
- Produces: child `turn/started`, `turn/completed`, and `turn/aborted` provider events carrying child/parent routing refs while retaining the existing early returns that protect parent session state.

- [ ] **Step 1: Rewrite lifecycle routing tests to express the desired boundary**

Replace the tests that expect child turn lifecycle to be fully suppressed. For a mapped child, emit `turn/started`, `turn/completed` with `status: "failed"`, and `turn/aborted` in separate cases. Assert each emitted provider event includes:

```ts
expect.objectContaining({
  providerThreadId: "child_provider_1",
  providerParentThreadId: "provider_parent",
  parentTurnId: "turn_parent",
})
```

Assert `turnId` remains the child turn ID, failure details remain in `payload`, and `updateSession` is never called. Keep explicit coverage that parent lifecycle notifications still update the parent session.

- [ ] **Step 2: Run the manager test file and verify failure**

Run:

```text
bun run --cwd apps/server test -- src/codexAppServerManager.test.ts
```

Expected: the new child turn assertions fail because `shouldSuppressChildConversationNotification` returns before `emitEvent`.

- [ ] **Step 3: Narrow the suppression list**

Remove only these methods from `shouldSuppressChildConversationNotification`:

```ts
"turn/started"
"turn/completed"
"turn/aborted"
```

Keep the child checks inside the later `turn/started`, `turn/completed`, and `turn/aborted` handlers. This ordering intentionally emits the provider event first, then returns before `updateSession`, so ingestion can update the materialized child thread without changing the parent Codex session.

- [ ] **Step 4: Cover an unmapped child lifecycle route**

Add a test where the parent session is running and a child turn arrives before `collab_agent_tool_call`. Assert the event carries the inferred `providerThreadId` and `providerParentThreadId`, does not carry a fabricated `parentTurnId`, and does not change the parent's active turn. This preserves best-effort child materialization without inventing an association.

- [ ] **Step 5: Run focused manager tests**

Run:

```text
bun run --cwd apps/server test -- src/codexAppServerManager.test.ts
```

Expected: all manager tests pass; child turn events are emitted and parent session update calls remain absent.

- [ ] **Step 6: Record findings and commit the lifecycle slice**

Append the verified isolation behavior to `findings-codex-agent-view.md`, then stage only the three Task 2 files and commit:

```text
git add apps/server/src/codexAppServerManager.ts apps/server/src/codexAppServerManager.test.ts findings-codex-agent-view.md
git commit -m "fix: route Codex child turn lifecycle"
```

---

### Task 3: Prove full Codex child conversation and dock behavior end to end

**Files:**
- Test: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- Test: `apps/web/src/components/chat/ComposerSubagentStrip.logic.test.ts`
- Test: `apps/web/src/components/chat/SubagentDetailSections.browser.tsx`
- Modify: `findings-codex-agent-view.md`

**Interfaces:**
- Consumes: provider events from Task 2, normalized metadata from Task 1, `deriveComposerSubagentStripItems`, and `onOpenSubagentThread`.
- Produces: regression proof that a Codex agent becomes one child thread, receives complete timeline data and terminal state, renders correct strip metadata, and opens via the right-dock callback.

- [ ] **Step 1: Extend server ingestion coverage with a complete child event sequence**

Starting from the existing `creates and routes subagent runtime events into child threads` test, emit one mapped child sequence with stable provider refs:

```ts
turn.started
content.delta                  // assistant_text
item.completed                 // assistant_message
item.started / item.completed  // command_execution
content.delta                  // reasoning summary stream
item.completed                 // reasoning summary item
turn.tasks.updated             // mapped from Codex turn/plan/updated
turn.completed                 // completed
```

Assert there is exactly one local child ID (`subagent:thread-1:child-provider-1`), its session becomes `ready` with no active turn, and its messages/activities/proposed plan contain the child data. Assert the parent thread does not receive the child message, child lifecycle activity, child command activity, or child plan.

- [ ] **Step 2: Add failed and aborted terminal-state cases**

Emit a failed `turn.completed` and a `turn.aborted` for separate child IDs. Assert failed becomes child session `error` with a useful last error, aborted becomes `interrupted`, and both child threads remain materialized and readable.

- [ ] **Step 3: Run ingestion tests and verify the generic route is sufficient**

Run:

```text
bun run --cwd apps/server test -- src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
```

Expected after Task 2: routing and lifecycle assertions pass through the existing `providerRefs` target resolution without a production change to `ProviderRuntimeIngestion.ts`. If this expectation fails, stop Task 3 with `BLOCKED` and report the exact event type and assertion because the approved plan's generic-route premise is wrong.

- [ ] **Step 4: Add a Codex-specific strip derivation regression**

In `ComposerSubagentStrip.logic.test.ts`, create a parent collaboration activity whose receiver agent has direct model `gpt-5.6-codex`, effort `high`, role `explorer`, background `true`, and a resolved provider-native child thread. Assert the derived row contains the child local thread ID, `primaryLabel`, role, `modelLabel: "GPT-5.6 Codex · high"`, background state, and the correct running or settled status. Add a requested-model-only variant and assert no model label is shown.

- [ ] **Step 5: Preserve dock routing and lazy subscription behavior**

Keep the existing `SubagentDetailSections.browser.tsx` tests for callback precedence and retain/release balance. Add a Codex-labelled card fixture only if the existing fixture does not exercise model-plus-effort rendering; assert clicking full conversation invokes `onOpenSubagentThread` exactly once and never invokes the full-page `onOpenThread` fallback.

- [ ] **Step 6: Run the focused web regressions**

Run:

```text
bun run --cwd apps/web test -- src/components/chat/ComposerSubagentStrip.logic.test.ts src/components/chat/SubagentDetailSections.test.tsx src/components/chat/MessagesTimeline.test.tsx
```

Run the browser component test with:

```text
bun run --cwd apps/web test:browser -- src/components/chat/SubagentDetailSections.browser.tsx
```

Expected: metadata, status partitioning, dock callback precedence, lazy subscription balance, and non-virtualized small-transcript regression all pass.

- [ ] **Step 7: Run the complete focused feature suite**

Run:

```text
bun run --cwd packages/shared test -- src/subagents.test.ts
bun run --cwd apps/server test -- src/codexAppServerManager.test.ts src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
bun run --cwd apps/web test -- src/workLog.test.ts src/lib/subagentPresentation.test.ts src/components/chat/ComposerSubagentStrip.logic.test.ts src/components/chat/SubagentDetailSections.test.tsx src/components/chat/MessagesTimeline.test.tsx
```

Expected: all selected tests pass. Do not claim the task fully complete until the separately authorized heavyweight workspace checks also pass.

- [ ] **Step 8: Record evidence and commit the end-to-end regression slice**

Append exact test counts, commands, and any intentionally skipped browser/heavyweight check to `findings-codex-agent-view.md`. Stage only changed Task 3 files and commit:

```text
git add apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/web/src/components/chat/ComposerSubagentStrip.logic.test.ts apps/web/src/components/chat/SubagentDetailSections.browser.tsx findings-codex-agent-view.md
git commit -m "test: verify Codex agent conversation view"
```

If `SubagentDetailSections.browser.tsx` did not change, omit it from `git add` rather than staging an unrelated existing diff.

---

### Task 4: Final review and completion gate

**Files:**
- Review: all commits produced by Tasks 1-3
- Modify if required by review: only files already named in Tasks 1-3
- Modify: `findings-codex-agent-view.md`

**Interfaces:**
- Consumes: the complete feature diff and focused-test evidence.
- Produces: an independent code-review verdict, resolved important findings, and an explicit list of any checks still awaiting authorization.

- [ ] **Step 1: Inspect the exact feature diff**

Use the commit before Task 1 as the base. Verify the diff contains no user-owned provider/settings/Agent MCP changes and no new Codex-specific UI/store/protocol.

- [ ] **Step 2: Request independent review**

Review for spec compliance, actual-versus-requested model truthfulness, parent/child lifecycle isolation, duplicate-child risk, sparse-update behavior, transcript performance guardrails, and test quality. Any Critical or Important finding must be fixed by the coder and re-reviewed before completion.

- [ ] **Step 3: Re-run only tests covering review fixes**

Use each package's `bun run --cwd <workspace> test -- <exact affected test files>` command. Do not repeat the whole focused suite unless the review fix crosses task boundaries.

- [ ] **Step 4: Handle heavyweight workspace checks**

Because the repository requires `bun fmt`, `bun lint`, and `bun typecheck` before completion but forbids running them without explicit user authorization, report them as pending unless the user has authorized them in this conversation. If authorized, run the three commands once as a single final verification pass and record results in findings.

- [ ] **Step 5: Commit review fixes or findings updates**

Stage only feature-owned files. If review required code changes, commit with a focused fix message. If only findings changed, commit that file separately. Never amend or include unrelated dirty files.
