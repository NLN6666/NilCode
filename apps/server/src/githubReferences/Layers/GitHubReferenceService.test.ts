import { ProjectId, type OrchestrationProject } from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GitHubCliError } from "../../git/Errors";
import { createGitHubCliWithFakeGh } from "../../git/testing/fakeGitHubCli";
import { makeGitHubReferenceService } from "./GitHubReferenceService";

const project = {
  id: ProjectId.makeUnsafe("project-github-references"),
  kind: "project",
  title: "App",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  isPinned: false,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  deletedAt: null,
} satisfies OrchestrationProject;

function makeDependencies(scenario: Parameters<typeof createGitHubCliWithFakeGh>[0] = {}) {
  return {
    github: createGitHubCliWithFakeGh(scenario).service,
    listProjects: () => Effect.succeed([project]),
    resolveRepositories: () =>
      Effect.succeed({
        repositories: [
          { nameWithOwner: "acme/app", url: "https://github.com/acme/app" },
          { nameWithOwner: "acme/upstream", url: "https://github.com/acme/upstream" },
        ],
        authoritative: true,
      }),
  };
}

describe("GitHubReferenceService", () => {
  it("searches the preferred project repository and ranks an exact number first", async () => {
    const service = makeGitHubReferenceService(
      makeDependencies({
        githubReferenceSearchJson: JSON.stringify({
          items: [
            {
              number: 5,
              title: "Recent issue",
              html_url: "https://github.com/acme/app/issues/5",
              state: "open",
              updated_at: "2026-08-11T02:00:00Z",
            },
            {
              number: 12,
              title: "Exact pull request",
              html_url: "https://github.com/acme/app/pull/12",
              state: "open",
              updated_at: "2026-08-10T02:00:00Z",
              pull_request: { merged_at: null },
            },
          ],
        }),
      }),
    );

    const result = await Effect.runPromise(
      service.search({ projectId: project.id, query: "#12", limit: 20 }),
    );

    expect(result.repository).toBe("acme/app");
    expect(result.entries.map((entry) => [entry.kind, entry.number])).toEqual([
      ["pull", 12],
      ["issue", 5],
    ]);
  });

  it("loads issue and pull request details into one reference shape", async () => {
    const service = makeGitHubReferenceService(
      makeDependencies({
        issueDetails: [
          {
            number: 5,
            title: "Issue five",
            body: "Issue body",
            url: "https://github.com/acme/app/issues/5",
            state: "open",
            author: { login: "octocat", name: null, avatarUrl: null, url: null },
            labels: [{ name: "bug", color: null }],
            stateReason: null,
            assignees: [],
            commentCount: 0,
            comments: [],
            commentsTruncated: false,
            createdAt: "2026-08-11T02:00:00Z",
            closedAt: null,
            updatedAt: "2026-08-11T02:00:00Z",
          },
        ],
        pullRequestDetail: {
          number: 12,
          title: "PR twelve",
          body: "PR body",
          url: "https://github.com/acme/app/pull/12",
          author: { login: "octocat", name: null, avatarUrl: null, url: null },
          state: "merged",
          isDraft: false,
          mergeable: "MERGEABLE",
          mergeability: "mergeable",
          mergeStateStatus: "CLEAN",
          reviewDecision: null,
          additions: 1,
          deletions: 0,
          changedFiles: 1,
          headBranch: "feature",
          baseBranch: "main",
          createdAt: "2026-08-10T00:00:00Z",
          updatedAt: "2026-08-11T01:00:00Z",
          mergedAt: "2026-08-11T01:00:00Z",
          closedAt: "2026-08-11T01:00:00Z",
          maintainerCanModify: true,
          reviewers: [],
          labels: [{ name: "feature", color: "00ff00" }],
          checks: [],
          comments: [],
          commits: [],
        },
      }),
    );

    const issue = await Effect.runPromise(
      service.detail({
        projectId: project.id,
        reference: {
          kind: "issue",
          repository: "acme/app",
          number: 5,
          title: "Issue five",
          url: "https://github.com/acme/app/issues/5",
        },
      }),
    );
    const pull = await Effect.runPromise(
      service.detail({
        projectId: project.id,
        reference: {
          kind: "pull",
          repository: "acme/app",
          number: 12,
          title: "PR twelve",
          url: "https://github.com/acme/app/pull/12",
        },
      }),
    );

    expect(issue).toMatchObject({ body: "Issue body", headBranch: null, isDraft: null });
    expect(pull).toMatchObject({
      state: "merged",
      body: "PR body",
      headBranch: "feature",
      baseBranch: "main",
      isDraft: false,
      labels: ["feature"],
    });
  });

  it("rejects references outside the project's authoritative repository inventory", async () => {
    const service = makeGitHubReferenceService(makeDependencies());
    const error = await Effect.runPromise(
      service
        .detail({
          projectId: project.id,
          reference: {
            kind: "issue",
            repository: "other/repo",
            number: 7,
            title: "Foreign issue",
            url: "https://github.com/other/repo/issues/7",
          },
        })
        .pipe(Effect.flip),
    );
    expect(error.reason).toBe("repository-unavailable");
  });

  it("maps missing and unauthenticated gh failures to typed availability errors", async () => {
    for (const [reason, expected] of [
      ["not-installed", "gh-not-installed"],
      ["not-authenticated", "gh-not-authenticated"],
    ] as const) {
      const service = makeGitHubReferenceService(
        makeDependencies({
          failWith: new GitHubCliError({ operation: "execute", detail: reason, reason }),
        }),
      );
      const error = await Effect.runPromise(
        service.search({ projectId: project.id, query: "", limit: 20 }).pipe(Effect.flip),
      );
      expect(error.reason).toBe(expected);
    }
  });
});
