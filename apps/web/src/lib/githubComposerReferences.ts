import type {
  GitHubReference,
  GitHubReferenceDetail,
  NativeApi,
  ProjectId,
} from "@synara/contracts";

const GITHUB_REFERENCE_TOKEN_PATTERN = /(?:^|\s)#(\d+)(?=$|\s|[.,;:!?)}\]])/g;
const TRAILING_GITHUB_REFERENCE_CONTEXT_PATTERN =
  /(?:\n\n)?<github_reference_context>\n[\s\S]*\n<\/github_reference_context>\s*$/;
const MAX_RESOLVED_REFERENCES = 5;
const MAX_REFERENCE_BODY_CHARS = 6_000;
const MAX_REFERENCE_CONTEXT_CHARS = 20_000;

function stringifyUntrustedContext(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      default:
        return "\\u2029";
    }
  });
}

export function formatGitHubReferenceToken(reference: GitHubReference): string {
  return `#${reference.number}`;
}

function referenceIdentity(reference: GitHubReference): string {
  return `${reference.repository.toLowerCase()}\u0000${reference.kind}\u0000${reference.number}`;
}

export function filterPromptGitHubReferences(
  prompt: string,
  references: ReadonlyArray<GitHubReference>,
): GitHubReference[] {
  const mentionedNumbers = new Set(
    [...prompt.matchAll(GITHUB_REFERENCE_TOKEN_PATTERN)].flatMap((match) => {
      const value = Number(match[1]);
      return Number.isInteger(value) && value > 0 ? [value] : [];
    }),
  );
  const seen = new Set<string>();
  return references.filter((reference) => {
    const identity = referenceIdentity(reference);
    if (!mentionedNumbers.has(reference.number) || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function collectPromptGitHubReferenceNumbers(prompt: string): number[] {
  const seen = new Set<number>();
  const numbers: number[] = [];
  for (const match of prompt.matchAll(GITHUB_REFERENCE_TOKEN_PATTERN)) {
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) continue;
    seen.add(number);
    numbers.push(number);
    if (numbers.length >= MAX_RESOLVED_REFERENCES) break;
  }
  return numbers;
}

export function appendGitHubReferenceContext(
  prompt: string,
  details: ReadonlyArray<GitHubReferenceDetail>,
): string {
  if (details.length === 0) return prompt;
  const serialized: string[] = [];
  let serializedChars = 2;
  for (const detail of details.slice(0, MAX_RESOLVED_REFERENCES)) {
    const entry = stringifyUntrustedContext({
      ...detail,
      body: detail.body.slice(0, MAX_REFERENCE_BODY_CHARS),
    });
    const nextChars = serializedChars + entry.length + (serialized.length > 0 ? 1 : 0);
    if (nextChars > MAX_REFERENCE_CONTEXT_CHARS) break;
    serialized.push(entry);
    serializedChars = nextChars;
  }
  if (serialized.length === 0) return prompt;
  const block = [
    "<github_reference_context>",
    `[${serialized.join(",")}]`,
    "</github_reference_context>",
  ].join("\n");
  return prompt.length > 0 ? `${prompt}\n\n${block}` : block;
}

export function stripTrailingGitHubReferenceContext(prompt: string): string {
  return prompt.replace(TRAILING_GITHUB_REFERENCE_CONTEXT_PATTERN, "").replace(/\n+$/, "");
}

export async function resolvePromptGitHubReferenceContext(input: {
  api: NativeApi;
  projectId: ProjectId;
  prompt: string;
}): Promise<string> {
  const numbers = collectPromptGitHubReferenceNumbers(input.prompt);
  if (numbers.length === 0) return input.prompt;
  const details = await Promise.all(
    numbers.map(async (number): Promise<GitHubReferenceDetail | null> => {
      try {
        const search = await input.api.githubReferences.search({
          projectId: input.projectId,
          query: String(number),
          limit: 20,
        });
        const match = search.entries.find((entry) => entry.number === number);
        if (!match) return null;
        return await input.api.githubReferences.detail({
          projectId: input.projectId,
          reference: {
            kind: match.kind,
            repository: match.repository,
            number: match.number,
            title: match.title,
            url: match.url,
          },
        });
      } catch {
        return null;
      }
    }),
  );
  return appendGitHubReferenceContext(
    input.prompt,
    details.filter((detail): detail is GitHubReferenceDetail => detail !== null),
  );
}
