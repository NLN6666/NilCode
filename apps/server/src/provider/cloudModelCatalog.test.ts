import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeOutboundJson, outboundHttp } from "@synara/shared/outboundHttp";

import {
  clearCloudModelCatalogCacheForTests,
  fetchCloudModelCatalog,
  projectCloudModelCatalog,
} from "./cloudModelCatalog.ts";

vi.mock("@synara/shared/outboundHttp", () => ({
  outboundHttp: { request: vi.fn() },
  decodeOutboundJson: vi.fn(),
}));

const requestMock = vi.mocked(outboundHttp.request);
const decodeMock = vi.mocked(decodeOutboundJson);

function model(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    tool_call: true,
    reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 400_000, output: 128_000 },
    ...overrides,
  };
}

describe("projectCloudModelCatalog", () => {
  it("maps the catalog onto Synara providers and keeps roster metadata", () => {
    const projected = projectCloudModelCatalog({
      openai: { models: { "gpt-5.6-sol": model({ description: "Bulk work" }) } },
      anthropic: {
        models: { "claude-opus-5": model({ id: "claude-opus-5", name: "Claude Opus 5" }) },
      },
      xai: { models: { "grok-4.5": model({ id: "grok-4.5", name: "Grok 4.5" }) } },
    });

    expect(projected.codex).toEqual([
      {
        slug: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        description: "Bulk work",
        contextWindowTokens: 400_000,
      },
    ]);
    expect(projected.claudeAgent?.[0]?.slug).toBe("claude-opus-5");
    expect(projected.grok?.[0]?.slug).toBe("grok-4.5");
  });

  it("drops models a coding agent cannot use", () => {
    const projected = projectCloudModelCatalog({
      xai: {
        models: {
          // Real entries from the live catalog: xai mixes image/video models in.
          "grok-imagine-image": model({
            id: "grok-imagine-image",
            modalities: { input: ["text"], output: ["image"] },
          }),
          "no-tools": model({ id: "no-tools", tool_call: false }),
          // The gpt-4 era is reasoning=false; the Codex CLI cannot run it.
          "non-reasoning": model({ id: "non-reasoning", reasoning: false }),
          "grok-4.5": model({ id: "grok-4.5" }),
        },
      },
    });

    expect(projected.grok?.map((entry) => entry.slug)).toEqual(["grok-4.5"]);
  });

  it("ignores providers Synara does not map to the catalog", () => {
    // Router runtimes get their roster from their own CLI; a generic catalog
    // would offer slugs the CLI cannot start a session with.
    const projected = projectCloudModelCatalog({
      google: { models: { "gemini-3": model({ id: "gemini-3" }) } },
      "google-vertex": { models: { "gemini-3": model({ id: "gemini-3" }) } },
    });

    expect(projected).toEqual({});
  });

  it("reads the effort ladder the catalog reports, when it reports one", () => {
    const projected = projectCloudModelCatalog({
      anthropic: {
        models: {
          "claude-sonnet-4-6": model({
            id: "claude-sonnet-4-6",
            reasoning_options: [
              { type: "effort", values: ["low", "medium", "high", "max"] },
              { type: "budget_tokens", min: 1024 },
            ],
          }),
        },
      },
    });

    expect(projected.claudeAgent?.[0]?.reasoningEffortValues).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  it("survives malformed input instead of losing the whole catalog", () => {
    expect(projectCloudModelCatalog(null)).toEqual({});
    expect(projectCloudModelCatalog("nope")).toEqual({});
    expect(projectCloudModelCatalog({ openai: { models: "not-an-object" } })).toEqual({});

    // One unreadable vendor entry must not cost the user every other model.
    const projected = projectCloudModelCatalog({
      openai: { models: { bad: null, "gpt-5.6": model({ id: "gpt-5.6" }) } },
      anthropic: 42,
    });
    expect(projected.codex?.map((entry) => entry.slug)).toEqual(["gpt-5.6"]);
  });

  it("falls back to the map key when a model omits its own id", () => {
    const projected = projectCloudModelCatalog({
      openai: { models: { "gpt-5.6-terra": model({ id: undefined }) } },
    });

    expect(projected.codex?.[0]?.slug).toBe("gpt-5.6-terra");
  });

  it("omits a context window the catalog does not know", () => {
    const projected = projectCloudModelCatalog({
      openai: { models: { "gpt-5.6": model({ id: "gpt-5.6", limit: { output: 128_000 } }) } },
    });

    expect(projected.codex?.[0]).not.toHaveProperty("contextWindowTokens");
  });
});

function catalogPayload(...slugs: readonly string[]): Record<string, unknown> {
  return {
    openai: {
      models: Object.fromEntries(slugs.map((slug) => [slug, model({ id: slug, name: slug })])),
    },
  };
}

/** Makes the next upstream read succeed with `payload`, or fail when omitted. */
function nextResponse(payload?: Record<string, unknown>): void {
  if (!payload) {
    requestMock.mockRejectedValueOnce(new Error("network down"));
    return;
  }
  requestMock.mockResolvedValueOnce({ status: 200 } as never);
  decodeMock.mockReturnValueOnce(payload);
}

describe("fetchCloudModelCatalog", () => {
  beforeEach(() => {
    clearCloudModelCatalogCacheForTests();
    requestMock.mockReset();
    decodeMock.mockReset();
  });

  it("answers a second read from the cache instead of re-fetching", async () => {
    nextResponse(catalogPayload("gpt-5.6-sol"));

    const first = await fetchCloudModelCatalog();
    const second = await fetchCloudModelCatalog();

    expect(first.codex?.map((entry) => entry.slug)).toEqual(["gpt-5.6-sol"]);
    expect(second).toEqual(first);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches inside the TTL when forced", async () => {
    nextResponse(catalogPayload("gpt-5.6-sol"));
    await fetchCloudModelCatalog();
    nextResponse(catalogPayload("gpt-5.6-sol", "gpt-6"));

    const refreshed = await fetchCloudModelCatalog({ force: true });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(refreshed.codex?.map((entry) => entry.slug)).toEqual(["gpt-5.6-sol", "gpt-6"]);
  });

  it("keeps the previous catalog when a forced refresh fails", async () => {
    nextResponse(catalogPayload("gpt-5.6-sol"));
    const before = await fetchCloudModelCatalog();
    nextResponse();

    const afterFailure = await fetchCloudModelCatalog({ force: true });

    expect(afterFailure).toEqual(before);
    // The cached copy also survives for the next ordinary read.
    expect(await fetchCloudModelCatalog()).toEqual(before);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous catalog when a forced refresh returns an unusable shape", async () => {
    nextResponse(catalogPayload("gpt-5.6-sol"));
    const before = await fetchCloudModelCatalog();
    // An empty projection means the upstream shape changed; it must not evict.
    nextResponse({ openai: { models: {} } });

    expect(await fetchCloudModelCatalog({ force: true })).toEqual(before);
  });

  it("still honours the TTL for ordinary reads after a forced refresh", async () => {
    nextResponse(catalogPayload("gpt-5.6-sol"));
    await fetchCloudModelCatalog();
    nextResponse(catalogPayload("gpt-6"));
    await fetchCloudModelCatalog({ force: true });

    const ordinary = await fetchCloudModelCatalog();

    expect(ordinary.codex?.map((entry) => entry.slug)).toEqual(["gpt-6"]);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
