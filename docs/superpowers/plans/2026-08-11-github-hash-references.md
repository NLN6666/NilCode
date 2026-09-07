# GitHub Hash References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped `#` references for GitHub PRs/issues with structured prompt context, while limiting `@` chat references to ordinary top-level conversations.

**Architecture:** Enforce top-level thread eligibility at both the web selector and server projection. Add a dedicated GitHub reference contract/service, mixed search RPC, composer inline node, and bounded send-time context resolver.

**Tech Stack:** TypeScript, Effect, React, Lexical, TanStack Query, WebSocket RPC, GitHub CLI, Vitest, Bun.

## Global Constraints

- Exclude every thread whose `parentThreadId` is non-null from `@` references.
- Limit GitHub search to authoritative repositories of the active project and at most 20 results.
- Never forward GitHub references as provider-native mentions.
- Bound prompt context and never block sending when reference resolution fails.
- Preserve existing composer cursor, deletion, undo, and serialization behavior.
- Use `bun run test`; never `bun test`.
- Do not run `bun fmt`, `bun lint`, or `bun typecheck` without explicit authorization.
- Preserve unrelated changes and create one task-scoped commit.

---

### Task 1: Exclude subagent threads from `@` references

**Files:**

- Modify: `apps/web/src/storeSelectors.ts`
- Test: `apps/web/src/storeSelectors.test.ts`
- Modify: `apps/server/src/provider/threadMentionContext.ts`
- Test: `apps/server/src/provider/threadMentionContext.test.ts`

**Interfaces:** Consumes `SidebarThreadSummary.parentThreadId`; produces top-level-only composer sources and server projection that omits child transcripts.

- [ ] Add a selector test with literal top-level/child IDs:

```ts
const sources = selector(
  stateWithThreads([
    { id: "root", parentThreadId: null },
    { id: "child", parentThreadId: "root" },
  ]),
);
expect(sources.map(({ id }) => id)).toEqual(["root"]);
```

- [ ] Run `bun run --cwd apps/web test -- src/storeSelectors.test.ts` and confirm the new assertion fails by returning `child`.
- [ ] Change the selector's `flatMap` guard to `if (!thread || thread.parentThreadId) return [];`, retaining its existing memoized equality path.
- [ ] Add a server test whose `getThreadDetailById` returns an `OrchestrationThread` with `parentThreadId: root`; expect `contextBlocks` to equal `[]`.
- [ ] Run `bun run --cwd apps/server test -- src/provider/threadMentionContext.test.ts` and confirm the new assertion fails by containing child transcript text.
- [ ] Skip hydrated child threads in `resolveThreadMentionPromptProjection`, then re-run both focused files to green.

### Task 2: Define and normalize the GitHub reference domain

**Files:**

- Create: `packages/contracts/src/githubReferences.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/ws.ts`, `packages/contracts/src/rpc.ts`
- Test: `packages/contracts/src/githubReferences.test.ts`
- Modify: `apps/server/src/git/Services/GitHubCli.ts`, `apps/server/src/git/Layers/GitHubCli.ts`, `apps/server/src/git/testing/fakeGitHubCli.ts`
- Test: `apps/server/src/git/Layers/GitHubCli.test.ts`

**Interfaces:** Produces reference/search/detail schemas and `GitHubCliShape.searchRepositoryReferences` plus `getIssueDetail`.

- [ ] Add contract tests for this public shape and invalid number/repository/URL/limit cases:

```ts
type GitHubReference = {
  kind: "pull" | "issue";
  repository: string;
  number: number;
  title: string;
  url: string;
};
```

- [ ] Run `bun run --cwd packages/contracts test -- src/githubReferences.test.ts`; expected failure is a missing module/export.
- [ ] Implement `GitHubReference`, `GitHubReferenceSearchItem`, `GitHubReferencesSearchInput/Result`, and `GitHubReferenceDetailInput/Result`; export them and add `githubReferences.search/detail` to `WS_METHODS`, `WebSocketRequestBody`, RPC definitions, and `WsFeatureRpcGroup`.
- [ ] Add GitHub CLI tests with one literal Search API issue and one result containing `pull_request`; expect normalized kinds `issue` and `pull` and exact repository/number/title/url/state.
- [ ] Run `bun run --cwd apps/server test -- src/git/Layers/GitHubCli.test.ts`; expected failure is absent service methods.
- [ ] Add these service signatures and implement them through `execute`:

