import type { ComputerAuditHistoryEntry, ComputerGetAuditHistoryResult } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ComputerAuditHistoryList,
  computerAuditHistoryEntries,
  nextComputerAuditHistoryPage,
} from "./ComputerAuditHistorySection";

function entry(
  index: number,
  effect: ComputerAuditHistoryEntry["effect"] = "dispatched-unknown",
): ComputerAuditHistoryEntry {
  return {
    id: index.toString(16).padStart(64, "0"),
    ts: "2026-09-20T12:00:00.000Z",
    tool: "computer_browser_click",
    effect,
  };
}
function page(
  entries: readonly ComputerAuditHistoryEntry[],
  nextCursor: string | null = "older",
): ComputerGetAuditHistoryResult {
  return { entries, nextCursor, status: "available", truncated: false };
}

describe("Computer audit history", () => {
  it("reduces the final request to the remaining row budget and stops at 100", () => {
    const pages = [0, 30, 60].map((start) =>
      page(Array.from({ length: 30 }, (_, i) => entry(start + i))),
    );
    expect(nextComputerAuditHistoryPage(pages[2]!, pages)).toEqual({ before: "older", limit: 10 });
    const last = page(Array.from({ length: 10 }, (_, i) => entry(90 + i)));
    expect(nextComputerAuditHistoryPage(last, [...pages, last])).toBeUndefined();
    expect(nextComputerAuditHistoryPage(page([], null), [])).toBeUndefined();
  });

  it("deduplicates pages and bounds retained UI rows", () => {
    const entries = Array.from({ length: 110 }, (_, i) => entry(i));
    const result = computerAuditHistoryEntries([page(entries.slice(0, 30)), page(entries)]);
    expect(result).toHaveLength(100);
    expect(new Set(result.map((item) => item.id)).size).toBe(100);
    expect(result[0]?.id).toBe(entry(0).id);
  });

  it("renders an entry without raw tool names, correlation IDs or private payloads", () => {
    const record = {
      ...entry(1),
      threadId: "private-thread",
      code: "private_refusal",
      args: { text: "synthetic-secret" },
    };
    const markup = renderToStaticMarkup(
      <ComputerAuditHistoryList entries={[record]} status="available" truncated={false} />,
    );
    expect(markup).toContain('role="list"');
    expect(markup.match(/role="listitem"/g) ?? []).toHaveLength(1);
    expect(markup).toContain("2026-09-20T12:00:00.000Z");
    expect(markup).not.toMatch(
      /computer_browser_click|private-thread|private_refusal|synthetic-secret/,
    );
  });

  it("keeps disabled, missing, and truncated empty histories distinguishable", () => {
    const states = [
      ["disabled", false],
      ["missing", false],
      ["available", true],
    ] as const;
    const messages = states.map(([status, truncated]) => {
      const markup = renderToStaticMarkup(
        <ComputerAuditHistoryList entries={[]} status={status} truncated={truncated} />,
      );
      expect(markup).not.toContain('role="list"');
      return markup.match(/<p\b[^>]*>([\s\S]*?)<\/p>/u)?.[1];
    });

    expect(messages.every(Boolean)).toBe(true);
    expect(new Set(messages).size).toBe(states.length);
  });

  it("adds a separate notice when retained bounds omitted earlier actions", () => {
    const render = (truncated: boolean) =>
      renderToStaticMarkup(
        <ComputerAuditHistoryList
          entries={[entry(1, "verified")]}
          status="available"
          truncated={truncated}
        />,
      );
    const markup = render(true);
    expect(markup.match(/role="listitem"/g) ?? []).toHaveLength(1);
    expect(markup.match(/<p\b/g)?.length).toBe((render(false).match(/<p\b/g)?.length ?? 0) + 1);
  });
});
