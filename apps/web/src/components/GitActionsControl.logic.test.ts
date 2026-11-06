import type { GitStatusResult } from "@synara/contracts";
import { assert, describe, it } from "vitest";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  requiresFeatureBranchForDefaultBranchAction,
  requiresDefaultBranchConfirmation,
  resolveAutoFeatureBranchName,
  resolveCreatePrActionAvailability,
  resolveCreatePrBaseBranch,
  resolveCreatePrBrowserPreparation,
  resolveCreatePrDialogExecution,
  resolveCreatePrDialogRuntimeStatus,
  resolveCreatePrDialogView,
  resolveCreatePrExecution,
  resolveCommitDialogActions,
  resolveDefaultCreateBranchName,
  resolveLiveThreadBranchUpdate,
  resolvePromotedPullPresentation,
  resolvePullActionAvailability,
  resolveQuickAction,
  shouldOfferCreateBranchPrompt,
  shouldPromotePullAction,
  summarizeGitResult,
} from "./GitActionsControl.logic";

function statusPr(
  overrides: Partial<NonNullable<GitStatusResult["pr"]>> = {},
): NonNullable<GitStatusResult["pr"]> {
  return {
    number: 10,
    title: "Open PR",
    url: "https://example.com/pr/10",
    baseBranch: "main",
    headBranch: "feature/test",
    state: "open",
    isDraft: false,
    mergeability: "unknown",
    additions: null,
    deletions: null,
    changedFiles: null,
    ...overrides,
  };
}

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    branch: "feature/test",
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: true,
    upstreamBranch: "feature/test",
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

function menuActionStates(items: ReturnType<typeof buildMenuItems>) {
  return items.map(({ id, disabled, kind, dialogAction }) => ({
    id,
    disabled,
    kind,
    dialogAction: dialogAction ?? null,
  }));
}

describe("when: branch is clean and has an open PR", () => {
  it("resolveQuickAction opens the existing PR", () => {
    const quick = resolveQuickAction(
      status({
        pr: statusPr({ number: 10, title: "Open PR", url: "https://example.com/pr/10" }),
      }),
      false,
    );
    assert.deepInclude(quick, { kind: "open_pr", disabled: false });
  });

  it("buildMenuItems disables commit/push and enables open PR", () => {
    const items = buildMenuItems(
      status({
        pr: statusPr({ number: 11, title: "Existing PR", url: "https://example.com/pr/11" }),
      }),
      false,
    );
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: true, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: true, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: false, kind: "open_pr", dialogAction: null },
    ]);
  });
});

describe("when: actions are busy", () => {
  it("resolveQuickAction returns running disabled state", () => {
    const quick = resolveQuickAction(status(), true);
    assert.deepInclude(quick, {
      kind: "show_hint",
      disabled: true,
    });
  });

  it("buildMenuItems disables all actions", () => {
    const items = buildMenuItems(status(), true);
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: true, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: true, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: true, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });
});

describe("when: git status is unavailable", () => {
  it("resolveQuickAction returns unavailable disabled state", () => {
    const quick = resolveQuickAction(null, false);
    assert.deepInclude(quick, {
      kind: "show_hint",
      disabled: true,
    });
  });

  it("buildMenuItems returns no menu items", () => {
    const items = buildMenuItems(null, false);
    assert.deepEqual(items, []);
  });
});

describe("when: branch is clean, ahead, and has an open PR", () => {
  it("resolveQuickAction prefers push", () => {
    const quick = resolveQuickAction(
      status({
        aheadCount: 3,
        pr: statusPr({ number: 13, title: "Open PR", url: "https://example.com/pr/13" }),
      }),
      false,
    );
    assert.deepInclude(quick, { kind: "run_action", action: "push", disabled: false });
  });
});

describe("when: branch is clean, ahead, and has no open PR", () => {
  it("resolveQuickAction pushes and creates a PR", () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, pr: null }), false);
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
    });
  });

  it("buildMenuItems enables push and create PR, with commit disabled", () => {
    const items = buildMenuItems(status({ aheadCount: 2, pr: null }), false);
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: true, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: false, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: false, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });
});