```ts
searchRepositoryReferences(input: { cwd: string; repository: string; query: string; limit: number }): Effect.Effect<GitHubReferenceSearchBatch, GitHubCliError>;
getIssueDetail(input: { cwd: string; repository: string; number: number }): Effect.Effect<GitHubIssueDetailData, GitHubCliError>;
```

- [ ] Extend the fake command router for the exact `gh api` invocations and run both focused files to green.

### Task 3: Add project-scoped service and RPC handlers

**Files:**

- Create: `apps/server/src/githubReferences/Services/GitHubReferenceService.ts`
- Create: `apps/server/src/githubReferences/Layers/GitHubReferenceService.ts`
- Test: `apps/server/src/githubReferences/Layers/GitHubReferenceService.test.ts`
- Modify: `apps/server/src/wsRpc.ts` and server layer composition peers.

**Interfaces:** Produces `search(input)` and `detail(input)` Effects using project lookup, repository resolution, and Task 2 GitHub methods.

- [ ] Write service tests against this interface:

```ts
interface GitHubReferenceServiceShape {
  search(
    input: GitHubReferencesSearchInput,
  ): Effect.Effect<GitHubReferencesSearchResult, GitHubReferencesUnavailableError>;
  detail(
    input: GitHubReferenceDetailInput,
  ): Effect.Effect<GitHubReferenceDetailResult, GitHubReferencesUnavailableError>;
}
```

- [ ] Cover preferred repository, exact `#123`, mixed ordering, no repository, foreign repository, missing/auth-failed `gh`, and deleted detail with literal expected results.
- [ ] Run `bun run --cwd apps/server test -- src/githubReferences/Layers/GitHubReferenceService.test.ts`; expected failure is missing service/layer.
- [ ] Implement project lookup, `resolveGitHubRepositories`, repository allow-list validation, `Math.min(input.limit ?? 20, 20)`, short query cache, and typed GitHub error mapping.
- [ ] Register the live layer and add `githubReferences.search/detail` handlers in `wsRpc.ts`, following `pullRequestsEffect` without exposing raw `GitHubCliError`.
- [ ] Re-run the service test and the exact contracts RPC tests changed in Task 2 to green.

### Task 4: Add `#` trigger, menu, and editor node

**Files:**

- Modify/Test: `apps/web/src/composer-logic.ts`, `apps/web/src/composer-logic.test.ts`
- Create/Test: `apps/web/src/lib/githubComposerReferences.ts`, `apps/web/src/lib/githubComposerReferences.test.ts`
- Modify/Test: `apps/web/src/components/composer-nodes/index.tsx`, `apps/web/src/composer-editor-mentions.ts`, `apps/web/src/composer-editor-mentions.test.ts`, `apps/web/src/components/ComposerPromptEditor.tsx`
- Modify/Test: `apps/web/src/components/chat/ComposerCommandMenu.tsx`, `apps/web/src/components/chat/ComposerCommandMenu.test.ts`
- Modify/Test: `apps/web/src/hooks/useComposerCommandMenuItems.ts`, `apps/web/src/hooks/useComposerCommandMenuItems.test.ts`
- Modify: `apps/web/src/i18n/locales/en/composer.ts`, `apps/web/src/i18n/locales/zh-CN/composer.ts`

**Interfaces:** Produces trigger/items, `ComposerGitHubReferenceNode`, pure token/reference filtering, and editor reference callbacks.

- [ ] Add trigger table tests with literal expectations:

```ts
expect(detectComposerTrigger("fix #12", 7)).toMatchObject({
  kind: "github-reference",
  query: "12",
  rangeStart: 4,
  rangeEnd: 7,
});
expect(detectComposerTrigger("https://x/#12", 13)).toBeNull();
expect(detectComposerTrigger("# heading", 9)).toBeNull();
```

