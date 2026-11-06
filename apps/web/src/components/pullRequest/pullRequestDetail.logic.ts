// FILE: pullRequestDetail.logic.ts
// Purpose: Pure helpers shared by every host of the pull request detail surface (the inbox
//          route's detail pane and the chat right-dock pane): the canonical
//          pane identity key, the "PR #n" tab chip label, the plain-language state
//          descriptor, and the flattened chronological timeline event list.
// Layer: Web domain helpers (no React)
// Exports: pullRequestDetailInputKey, pullRequestPaneTabLabel, pullRequestDetailInputFromPane,
//          describePullRequestState, stripHtmlComments, PullRequestTimelineEvent,
//          buildPullRequestTimelineEvents

import type {
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestState,
} from "@synara/contracts";

import type { RightDockPane } from "~/rightDockStore.logic";
import { t as defaultTranslate } from "~/i18n";

import { pullRequestMarkdownPreview } from "./pullRequestMarkdown.logic";

/** Canonical identity for one detail surface — used as the React key so switching the
 *  selected pull request remounts the panel (resetting its tab and diff state). */
export function pullRequestDetailInputKey(input: PullRequestDetailInput): string {
  return `${input.projectId}:${input.repository}#${input.number}`;
}

/** Tab chip label for the right-dock pane tab. */
export function pullRequestPaneTabLabel(number: number): string {
  return `PR #${number}`;
}

/** The detail input a dock "pullRequest" pane points at, or null while the pane is empty.
 *  Single owner of the identity-fields guard so every pane consumer (content, tab icon)
 *  validates the same way. */
export function pullRequestDetailInputFromPane(pane: RightDockPane): PullRequestDetailInput | null {
  if (
    pane.kind !== "pullRequest" ||
    !pane.pullRequestProjectId ||
    !pane.pullRequestRepository ||
    !pane.pullRequestNumber
  ) {
    return null;
  }
  return {
    projectId: pane.pullRequestProjectId,
    repository: pane.pullRequestRepository,
    number: pane.pullRequestNumber,
  };
}

// Plain-language state descriptor shown next to the author line — the state color itself is
// already conveyed by the PullRequestStateGlyph in the header, so this stays neutral text.
// State only, matching git: conflicts are a merge signal and render as their own row.
export function describePullRequestState(
  state: PullRequestState,
  isDraft: boolean,
  translate: typeof defaultTranslate,
): string {
  if (isDraft && state === "open") return translate("git:column_draft");
  if (state === "open") return translate("git:readyForReview");
  if (state === "merged") return translate("git:merged");
  return translate("chat:closed");
}

// stripHtmlComments now lives with the rest of the markdown preprocessing.
export { stripHtmlComments } from "./pullRequestMarkdown.logic";

export interface PullRequestTimelineEvent {
  id: string;
  /** ISO timestamp the event sorts by. */
  at: string;
  title: string;
  body: string | null;
}

/** How the app names a GitHub person: the display name, else the login. Null when neither is
 *  known (a deleted account); each surface picks its own word for that case. */
export function githubActorName(
  actor: { login?: string | null; name?: string | null } | null | undefined,
): string | null {
  return actor?.name?.trim() || actor?.login?.trim() || null;
}

/** A pull request's timeline source; issues have no commits and no merge. */
export type GitHubItemTimelineSource = Pick<
  PullRequestDetail,
  "createdAt" | "author" | "comments" | "closedAt"
> &
  Partial<Pick<PullRequestDetail, "commits" | "mergedAt">>;

/** Flattens creation, commits, comments/reviews, and the terminal merge/close event into one
 *  chronologically sorted list. Merged wins over closed: GitHub sets both timestamps on a
 *  merge, and showing "closed" for a merged pull request would misstate what happened. */
