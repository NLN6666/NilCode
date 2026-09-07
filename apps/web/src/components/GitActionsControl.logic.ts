import type {
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
} from "@synara/contracts";
import { isTemporaryWorktreeBranch, resolveUniqueSynaraBranchName } from "@synara/shared/git";
import { git as defaultGitCopy } from "~/i18n/locales/en/git";

/**
 * The `git` catalog group. These resolvers default to English so their unit tests can keep
 * asserting plain strings; the running app always passes the active catalog.
 */
export type GitCopy = typeof defaultGitCopy;

export type GitActionIconName = "commit" | "push" | "pr";

/** Every glyph a git affordance can render — see `gitActionGlyphs.tsx` for the map. */
export type GitGlyphName = GitActionIconName | "sync" | "branch";

export type GitDialogAction = "commit" | "push" | "commit_push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "commit_push" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "show_hint" | "create_branch";
  action?: GitStackedAction;
  hint?: string;
}

const FALLBACK_DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export function requiresFeatureBranchForDefaultBranchAction(
  action: DefaultBranchConfirmableAction,
): boolean {
  return action === "create_pr" || action === "commit_push_pr";
}

const SHORT_SHA_LENGTH = 7;
const TOAST_DESCRIPTION_MAX = 72;

function shortenSha(sha: string | undefined): string | null {
  if (!sha) return null;
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function truncateText(
  value: string | undefined,
  maxLength = TOAST_DESCRIPTION_MAX,
): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function resolveDefaultCreateBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  return resolveUniqueSynaraBranchName(existingBranchNames, preferredBranch);
}

export function buildGitActionProgressStages(input: {
  action: GitStackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  forcePushOnly?: boolean;
  pushTarget?: string;
  featureBranch?: boolean;
  shouldPushBeforePr?: boolean;
  copy?: GitCopy;
}): string[] {
  const progress = (input.copy ?? defaultGitCopy).progress;
  const branchStages = input.featureBranch ? [progress.preparingFeatureBranch] : [];
  const pushStage = input.pushTarget ? progress.pushingTo(input.pushTarget) : progress.pushing;
  if (input.action === "push") {
    return [pushStage];
  }
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, progress.creatingPr] : [progress.creatingPr];
  }
  const shouldIncludeCommitStages =
    !input.forcePushOnly && (input.action === "commit" || input.hasWorkingTreeChanges);
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? [progress.committing]
      : [progress.generatingCommitMessage, progress.committing];
  if (input.action === "commit") {
    return [...branchStages, ...commitStages];
  }
  if (input.action === "commit_push") {
    return [...branchStages, ...commitStages, pushStage];
  }
  return [...branchStages, ...commitStages, pushStage, progress.creatingPr];
}

const withDescription = (title: string, description: string | undefined) =>
  description ? { title, description } : { title };

export type CreatePrExecution =
  | { kind: "run_action"; action: "create_pr" | "commit_push_pr" }
  | { kind: "open_pr" }
  | { kind: "unavailable"; hint: string };

/**
 * Create PR is a "do everything" action: it resolves whichever stacked action
 * completes the missing steps (commit → push/publish → PR) from the current git
 * state. Behind/diverged branches stay blocked so a one-click action never has
 * to auto-resolve merge conflicts; the default branch keeps its confirmation
 * dialog (handled by the caller) before switching to a feature branch.
 */
export function resolveCreatePrExecution(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  isDefaultBranch: boolean;
  hasOriginRemote: boolean;
  defaultBranchName?: string | null | undefined;
  copy?: GitCopy;
}): CreatePrExecution {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input;
  const hints = (input.copy ?? defaultGitCopy).hints;
  if (isBusy) return { kind: "unavailable", hint: hints.busy };
  if (!gitStatus) return { kind: "unavailable", hint: hints.noStatus };
  if (gitStatus.pr?.state === "open") return { kind: "open_pr" };
  if (gitStatus.branch === null) {
    return { kind: "unavailable", hint: hints.detachedPr };
  }

  const isAhead = gitStatus.aheadCount > 0;
  if (gitStatus.behindCount > 0) {
    return {
      kind: "unavailable",
      hint: isAhead ? hints.diverged : hints.behindPullBeforePr,
    };
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return { kind: "unavailable", hint: hints.addOriginPr };
  }

  if (gitStatus.hasWorkingTreeChanges) {
    return { kind: "run_action", action: "commit_push_pr" };
  }

  const canCreateCleanPublishedPr =
    !isDefaultBranch &&
    gitStatus.hasUpstream &&
    gitStatus.upstreamBranch !== null &&
    !tracksDefaultUpstream(gitStatus, defaultBranchName);
  if (isAhead || canCreateCleanPublishedPr) {
    return { kind: "run_action", action: "create_pr" };
  }

  return { kind: "unavailable", hint: hints.noBranchChangesForPr };
}

