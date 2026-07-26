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

// Shared PR eligibility for explicit menu/CTA paths; the primary quick action ranks separately.
function canRunCreatePrAction(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  isDefaultBranch: boolean;
  hasOriginRemote: boolean;
  defaultBranchName?: string | null | undefined;
}): boolean {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input;
  if (!gitStatus) return false;

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const canPushWithoutUpstream = hasOriginRemote && !gitStatus.hasUpstream;
  const canCreateCleanPublishedPr =
    !isDefaultBranch &&
    gitStatus.hasUpstream &&
    gitStatus.upstreamBranch !== null &&
    !tracksDefaultUpstream(gitStatus, defaultBranchName);

  return (
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    !isBehind &&
    (canCreateCleanPublishedPr ||
      (gitStatus.aheadCount > 0 && (gitStatus.hasUpstream || canPushWithoutUpstream)))
  );
}

function extractTrackedBranchName(upstreamBranch: string | null | undefined): string | null {
  if (!upstreamBranch) return null;
  const branchName = upstreamBranch.trim();
  return branchName.length > 0 ? branchName : null;
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
  const canCreatePr = canRunCreatePrAction({
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
          disabled: !canCreatePr,
          icon: "pr",
          kind: "open_dialog",
          dialogAction: "create_pr",
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

export function resolveCreatePrActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isDefaultBranch?: boolean;
  hasOriginRemote?: boolean;
  defaultBranchName?: string | null | undefined;
  copy?: GitCopy;
}): { canRun: boolean; hint: string | null } {
  const canRun = canRunCreatePrAction({
    gitStatus: input.gitStatus,
    isBusy: false,
    isDefaultBranch: input.isDefaultBranch ?? false,
    hasOriginRemote: input.hasOriginRemote ?? true,
    defaultBranchName: input.defaultBranchName,
  });

  return {
    canRun,
    hint: canRun ? null : (input.copy ?? defaultGitCopy).hints.noBranchChangesForPr,
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