describe("when: branch is clean, up to date, and has no open PR", () => {
  it("resolveQuickAction returns disabled commit on a published feature branch", () => {
    const quick = resolveQuickAction(
      status({ aheadCount: 0, behindCount: 0, hasWorkingTreeChanges: false, pr: null }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "show_hint",
      disabled: true,
    });
  });

  it("resolveCreatePrActionAvailability blocks stale create-pr calls for default upstream", () => {
    const availability = resolveCreatePrActionAvailability({
      gitStatus: status({
        branch: "synara/pi-cleanup",
        upstreamBranch: "main",
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
      defaultBranchName: "main",
    });

    assert.isFalse(availability.canRun);
  });

  it("resolveCreatePrActionAvailability explains why literal create_pr cannot run dirty", () => {
    const availability = resolveCreatePrActionAvailability({
      gitStatus: status({ hasWorkingTreeChanges: true }),
      defaultBranchName: "main",
    });

    assert.isFalse(availability.canRun);
  });
});

describe("when: branch is behind upstream", () => {
  it("resolveQuickAction returns pull", () => {
    const quick = resolveQuickAction(status({ behindCount: 2 }), false);
    assert.deepInclude(quick, { kind: "run_pull", disabled: false });
  });

  it("resolvePullActionAvailability enables pull", () => {
    const availability = resolvePullActionAvailability({
      gitStatus: status({ behindCount: 2 }),
      isBusy: false,
    });

    assert.deepEqual(availability, { canRun: true, hint: null });
  });

  it("promotes Pull while behind upstream", () => {
    const quick = resolveQuickAction(status({ behindCount: 2 }), false);
    assert.equal(shouldPromotePullAction({ quickAction: quick, isPullRunning: false }), true);
    assert.isNotNull(resolvePromotedPullPresentation({ quickAction: quick, isPullRunning: false }));
  });

  it("resolvePromotedPullPresentation does not use the busy Commit hint", () => {
    const busyQuickAction = resolveQuickAction(status({ behindCount: 2 }), true);
    assert.deepInclude(busyQuickAction, { kind: "show_hint", disabled: true });
    assert.equal(
      resolvePromotedPullPresentation({
        quickAction: busyQuickAction,
        isPullRunning: false,
      }),
      null,
    );
  });
});

describe("when: branch has diverged from upstream", () => {
  it("resolveQuickAction returns a disabled sync hint", () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, behindCount: 1 }), false);
    assert.deepInclude(quick, { disabled: true, kind: "show_hint" });
  });

  it("resolvePullActionAvailability blocks fast-forward pull", () => {
    const availability = resolvePullActionAvailability({
      gitStatus: status({ aheadCount: 2, behindCount: 1 }),
      isBusy: false,
    });

    assert.isFalse(availability.canRun);
  });
});

describe("when: branch is up to date", () => {
  it("resolvePullActionAvailability disables pull", () => {
    const availability = resolvePullActionAvailability({
      gitStatus: status({ aheadCount: 0, behindCount: 0 }),
      isBusy: false,
    });

    assert.isFalse(availability.canRun);
  });

  it("does not promote Pull for an up-to-date branch", () => {
    const quick = resolveQuickAction(status({ aheadCount: 0, behindCount: 0 }), false);

    assert.equal(
      resolvePromotedPullPresentation({ quickAction: quick, isPullRunning: false }),
      null,
    );
  });
});

describe("when: working tree has local changes", () => {
  it("resolveQuickAction returns commit, push, and create PR", () => {
    const quick = resolveQuickAction(status({ hasWorkingTreeChanges: true }), false);
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push_pr",
    });
  });

  it("resolveQuickAction falls back to commit when no origin remote exists", () => {
    const quick = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, hasUpstream: false }),
      false,
      false,
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit",
      disabled: false,
    });
  });

  it("resolveQuickAction hides create-branch when the caller opts out", () => {
    const quick = resolveQuickAction(
      status({ branch: "worktree/semantic-name", hasUpstream: false }),
      false,
      false,
      true,
      false,
    );
    assert.deepInclude(quick, {
      kind: "show_hint",
      disabled: true,
    });
  });

  it("resolveQuickAction shows create-branch when the caller opts in", () => {
    const quick = resolveQuickAction(
      status({ branch: "worktree/semantic-name", hasUpstream: false }),
      false,
      false,
      true,
      true,
    );
    assert.deepInclude(quick, {
      kind: "create_branch",
      disabled: false,
    });
  });

  it("buildMenuItems enables commit and create PR while push stays disabled", () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true }), false);
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: false, kind: "open_dialog", dialogAction: "commit" },
      { id: "commit_push", disabled: false, kind: "open_dialog", dialogAction: "commit_push" },
      { id: "push", disabled: true, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: false, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });
});

