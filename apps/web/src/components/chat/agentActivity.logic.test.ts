import { describe, expect, it } from "vitest";
import type { WorkLogEntry } from "../../session-logic";
import {
  REASONING_TRACE_TITLE_KEY,
  deriveAgentActivityTimelineState,
  formatAgentActivityEntryPreview,
  formatAgentActivityEntryTitle,
  isAgentActivityWorkEntry,
  isCodexActivityStatusWorkEntry,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";

function workEntry(overrides: Partial<WorkLogEntry> & Pick<WorkLogEntry, "id">): WorkLogEntry {
  return {
    createdAt: "2026-06-05T00:00:00.000Z",
    label: "Tool call",
    tone: "tool",
    ...overrides,
  };
}

describe("deriveAgentActivityTimelineState", () => {
  it("compacts consecutive reasoning updates while preserving detail entries", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "reasoning-1",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Check sidebar z-index",
      }),
      workEntry({
        id: "reasoning-2",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Verify diffToggleControl uses valid props",
      }),
      workEntry({
        id: "tool-1",
        label: "Read",
        tone: "tool",
      }),
    ]);

    expect(state.timelineWorkEntries.map((entry) => entry.id)).toEqual([
      "agent-reasoning:reasoning-1",
      "tool-1",
    ]);
    // The count travels as data; the component layer composes "N updates - ...".
    expect(state.timelineWorkEntries[0]).toMatchObject({
      label: REASONING_TRACE_TITLE_KEY,
      toolTitle: REASONING_TRACE_TITLE_KEY,
      reasoningUpdateCount: 2,
      preview: "Verify diffToggleControl uses valid props",
    });
    expect(state.detailById.get("agent-reasoning:reasoning-1")?.entries).toHaveLength(2);
  });

  it("cleans reasoning prefixes for single update previews", () => {
    const entry = workEntry({
      id: "reasoning-1",
      label: "Reasoning update",
      detail: "Reasoning update Running Complete analysis of the floating panel issue",
    });

    expect(formatAgentActivityEntryPreview(entry)).toBe(
      "Complete analysis of the floating panel issue",
    );
  });

  it("keeps canonical reasoning tool calls as separate timeline rows", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "reasoning-item-1",
        label: "Reasoning",
        toolTitle: "Reasoning",
        toolCallId: "provider-reasoning-1",
        detail: "Inspect the protocol",
      }),
      workEntry({
        id: "reasoning-item-2",
        label: "Reasoning",
        toolTitle: "Reasoning",
        toolCallId: "provider-reasoning-2",
        detail: "Update the adapter",
      }),
      workEntry({
        id: "reasoning-item-3",
        label: "Reasoning",
        toolTitle: "Reasoning",
        toolCallId: "provider-reasoning-3",
        detail: "Verify the result",
      }),
    ]);

    expect(state.timelineWorkEntries.map((entry) => entry.id)).toEqual([
      "reasoning-item-1",
      "reasoning-item-2",
      "reasoning-item-3",
    ]);
    expect(state.timelineWorkEntries.every((entry) => entry.tone === "tool")).toBe(true);
  });

  it("shows the latest readable Codex summary and omits empty placeholders", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "reasoning-visible",
        label: "Reasoning trace",
        toolTitle: "Reasoning trace",
        toolCallId: "provider-reasoning-visible",
        detail:
          "**Planning Codex threads inspection**\n\n<!-- -->\n\n**Refining the display logic**\n\n<!-- -->",
      }),
      workEntry({
        id: "reasoning-empty",
        label: "Reasoning trace",
        toolTitle: "Reasoning trace",
        toolCallId: "provider-reasoning-empty",
      }),
    ]);

    expect(state.timelineWorkEntries).toHaveLength(1);
    expect(state.timelineWorkEntries[0]).toMatchObject({
      id: "reasoning-visible",
      preview: "Refining the display logic",
    });
  });

  it("recognizes reasoning trace and summary labels as reasoning activity", () => {
    const trace = workEntry({
      id: "reasoning-trace-1",
      label: "Reasoning trace",
      detail: "Reasoning trace Running Inspect the protocol",
    });
    const summary = workEntry({
      id: "reasoning-summary-1",
      label: "Reasoning summary",
      detail: "Reasoning summary Update the adapter",
    });

    expect(isReasoningUpdateWorkEntry(trace)).toBe(true);
    expect(isReasoningUpdateWorkEntry(summary)).toBe(true);
    expect(
      isCodexActivityStatusWorkEntry(
        workEntry({
          id: "command-execution-1",
          label: "Ran command",
          toolTitle: "Ran command",
          itemType: "command_execution",
        }),
      ),
    ).toBe(true);
    expect(formatAgentActivityEntryPreview(trace)).toBe("Inspect the protocol");
    expect(formatAgentActivityEntryPreview(summary)).toBe("Update the adapter");
  });

  it("keeps generic agent task rows openable without compacting them away", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "agent-task-1",
        label: "Find changelog implementation",
        itemType: "collab_agent_tool_call",
        toolTitle: "Find changelog implementation",
        subagentAction: {
          tool: "task",
          status: "completed",
          summaryText: "Agent activity",
          prompt: "Explore this codebase to find the changelog feature.",
        },
      }),
    ]);

    expect(state.timelineWorkEntries.map((entry) => entry.id)).toEqual(["agent-task-1"]);
    expect(isAgentActivityWorkEntry(state.timelineWorkEntries[0]!)).toBe(true);
    expect(state.detailById.get("agent-task-1")).toMatchObject({
      title: { kind: "text", text: "Find changelog implementation" },
      summary: "Explore this codebase to find the changelog feature.",
    });
  });

  it("uses the prompt as the detail summary when the agent result is long", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "agent-task-1",
        label: "Find changelog implementation",
        itemType: "collab_agent_tool_call",
        toolTitle: "Find changelog implementation",
        detail: "Full changelog report\nwith many file references and implementation notes.",
        subagentAction: {
          tool: "task",
          status: "completed",
          summaryText: "Agent activity",
          prompt: "Explore this codebase to find the changelog feature.",
        },
      }),
    ]);

    expect(state.detailById.get("agent-task-1")).toMatchObject({
      summary: "Explore this codebase to find the changelog feature.",
    });
    expect(state.timelineWorkEntries[0]).toMatchObject({
      detail: "Full changelog report\nwith many file references and implementation notes.",
    });
  });
  it("carries no update count for a single compacted reasoning update", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "reasoning-1",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Check sidebar z-index",
      }),
    ]);

    expect(state.timelineWorkEntries[0]).toMatchObject({
      label: REASONING_TRACE_TITLE_KEY,
      preview: "Check sidebar z-index",
    });
    expect(state.timelineWorkEntries[0]?.reasoningUpdateCount).toBeUndefined();
  });

  it("still recognizes its own synthesized rows as reasoning after key-ification", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({
        id: "reasoning-1",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Check sidebar z-index",
      }),
      workEntry({
        id: "reasoning-2",
        label: "Reasoning update",
        tone: "info",
        detail: "Running Verify the adapter",
      }),
    ]);

    const synthesized = state.timelineWorkEntries[0]!;
    expect(isReasoningUpdateWorkEntry(synthesized)).toBe(true);
    expect(isAgentActivityWorkEntry(synthesized)).toBe(true);
    expect(isCodexActivityStatusWorkEntry(synthesized)).toBe(true);
    expect(formatAgentActivityEntryTitle(synthesized)).toEqual({ kind: "reasoning" });
  });

  it("never surfaces the reasoning title key as preview text", () => {
    const state = deriveAgentActivityTimelineState([
      workEntry({ id: "reasoning-1", label: "Reasoning update", tone: "info" }),
    ]);

    // A previewless group still yields a row; its preview must resolve to null
    // rather than falling back to the raw key now living in `label`.
    expect(state.timelineWorkEntries[0]?.label).toBe(REASONING_TRACE_TITLE_KEY);
    expect(formatAgentActivityEntryPreview(state.timelineWorkEntries[0]!)).toBeNull();
    expect(
      formatAgentActivityEntryPreview(
        workEntry({
          id: "reasoning-key-only",
          label: REASONING_TRACE_TITLE_KEY,
          toolTitle: REASONING_TRACE_TITLE_KEY,
        }),
      ),
    ).toBeNull();
  });

  it("returns semantic title keys instead of English copy", () => {
    expect(
      formatAgentActivityEntryTitle(
        workEntry({ id: "reasoning-1", label: "Reasoning update", tone: "info" }),
      ),
    ).toEqual({ kind: "reasoning" });
    expect(
      formatAgentActivityEntryTitle(
        workEntry({ id: "agent-1", label: "", itemType: "collab_agent_tool_call" }),
      ),
    ).toEqual({ kind: "agentTask" });
    expect(formatAgentActivityEntryTitle(workEntry({ id: "other-1", label: "" }))).toEqual({
      kind: "activity",
    });
    expect(formatAgentActivityEntryTitle(workEntry({ id: "read-1", label: "Read" }))).toEqual({
      kind: "text",
      text: "Read",
    });
  });
});
