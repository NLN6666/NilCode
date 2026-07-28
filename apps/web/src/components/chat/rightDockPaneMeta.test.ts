import { describe, expect, it } from "vitest";

import { en } from "~/i18n/locales/en";
import { RIGHT_DOCK_PANE_KINDS } from "~/rightDockStore.logic";
import { RIGHT_DOCK_ADD_MENU_KINDS, getRightDockPaneMeta } from "./rightDockPaneMeta";

describe("RIGHT_DOCK_ADD_MENU_KINDS", () => {
  it("offers the explorer pane but not the chat-driven file pane", () => {
    // The "+" menu surfaces the file-tree explorer; single-file preview tabs are
    // opened by clicking a file reference in chat, not from the add menu.
    expect(RIGHT_DOCK_ADD_MENU_KINDS).toContain("explorer");
    expect(RIGHT_DOCK_ADD_MENU_KINDS).not.toContain("file");
  });

  it("keeps the canonical kind order minus context-only panes", () => {
    expect([...RIGHT_DOCK_ADD_MENU_KINDS]).toEqual(
      RIGHT_DOCK_PANE_KINDS.filter((kind) => kind !== "file" && kind !== "pullRequest"),
    );
  });

  it("labels a pane from the active catalog", () => {
    const labels = en.chat.panes.kinds;
    expect(getRightDockPaneMeta("explorer", labels).label).toBe("Explorer");
  });

  it("falls back to a neutral label for a kind the catalog does not know", () => {
    const labels = en.chat.panes.kinds;
    // Stale persisted dock state can name a kind that no longer exists.
    expect(getRightDockPaneMeta("legacy-pane" as never, labels).label).toBe(labels.fallback);
  });
});
