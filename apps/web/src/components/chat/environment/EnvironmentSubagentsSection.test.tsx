import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EnvironmentSubagentsSection } from "./EnvironmentSubagentsSection";
import { runningSubagentRosterItem, subagentRosterItem } from "./subagentRosterFixtures";

const noop = () => undefined;

describe("EnvironmentSubagentsSection", () => {
  it("shows live agents ahead of completed avatars in the list-opening row", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSubagentsSection
        roster={{
          active: ["Scout", "Reviewer"].map((label) => runningSubagentRosterItem(label)),
          previous: ["One", "Two", "Three"].map((label) => subagentRosterItem(label)),
        }}
        onOpenList={noop}
      />,
    );

    expect(markup).toContain('data-testid="environment-subagents-section"');
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
    // Only the live agents' avatars lead the summary when both groups exist.
    expect(markup.match(/<svg/g)).toHaveLength(2);
  });

  it("includes queued agents in the active avatar stack", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSubagentsSection
        roster={{
          active: [
            runningSubagentRosterItem("Running"),
            runningSubagentRosterItem("Waiting", { statusKind: "queued", statusLabel: "Queued" }),
          ],
          previous: [],
        }}
        onOpenList={noop}
      />,
    );
    expect(markup).toContain('data-testid="environment-subagents-section"');
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
    expect(markup.match(/<svg/g)).toHaveLength(2);
  });

  it("uses a capped completed-avatar stack when no agent is active", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSubagentsSection
        roster={{
          active: [],
          previous: ["One", "Two", "Three", "Four"].map((label) => subagentRosterItem(label)),
        }}
        onOpenList={noop}
      />,
    );

    expect(markup).toContain('data-testid="environment-subagents-section"');
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(1);
    expect(markup.match(/<svg/g)).toHaveLength(3);
  });

  it("renders nothing before the thread spawns a subagent", () => {
    const markup = renderToStaticMarkup(
      <EnvironmentSubagentsSection roster={{ active: [], previous: [] }} onOpenList={noop} />,
    );

    expect(markup).toBe("");
  });
});