function extractTrackedBranchName(upstreamBranch: string | null | undefined): string | null {
  if (!upstreamBranch) return null;
  const branchName = upstreamBranch.trim();
  return branchName.length > 0 ? branchName : null;
}

export function resolveCreatePrBaseBranch(
  gitStatus: GitStatusResult | null,
  defaultBranchName?: string | null,
): string {
  if (gitStatus?.configuredPrBaseBranch) {
    return gitStatus.configuredPrBaseBranch;
  }
  const trackedBranchName = extractTrackedBranchName(gitStatus?.upstreamBranch);
  if (gitStatus?.hasUpstream && trackedBranchName && trackedBranchName !== gitStatus.branch) {
    return trackedBranchName;
  }
  return defaultBranchName ?? "main";
}

function tracksDefaultUpstream(
  gitStatus: GitStatusResult,
  defaultBranchName?: string | null,
): boolean {
  const trackedBranchName = extractTrackedBranchName(gitStatus.upstreamBranch);
  if (!trackedBranchName) return false;
  if (defaultBranchName) return trackedBranchName === defaultBranchName;
  return FALLBACK_DEFAULT_BRANCH_NAMES.has(trackedBranchName);
}

/** Git state a dialog resolves its available actions from — shared by Create PR and Commit. */
export interface GitDialogContext {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  isDefaultBranch: boolean;
  hasOriginRemote: boolean;
  defaultBranchName?: string | null | undefined;
}

export interface CreatePrDialogRuntimeStatus {
  gitStatus: GitStatusResult | null;
  isDefaultBranch: boolean;
  statusOverride: GitStatusResult | null;
}

/**
 * A post-push toast carries a synthetic status so its CTA can open even when
 * the query cache still reflects the pre-push branch. Preserve that exact
 * stale object as a freshness marker: the synthetic snapshot wins while the
 * cache still returns it, then a newly fetched live object takes over so later
 * working-tree or branch changes are reflected by the dialog.
 */
export function resolveCreatePrDialogRuntimeStatus(input: {
  liveGitStatus: GitStatusResult | null;
  statusOverride: GitStatusResult | null;
  statusOverrideSource: GitStatusResult | null;
  isDefaultBranch: boolean;
  isDefaultBranchOverride: boolean | null;
}): CreatePrDialogRuntimeStatus {
  const liveStatusIsKnownStale =
    input.liveGitStatus !== null && input.liveGitStatus === input.statusOverrideSource;
  if (input.liveGitStatus && !liveStatusIsKnownStale) {
    return {
      gitStatus: input.liveGitStatus,
      isDefaultBranch: input.isDefaultBranch,
      statusOverride: null,
    };
  }
  return {
    gitStatus: input.statusOverride,
    isDefaultBranch: input.isDefaultBranchOverride ?? input.isDefaultBranch,
    statusOverride: input.statusOverride,
  };
}

/**
 * Execution for the Create PR dialog, honoring the "Commit and push local
 * changes" toggle: with the toggle off a dirty tree is evaluated as if it were
 * clean, so the dialog can offer a PR from already-committed work only (and
 * correctly reports unavailability when nothing is committed).
 */
export function resolveCreatePrDialogExecution(
  context: GitDialogContext,
  includeLocalChanges: boolean,
  copy: GitCopy = defaultGitCopy,
): CreatePrExecution {
  const { gitStatus } = context;
  if (!gitStatus || includeLocalChanges || !gitStatus.hasWorkingTreeChanges) {
    return resolveCreatePrExecution({ ...context, copy });
  }
  return resolveCreatePrExecution({
    ...context,
    gitStatus: { ...gitStatus, hasWorkingTreeChanges: false },
    copy,
  });
}

export interface CreatePrDialogView {
  branchName: string | null;
  baseBranchName: string;
  // The PR head does not exist on the remote yet: either the current branch is
  // unpublished or a feature branch will be created off the default branch.
  isNewBranch: boolean;
  // Submitting creates an auto-named feature branch first (default-branch flow).
  willCreateFeatureBranch: boolean;
  showCommitToggle: boolean;
  insertions: number;
  deletions: number;
}