describe("when: on default branch without open PR", () => {
  it("resolveQuickAction returns commit and push when local changes exist", () => {
    const quick = resolveQuickAction(
      status({ branch: "main", hasWorkingTreeChanges: true }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      disabled: false,
    });
  });

  it("resolveQuickAction returns push when branch is ahead", () => {
    const quick = resolveQuickAction(
      status({ branch: "main", aheadCount: 2, pr: null }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      disabled: false,
    });
  });

  it("buildMenuItems enables commit-and-push and create PR when local changes exist on default branch", () => {
    const items = buildMenuItems(
      status({ branch: "main", hasWorkingTreeChanges: true, aheadCount: 0, pr: null }),
      false,
      true,
      true,
    );
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: false, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: false, kind: "open_dialog", dialogAction: "commit_push" },
      { id: "pr", disabled: false, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });

  it("does not enable create PR on a clean default branch with nothing new to publish", () => {
    const items = buildMenuItems(
      status({ branch: "main", aheadCount: 0, behindCount: 0, pr: null }),
      false,
      true,
      true,
    );
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: true, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: true, kind: "open_dialog", dialogAction: "commit_push" },
      { id: "pr", disabled: true, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });
});

describe("when: working tree has local changes and branch is behind upstream", () => {
  it("resolveQuickAction automatically prefers pulling before commit or push flows", () => {
    const quick = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, behindCount: 1 }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_pull",
      disabled: false,
    });
  });

  it("buildMenuItems enables commit and keeps push and PR disabled", () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true, behindCount: 2 }), false);
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: false, kind: "open_dialog", dialogAction: "commit" },
      { id: "commit_push", disabled: true, kind: "open_dialog", dialogAction: "commit_push" },
      { id: "push", disabled: true, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: true, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });
});

describe("when: HEAD is detached and there are no local changes", () => {
  it("resolveQuickAction shows detached head hint", () => {
    const quick = resolveQuickAction(
      status({ branch: null, hasWorkingTreeChanges: false, hasUpstream: false }),
      false,
    );
    assert.deepInclude(quick, { kind: "show_hint", disabled: true });
  });

  it("resolveQuickAction offers to attach the managed worktree to a branch", () => {
    const quick = resolveQuickAction(
      status({ branch: null, hasWorkingTreeChanges: false, hasUpstream: false }),
      false,
      false,
      true,
      true,
    );
    assert.deepInclude(quick, { kind: "create_branch", disabled: false });
  });
});

describe("when: branch has no upstream configured", () => {
  it("resolveQuickAction opens PR when clean, no upstream, no local commits are ahead, and PR exists", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 0,
        pr: statusPr({ number: 14, title: "Existing PR", url: "https://example.com/pr/14" }),
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "open_pr",
      disabled: false,
    });
  });

  it("resolveQuickAction runs push when clean, no upstream, and local commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 1,
        pr: statusPr({ number: 15, title: "Existing PR", url: "https://example.com/pr/15" }),
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "push",
      disabled: false,
    });
  });

  it("resolveQuickAction runs push and create PR when no upstream and commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 2,
        pr: null,
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
      disabled: false,
    });
  });

  it("resolveQuickAction disables push-and-pr flows when no origin remote exists", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 2,
        pr: null,
      }),
      false,
      false,
      false,
    );
    assert.deepInclude(quick, { kind: "show_hint", disabled: true });
  });

  it("buildMenuItems enables create PR when no upstream and commits are ahead", () => {
    const items = buildMenuItems(status({ hasUpstream: false, pr: null, aheadCount: 2 }), false);
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: true, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: false, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: false, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });

  it("buildMenuItems disables push and create PR when no origin remote exists", () => {
    const items = buildMenuItems(
      status({ hasUpstream: false, pr: null, aheadCount: 2 }),
      false,
      false,
    );
    assert.deepEqual(menuActionStates(items), [
      { id: "commit", disabled: true, kind: "open_dialog", dialogAction: "commit" },
      { id: "push", disabled: true, kind: "open_dialog", dialogAction: "push" },
      { id: "pr", disabled: true, kind: "open_dialog", dialogAction: "create_pr" },
    ]);
  });

  it("resolveQuickAction uses push-only on default branch when no upstream exists and commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        branch: "main",
        hasUpstream: false,
        aheadCount: 1,
        pr: null,
      }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      disabled: false,
    });
  });
});

