# GitHub `#` References and Main-Thread-Only `@` Mentions — Design

**Date:** 2026-08-11
**Status:** Approved for implementation

## Goal

Add a `#` composer picker for pull requests and GitHub issues from the active project's preferred GitHub repository, attach bounded structured context when the turn is sent, and prevent `@` chat mentions from offering or resolving subagent child threads.

## User-visible behavior

### `@` chat mentions

- Ordinary project, chat, and studio threads remain available.
- A thread with a non-null `parentThreadId` is a subagent child and is never offered.
- The server enforces the same invariant so stale or handcrafted `thread://` references cannot inject a child transcript.

### `#` GitHub references

- A whitespace-bounded `#` opens a picker for the active project's preferred GitHub repository.
- Empty query lists recently updated open PRs and issues. `#123` prioritizes that number; a text fragment filters titles. Results are capped at 20.
- Rows show PR/Issue type, number, title, state, and repository.
- Selection inserts the canonical `#123` token. Send-time resolution restores repository, type, number, title, URL, and detail through the project-scoped service.
- URL fragments do not trigger. Whitespace after an unmatched `#` closes the menu so Markdown headings remain usable.

## Architecture

GitHub references use a dedicated contract instead of masquerading as provider-native mentions:

```ts
interface GitHubReference {
  kind: "pull" | "issue";
  repository: string;
  number: number;
  title: string;
  url: string;
}
```

Search and detail inputs are project-scoped. The server resolves authoritative repository inventory and rejects repositories outside it.

The web client calls a debounced WebSocket RPC search method. A focused service resolves the preferred repository and asks `GitHubCli` for mixed results. Search uses GitHub's issue search surface, which distinguishes PRs from issues. At dispatch, the client resolves the bounded set of numeric tokens through the same project-scoped RPC: issues use the issue detail surface while PRs reuse the existing PR detail operation. A bounded `<github_reference_context>` block is appended before provider-specific prompt formatting and stripped from the displayed timeline text.

The composer adds a `github-reference` trigger and menu item while keeping `#123` as normal editable text. Send-time token collection means deleting the token removes the reference automatically, queued turns remain self-contained, and GitHub references never enter provider-native mention metadata.

## Reliability and security

- Search is debounced, stale requests are ignored, cache keys include project/repository/query, and results are capped at 20.
- Missing or unauthenticated `gh` becomes an actionable unavailable state without breaking the composer.
- Detail resolution has per-reference, total-character, and reference-count budgets.
- An inaccessible item preserves readable `#123` text and omits only its context instead of blocking the turn.
- The server never trusts an arbitrary repository supplied by the browser.

## Testing

- Selector and server context tests prove subagent threads cannot be referenced through `@`.
- Contract, GitHub CLI, service, and RPC tests cover mixed results, exact-number matching, malformed payloads, auth failures, repository validation, and PR/Issue detail normalization.
- Composer tests cover trigger boundaries, URL/Markdown conflicts, menu grouping, token filtering, bounded context, and untrusted-field escaping.
- Send-path tests prove resolution failure degrades to plain text and hidden context is stripped from displayed messages.

## Non-goals

- No cross-repository global search.
- No issue or PR mutation from the picker.
- No comments, diffs, checks, or full PR timelines in prompt context.
- No change to subagent visibility in the sidebar or dock.
