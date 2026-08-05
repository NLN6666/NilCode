import { describe, expect, it } from "vitest";

import { en } from "~/i18n/locales/en";
import { RIGHT_DOCK_PANE_KINDS } from "~/rightDockStore.logic";
import {
  RIGHT_DOCK_ADD_MENU_KINDS,
  getRightDockPaneMeta,
  resolveRightDockLauncherItems,
} from "./rightDockPaneMeta";

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

describe("resolveRightDockLauncherItems", () => {
  const LAUNCHER_INPUT = {
    labels: en.chat.panes.kinds,
    launcherLabels: en.chat.panes.launchers,
  };

  it("offers the non-Git tools for a chat without a repository", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
      }).map(({ kind, label }) => [kind, label]),
    ).toEqual([
      ["terminal", "Terminal"],
      ["browser", "Browser"],
      ["explorer", "Files"],
      ["sidechat", "Side chats"],
    ]);
  });

  it("adds review and source control only for Git repositories", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: true,
        hasReview: true,
      }).map(({ kind }) => kind),
    ).toEqual(["diff", "terminal", "browser", "explorer", "sidechat", "git"]);
  });

  it("hides workspace-backed tools while no workspace is ready", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: false,
        hasGitRepository: false,
        hasReview: false,
      }).map(({ kind }) => kind),
    ).toEqual(["terminal", "browser", "sidechat"]);
  });

  it("hides review for a clean Git repository", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: true,
        hasReview: false,
      }).map(({ kind }) => kind),
    ).toEqual(["terminal", "browser", "explorer", "sidechat", "git"]);
  });
});