describe("resolveCreatePrExecution", () => {
  const baseInput = {
    isBusy: false,
    isDefaultBranch: false,
    hasOriginRemote: true,
    defaultBranchName: "main",
  };

  it("runs the full commit+push+PR chain when the working tree is dirty", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ hasWorkingTreeChanges: true }),
    });
    assert.deepEqual(execution, { kind: "run_action", action: "commit_push_pr" });
  });

  it("runs push+PR when the branch is clean but ahead", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ aheadCount: 2 }),
    });
    assert.deepEqual(execution, { kind: "run_action", action: "create_pr" });
  });

  it("runs create PR for a clean published feature branch", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ aheadCount: 0 }),
    });
    assert.deepEqual(execution, { kind: "run_action", action: "create_pr" });
  });

  it("opens the existing PR instead of creating a new one", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ hasWorkingTreeChanges: true, pr: statusPr() }),
    });
    assert.deepEqual(execution, { kind: "open_pr" });
  });

  it("stays unavailable when the branch is behind upstream, even with local changes", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ hasWorkingTreeChanges: true, behindCount: 1 }),
    });
    assert.equal(execution.kind, "unavailable");
  });

  it("stays unavailable when the branch has diverged from upstream", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ aheadCount: 2, behindCount: 1 }),
    });
    assert.equal(execution.kind, "unavailable");
  });

  it("stays unavailable without an origin remote", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      hasOriginRemote: false,
      gitStatus: status({ hasWorkingTreeChanges: true, hasUpstream: false, upstreamBranch: null }),
    });
    assert.equal(execution.kind, "unavailable");
  });

  it("stays unavailable on a detached HEAD", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({ branch: null }),
    });
    assert.equal(execution.kind, "unavailable");
  });

  it("stays unavailable when a clean branch only tracks the default branch", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      gitStatus: status({
        branch: "synara/pi-cleanup",
        upstreamBranch: "main",
        aheadCount: 0,
      }),
    });
    assert.equal(execution.kind, "unavailable");
  });

  it("stays unavailable while a git action is running", () => {
    const execution = resolveCreatePrExecution({
      ...baseInput,
      isBusy: true,
      gitStatus: status({ hasWorkingTreeChanges: true }),
    });
    assert.equal(execution.kind, "unavailable");
  });
});

describe("resolveCreatePrDialogExecution", () => {
  const baseContext = {
    isBusy: false,
    isDefaultBranch: false,
    hasOriginRemote: true,
    defaultBranchName: "main",
  };

  it("keeps the full commit chain when local changes are included", () => {
    const execution = resolveCreatePrDialogExecution(
      { ...baseContext, gitStatus: status({ hasWorkingTreeChanges: true }) },
      true,
    );
    assert.deepEqual(execution, { kind: "run_action", action: "commit_push_pr" });
  });

  it("evaluates a dirty tree as clean when local changes are excluded", () => {
    const execution = resolveCreatePrDialogExecution(
      { ...baseContext, gitStatus: status({ hasWorkingTreeChanges: true, aheadCount: 2 }) },
      false,
    );
    assert.deepEqual(execution, { kind: "run_action", action: "create_pr" });
  });

  it("reports unavailability when excluding changes leaves nothing to include", () => {
    const execution = resolveCreatePrDialogExecution(
      {
        ...baseContext,
        gitStatus: status({
          hasWorkingTreeChanges: true,
          upstreamBranch: "main",
          aheadCount: 0,
        }),
      },
      false,
    );
    assert.equal(execution.kind, "unavailable");
  });

  it("keeps blocking states (behind upstream) regardless of the toggle", () => {
    const execution = resolveCreatePrDialogExecution(
      { ...baseContext, gitStatus: status({ hasWorkingTreeChanges: true, behindCount: 1 }) },
      false,
    );
    assert.equal(execution.kind, "unavailable");
  });
});

