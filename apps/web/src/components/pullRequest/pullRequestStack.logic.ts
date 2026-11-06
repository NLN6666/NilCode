import type { PullRequestDetail, PullRequestStack, PullRequestStackEntry } from "@synara/contracts";
import { t as defaultTranslate } from "~/i18n";

export type PullRequestStackAssessment = {
  readonly label: string;
  readonly tone: "ready" | "blocked" | "pending" | "warning" | "complete";
  readonly mergeTargetCount: number;
  readonly canAttemptMerge: boolean;
  readonly blocker: string | null;
};

/** Entries affected by merging the selected PR, ordered from the base branch upwards. */
export function pullRequestStackTargetEntries(
  stack: PullRequestStack,
): ReadonlyArray<PullRequestStackEntry> {
  return stack.entries.filter(
    (entry) => entry.position <= stack.position && entry.state !== "merged",
  );
}

export function assessPullRequestStack(
  stack: PullRequestStack,
  translate: typeof defaultTranslate,
): PullRequestStackAssessment {
  const targets = pullRequestStackTargetEntries(stack);
  if (targets.length === 0) {
    return {
      label: translate("git:stackMerged"),
      tone: "complete",
      mergeTargetCount: 0,
      canAttemptMerge: false,
      blocker: null,
    };
  }

  const closed = targets.find((entry) => entry.state === "closed");
  if (closed) {
    return {
      label: translate("git:pullRequestStackNeedsAttention"),
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: translate("git:pullRequestStackClosedWithoutMerge", { value0: closed.number }),
    };
  }

  const draft = targets.find((entry) => entry.isDraft);
  if (draft) {
    return {
      label: translate("git:pullRequestStackNeedsAttention"),
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: translate("git:pullRequestStackEntryStillDraft", { value0: draft.number }),
    };
  }

  const conflicting = targets.find(
    (entry) =>
      entry.mergeability === "conflicting" ||
      ["BLOCKED", "DIRTY", "DRAFT"].includes(entry.mergeStateStatus ?? ""),
  );
  if (conflicting) {
    return {
      label: translate("git:pullRequestStackNeedsAttention"),
      tone: "blocked",
      mergeTargetCount: targets.length,
      canAttemptMerge: false,
      blocker: translate("git:pullRequestStackEntryNotReady", { value0: conflicting.number }),
    };
  }

  if (targets.some((entry) => entry.mergeStateStatus === "UNSTABLE")) {
    return {
      label: translate("git:pullRequestStackMergeableWithFailingChecks"),
      tone: "warning",
      mergeTargetCount: targets.length,
      canAttemptMerge: true,
      blocker: null,
    };
  }

  const pending = targets.some(
    (entry) =>
      entry.mergeability === "unknown" ||
      entry.mergeStateStatus === null ||
      ["BEHIND", "UNKNOWN"].includes(entry.mergeStateStatus),
  );
  if (pending) {
    return {
      label: translate("git:pullRequestStackMergeStatusPending"),
      tone: "pending",
      mergeTargetCount: targets.length,
      canAttemptMerge: true,
      blocker: null,
    };
  }

  return {
    label: translate("git:pullRequestStackReadyToMerge"),
    tone: "ready",
    mergeTargetCount: targets.length,
    canAttemptMerge: true,
    blocker: null,
  };
}

export function pullRequestMergeBlocker(
  detail: Pick<PullRequestDetail, "mergeability" | "stackMetadataIncomplete">,
  stackAssessment: PullRequestStackAssessment | null,
  translate: typeof defaultTranslate,
): string | null {
  if (detail.stackMetadataIncomplete === true) {
    return translate("git:stackDetailsCouldNotBeLoadedRefreshBeforeMerging");
  }
  if (stackAssessment?.canAttemptMerge === false) {
    return stackAssessment.blocker ?? translate("git:pullRequestStackNotReady");
  }
  return detail.mergeability === "conflicting" ? translate("git:prMergeBlocker_conflicts") : null;
}
