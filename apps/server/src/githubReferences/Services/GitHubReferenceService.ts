import type {
  GitHubReferenceDetail,
  GitHubReferenceDetailInput,
  GitHubReferencesSearchInput,
  GitHubReferencesSearchResult,
  GitHubReferencesUnavailableError,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface GitHubReferenceServiceShape {
  readonly search: (
    input: GitHubReferencesSearchInput,
  ) => Effect.Effect<GitHubReferencesSearchResult, GitHubReferencesUnavailableError>;
  readonly detail: (
    input: GitHubReferenceDetailInput,
  ) => Effect.Effect<GitHubReferenceDetail, GitHubReferencesUnavailableError>;
}

export class GitHubReferenceService extends ServiceMap.Service<
  GitHubReferenceService,
  GitHubReferenceServiceShape
>()("synara/githubReferences/Services/GitHubReferenceService/GitHubReferenceService") {}