export function resolveCreatePrDialogView(context: GitDialogContext): CreatePrDialogView {
  const gitStatus = context.gitStatus;
  return {
    branchName: gitStatus?.branch ?? null,
    baseBranchName: resolveCreatePrBaseBranch(gitStatus, context.defaultBranchName),
    isNewBranch: context.isDefaultBranch || gitStatus?.hasUpstream !== true,
    willCreateFeatureBranch: context.isDefaultBranch,
    showCommitToggle: gitStatus?.hasWorkingTreeChanges === true,
    insertions: gitStatus?.workingTree.insertions ?? 0,
    deletions: gitStatus?.workingTree.deletions ?? 0,
  };
}

export type CreatePrBrowserPreparation =
  | { kind: "run_action"; action: "commit_push" | "push" }
  | { kind: "open_compare" }
  | { kind: "open_pr" }
  | { kind: "unavailable"; hint: string };

/**
 * "Open PR in browser" runs only the missing local steps (commit and/or push)
 * and then opens the GitHub compare page, leaving PR authoring to the browser.
 */
export function resolveCreatePrBrowserPreparation(
  context: GitDialogContext,
  includeLocalChanges: boolean,
  copy: GitCopy = defaultGitCopy,
): CreatePrBrowserPreparation {
  const execution = resolveCreatePrDialogExecution(context, includeLocalChanges, copy);
  if (execution.kind !== "run_action") return execution;
  if (execution.action === "commit_push_pr") {
    return { kind: "run_action", action: "commit_push" };
  }
  const gitStatus = context.gitStatus;
  if (!gitStatus?.hasUpstream || gitStatus.aheadCount > 0) {
    return { kind: "run_action", action: "push" };
  }
  return { kind: "open_compare" };
}

export function summarizeGitResult(
  result: GitRunStackedActionResult,
  copy: GitCopy = defaultGitCopy,
): {
  title: string;
  description?: string;
} {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
    const title =
      result.pr.status === "created"
        ? copy.result.createdPr(prNumber)
        : copy.result.openedPr(prNumber);
    return withDescription(title, truncateText(result.pr.title));
  }

  if (result.push.status === "pushed") {
    const shortSha = shortenSha(result.commit.commitSha);
    const branch = result.push.upstreamBranch ?? result.push.branch;
    const pushedCommitPart = shortSha ? ` ${shortSha}` : "";
    const branchPart = branch ? copy.result.pushedToBranch(branch) : "";
    return withDescription(
      copy.result.pushed(pushedCommitPart, branchPart),
      truncateText(result.commit.subject),
    );
  }

  if (result.commit.status === "created") {
    const shortSha = shortenSha(result.commit.commitSha);
    const title = shortSha ? copy.result.committed(shortSha) : copy.result.committedChanges;
    return withDescription(title, truncateText(result.commit.subject));
  }

  return { title: copy.result.done };
}

