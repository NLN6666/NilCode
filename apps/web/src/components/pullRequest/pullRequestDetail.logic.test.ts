import { describe, expect, it } from "vitest";

import type { PullRequestComment, PullRequestCommit } from "@synara/contracts";

import type { RightDockPane } from "~/rightDockStore.logic";
import { t } from "~/i18n";

import {
  buildPullRequestTimelineEvents,
  pullRequestDetailInputFromPane,
  stripHtmlComments,
  describePullRequestChecksBrief,
  describePullRequestMergeStatus,
} from "./pullRequestDetail.logic";

function makeCommit(overrides: Partial<PullRequestCommit> = {}): PullRequestCommit {
  return {
    oid: "abcdef1234567890",
    messageHeadline: "Fix the widget",
    messageBody: "",
    committedDate: "2026-07-02T10:00:00Z",
    authors: [],
    ...overrides,
  };
}

function makeComment(overrides: Partial<PullRequestComment> = {}): PullRequestComment {
  return {
    id: "comment-1",
    kind: "issue-comment",
    author: { login: "reviewer", name: null, avatarUrl: null, url: null },
    body: "Looks good",
    createdAt: "2026-07-03T10:00:00Z",
    updatedAt: null,
    url: null,
    path: null,
    reviewState: null,
    ...overrides,
  };
}

function makeTimelineSource() {
  return {
    createdAt: "2026-07-01T10:00:00Z",
    author: { login: "author", name: null, avatarUrl: null, url: null },
    commits: [makeCommit()],
    comments: [makeComment()],
    mergedAt: null,
    closedAt: null,
  };
}

describe("buildPullRequestTimelineEvents", () => {
  it("orders created, commit, and comment events chronologically", () => {
    const events = buildPullRequestTimelineEvents(makeTimelineSource(), t);
    expect(events.map((event) => event.id)).toEqual(["created", "abcdef1234567890", "comment-1"]);
  });

  it("preserves provider commit identity and author values in timeline entries", () => {
    const events = buildPullRequestTimelineEvents(
      {
        ...makeTimelineSource(),
        commits: [
          makeCommit({
            authors: [{ login: null, name: "Local author", avatarUrl: null, url: null }],
          }),
        ],
      },
      t,
    );
    const commitEvent = events.find((event) => event.id === "abcdef1234567890");
    expect(commitEvent?.title).toContain("abcdef1");
    expect(commitEvent?.title).toContain("Local author");
  });

  it("preserves display names and login fallbacks from provider data", () => {
    const events = buildPullRequestTimelineEvents(
      {
        ...makeTimelineSource(),
        author: { login: "octo", name: "Octo Cat", avatarUrl: null, url: null },
      },
      t,
    );
    expect(events[0]?.title).toContain("Octo Cat");
    expect(events[0]?.title).not.toContain("octo");
    expect(events[2]?.title).toContain("reviewer");
  });

  it("builds an issue timeline without pull request commit events", () => {
    const events = buildPullRequestTimelineEvents(
      {
        createdAt: "2026-07-01T10:00:00Z",
        author: { login: "author", name: null, avatarUrl: null, url: null },
        comments: [makeComment()],
        closedAt: "2026-07-05T10:00:00Z",
      },
      t,
      "issue",
    );
    expect(events.map((event) => event.id)).toEqual(["created", "comment-1", "closed"]);
  });

  it("appends a merged event and suppresses the closed event when both timestamps exist", () => {
    const events = buildPullRequestTimelineEvents(
      {
        ...makeTimelineSource(),
        mergedAt: "2026-07-04T10:00:00Z",
        closedAt: "2026-07-04T10:00:00Z",
      },
      t,
    );
    const ids = events.map((event) => event.id);
    expect(ids).toContain("merged");
    expect(ids).not.toContain("closed");
    expect(events.at(-1)?.id).toBe("merged");
  });

  it("appends a closed event for a closed-but-unmerged pull request", () => {
    const events = buildPullRequestTimelineEvents(
      {
        ...makeTimelineSource(),
        closedAt: "2026-07-04T10:00:00Z",
      },
      t,
    );
    expect(events.at(-1)?.id).toBe("closed");
  });
});

describe("pullRequestDetailInputFromPane", () => {
  const basePane: RightDockPane = {
    id: "pane-1",
    kind: "pullRequest",
    threadId: null,
    diffTurnId: null,
    diffFilePath: null,
    filePath: null,
    pullRequestProjectId: "project-1" as RightDockPane["pullRequestProjectId"],
    pullRequestRepository: "acme/widgets",
    pullRequestNumber: 350,
    pullRequestInitialTab: null,
  };

  it("builds the detail input from a fully-populated pull request pane", () => {
    expect(pullRequestDetailInputFromPane(basePane)).toEqual({
      projectId: "project-1",
      repository: "acme/widgets",
      number: 350,
    });
  });

  it("returns null for empty pull request panes and other pane kinds", () => {
    expect(pullRequestDetailInputFromPane({ ...basePane, pullRequestNumber: null })).toBeNull();
    expect(pullRequestDetailInputFromPane({ ...basePane, kind: "diff" })).toBeNull();
  });
});

describe("stripHtmlComments", () => {
  it("removes multi-line comments anywhere in the body", () => {
    expect(stripHtmlComments("Before\n<!--\nline one\nline two\n-->\nAfter")).toBe(
      "Before\n\nAfter",
    );
  });

  it("keeps comments inside fenced code blocks", () => {
    const markdown = "Intro\n```html\n<!-- keep me -->\n```\n<!-- drop me -->";
    expect(stripHtmlComments(markdown)).toBe("Intro\n```html\n<!-- keep me -->\n```");
  });
});

describe("describePullRequestMergeStatus", () => {
  const open = { state: "open", isDraft: false, baseBranch: "main" } as const;
  it("classifies merge eligibility, conflicts, and terminal states", () => {
    expect(describePullRequestMergeStatus({ ...open, mergeability: "mergeable" }, t)).toMatchObject(
      {
        tone: "success",
      },
    );
    expect(describePullRequestMergeStatus({ ...open, mergeability: "conflicting" }, t).tone).toBe(
      "conflict",
    );
    expect(
      describePullRequestMergeStatus(
        {
          ...open,
          isDraft: true,
          mergeability: "mergeable",
        },
        t,
      ).tone,
    ).toBe("muted");
    expect(
      describePullRequestMergeStatus(
        {
          ...open,
          state: "merged",
          mergeability: "unknown",
        },
        t,
      ).tone,
    ).toBe("muted");
  });
});

describe("describePullRequestChecksBrief", () => {
  it("classifies check outcomes", () => {
    expect(describePullRequestChecksBrief([], t).tone).toBe("none");
    expect(
      describePullRequestChecksBrief([{ status: "success" }, { status: "success" }], t),
    ).toMatchObject({ tone: "success" });
    expect(
      describePullRequestChecksBrief(
        [{ status: "failure" }, { status: "pending" }, { status: "success" }],
        t,
      ).tone,
    ).toBe("failure");
  });
});
