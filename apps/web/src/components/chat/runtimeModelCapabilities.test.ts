import { describe, expect, it } from "vitest";

import { getRuntimeAwareModelCapabilities } from "./runtimeModelCapabilities";
import { withCloudModelDescriptors } from "~/providerModelOptions";

const efforts = (input: Parameters<typeof getRuntimeAwareModelCapabilities>[0]) =>
  getRuntimeAwareModelCapabilities(input).reasoningEffortLevels.map((level) => level.value);

describe("getRuntimeAwareModelCapabilities for Claude", () => {
  it("gives a model outside the built-in table the discovered ladder", () => {
    // claude-opus-5 ships in the cloud catalog but not in this build's table,
    // so without this it reaches the trait picker with no effort options at all.
    expect(
      efforts({
        provider: "claudeAgent",
        model: "claude-opus-5",
        runtimeModel: {
          slug: "claude-opus-5",
          name: "Claude Opus 5",
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

  it("stays empty when neither the table nor discovery knows the model", () => {
    expect(efforts({ provider: "claudeAgent", model: "claude-opus-9" })).toEqual([]);
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