export function buildMenuItems(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true,
  isDefaultBranch = false,
  defaultBranchName?: string | null,
  copy: GitCopy = defaultGitCopy,
): GitActionMenuItem[] {
  if (!gitStatus) return [];

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCommitPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    (hasChanges || gitStatus.aheadCount > 0) &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const prExecution = resolveCreatePrExecution({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
  });
  const canOpenPr = !isBusy && hasOpenPr;

  return [
    {
      id: "commit",
      label: copy.actions.commit,
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
    ...(hasChanges && !isDefaultBranch
      ? [
          {
            id: "commit_push" as const,
            label: copy.actions.commitPush,
            disabled: !canCommitPush,
            icon: "push" as const,
            kind: "open_dialog" as const,
            dialogAction: "commit_push" as const,
          },
        ]
      : []),
    {
      id: "push",
      label: isDefaultBranch ? copy.actions.commitPush : copy.actions.push,
      disabled: !(isDefaultBranch ? canCommitPush : canPush),
      icon: "push",
      kind: "open_dialog",
      dialogAction: isDefaultBranch ? "commit_push" : "push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: copy.actions.createPr,
          disabled: !canOpenPr,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: copy.actions.createPr,
          disabled: prExecution.kind !== "run_action",
          icon: "pr",
          kind: "open_dialog",
          dialogAction: "create_pr",
        },
  ];
}

/**
 * Human-readable reason a git menu item is unavailable. Shared by the dropdown picker
 * rows and the Commit dialog action rows so the same blocked action always explains
 * itself with the same sentence.
 */
export function resolveGitMenuActionDisabledReason(input: {
  item: GitActionMenuItem;
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
  isDefaultBranch: boolean;
  defaultBranchName: string | null | undefined;
  copy?: GitCopy;
}): string | null {
  const { item, gitStatus, isBusy, hasOriginRemote, isDefaultBranch, defaultBranchName } = input;
  const hints = (input.copy ?? defaultGitCopy).hints;
  if (!item.disabled) return null;
  if (isBusy) return hints.busy;
  if (!gitStatus) return hints.noStatus;

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const action = item.dialogAction ?? item.id;

  if (action === "commit") {
    if (!hasChanges) {
      return hints.cleanWorktree;
    }
    return hints.commitUnavailable;
  }

  if (action === "push") {
    if (!hasBranch) {
      return hints.detachedPush;
    }
    if (hasChanges) {
      return hints.uncommittedPush;
    }
    if (isBehind) {
      return hints.behindPush;
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return hints.addOriginPush;
    }
    if (!isAhead) {
      return hints.noCommitsPush;
    }
    return hints.pushUnavailable;
  }

  if (action === "commit_push") {
    if (!hasBranch) {
      return hints.detachedCommitPush;
    }
    if (isBehind) {
      return hints.behindCommitPush;
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return hints.addOriginCommitPush;
    }
    if (!hasChanges && !isAhead) {
      return hints.nothingToPush;
    }
    return hints.commitPushUnavailable;
  }

  if (hasOpenPr) {
    return hints.viewPrUnavailable;
  }
  const prExecution = resolveCreatePrExecution({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
    ...(input.copy ? { copy: input.copy } : {}),
  });
  if (prExecution.kind === "unavailable") {
    return prExecution.hint;
  }
  return hints.createPrUnavailable;
}

export type GitCommitDialogActionId = "commit_new_branch" | "commit" | "commit_push" | "create_pr";

export interface GitCommitDialogAction {
  id: GitCommitDialogActionId;
  label: string;
  icon: GitGlyphName;
  /** Stacked action to dispatch; `create_pr` hands off to the Create PR dialog. */
  action: "commit" | "push" | "commit_push" | "create_pr";
  /** Commit onto a freshly created feature branch instead of the current one. */
  featureBranch: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

const NO_FILE_SELECTION_HINT = "Select at least one file to commit.";

/**
 * Action rows offered by the Commit dialog. Commit-family rows reuse the dropdown
 * menu's availability and wording (so "Commit & push" collapses to "Push" on a clean
 * tree exactly as the menu does), while the PR row mirrors the one-click Create PR
 * resolution and only ever hands off to the Create PR dialog.
 */
export function resolveCommitDialogActions(input: {
  context: GitDialogContext;
  /** False when the user excluded every changed file in the dialog's file list. */
  hasFileSelection: boolean;
  copy?: GitCopy;
}): GitCommitDialogAction[] {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input.context;
  const copy = input.copy ?? defaultGitCopy;
  const menuItems = buildMenuItems(
    gitStatus,
    isBusy,
    hasOriginRemote,
    isDefaultBranch,
    defaultBranchName,
    copy,
  );
  const commitItem = menuItems.find((item) => item.id === "commit") ?? null;
  const pushItem =
    menuItems.find((item) => item.id === "commit_push") ??
    menuItems.find((item) => item.id === "push") ??
    null;
  const reasonInput = {
    gitStatus,
    isBusy,
    hasOriginRemote,
    isDefaultBranch,
    defaultBranchName,
    copy,
  };

  const resolveRowState = (item: GitActionMenuItem | null, gateOnSelection: boolean) => {
    if (!item) {
      return {
        disabled: true,
        disabledReason: isBusy ? copy.hints.busy : copy.hints.noStatus,
      };
    }
    if (item.disabled) {
      return {
        disabled: true,
        disabledReason: resolveGitMenuActionDisabledReason({ item, ...reasonInput }),
      };
    }
    if (gateOnSelection && !input.hasFileSelection) {
      return { disabled: true, disabledReason: copy.hints.selectFilesToCommit };
    }
    return { disabled: false, disabledReason: null };
  };

  const prExecution = resolveCreatePrExecution({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
    copy,
  });
  // A pure push needs no working-tree selection; anything that commits does.
  const pushCommits = pushItem?.dialogAction !== "push";

  return [
    {
      id: "commit_new_branch",
      label: copy.actions.commitOnNewBranch,
      icon: "branch",
      action: "commit",
      featureBranch: true,
      ...resolveRowState(commitItem, true),
    },
    {
      id: "commit",
      label: copy.actions.commit,
      icon: "commit",
      action: "commit",
      featureBranch: false,
      ...resolveRowState(commitItem, true),
    },
    {
      id: "commit_push",
      label: pushItem?.label ?? copy.actions.commitAndPush,
      icon: "push",
      action: pushItem?.dialogAction === "push" ? "push" : "commit_push",
      featureBranch: false,
      ...resolveRowState(pushItem, pushCommits),
    },
    {
      id: "create_pr",
      label: prExecution.kind === "open_pr" ? copy.actions.viewPr : copy.actions.createPr,
      icon: "pr",
      action: "create_pr",
      featureBranch: false,
      disabled: prExecution.kind === "unavailable",
      disabledReason: prExecution.kind === "unavailable" ? prExecution.hint : null,
    },
  ];
}

export function resolveQuickAction(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  isDefaultBranch = false,
  hasOriginRemote = true,
  shouldOfferCreateBranch = false,
  _defaultBranchName?: string | null,
  copy: GitCopy = defaultGitCopy,
): GitQuickAction {
  if (isBusy) {
    return {
      label: copy.actions.commit,
      disabled: true,
      kind: "show_hint",
      hint: copy.hints.busy,
    };
  }

  if (!gitStatus) {
    return {
      label: copy.actions.commit,
      disabled: true,
      kind: "show_hint",
      hint: copy.hints.noStatus,
    };
  }

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;

  if (!hasBranch) {
    if (shouldOfferCreateBranch) {
      return {
        label: copy.actions.createBranch,
        disabled: false,
        kind: "create_branch",
      };
    }
    return {
      label: copy.actions.commit,
      disabled: true,
      kind: "show_hint",
      hint: copy.hints.createBranchFirst,
    };
  }

  if (!gitStatus.hasUpstream && shouldOfferCreateBranch) {
    return {
      label: copy.actions.createBranch,
      disabled: false,
      kind: "create_branch",
    };
  }

  if (gitStatus.hasUpstream) {
    if (isDiverged) {
      return {
        label: copy.actions.syncBranch,
        disabled: true,
        kind: "show_hint",
        hint: copy.hints.diverged,
      };
    }

    if (isBehind) {
      return {
        label: copy.actions.pull,
        disabled: false,
        kind: "run_pull",
      };
    }
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return {
        label: copy.actions.commit,
        disabled: false,
        kind: "run_action",
        action: "commit",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: copy.actions.commitPush,
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: copy.actions.commitPushPr,
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasOriginRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: copy.actions.viewPr, disabled: false, kind: "open_pr" };
      }
      return {
        label: copy.actions.push,
        disabled: true,
        kind: "show_hint",
        hint: copy.hints.addOriginPushOrPr,
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return { label: copy.actions.viewPr, disabled: false, kind: "open_pr" };
      }
      return {
        label: copy.actions.push,
        disabled: true,
        kind: "show_hint",
        hint: copy.hints.noCommitsPush,
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch ? copy.actions.commitPush : copy.actions.push,
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: copy.actions.pushCreatePr,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch ? copy.actions.commitPush : copy.actions.push,
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: copy.actions.pushCreatePr,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return { label: copy.actions.viewPr, disabled: false, kind: "open_pr" };
  }

  return {
    label: copy.actions.commit,
    disabled: true,
    kind: "show_hint",
    hint: copy.hints.branchUpToDate,
  };
}

/**
 * Availability of the literal `create_pr` stacked action (clean tree required).
 * Guards stale dispatches from surfaces that resolved their action earlier
 * (quick action, post-push toast CTA); the menu path resolves the full chain
 * via resolveCreatePrExecution instead.
 */
export function resolveCreatePrActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isDefaultBranch?: boolean;
  hasOriginRemote?: boolean;
  defaultBranchName?: string | null | undefined;
  copy?: GitCopy;
}): { canRun: boolean; hint: string | null } {
  const execution = resolveCreatePrExecution({
    gitStatus: input.gitStatus,
    isBusy: false,
    isDefaultBranch: input.isDefaultBranch ?? false,
    hasOriginRemote: input.hasOriginRemote ?? true,
    defaultBranchName: input.defaultBranchName,
    ...(input.copy ? { copy: input.copy } : {}),
  });
  const canRun = execution.kind === "run_action" && execution.action === "create_pr";
  const hints = (input.copy ?? defaultGitCopy).hints;
  const hint = (() => {
    if (canRun) return null;
    if (execution.kind === "unavailable") return execution.hint;
    if (execution.kind === "open_pr") {
      return hints.prAlreadyOpen;
    }
    if (execution.kind === "run_action" && execution.action === "commit_push_pr") {
      return hints.commitBeforePr;
    }
    return hints.noBranchChangesForPr;
  })();

  return {
    canRun,
    hint,
  };
}

