import {
  GitHubReferencesUnavailableError,
  type GitHubReferenceDetail,
  type GitHubReferenceSearchItem,
  type OrchestrationProject,
} from "@synara/contracts";
import { Effect, Layer } from "effect";

import { GitHubCliError } from "../../git/Errors";
import { GitCore } from "../../git/Services/GitCore";
import { GitHubCli, type GitHubCliShape } from "../../git/Services/GitHubCli";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import {
  resolveGitHubRepositories,
  type GitHubRepositoryInventory,
} from "../../pullRequests/repositoryResolution";
import {
  GitHubReferenceService,
  type GitHubReferenceServiceShape,
} from "../Services/GitHubReferenceService";

export interface GitHubReferenceServiceDependencies {
  readonly github: GitHubCliShape;
  readonly listProjects: () => Effect.Effect<ReadonlyArray<OrchestrationProject>, unknown>;
  readonly resolveRepositories: (
    project: OrchestrationProject,
  ) => Effect.Effect<GitHubRepositoryInventory, unknown>;
}

function unavailable(
  reason: GitHubReferencesUnavailableError["reason"],
  message: string,
): GitHubReferencesUnavailableError {
  return new GitHubReferencesUnavailableError({ reason, message });
}

function mapGitHubError(error: unknown, operation: "search" | "detail") {
  if (error instanceof GitHubReferencesUnavailableError) return error;
  if (error instanceof GitHubCliError) {
    if (error.reason === "not-installed") return unavailable("gh-not-installed", error.detail);
    if (error.reason === "not-authenticated") {
      return unavailable("gh-not-authenticated", error.detail);
    }
    return unavailable(
      operation === "detail" ? "reference-not-found" : "repository-unavailable",
      error.detail,
    );
  }
  return unavailable(
    "repository-unavailable",
    operation === "detail"
      ? "Unable to resolve the GitHub reference for this project."
      : "Unable to resolve a GitHub repository for this project.",
  );
}

function rankSearchEntries(
  entries: ReadonlyArray<GitHubReferenceSearchItem>,
  query: string,
): ReadonlyArray<GitHubReferenceSearchItem> {
  const exactNumber = /^#?(\d+)$/.exec(query.trim())?.[1];
  if (!exactNumber) return entries;
  const number = Number(exactNumber);
  return [...entries].sort((left, right) =>
    left.number === number ? -1 : right.number === number ? 1 : 0,
  );
}

export function makeGitHubReferenceService(
  dependencies: GitHubReferenceServiceDependencies,
): GitHubReferenceServiceShape {
  const loadProjectInventory = (projectId: string) =>
    dependencies.listProjects().pipe(
      Effect.flatMap((projects) => {
        const project = projects.find((candidate) => candidate.id === projectId);
        return project
          ? dependencies
              .resolveRepositories(project)
              .pipe(Effect.map((inventory) => ({ project, inventory })))
          : Effect.fail(
              unavailable("repository-unavailable", "The selected project is not available."),
            );
      }),
      Effect.mapError((error) => mapGitHubError(error, "search")),
    );

  return {
    search: (input) =>
      loadProjectInventory(input.projectId).pipe(
        Effect.flatMap(({ project, inventory }) => {
          const repository = inventory.repositories[0]?.nameWithOwner;
          if (!repository || !inventory.authoritative) {
            return Effect.fail(
              unavailable(
                "repository-unavailable",
                "No authoritative GitHub repository is configured for this project.",
              ),
            );
          }
          const query = input.query.trim();
          const normalizedQuery = /^#\d+$/.test(query) ? query.slice(1) : query;
          return dependencies.github
            .searchRepositoryReferences({
              cwd: project.workspaceRoot,
              repository,
              query: normalizedQuery,
              limit: Math.min(input.limit ?? 20, 20),
            })
            .pipe(
              Effect.map((batch) => ({
                repository,
                entries: rankSearchEntries(batch.entries, query),
              })),
              Effect.mapError((error) => mapGitHubError(error, "search")),
            );
        }),
      ),
    detail: (input) =>
      loadProjectInventory(input.projectId).pipe(
        Effect.flatMap(({ project, inventory }) => {
          const referenceRepository = input.reference.repository.toLowerCase();
          const allowed =
            inventory.authoritative &&
            inventory.repositories.some(
              (repository) => repository.nameWithOwner.toLowerCase() === referenceRepository,
            );
          if (!allowed) {
            return Effect.fail(
              unavailable(
                "repository-unavailable",
                "The referenced repository does not belong to the selected project.",
              ),
            );
          }

          if (input.reference.kind === "issue") {
            return dependencies.github
              .getIssueDetail({
                cwd: project.workspaceRoot,
                repository: input.reference.repository,
                number: input.reference.number,
              })
              .pipe(
                Effect.map(
                  (detail): GitHubReferenceDetail => ({
                    reference: input.reference,
                    state: detail.state,
                    body: detail.body,
                    authorLogin: detail.author?.login ?? null,
                    labels: detail.labels.map((label) => label.name),
                    updatedAt: detail.updatedAt,
                    headBranch: null,
                    baseBranch: null,
                    isDraft: null,
                  }),
                ),
                Effect.mapError((error) => mapGitHubError(error, "detail")),
              );
          }

          return dependencies.github
            .getPullRequestDetail({
              cwd: project.workspaceRoot,
              repository: input.reference.repository,
              number: input.reference.number,
            })
            .pipe(
              Effect.map(
                (detail): GitHubReferenceDetail => ({
                  reference: input.reference,
                  state: detail.state,
                  body: detail.body,
                  authorLogin: detail.author?.login ?? null,
                  labels: detail.labels.map((label) => label.name),
                  updatedAt: detail.updatedAt,
                  headBranch: detail.headBranch,
                  baseBranch: detail.baseBranch,
                  isDraft: detail.isDraft,
                }),
              ),
              Effect.mapError((error) => mapGitHubError(error, "detail")),
            );
        }),
        Effect.mapError((error) => mapGitHubError(error, "detail")),
      ),
  };
}

export const GitHubReferenceServiceLive = Layer.effect(
  GitHubReferenceService,
  Effect.gen(function* () {
    const git = yield* GitCore;
    const github = yield* GitHubCli;
    const projection = yield* ProjectionSnapshotQuery;
    return makeGitHubReferenceService({
      github,
      listProjects: () =>
        projection
          .getShellSnapshot()
          .pipe(
            Effect.map((snapshot) =>
              snapshot.projects.map((project) => ({ ...project, deletedAt: null })),
            ),
          ),
      resolveRepositories: (project) => resolveGitHubRepositories(git, project.workspaceRoot),
    });
  }),
);