- [ ] Run `bun run --cwd apps/web test -- src/composer-logic.test.ts`; confirm the `#12` case fails because no trigger exists, then implement the trigger and re-run green.
- [ ] Define pure helpers with exact signatures and tests for same-number/different-repository identity:

```ts
formatGitHubReferenceToken(reference: GitHubReference): string;
filterPromptGitHubReferences(prompt: string, references: readonly GitHubReference[]): GitHubReference[];
```

- [ ] Run `bun run --cwd apps/web test -- src/lib/githubComposerReferences.test.ts`; verify missing-module failure, implement canonical `#number` text plus repository/type keyed metadata filtering, and run green.
- [ ] Add editor tests that parse a serialized GitHub node, return `#123` from root text, remove its structured reference on deletion, and leave adjacent Mention/Skill/MCP nodes intact; verify red.
- [ ] Implement `ComposerGitHubReferenceNode` with `getReference(): GitHubReference`, text content `#${number}`, JSON import/export, DOM rendering, and inclusion in `ComposerInlineTokenNode`, `COMPOSER_NODE_CLASSES`, cursor/delete/offset branches, and segment parsing.
- [ ] Add a `github-reference` menu item/group test and implement label/type/state/repository presentation plus English/Chinese group copy.
- [ ] Run `bun run --cwd apps/web test -- src/composer-logic.test.ts src/lib/githubComposerReferences.test.ts src/composer-editor-mentions.test.ts src/components/chat/ComposerCommandMenu.test.ts src/hooks/useComposerCommandMenuItems.test.ts` to green.

### Task 5: Wire search, payloads, and bounded context

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`, `apps/web/src/lib/gitReactQuery.ts`, focused ChatView tests.
- Create/Test: `apps/server/src/provider/githubReferenceContext.ts`, `apps/server/src/provider/githubReferenceContext.test.ts`
- Modify: provider dispatch/steer paths and turn contracts/projection fields carrying `githubReferences`.

**Interfaces:** Consumes Tasks 3–4; produces debounced search, selected refs in optimistic/real payloads, and `<github_reference_context>` blocks.

- [ ] Add formatter/resolver tests against this result shape:

```ts
interface ResolvedGitHubReferencePromptProjection {
  contextBlocks: readonly string[];
  unresolvedReferences: readonly GitHubReference[];
}
```

- [ ] Cover issue, PR, inaccessible item, per-block truncation, total budget, count cap, and provider-mention separation; run `bun run --cwd apps/server test -- src/provider/githubReferenceContext.test.ts` and verify missing-module failure.
- [ ] Implement bounded `<github_reference_context>` formatting and Effect resolution through `GitHubReferenceService.detail`.
- [ ] Add ChatView-focused tests that select one row, delete the node, ignore an older search response, and compare optimistic/real `githubReferences` payload arrays literally; verify red.
- [ ] Wire debounced RPC query, selection replacement, editor state, optimistic send, real dispatch/steer fields, orchestration projection, and provider context append.
- [ ] Run the new context test and exact changed ChatView test files to green.

### Task 6: Regression, review, and commit

**Files:** Modify `findings.md`; review all task-owned files.

- [ ] Run the complete focused contracts/server/web suite.
- [ ] Inspect `git diff --check`, status, and exact diff.
- [ ] Request one independent read-only review; fix Critical/Important findings and re-run affected tests. Maximum two reviews.
- [ ] Record exact evidence and skipped heavyweight checks in `findings.md`.
- [ ] Stage only task files, inspect staged diff, and commit `feat: add GitHub composer references`.

Focused commands:

```text
bun run --cwd packages/contracts test -- src/githubReferences.test.ts src/rpc.test.ts
bun run --cwd apps/server test -- src/git/Layers/GitHubCli.test.ts src/githubReferences/Layers/GitHubReferenceService.test.ts src/provider/threadMentionContext.test.ts src/provider/githubReferenceContext.test.ts
bun run --cwd apps/web test -- src/storeSelectors.test.ts src/composer-logic.test.ts src/lib/githubComposerReferences.test.ts src/composer-editor-mentions.test.ts src/components/chat/ComposerCommandMenu.test.ts src/hooks/useComposerCommandMenuItems.test.ts
git diff --check
```