describe("resolveCommitDialogActions", () => {
  const baseContext = {
    isBusy: false,
    isDefaultBranch: false,
    hasOriginRemote: true,
    defaultBranchName: "main",
  };
  const dirtyStatus = status({
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [{ path: "a.ts", insertions: 3, deletions: 1 }],
      insertions: 3,
      deletions: 1,
    },
  });
  const byId = (context: Parameters<typeof resolveCommitDialogActions>[0]) =>
    Object.fromEntries(resolveCommitDialogActions(context).map((action) => [action.id, action]));

  it("offers commit, commit & push, and PR on a dirty feature branch", () => {
    const actions = byId({
      context: { ...baseContext, gitStatus: dirtyStatus },
      hasFileSelection: true,
    });
    assert.deepInclude(actions.commit, {
      action: "commit",
      featureBranch: false,
      disabled: false,
    });
    assert.deepInclude(actions.commit_new_branch, {
      action: "commit",
      featureBranch: true,
      disabled: false,
    });
    assert.deepInclude(actions.commit_push, {
      action: "commit_push",
      disabled: false,
    });
    assert.deepInclude(actions.create_pr, { action: "create_pr", disabled: false });
  });

  it("blocks every commit row while all files are excluded", () => {
    const actions = byId({
      context: { ...baseContext, gitStatus: dirtyStatus },
      hasFileSelection: false,
    });
    assert.equal(actions.commit?.disabled, true);
    assert.isNotEmpty(actions.commit?.disabledReason);
    assert.equal(actions.commit_new_branch?.disabled, true);
    assert.equal(actions.commit_push?.disabled, true);
    // The PR row hands off to the Create PR dialog, so it ignores the file selection.
    assert.equal(actions.create_pr?.disabled, false);
  });

  it("collapses the push row to a pure push on a clean branch that is ahead", () => {
    const actions = byId({
      context: { ...baseContext, gitStatus: status({ aheadCount: 2 }) },
      hasFileSelection: true,
    });
    assert.deepInclude(actions.commit_push, {
      action: "push",
      disabled: false,
    });
    assert.equal(actions.commit?.disabled, true);
    assert.isNotEmpty(actions.commit?.disabledReason);
  });

  it("explains why commit & push is blocked behind upstream", () => {
    const actions = byId({
      context: {
        ...baseContext,
        gitStatus: status({ hasWorkingTreeChanges: true, behindCount: 1 }),
      },
      hasFileSelection: true,
    });
    assert.equal(actions.commit?.disabled, false);
    assert.equal(actions.commit_push?.disabled, true);
    assert.isNotEmpty(actions.commit_push?.disabledReason);
  });

  it("uses the commit & push reason for the default-branch push menu item", () => {
    const actions = byId({
      context: {
        ...baseContext,
        isDefaultBranch: true,
        gitStatus: status({ branch: "main", hasWorkingTreeChanges: true, behindCount: 1 }),
      },
      hasFileSelection: true,
    });
    assert.equal(actions.commit_push?.disabled, true);
    assert.isNotEmpty(actions.commit_push?.disabledReason);
  });

  it("disables everything while a git action is running", () => {
    const actions = resolveCommitDialogActions({
      context: { ...baseContext, gitStatus: dirtyStatus, isBusy: true },
      hasFileSelection: true,
    });
    assert.isTrue(actions.every((action) => action.disabled));
    assert.isTrue(actions.every((action) => Boolean(action.disabledReason)));
  });
});

describe("resolveCreatePrDialogRuntimeStatus", () => {
  it("uses a newly dirty live tree instead of a clean post-push snapshot", () => {
    const postPushStatus = status({ hasWorkingTreeChanges: false, aheadCount: 0 });
    const liveStatus = status({
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "new-edit.ts", insertions: 7, deletions: 2 }],
        insertions: 7,
        deletions: 2,
      },
    });

    const resolved = resolveCreatePrDialogRuntimeStatus({
      liveGitStatus: liveStatus,
      statusOverride: postPushStatus,
      statusOverrideSource: status(),
      isDefaultBranch: false,
      isDefaultBranchOverride: false,
    });

    assert.strictEqual(resolved.gitStatus, liveStatus);
    assert.isTrue(resolved.gitStatus?.hasWorkingTreeChanges);
    assert.isNull(resolved.statusOverride);
  });

  it("keeps the post-push snapshot while the cache still returns its source object", () => {
    const stalePrePushStatus = status({ aheadCount: 2 });
    const postPushStatus = status({ hasUpstream: true, aheadCount: 0 });

    const resolved = resolveCreatePrDialogRuntimeStatus({
      liveGitStatus: stalePrePushStatus,
      statusOverride: postPushStatus,
      statusOverrideSource: stalePrePushStatus,
      isDefaultBranch: true,
      isDefaultBranchOverride: false,
    });

    assert.strictEqual(resolved.gitStatus, postPushStatus);
    assert.strictEqual(resolved.statusOverride, postPushStatus);
    assert.isFalse(resolved.isDefaultBranch);
  });

  it("keeps the post-push snapshot while live status is unavailable", () => {
    const postPushStatus = status({ hasUpstream: true, aheadCount: 0 });

    const resolved = resolveCreatePrDialogRuntimeStatus({
      liveGitStatus: null,
      statusOverride: postPushStatus,
      statusOverrideSource: status({ aheadCount: 2 }),
      isDefaultBranch: false,
      isDefaultBranchOverride: false,
    });

    assert.strictEqual(resolved.gitStatus, postPushStatus);
    assert.strictEqual(resolved.statusOverride, postPushStatus);
  });
});

