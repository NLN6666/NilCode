import type { ProviderModelDescriptor } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  getRuntimeAwareModelCapabilities,
  resolveRuntimeModelDescriptor,
} from "./runtimeModelCapabilities";
import { mergeDynamicModelOptions, withCloudModelDescriptors } from "~/providerModelOptions";
import { providerModelSupportsAutoRuntimeMode } from "~/lib/runtimeMode";

const efforts = (input: Parameters<typeof getRuntimeAwareModelCapabilities>[0]) =>
  getRuntimeAwareModelCapabilities(input).reasoningEffortLevels.map((level) => level.value);

describe("getRuntimeAwareModelCapabilities for Claude", () => {
  it("gives a model outside the built-in table the discovered ladder", () => {
    // Family fallback must not mask the actual discovered ladder of a newer model.
    expect(
      efforts({
        provider: "claudeAgent",
        model: "claude-opus-6",
        runtimeModel: {
          slug: "claude-opus-6",
          name: "Claude Opus 6",
          supportedReasoningEfforts: [
            { value: "low" },
            { value: "medium" },
            { value: "high" },
            { value: "xhigh" },
            { value: "max" },
          ],
        },
      }),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps a curated ladder rather than letting discovery flatten it", () => {
    // The built-in ladder carries Synara-only prompt modes that no discovery
    // source reports; replacing it would silently drop them.
    const curated = efforts({
      provider: "claudeAgent",
      model: "claude-opus-4-8",
      runtimeModel: {
        slug: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        supportedReasoningEfforts: [{ value: "low" }, { value: "high" }],
      },
    });

    expect(curated).toContain("ultrathink");
    expect(curated.length).toBeGreaterThan(2);
  });

  it("borrows the newest family ladder for a newer Claude model until discovery arrives", () => {
    expect(efforts({ provider: "claudeAgent", model: "claude-opus-9" })).toEqual(
      efforts({ provider: "claudeAgent", model: "claude-opus-5-5" }),
    );
  });

  it("does not guess a ladder for an unrecognized Claude model", () => {
    expect(efforts({ provider: "claudeAgent", model: "claude-custom" })).toEqual([]);
  });
});

describe("withCloudModelDescriptors", () => {
  const cloud = [
    {
      slug: "claude-opus-5",
      name: "Claude Opus 5",
      reasoningEffortValues: ["low", "high"],
    },
  ];

  it("adds a descriptor for a model the CLI did not report", () => {
    const merged = withCloudModelDescriptors([], cloud);

    expect(merged).toEqual([
      {
        slug: "claude-opus-5",
        name: "Claude Opus 5",
        supportedReasoningEfforts: [{ value: "low" }, { value: "high" }],
      },
    ]);
  });

  it("leaves a model the CLI already described alone", () => {
    // The CLI knows what it accepts; the catalog only knows what the vendor sells.
    const runtime = [
      { slug: "claude-opus-5", name: "From CLI", supportedReasoningEfforts: [{ value: "max" }] },
    ];

    expect(withCloudModelDescriptors(runtime, cloud)).toBe(runtime);
  });

  it("passes the runtime list straight through when there is no cloud catalog", () => {
    const runtime = [{ slug: "claude-sonnet-5", name: "Claude Sonnet 5" }];

    expect(withCloudModelDescriptors(runtime, undefined)).toBe(runtime);
    expect(withCloudModelDescriptors(runtime, [])).toBe(runtime);
  });

  it("omits the effort field when the catalog reports no ladder", () => {
    expect(withCloudModelDescriptors([], [{ slug: "m", name: "M" }])[0]).not.toHaveProperty(
      "supportedReasoningEfforts",
    );
  });
});

describe("resolveRuntimeModelDescriptor", () => {
  it("matches a Claude model by its resolved canonical id", () => {
    const runtimeModels: ReadonlyArray<ProviderModelDescriptor> = [
      {
        slug: "sonnet",
        resolvedModel: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        supportsAutoMode: false,
      },
    ];

    expect(
      resolveRuntimeModelDescriptor({
        provider: "claudeAgent",
        model: "claude-sonnet-5",
        runtimeModels,
      }),
    ).toBe(runtimeModels[0]);
  });

  it.each([
    ["opus", true],
    ["opus[1m]", true],
    ["opus[1m]", false],
  ] as const)("preserves Auto support for discovered %s (%s)", (slug, supportsAutoMode) => {
    const runtimeModels: ReadonlyArray<ProviderModelDescriptor> = [
      { slug, resolvedModel: "claude-opus-6[1m]", name: "Opus", supportsAutoMode },
    ];
    const [option] = mergeDynamicModelOptions({
      provider: "claudeAgent",
      staticOptions: [],
      dynamicModels: runtimeModels,
    });
    expect(option?.slug).toBe("claude-opus-6");
    const descriptor = resolveRuntimeModelDescriptor({
      provider: "claudeAgent",
      model: option?.slug,
      runtimeModels,
    });
    expect(descriptor).toBe(runtimeModels[0]);
    expect(
      providerModelSupportsAutoRuntimeMode("claudeAgent", descriptor, {
        provider: "claudeAgent",
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        supportsAutoRuntimeMode: true,
        checkedAt: new Date(0).toISOString(),
      }),
    ).toBe(supportsAutoMode);
  });

  it("prefers an exact Claude descriptor over a context-qualified fallback", () => {
    const runtimeModels: ReadonlyArray<ProviderModelDescriptor> = [
      {
        slug: "opus[1m]",
        resolvedModel: "claude-opus-6[1m]",
        name: "Opus",
        supportsAutoMode: true,
      },
      { slug: "claude-opus-6", name: "Opus", supportsAutoMode: false },
    ];
    expect(
      resolveRuntimeModelDescriptor({
        provider: "claudeAgent",
        model: "claude-opus-6",
        runtimeModels,
      }),
    ).toBe(runtimeModels[1]);
  });

  it("does not resolve an explicitly qualified selection to a bare Claude descriptor", () => {
    expect(
      resolveRuntimeModelDescriptor({
        provider: "claudeAgent",
        model: "claude-opus-6[1m]",
        runtimeModels: [{ slug: "claude-opus-6", name: "Opus", supportsAutoMode: true }],
      }),
    ).toBeUndefined();
  });
});
