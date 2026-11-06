import type {
  GitActionProgressPhase,
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
  ThreadId,
} from "@synara/contracts";
import { isTemporaryWorktreeBranch, resolveUniqueSynaraBranchName } from "@synara/shared/git";
import { t as defaultTranslate } from "~/i18n";

export type GitActionTranslator = typeof defaultTranslate;

export type GitActionIconName = "commit" | "push" | "pr";

export function buildGitActionFailureToast(input: {
  message: string;
  phase: GitActionProgressPhase | null;
  threadId: ThreadId | null;
  translate?: GitActionTranslator;
}) {
  const translate = input.translate ?? defaultTranslate;
  const titleKeys: Record<GitActionProgressPhase, string> = {
    branch: "git:gitActionBranchFailure",
    commit: "git:gitActionCommitFailure",
    push: "git:pushFailed",
    pr: "git:gitActionPrFailure",
  };
  return {
    type: "error" as const,
    title: input.phase ? translate(titleKeys[input.phase]) : translate("git:gitActionFailure"),
    description: input.message,
    timeout: 0,
    data: {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      copyText: input.message,
    },
  };
}

/** Every glyph a git affordance can render — see `gitActionGlyphs.tsx` for the map. */
export type GitGlyphName = GitActionIconName | "sync" | "branch" | "view_pr";

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
  translate?: GitActionTranslator;
}): string[] {
  const translate = input.translate ?? defaultTranslate;
  const branchStages = input.featureBranch
    ? [translate("git:gitActionPreparingFeatureBranch")]
    : [];
  const pushStage = input.pushTarget
    ? translate("git:gitActionPushingTo", { value0: input.pushTarget })
    : translate("git:gitActionPushing");
  const creatingPrStage = translate("git:gitActionCreatingPr");
  const committingStage = translate("git:gitActionCommitting");
  if (input.action === "push") {
    return [pushStage];
  }
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, creatingPrStage] : [creatingPrStage];
  }
  const shouldIncludeCommitStages =
    !input.forcePushOnly && (input.action === "commit" || input.hasWorkingTreeChanges);
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? [committingStage]
      : [translate("git:gitActionGeneratingCommitMessage"), committingStage];
  if (input.action === "commit") {
    return [...branchStages, ...commitStages];
  }
  if (input.action === "commit_push") {
    return [...branchStages, ...commitStages, pushStage];
  }
  return [...branchStages, ...commitStages, pushStage, creatingPrStage];
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
  translate?: GitActionTranslator;
}): CreatePrExecution {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input;
  const translate = input.translate ?? defaultTranslate;
  if (isBusy) return { kind: "unavailable", hint: translate("git:gitActionBusy") };
  if (!gitStatus) return { kind: "unavailable", hint: translate("git:waitingForGit") };
  if (gitStatus.pr?.state === "open") return { kind: "open_pr" };
  if (gitStatus.branch === null) {
    return {
      kind: "unavailable",
      hint: translate("git:gitActionCreateBranchBeforePr"),
    };
  }

  const isAhead = gitStatus.aheadCount > 0;
  if (gitStatus.behindCount > 0) {
    return {
      kind: "unavailable",
      hint: translate(isAhead ? "git:gitActionDiverged" : "git:gitActionBehindPullBeforePr"),
    };
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return { kind: "unavailable", hint: translate("git:gitActionAddOriginBeforePr") };
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

  return {
    kind: "unavailable",
    hint: translate("git:noBranchChangesToIncludeInAPR"),
  };
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
  translate: GitActionTranslator = defaultTranslate,
): CreatePrExecution {
  const { gitStatus } = context;
  if (!gitStatus || includeLocalChanges || !gitStatus.hasWorkingTreeChanges) {
    return resolveCreatePrExecution({ ...context, translate });
  }
  return resolveCreatePrExecution({
    ...context,
    gitStatus: { ...gitStatus, hasWorkingTreeChanges: false },
    translate,
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
  translate: GitActionTranslator = defaultTranslate,
): CreatePrBrowserPreparation {
  const execution = resolveCreatePrDialogExecution(context, includeLocalChanges, translate);
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
  translate: GitActionTranslator = defaultTranslate,
): {
  title: string;
  description?: string;
} {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
    const title =
      result.pr.status === "created"
        ? translate("git:gitActionPrCreated", { value0: prNumber })
        : translate("git:gitActionPrOpened", { value0: prNumber });
    return withDescription(title, truncateText(result.pr.title));
  }

  if (result.push.status === "pushed") {
    const shortSha = shortenSha(result.commit.commitSha);
    const branch = result.push.upstreamBranch ?? result.push.branch;
    const pushedCommitPart = shortSha ? ` ${shortSha}` : "";
    const branchPart = branch ? translate("git:gitActionPushedToBranch", { value0: branch }) : "";
    return withDescription(
      translate("git:gitActionPushed", { value0: pushedCommitPart, value1: branchPart }),
      truncateText(result.commit.subject),
    );
  }

  if (result.commit.status === "created") {
    const shortSha = shortenSha(result.commit.commitSha);
    const title = shortSha
      ? translate("git:gitActionCommitted", { value0: shortSha })
      : translate("git:gitActionCommittedChanges");
    return withDescription(title, truncateText(result.commit.subject));
  }

  return { title: translate("git:detail_done") };
}

export function buildMenuItems(
  gitStatus: GitStatusResult | null,
  isBusy: boolean,
  hasOriginRemote = true,
  isDefaultBranch = false,
  defaultBranchName?: string | null,
  translate: GitActionTranslator = defaultTranslate,
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
    translate,
  });
  const canOpenPr = !isBusy && hasOpenPr;

  return [
    {
      id: "commit",
      label: translate("git:gitActionCommit"),
      disabled: !canCommit,
      icon: "commit",
      kind: "open_dialog",
      dialogAction: "commit",
    },
    ...(hasChanges && !isDefaultBranch
      ? [
          {
            id: "commit_push" as const,
            label: translate("git:commitAndPush"),
            disabled: !canCommitPush,
            icon: "push" as const,
            kind: "open_dialog" as const,
            dialogAction: "commit_push" as const,
          },
        ]
      : []),
    {
      id: "push",
      label: isDefaultBranch ? translate("git:commitAndPush") : translate("git:gitActionPush"),
      disabled: !(isDefaultBranch ? canCommitPush : canPush),
      icon: "push",
      kind: "open_dialog",
      dialogAction: isDefaultBranch ? "commit_push" : "push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: translate("git:createPR"),
          disabled: !canOpenPr,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: translate("git:createPR"),
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
  translate?: GitActionTranslator;
}): string | null {
  const { item, gitStatus, isBusy, hasOriginRemote, isDefaultBranch, defaultBranchName } = input;
  const translate = input.translate ?? defaultTranslate;
  if (!item.disabled) return null;
  if (isBusy) return translate("git:gitActionBusy");
  if (!gitStatus) return translate("git:waitingForGit");

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const action = item.dialogAction ?? item.id;

  if (action === "commit") {
    if (!hasChanges) {
      return translate("git:gitActionCleanWorktree");
    }
    return translate("git:gitActionCommitUnavailable");
  }

  if (action === "push") {
    if (!hasBranch) {
      return translate("git:gitActionDetachedPush");
    }
    if (hasChanges) {
      return translate("git:gitActionUncommittedPush");
    }
    if (isBehind) {
      return translate("git:gitActionBehindPush");
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return translate("git:gitActionAddOriginBeforePush");
    }
    if (!isAhead) {
      return translate("git:gitActionNoCommitsToPush");
    }
    return translate("git:gitActionPushUnavailable");
  }

  if (action === "commit_push") {
    if (!hasBranch) {
      return translate("git:gitActionDetachedCommitPush");
    }
    if (isBehind) {
      return translate("git:gitActionBehindCommitPush");
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return translate("git:gitActionAddOriginBeforeCommitPush");
    }
    if (!hasChanges && !isAhead) {
      return translate("git:gitActionNothingToPush");
    }
    return translate("git:gitActionCommitPushUnavailable");
  }

  if (hasOpenPr) {
    return translate("git:gitActionViewPrUnavailable");
  }
  const prExecution = resolveCreatePrExecution({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
    translate,
  });
  if (prExecution.kind === "unavailable") {
    return prExecution.hint;
  }
  return translate("git:createPRUnavailable");
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
  translate?: GitActionTranslator;
}): GitCommitDialogAction[] {
  const { gitStatus, isBusy, isDefaultBranch, hasOriginRemote, defaultBranchName } = input.context;
  const translate = input.translate ?? defaultTranslate;
  const menuItems = buildMenuItems(
    gitStatus,
    isBusy,
    hasOriginRemote,
    isDefaultBranch,
    defaultBranchName,
    translate,
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
    translate,
  };

  const resolveRowState = (item: GitActionMenuItem | null, gateOnSelection: boolean) => {
    if (!item) {
      return {
        disabled: true,
        disabledReason: isBusy ? translate("git:gitActionBusy") : translate("git:waitingForGit"),
      };
    }
    if (item.disabled) {
      return {
        disabled: true,
        disabledReason: resolveGitMenuActionDisabledReason({ item, ...reasonInput }),
      };
    }
    if (gateOnSelection && !input.hasFileSelection) {
      return {
        disabled: true,
        disabledReason: translate("git:gitActionSelectFilesToCommit"),
      };
    }
    return { disabled: false, disabledReason: null };
  };

  const prExecution = resolveCreatePrExecution({
    gitStatus,
    isBusy,
    isDefaultBranch,
    hasOriginRemote,
    defaultBranchName,
    translate,
  });
  // A pure push needs no working-tree selection; anything that commits does.
  const pushCommits = pushItem?.dialogAction !== "push";

  return [
    {
      id: "commit_new_branch",
      label: translate("git:gitActionCommitOnNewBranch"),
      icon: "branch",
      action: "commit",
      featureBranch: true,
      ...resolveRowState(commitItem, true),
    },
    {
      id: "commit",
      label: translate("git:gitActionCommit"),
      icon: "commit",
      action: "commit",
      featureBranch: false,
      ...resolveRowState(commitItem, true),
    },
    {
      id: "commit_push",
      label: pushItem?.label ?? translate("git:commitAndPush"),
      icon: "push",
      action: pushItem?.dialogAction === "push" ? "push" : "commit_push",
      featureBranch: false,
      ...resolveRowState(pushItem, pushCommits),
    },
    {
      id: "create_pr",
      label: prExecution.kind === "open_pr" ? translate("git:viewPR") : translate("git:createPR"),
      icon: prExecution.kind === "open_pr" ? "view_pr" : "pr",
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
  translate: GitActionTranslator = defaultTranslate,
): GitQuickAction {
  if (isBusy) {
    return {
      label: translate("git:gitActionCommit"),
      disabled: true,
      kind: "show_hint",
      hint: translate("git:gitActionBusy"),
    };
  }

  if (!gitStatus) {
    return {
      label: translate("git:gitActionCommit"),
      disabled: true,
      kind: "show_hint",
      hint: translate("git:waitingForGit"),
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
        label: translate("common:createBranch"),
        disabled: false,
        kind: "create_branch",
      };
    }
    return {
      label: translate("git:gitActionCommit"),
      disabled: true,
      kind: "show_hint",
      hint: translate("git:gitActionCreateBranchFirst"),
    };
  }

  if (!gitStatus.hasUpstream && shouldOfferCreateBranch) {
    return {
      label: translate("common:createBranch"),
      disabled: false,
      kind: "create_branch",
    };
  }

  if (gitStatus.hasUpstream) {
    if (isDiverged) {
      return {
        label: translate("git:gitActionSyncBranch"),
        disabled: true,
        kind: "show_hint",
        hint: translate("git:gitActionDiverged"),
      };
    }

    if (isBehind) {
      return {
        label: translate("git:pull"),
        disabled: false,
        kind: "run_pull",
      };
    }
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return {
        label: translate("git:gitActionCommit"),
        disabled: false,
        kind: "run_action",
        action: "commit",
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: translate("git:commitAndPush"),
        disabled: false,
        kind: "run_action",
        action: "commit_push",
      };
    }
    return {
      label: translate("git:gitActionCommitPushPr"),
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasOriginRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: translate("git:viewPR"), disabled: false, kind: "open_pr" };
      }
      return {
        label: translate("git:gitActionPush"),
        disabled: true,
        kind: "show_hint",
        hint: translate("git:gitActionAddOriginBeforePushOrPr"),
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return { label: translate("git:viewPR"), disabled: false, kind: "open_pr" };
      }
      return {
        label: translate("git:gitActionPush"),
        disabled: true,
        kind: "show_hint",
        hint: translate("git:gitActionNoCommitsToPush"),
      };
    }
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch ? translate("git:commitAndPush") : translate("git:gitActionPush"),
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: translate("git:gitActionPushCreatePr"),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultBranch) {
      return {
        label: isDefaultBranch ? translate("git:commitAndPush") : translate("git:gitActionPush"),
        disabled: false,
        kind: "run_action",
        action: isDefaultBranch ? "commit_push" : "push",
      };
    }
    return {
      label: translate("git:gitActionPushCreatePr"),
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return { label: translate("git:viewPR"), disabled: false, kind: "open_pr" };
  }

  return {
    label: translate("git:gitActionCommit"),
    disabled: true,
    kind: "show_hint",
    hint: translate("git:gitActionBranchUpToDate"),
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
  translate?: GitActionTranslator;
}): { canRun: boolean; hint: string | null } {
  const translate = input.translate ?? defaultTranslate;
  const execution = resolveCreatePrExecution({
    gitStatus: input.gitStatus,
    isBusy: false,
    isDefaultBranch: input.isDefaultBranch ?? false,
    hasOriginRemote: input.hasOriginRemote ?? true,
    defaultBranchName: input.defaultBranchName,
    translate,
  });
  const canRun = execution.kind === "run_action" && execution.action === "create_pr";
  const hint = (() => {
    if (canRun) return null;
    if (execution.kind === "unavailable") return execution.hint;
    if (execution.kind === "open_pr") {
      return translate("git:gitActionPrAlreadyOpen");
    }
    if (execution.kind === "run_action" && execution.action === "commit_push_pr") {
      return translate("git:gitActionCommitBeforePr");
    }
    return translate("git:noBranchChangesToIncludeInAPR");
  })();

  return {
    canRun,
    hint,
  };
}