describe("resolveCreatePrDialogView", () => {
  const baseContext = {
    isBusy: false,
    isDefaultBranch: false,
    hasOriginRemote: true,
    defaultBranchName: "main",
  };

  it("describes a published feature branch as an existing branch", () => {
    const view = resolveCreatePrDialogView({ ...baseContext, gitStatus: status() });
    assert.deepEqual(view, {
      branchName: "feature/test",
      baseBranchName: "main",
      isNewBranch: false,
      willCreateFeatureBranch: false,
      showCommitToggle: false,
      insertions: 0,
      deletions: 0,
    });
  });

  it("uses a different tracked upstream as the PR base branch", () => {
    const gitStatus = status({
      branch: "feature/test",
      hasUpstream: true,
      upstreamBranch: "develop",
    });

    assert.equal(resolveCreatePrBaseBranch(gitStatus, "main"), "develop");
    assert.equal(
      resolveCreatePrDialogView({ ...baseContext, gitStatus }).baseBranchName,
      "develop",
    );
  });

  it("prefers the configured PR merge base over the tracked upstream", () => {
    const gitStatus = status({
      branch: "feature/test",
      hasUpstream: true,
      upstreamBranch: "develop",
      configuredPrBaseBranch: "release",
    });

    assert.equal(resolveCreatePrBaseBranch(gitStatus, "main"), "release");
    assert.equal(
      resolveCreatePrDialogView({ ...baseContext, gitStatus }).baseBranchName,
      "release",
    );
  });

  it("describes an unpublished branch as new and surfaces diff stats", () => {
    const view = resolveCreatePrDialogView({
      ...baseContext,
      gitStatus: status({
        hasWorkingTreeChanges: true,
        hasUpstream: false,
        upstreamBranch: null,
        workingTree: {
          files: [{ path: "a.ts", insertions: 400, deletions: 41 }],
          insertions: 400,
          deletions: 41,
        },
      }),
    });
    assert.isTrue(view.isNewBranch);
    assert.isFalse(view.willCreateFeatureBranch);
    assert.isTrue(view.showCommitToggle);
    assert.equal(view.insertions, 400);
    assert.equal(view.deletions, 41);
  });

  it("plans an auto-named feature branch on the default branch", () => {
    const view = resolveCreatePrDialogView({
      ...baseContext,
      isDefaultBranch: true,
      gitStatus: status({ branch: "main", upstreamBranch: "main", hasWorkingTreeChanges: true }),
    });
    assert.isTrue(view.isNewBranch);
    assert.isTrue(view.willCreateFeatureBranch);
  });

  it("falls back to main without a resolved default branch name", () => {
    const view = resolveCreatePrDialogView({
      ...baseContext,
      defaultBranchName: null,
      gitStatus: null,
    });
    assert.equal(view.baseBranchName, "main");
    assert.isNull(view.branchName);
  });
});