export function buildPullRequestTimelineEvents(
  detail: GitHubItemTimelineSource,
  translate: typeof defaultTranslate,
  noun?: "pull request" | "issue",
): PullRequestTimelineEvent[] {
  const isIssue = noun === "issue";
  const itemNoun = isIssue ? translate("settings:issue") : translate("chat:pullRequest");
  const someone = translate("git:timelineSomeone");
  const mergedAt = detail.mergedAt ?? null;
  const events: PullRequestTimelineEvent[] = [
    {
      id: "created",
      at: detail.createdAt,
      title: translate("git:timelineOpenedThis", {
        value0: githubActorName(detail.author) ?? someone,
        value1: itemNoun,
      }),
      body: null,
    },
    ...(detail.commits ?? []).map((commit) => {
      const authorLabel = commit.authors.map(githubActorName).find((name) => name !== null);
      return {
        id: commit.oid,
        at: commit.committedDate,
        title: authorLabel
          ? translate("git:timelineCommitBy", {
              value0: commit.oid.slice(0, 7),
              value1: authorLabel,
            })
          : translate("git:timelineCommit", { value0: commit.oid.slice(0, 7) }),
        body: commit.messageHeadline || translate("git:timelineNoCommitMessage"),
      };
    }),
    ...detail.comments.map((comment) => ({
      id: comment.id,
      at: comment.createdAt,
      title:
        comment.kind === "review"
          ? translate("git:timelineReviewedBy", {
              value0: githubActorName(comment.author) ?? someone,
            })
          : translate("git:timelineCommentedBy", {
              value0: githubActorName(comment.author) ?? someone,
            }),
      // Timeline previews are plain text, so raw markdown/HTML would print literally.
      body: pullRequestMarkdownPreview(comment.body) || null,
    })),
    ...(mergedAt
      ? [
          {
            id: "merged",
            at: mergedAt,
            title: translate("git:pr_merged"),
            body: null,
          },
        ]
      : []),
    ...(detail.closedAt && !mergedAt
      ? [
          {
            id: "closed",
            at: detail.closedAt,
            title: translate(isIssue ? "git:issueClosed" : "git:pr_closed"),
            body: null,
          },
        ]
      : []),
  ];
  return events.toSorted((left, right) => left.at.localeCompare(right.at));
}

export type PullRequestMergeStatusTone = "success" | "conflict" | "muted";

/** The Merge status line of the detail's info column, from what GitHub reports. */
export function describePullRequestMergeStatus(
  detail: Pick<PullRequestDetail, "state" | "isDraft" | "mergeability" | "baseBranch">,
  translate: typeof defaultTranslate,
): { tone: PullRequestMergeStatusTone; label: string } {
  if (detail.state === "merged") return { tone: "muted", label: translate("git:merged") };
  if (detail.state === "closed") return { tone: "muted", label: translate("chat:closed") };
  if (detail.isDraft) return { tone: "muted", label: translate("git:column_draft") };
  if (detail.mergeability === "conflicting") {
    return {
      tone: "conflict",
      label: `${translate("git:conflictsWith")} ${detail.baseBranch}`,
    };
  }
  if (detail.mergeability === "mergeable") {
    return { tone: "success", label: translate("git:pullRequestCanMergeWithoutConflicts") };
  }
  return { tone: "muted", label: translate("git:pullRequestMergeStatusUnknown") };
}

/** "24 successful", "2 failing, 22 successful": the checks row's one-line summary. */
export function describePullRequestChecksBrief(
  checks: ReadonlyArray<{
    status: PullRequestDetail["checks"][number]["status"];
  }>,
  translate: typeof defaultTranslate,
): { tone: "success" | "failure" | "pending" | "none"; label: string } {
  if (checks.length === 0) return { tone: "none", label: translate("git:noChecks") };
  const count = (...statuses: string[]) =>
    checks.filter((check) => statuses.includes(check.status)).length;
  const failing = count("failure", "cancelled");
  const pending = count("pending");
  const successful = count("success");
  const parts = [
    failing > 0 ? translate("git:checksSummary_failing", { count: failing }) : null,
    pending > 0 ? translate("git:checksSummary_pending", { count: pending }) : null,
    successful > 0 ? translate("git:checksSummary_succeeded", { count: successful }) : null,
  ].filter((part) => part !== null);
  const label =
    parts.length > 0
      ? parts.join(", ")
      : translate("git:checksSummary_skipped", { count: checks.length });
  return {
    tone: failing > 0 ? "failure" : pending > 0 ? "pending" : successful > 0 ? "success" : "none",
    label,
  };
}
