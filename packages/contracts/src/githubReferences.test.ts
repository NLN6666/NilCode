import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  GitHubReference,
  GitHubReferenceDetail,
  GitHubReferencesSearchInput,
  GitHubReferencesSearchResult,
} from "./githubReferences";

const decodeReference = Schema.decodeUnknownSync(GitHubReference);
const decodeDetail = Schema.decodeUnknownSync(GitHubReferenceDetail);
const decodeSearchInput = Schema.decodeUnknownSync(GitHubReferencesSearchInput);
const decodeSearchResult = Schema.decodeUnknownSync(GitHubReferencesSearchResult);

const reference = {
  kind: "issue",
  repository: "acme/widgets",
  number: 42,
  title: "Fix authentication",
  url: "https://github.com/acme/widgets/issues/42",
} as const;

describe("GitHubReference", () => {
  it("accepts canonical issue and pull references", () => {
    expect(decodeReference(reference)).toEqual(reference);
    expect(
      decodeReference({
        ...reference,
        kind: "pull",
        url: "https://github.com/acme/widgets/pull/42",
      }),
    ).toMatchObject({ kind: "pull", number: 42 });
  });

  it("rejects invalid repositories, URLs, and non-positive numbers", () => {
    expect(() => decodeReference({ ...reference, repository: "widgets" })).toThrow();
    expect(() => decodeReference({ ...reference, url: "https://example.com/42" })).toThrow();
    expect(() => decodeReference({ ...reference, number: 0 })).toThrow();
  });
});

describe("GitHub reference search contracts", () => {
  it("bounds search input and decodes mixed results", () => {
    expect(decodeSearchInput({ projectId: "project-1", query: "auth", limit: 20 })).toEqual({
      projectId: "project-1",
      query: "auth",
      limit: 20,
    });
    expect(() => decodeSearchInput({ projectId: "project-1", query: "auth", limit: 21 })).toThrow();

    expect(
      decodeSearchResult({
        repository: "acme/widgets",
        entries: [
          { ...reference, state: "open", updatedAt: "2026-08-11T00:00:00Z" },
          {
            ...reference,
            kind: "pull",
            number: 7,
            title: "Ship authentication",
            url: "https://github.com/acme/widgets/pull/7",
            state: "merged",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ],
      }).entries.map(({ kind, number }) => ({ kind, number })),
    ).toEqual([
      { kind: "issue", number: 42 },
      { kind: "pull", number: 7 },
    ]);
  });
});

describe("GitHubReferenceDetail", () => {
  it("keeps issue fields provider-neutral and PR-only fields nullable", () => {
    expect(
      decodeDetail({
        reference,
        state: "closed",
        body: "Resolved",
        authorLogin: "octocat",
        labels: ["bug"],
        updatedAt: "2026-08-11T00:00:00Z",
        headBranch: null,
        baseBranch: null,
        isDraft: null,
      }),
    ).toMatchObject({ state: "closed", headBranch: null, isDraft: null });
  });
});