describe("resolveCreatePrBrowserPreparation", () => {
  const baseContext = {
    isBusy: false,
    isDefaultBranch: false,
    hasOriginRemote: true,
    defaultBranchName: "main",
  };

  it("commits and pushes (without creating the PR) when local changes are included", () => {
    const preparation = resolveCreatePrBrowserPreparation(
      { ...baseContext, gitStatus: status({ hasWorkingTreeChanges: true }) },
      true,
    );
    assert.deepEqual(preparation, { kind: "run_action", action: "commit_push" });
  });

  it("pushes first when the branch is ahead of upstream", () => {
    const preparation = resolveCreatePrBrowserPreparation(
      { ...baseContext, gitStatus: status({ aheadCount: 2 }) },
      true,
    );
    assert.deepEqual(preparation, { kind: "run_action", action: "push" });
  });

  it("pushes committed work only when local changes are excluded on an ahead branch", () => {
    const preparation = resolveCreatePrBrowserPreparation(
      { ...baseContext, gitStatus: status({ hasWorkingTreeChanges: true, aheadCount: 1 }) },
      false,
    );
    assert.deepEqual(preparation, { kind: "run_action", action: "push" });
  });

  it("opens the compare page directly for a clean published branch", () => {
    const preparation = resolveCreatePrBrowserPreparation(
      { ...baseContext, gitStatus: status() },
      true,
    );
    assert.deepEqual(preparation, { kind: "open_compare" });
  });

  it("passes through open-PR and unavailable outcomes", () => {
    assert.deepEqual(
      resolveCreatePrBrowserPreparation(
        { ...baseContext, gitStatus: status({ pr: statusPr() }) },
        true,
      ),
      { kind: "open_pr" },
    );
    const unavailable = resolveCreatePrBrowserPreparation(
      { ...baseContext, gitStatus: null },
      true,
    );
    assert.equal(unavailable.kind, "unavailable");
    if (unavailable.kind === "unavailable") assert.isNotEmpty(unavailable.hint);
  });
});

describe("requiresDefaultBranchConfirmation", () => {
  it("requires confirmation for push actions on default branch", () => {
    assert.isFalse(requiresDefaultBranchConfirmation("commit", true));
    assert.isTrue(requiresDefaultBranchConfirmation("push", true));
    assert.isTrue(requiresDefaultBranchConfirmation("create_pr", true));
    assert.isTrue(requiresDefaultBranchConfirmation("commit_push", true));
    assert.isTrue(requiresDefaultBranchConfirmation("commit_push_pr", true));
    assert.isFalse(requiresDefaultBranchConfirmation("commit_push", false));
  });
});

describe("requiresFeatureBranchForDefaultBranchAction", () => {
  it("requires feature branches for PR actions on the default branch", () => {
    assert.isFalse(requiresFeatureBranchForDefaultBranchAction("push"));
    assert.isFalse(requiresFeatureBranchForDefaultBranchAction("commit_push"));
    assert.isTrue(requiresFeatureBranchForDefaultBranchAction("create_pr"));
    assert.isTrue(requiresFeatureBranchForDefaultBranchAction("commit_push_pr"));
  });
});