export function resolvePullActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  copy?: GitCopy;
}): { canRun: boolean; hint: string | null } {
  const { gitStatus, isBusy } = input;
  const hints = (input.copy ?? defaultGitCopy).hints;
  if (isBusy) return { canRun: false, hint: hints.busy };
  if (!gitStatus) return { canRun: false, hint: hints.noStatus };
  if (gitStatus.branch === null) {
    return { canRun: false, hint: hints.detachedPull };
  }
  if (!gitStatus.hasUpstream) {
    return { canRun: false, hint: hints.noUpstreamPull };
  }
  if (gitStatus.aheadCount > 0 && gitStatus.behindCount > 0) {
    return { canRun: false, hint: "Branch has diverged from upstream. Rebase/merge first." };
  }
  if (gitStatus.behindCount <= 0) {
    return { canRun: false, hint: hints.alreadyUpToDate };
  }
  return { canRun: true, hint: null };
}

/** Promote Pull as the primary git affordance while it is available or already running. */
export function shouldPromotePullAction(input: {
  quickAction: GitQuickAction;
  isPullRunning: boolean;
}): boolean {
  return (
    input.isPullRunning || (input.quickAction.kind === "run_pull" && !input.quickAction.disabled)
  );
}

export interface PromotedPullPresentation {
  label: string;
}

