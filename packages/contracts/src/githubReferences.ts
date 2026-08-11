import { Schema } from "effect";

import { IsoDateTime, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";

export const GitHubReferenceKind = Schema.Literals(["pull", "issue"]);
export type GitHubReferenceKind = typeof GitHubReferenceKind.Type;

export const GitHubReferenceState = Schema.Literals(["open", "closed", "merged"]);
export type GitHubReferenceState = typeof GitHubReferenceState.Type;

export const GitHubRepositoryName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[^/\s]+\/[^/\s]+$/),
);
export type GitHubRepositoryName = typeof GitHubRepositoryName.Type;

export const GitHubReferenceUrl = TrimmedNonEmptyString.check(
  Schema.isPattern(/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/\d+(?:[/?#].*)?$/),
);

const GitHubReferenceFields = {
  kind: GitHubReferenceKind,
  repository: GitHubRepositoryName,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: GitHubReferenceUrl,
} as const;

export const GitHubReference = Schema.Struct(GitHubReferenceFields);
export type GitHubReference = typeof GitHubReference.Type;

export const GitHubReferenceSearchItem = Schema.Struct({
  ...GitHubReferenceFields,
  state: GitHubReferenceState,
  updatedAt: IsoDateTime,
});
export type GitHubReferenceSearchItem = typeof GitHubReferenceSearchItem.Type;

export const GitHubReferencesSearchInput = Schema.Struct({
  projectId: ProjectId,
  query: Schema.String.check(Schema.isMaxLength(200)),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(20))).pipe(
    Schema.withDecodingDefault(() => 20),
  ),
});
export type GitHubReferencesSearchInput = typeof GitHubReferencesSearchInput.Type;

export const GitHubReferencesSearchResult = Schema.Struct({
  repository: GitHubRepositoryName,
  entries: Schema.Array(GitHubReferenceSearchItem),
});
export type GitHubReferencesSearchResult = typeof GitHubReferencesSearchResult.Type;

export const GitHubReferenceDetailInput = Schema.Struct({
  projectId: ProjectId,
  reference: GitHubReference,
});
export type GitHubReferenceDetailInput = typeof GitHubReferenceDetailInput.Type;

export const GitHubReferenceDetail = Schema.Struct({
  reference: GitHubReference,
  state: GitHubReferenceState,
  body: Schema.String,
  authorLogin: Schema.NullOr(TrimmedNonEmptyString),
  labels: Schema.Array(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
  headBranch: Schema.NullOr(TrimmedNonEmptyString),
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  isDraft: Schema.NullOr(Schema.Boolean),
});
export type GitHubReferenceDetail = typeof GitHubReferenceDetail.Type;

export class GitHubReferencesUnavailableError extends Schema.TaggedErrorClass<GitHubReferencesUnavailableError>()(
  "GitHubReferencesUnavailableError",
  {
    reason: Schema.Literals([
      "gh-not-installed",
      "gh-not-authenticated",
      "repository-unavailable",
      "reference-not-found",
    ]),
    message: TrimmedNonEmptyString,
  },
) {}