describe("buildGitActionProgressStages", () => {
  it("shows push-only stages for the dedicated push action", () => {
    const stages = buildGitActionProgressStages({
      action: "push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
    });
    assert.lengthOf(stages, 1);
    assert.include(stages[0] ?? "", "origin/feature/test");
  });

  it("shows push and pr stages when create-pr needs to publish first", () => {
    const stages = buildGitActionProgressStages({
      action: "create_pr",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
      shouldPushBeforePr: true,
    });
    const prOnlyStage = buildGitActionProgressStages({
      action: "create_pr",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
      shouldPushBeforePr: false,
    });
    assert.lengthOf(stages, 2);
    assert.include(stages[0] ?? "", "origin/feature/test");
    assert.deepEqual(stages.slice(1), prOnlyStage);
  });

  it("shows only push progress when push-only is forced", () => {
    const stages = buildGitActionProgressStages({
      action: "commit_push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      forcePushOnly: true,
      pushTarget: "origin/feature/test",
    });
    const pushOnlyStages = buildGitActionProgressStages({
      action: "push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, pushOnlyStages);
    assert.include(stages[0] ?? "", "origin/feature/test");
  });

  it("includes commit stages for commit+push when working tree is dirty", () => {
    const stages = buildGitActionProgressStages({
      action: "commit_push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    const customMessageStages = buildGitActionProgressStages({
      action: "commit_push",
      hasCustomCommitMessage: true,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    assert.lengthOf(stages, 3);
    assert.lengthOf(customMessageStages, 2);
    assert.deepEqual(stages.slice(1), customMessageStages);
    assert.include(stages[2] ?? "", "origin/feature/test");
  });
});

describe("summarizeGitResult", () => {
  it("returns push-focused toast for push action", () => {
    const result = summarizeGitResult({
      action: "commit_push",
      branch: { status: "skipped_not_requested" },
      commit: {
        status: "created",
        commitSha: "abcdef0123456789",
        subject: "fix: tighten quick action tooltip hover handling",
      },
      push: {
        status: "pushed",
        branch: "foo",
        upstreamBranch: "origin/foo",
      },
      pr: { status: "skipped_not_requested" },
    });

    assert.include(result.title, "abcdef0");
    assert.include(result.title, "origin/foo");
    assert.equal(result.description, "fix: tighten quick action tooltip hover handling");
  });

  it("truncates long description text", () => {
    const result = summarizeGitResult({
      action: "commit_push_pr",
      branch: { status: "skipped_not_requested" },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "short subject",
      },
      push: { status: "pushed", branch: "foo" },
      pr: {
        status: "created",
        number: 99,
        title:
          "feat: this title is intentionally extremely long so we can validate that toast descriptions are truncated with an ellipsis suffix",
      },
    });

    assert.include(result.title, "#99");
    assert.equal(
      result.description,
      "feat: this title is intentionally extremely long so we can validate t...",
    );
  });
});

describe("resolveAutoFeatureBranchName", () => {
  it("uses semantic preferred branch names when available", () => {
    const branch = resolveAutoFeatureBranchName(["main", "feature/other"], "fix toast copy");
    assert.equal(branch, "feature/fix-toast-copy");
  });

  it("normalizes preferred names that already include a branch namespace", () => {
    const branch = resolveAutoFeatureBranchName(["main"], "feature/refine-toolbar-actions");
    assert.equal(branch, "feature/refine-toolbar-actions");
  });

  it("increments suffix when the preferred branch name already exists", () => {
    const branch = resolveAutoFeatureBranchName(
      ["main", "feature/fix-toast-copy", "feature/fix-toast-copy-2"],
      "fix toast copy",
    );
    assert.equal(branch, "feature/fix-toast-copy-3");
  });

  it("treats existing branch names as case-insensitive for collision checks", () => {
    const branch = resolveAutoFeatureBranchName(["Feature/Ticket-1"], "feature/ticket-1");
    assert.equal(branch, "feature/ticket-1-2");
  });

  it("falls back to feature/update when no preferred name is provided", () => {
    const branch = resolveAutoFeatureBranchName(["main"]);
    assert.equal(branch, "feature/update");
  });
});

describe("resolveDefaultCreateBranchName", () => {
  it("normalizes an existing legacy synara namespace", () => {
    const branch = resolveDefaultCreateBranchName(["main"], "synara/refine-toolbar-actions");
    assert.equal(branch, "synara/refine-toolbar-actions");
  });
});

describe("resolveLiveThreadBranchUpdate", () => {
  it("does not regress a semantic thread branch back to a temporary worktree branch", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "feature/semantic-branch",
      gitStatus: status({ branch: "synara/deadbeef" }),
    });

    assert.equal(update, null);
  });

  it("accepts real branch changes", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "feature/old",
      gitStatus: status({ branch: "feature/new" }),
    });

    assert.deepEqual(update, { branch: "feature/new" });
  });

  it("does not treat pending branch discovery as out-of-sync with status", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: null,
      gitStatus: status({ branch: "main" }),
    });

    assert.equal(update, null);
  });
});

describe("shouldOfferCreateBranchPrompt", () => {
  const temporaryBranch = "synara/deadbeef";

  it("hides the create-branch prompt when the branch already has upstream", () => {
    assert.isFalse(
      shouldOfferCreateBranchPrompt({
        activeWorktreePath: "/tmp/project/.worktrees/feature-test",
        gitStatus: {
          branch: temporaryBranch,
          hasUpstream: true,
        },
      }),
    );
  });

  it("hides the create-branch prompt outside a worktree even when the branch is local-only", () => {
    assert.isFalse(
      shouldOfferCreateBranchPrompt({
        activeWorktreePath: null,
        gitStatus: {
          branch: temporaryBranch,
          hasUpstream: false,
        },
      }),
    );
  });

  it("hides the create-branch prompt once the current branch has been finalized", () => {
    assert.isFalse(
      shouldOfferCreateBranchPrompt({
        activeWorktreePath: "/tmp/project/.worktrees/feature-test",
        gitStatus: {
          branch: "feature/test",
          hasUpstream: false,
        },
        createBranchFlowCompleted: true,
      }),
    );
  });

  it("keeps the create-branch prompt visible for a semantic local-only branch until the flow is completed", () => {
    assert.isTrue(
      shouldOfferCreateBranchPrompt({
        activeWorktreePath: "/tmp/project/.worktrees/feature-test",
        gitStatus: {
          branch: "feature/test",
          hasUpstream: false,
        },
        createBranchFlowCompleted: false,
      }),
    );
  });
});