/**
 * Chrome for a promoted Pull control. `resolveQuickAction` collapses to a disabled
 * "Commit" hint while any git action is running, so callers must not use that label
 * while Pull is the promoted affordance.
 */
export function resolvePromotedPullPresentation(input: {
  quickAction: GitQuickAction;
  isPullRunning: boolean;
}): PromotedPullPresentation | null {
  if (!shouldPromotePullAction(input)) return null;
  return { label: input.isPullRunning ? "Pulling..." : "Pull" };
}

export function shouldOfferCreateBranchPrompt(input: {
  activeWorktreePath: string | null;
  gitStatus: Pick<GitStatusResult, "branch" | "hasUpstream"> | null;
  createBranchFlowCompleted?: boolean;
}): boolean {
  if (!input.activeWorktreePath) return false;
  if (!input.gitStatus) return false;
  if (input.gitStatus.hasUpstream) return false;
  if (input.createBranchFlowCompleted) return false;
  return true;
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean,
): action is DefaultBranchConfirmableAction {
  if (!isDefaultBranch) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  copy?: GitCopy;
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const dialog = (input.copy ?? defaultGitCopy).defaultBranchDialog;
  const suffix = dialog.onBranchSuffix(branchLabel);

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: dialog.commitPushTitle,
        description: dialog.commitPushDescription(suffix),
        continueLabel: dialog.commitPushContinue(branchLabel),
      };
    }
    return {
      title: dialog.pushTitle,
      description: dialog.pushDescription(suffix),
      continueLabel: dialog.pushContinue(branchLabel),
    };
  }

  if (input.includesCommit) {
    return {
      title: dialog.featureBranchCommitPrTitle,
      description: dialog.featureBranchCommitPrDescription(branchLabel),
      continueLabel: dialog.createFeatureBranch,
    };
  }
  return {
    title: dialog.featureBranchPrTitle,
    description: dialog.featureBranchPrDescription(branchLabel),
    continueLabel: dialog.createFeatureBranch,
  };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: GitStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) {
    return null;
  }

  // Branch list not ready yet — don't treat "status arrived first" as out-of-sync
  // or we permanently invalidate and show "Refreshing git status...".
  if (input.threadBranch === null) {
    return null;
  }

  if (input.gitStatus.branch === null && input.threadBranch !== null) {
    return null;
  }

  if (input.threadBranch === input.gitStatus.branch) {
    return null;
  }

  if (
    input.threadBranch !== null &&
    input.gitStatus.branch !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.branch)
  ) {
    return null;
  }

  return {
    branch: input.gitStatus.branch,
  };
}

// Re-export from shared for backwards compatibility in this module's exports
export { resolveAutoFeatureBranchName } from "@synara/shared/git";
