// FILE: providerOrdering.test.ts
// Purpose: Keeps provider ordering normalization covered for every exposed provider.
// Layer: Web settings tests
// Depends on: provider display metadata from contracts and providerOrdering helpers.

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";
import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_ORDER,
  isProviderKind,
  normalizeHiddenProviders,
  normalizeProviderOrder,
  normalizeHiddenModels,
  filterModelOptionsByVisibility,
} from "./providerOrdering";

const ALL_PROVIDER_KINDS = Object.keys(PROVIDER_DISPLAY_NAMES) as ProviderKind[];

describe("providerOrdering", () => {
  it("includes every displayable provider in the default order", () => {
    expect(DEFAULT_PROVIDER_ORDER).toHaveLength(ALL_PROVIDER_KINDS.length);
    expect(new Set(DEFAULT_PROVIDER_ORDER)).toEqual(new Set(ALL_PROVIDER_KINDS));
  });

  it("keeps the shared descriptor exhaustive and aligned with contract labels", () => {
    expect(PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.kind)).toEqual(
      DEFAULT_PROVIDER_ORDER,
    );
    for (const descriptor of PROVIDER_DESCRIPTORS) {
      expect(descriptor.displayName).toBe(PROVIDER_DISPLAY_NAMES[descriptor.kind]);
    }
  });

  it("keeps Pi as a valid provider for persisted order and visibility settings", () => {
    expect(isProviderKind("pi")).toBe(true);
    expect(normalizeProviderOrder(["pi", "codex"])[0]).toBe("pi");
    expect(normalizeHiddenProviders(["bogus", "pi", "pi"])).toEqual(["pi"]);
  });
});

describe("normalizeHiddenModels", () => {
  it("drops unknown providers, blank slugs, and duplicates", () => {
    expect(
      normalizeHiddenModels([
        { provider: "claudeAgent", slug: "claude-haiku-4-5" },
        { provider: "not-a-provider", slug: "x" },
        { provider: "codex", slug: "   " },
        { provider: "claudeAgent", slug: "CLAUDE-HAIKU-4-5" },
      ]),
    ).toEqual([{ provider: "claudeAgent", slug: "claude-haiku-4-5" }]);
  });
});

describe("filterModelOptionsByVisibility", () => {
  const options = [{ slug: "claude-opus-5" }, { slug: "claude-haiku-4-5" }];

  it("removes a hidden model", () => {
    expect(
      filterModelOptionsByVisibility("claudeAgent", options, [
        { provider: "claudeAgent", slug: "claude-haiku-4-5" },
      ]),
    ).toEqual([{ slug: "claude-opus-5" }]);
  });

  it("keeps the model in use even when it is hidden", () => {
    // This guard is why model hiding is safe to ship: without it a thread could
    // be stranded on a model its own picker refused to show.
    expect(
      filterModelOptionsByVisibility(
        "claudeAgent",
        options,
        [{ provider: "claudeAgent", slug: "claude-haiku-4-5" }],
        "claude-haiku-4-5",
      ),
    ).toEqual(options);
  });

  it("ignores entries belonging to another provider", () => {
    expect(
      filterModelOptionsByVisibility("claudeAgent", options, [
        { provider: "codex", slug: "claude-haiku-4-5" },
      ]),
    ).toEqual(options);
  });

  it("treats hiding everything as hiding nothing", () => {
    // An empty picker reads as a broken app, and the user's next move would be
    // to undo it anyway.
    expect(
      filterModelOptionsByVisibility(
        "claudeAgent",
        options,
        options.map((option) => ({ provider: "claudeAgent" as const, slug: option.slug })),
      ),
    ).toEqual(options);
  });
});
