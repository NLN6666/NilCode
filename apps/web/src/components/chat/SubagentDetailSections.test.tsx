import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkLogEntry, WorkLogSubagent } from "../../workLog";

// Stubbed so this SSR suite never imports the real store-subscribing module.
// The lazy-subscription guarantee itself is covered in
// SubagentDetailSections.browser.tsx — effects do not run under SSR, so asserting
// it here would pass no matter what the component does.
vi.mock("../../threadDetailSubscriptionRetention", () => ({
  retainThreadDetailSubscription: () => () => {},
}));

const { collectDetailSubagents, SubagentDetailSections } = await import("./SubagentDetailSections");

function subagent(overrides: Partial<WorkLogSubagent> = {}): WorkLogSubagent {
  return { threadId: "subagent:parent:child-1", ...overrides };
}

function renderSections(subagents: ReadonlyArray<WorkLogSubagent>): string {
  return renderToStaticMarkup(
    <SubagentDetailSections
      subagents={subagents}
      chatTypographyStyle={{ fontSize: "14px" }}
      footerTextStyle={{ fontSize: "11px" }}
      onOpenThread={() => {}}
    />,
  );
}

describe("collectDetailSubagents", () => {
  it("dedupes by resolved thread and keeps the latest record", () => {
    const entries: WorkLogEntry[] = [
      {
        id: "entry-1",
        createdAt: "2026-06-05T00:00:00.000Z",
        label: "Agent task",
        tone: "tool",
        subagents: [subagent({ resolvedThreadId: "thread-a", statusLabel: "Running" })],
      },
      {
        id: "entry-2",
        createdAt: "2026-06-05T00:00:01.000Z",
        label: "Agent task",
        tone: "tool",
        subagents: [
          subagent({ resolvedThreadId: "thread-a", statusLabel: "Completed" }),
          subagent({ threadId: "subagent:parent:child-2", resolvedThreadId: "thread-b" }),
        ],
      },
    ];

    const collected = collectDetailSubagents(entries);
    expect(collected).toHaveLength(2);
    expect(collected[0]?.statusLabel).toBe("Completed");
    expect(collected[1]?.resolvedThreadId).toBe("thread-b");
  });

  it("returns nothing when no entry carries subagents", () => {
    expect(
      collectDetailSubagents([
        { id: "entry-1", createdAt: "2026-06-05T00:00:00.000Z", label: "Read", tone: "tool" },
      ]),
    ).toHaveLength(0);
  });
});

describe("SubagentDetailSections", () => {
  it("renders model, role, status, and effort when present", () => {
    const markup = renderSections([
      subagent({
        resolvedThreadId: "thread-a",
        nickname: "Scout",
        role: "explorer",
        model: "claude-opus-4-6",
        effort: "high",
        statusLabel: "Completed",
        background: true,
      }),
    ]);

    expect(markup).toContain("Scout");
    expect(markup).toContain("Model");
    expect(markup).toContain("Opus 4.6");
    expect(markup).toContain("Role");
    expect(markup).toContain("explorer");
    expect(markup).toContain("Status");
    expect(markup).toContain("Completed");
    expect(markup).toContain("Effort");
    expect(markup).toContain("high");
    expect(markup).toContain("Background");
  });

  it("omits metadata rows for fields the subagent does not carry", () => {
    const markup = renderSections([subagent({ resolvedThreadId: "thread-a", nickname: "Scout" })]);

    expect(markup).toContain("Scout");
    expect(markup).not.toContain(">Model<");
    expect(markup).not.toContain(">Effort<");
    expect(markup).not.toContain(">Background<");
  });

  it("disables the open button and explains why without a resolved thread", () => {
    const markup = renderSections([subagent({ nickname: "Scout" })]);

    expect(markup).toContain("disabled");
    expect(markup).toContain("This agent has no conversation to open.");
    // No thread means no conversation disclosure either.
    expect(markup).not.toContain("Show conversation");
  });

  it("renders one card per subagent in a fan-out", () => {
    const markup = renderSections([
      subagent({ threadId: "subagent:parent:a", resolvedThreadId: "thread-a", nickname: "Scout" }),
      subagent({ threadId: "subagent:parent:b", resolvedThreadId: "thread-b", nickname: "Digger" }),
      subagent({ threadId: "subagent:parent:c", resolvedThreadId: "thread-c", nickname: "Runner" }),
    ]);

    expect(markup.split('data-testid="subagent-detail-card"')).toHaveLength(4);
    expect(markup).toContain("Scout");
    expect(markup).toContain("Digger");
    expect(markup).toContain("Runner");
  });
});