export function resolvePullActionAvailability(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  translate?: GitActionTranslator;
}): { canRun: boolean; hint: string | null } {
  const { gitStatus, isBusy } = input;
  const translate = input.translate ?? defaultTranslate;
  if (isBusy) return { canRun: false, hint: translate("git:gitActionBusy") };
  if (!gitStatus) return { canRun: false, hint: translate("git:waitingForGit") };
  if (gitStatus.branch === null) {
    return { canRun: false, hint: translate("git:gitActionDetachedPull") };
  }
  if (!gitStatus.hasUpstream) {
    return { canRun: false, hint: translate("git:gitActionNoUpstreamPull") };
  }
  if (gitStatus.aheadCount > 0 && gitStatus.behindCount > 0) {
    return { canRun: false, hint: translate("git:gitActionDiverged") };
  }
  if (gitStatus.behindCount <= 0) {
    return { canRun: false, hint: translate("git:gitActionAlreadyUpToDate") };
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
  translate?: GitActionTranslator;
}): PromotedPullPresentation | null {
  if (!shouldPromotePullAction(input)) return null;
  const translate = input.translate ?? defaultTranslate;
  return {
    label: input.isPullRunning ? translate("git:gitActionPulling") : translate("git:pull"),
  };
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
  translate?: GitActionTranslator;
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const translate = input.translate ?? defaultTranslate;
  const suffix = translate("git:defaultBranchActionOnBranch", { value0: branchLabel });

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: translate("git:defaultBranchCommitPushTitle"),
        description: translate("git:defaultBranchCommitPushDescription", { value0: suffix }),
        continueLabel: translate("git:defaultBranchCommitPushContinue", {
          value0: branchLabel,
        }),
      };
    }
    return {
      title: translate("git:defaultBranchPushTitle"),
      description: translate("git:defaultBranchPushDescription", { value0: suffix }),
      continueLabel: translate("git:defaultBranchPushContinue", { value0: branchLabel }),
    };
  }

  if (input.includesCommit) {
    return {
      title: translate("git:defaultBranchFeatureBranchCommitPrTitle"),
      description: translate("git:defaultBranchFeatureBranchCommitPrDescription", {
        value0: branchLabel,
      }),
      continueLabel: translate("git:createFeatureBranchContinue"),
    };
  }
  return {
    title: translate("git:defaultBranchFeatureBranchPrTitle"),
    description: translate("git:defaultBranchFeatureBranchPrDescription", {
      value0: branchLabel,
    }),
    continueLabel: translate("git:createFeatureBranchContinue"),
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
