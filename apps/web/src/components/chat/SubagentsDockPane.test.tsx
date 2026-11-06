import { ThreadId } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  runningSubagentRosterItem,
  subagentRosterItem,
} from "./environment/subagentRosterFixtures";
import { SubagentsList } from "./SubagentsDockPane";

const noop = () => undefined;

describe("SubagentsList", () => {
  it("lists active runs with controls, then done runs folded after ten", () => {
    const markup = renderToStaticMarkup(
      <SubagentsList
        roster={{
          active: [
            runningSubagentRosterItem("Scout", { lastToolName: "Grep", totalTokens: 18_000 }),
          ],
          previous: [
            subagentRosterItem("Broken", { statusLabel: "Failed", statusKind: "failed" }),
            ...Array.from({ length: 11 }, (_, index) => subagentRosterItem(`Done ${index + 1}`)),
          ],
        }}
        parent={{ threadId: ThreadId.makeUnsafe("parent"), label: "Refactor auth" }}
        nowMs={Date.parse("2026-10-10T10:02:00.000Z")}
        onOpen={noop}
        onBackground={noop}
        onStop={noop}
      />,
    );

    expect(markup).toContain("Refactor auth");
    expect(markup.match(/data-testid="subagents-pane-active-row"/g) ?? []).toHaveLength(1);
    expect(markup.match(/data-testid="subagents-pane-done-row"/g) ?? []).toHaveLength(12);
    const activeControls =
      markup.match(/<button\b[^>]*\baria-label="[^"]*Scout[^"]*"[^>]*>/g) ?? [];
    expect(activeControls).toHaveLength(3);
    expect(markup).toContain(" · Grep · 18k tokens");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Done 9");
    expect(markup).toContain('aria-hidden="true" inert=""');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("keeps parent navigation when sibling details are not hydrated", () => {
    const markup = renderToStaticMarkup(
      <SubagentsList
        roster={{ active: [], previous: [] }}
        parent={{ threadId: ThreadId.makeUnsafe("parent"), label: "Parent" }}
        nowMs={0}
        onOpen={noop}
        onBackground={noop}
        onStop={noop}
      />,
    );
    expect(markup).toContain("Parent");
    expect(markup).toContain('data-testid="subagents-dock-pane"');
    expect(markup).not.toContain('data-testid="subagents-pane-active-row"');
    expect(markup).not.toContain('data-testid="subagents-pane-done-row"');
    expect(markup).toContain("h-full min-h-0");
  });

  it("does not invent a finish time and keeps failure statistics separate from the summary", () => {
    const markup = renderToStaticMarkup(
      <SubagentsList
        roster={{
          active: [],
          previous: [
            subagentRosterItem("Broken", {
              settledAt: null,
              statusKind: "failed",
              statusLabel: "Failed",
              summary: "Quota exhausted",
              totalTokens: 12000,
              toolUses: 3,
            }),
          ],
        }}
        parent={null}
        nowMs={Date.parse("2026-10-10T10:02:00Z")}
        onOpen={noop}
        onBackground={noop}
        onStop={noop}
      />,
    );
    expect(markup).not.toContain("ago");
    expect(markup).toContain("12k tokens · 3 tool calls");
    expect(markup.match(/Quota exhausted/g)).toHaveLength(1);
  });

  it("updates finished-row timing as the supplied clock advances", () => {
    const render = (nowMs: number) =>
      renderToStaticMarkup(
        <SubagentsList
          roster={{
            active: [],
            previous: [subagentRosterItem("Quiet", { statusKind: "idle", statusLabel: "Idle" })],
          }}
          parent={null}
          nowMs={nowMs}
          onOpen={noop}
          onBackground={noop}
          onStop={noop}
        />,
      );
    const shortlyAfterFinish = render(Date.parse("2026-10-10T10:01:10Z"));
    const later = render(Date.parse("2026-10-10T10:03:10Z"));
    expect(shortlyAfterFinish).not.toBe(later);
  });

  it.each(["Idle", "Closed"])("does not label a finished row as %s", (statusLabel) => {
    const markup = renderToStaticMarkup(
      <SubagentsList
        roster={{
          active: [],
          previous: [subagentRosterItem("Quiet", { statusKind: "idle", statusLabel })],
        }}
        parent={null}
        nowMs={0}
        onOpen={noop}
        onBackground={noop}
        onStop={noop}
      />,
    );
    expect(markup).not.toContain(`>${statusLabel}</span>`);
  });

  it("renders the empty-list state when the chat has no subagents", () => {
    const markup = renderToStaticMarkup(
      <SubagentsList
        roster={{ active: [], previous: [] }}
        parent={null}
        nowMs={0}
        onOpen={noop}
        onBackground={noop}
        onStop={noop}
      />,
    );

    expect(markup).toContain('data-testid="subagents-dock-pane"');
    expect(markup).not.toContain('data-testid="subagents-pane-active-row"');
    expect(markup).not.toContain('data-testid="subagents-pane-done-row"');
    expect(markup).toContain("h-full min-h-0");
  });
});
