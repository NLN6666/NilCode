import { describe, expect, it } from "vitest";

import { en } from "~/i18n/locales/en";
import { getRightDockPaneMeta, resolveRightDockLauncherItems } from "./rightDockPaneMeta";

describe("getRightDockPaneMeta", () => {
  it("labels a pane from the active catalog", () => {
    const labels = en.chat.panes.kinds;
    expect(getRightDockPaneMeta("explorer", labels).label).toBe("Explorer");
  });

  it("falls back to a neutral label for a kind the catalog does not know", () => {
    const labels = en.chat.panes.kinds;
    // Stale persisted dock state can name a kind that no longer exists.
    expect(getRightDockPaneMeta("legacy-pane" as never, labels).label).toBe(labels.fallback);
  });

  it("gives the platform-neutral device kind its user-facing iOS label", () => {
    expect(getRightDockPaneMeta("device", en.chat.panes.kinds).label).toBe("iOS Simulator");
  });
});

describe("resolveRightDockLauncherItems", () => {
  const LAUNCHER_INPUT = {
    labels: en.chat.panes.kinds,
    launcherLabels: en.chat.panes.launchers,
    hasBackgroundServices: false,
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

  // This result is the *only* way to reach a pane: it feeds both the empty-dock
  // launcher buttons and the "+" add menu. A kind missing here is unreachable, which
  // is exactly how the services pane shipped with no entry point at all.
  it("hides background services while the roster is empty", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        hasBackgroundServices: false,
      }).map(({ kind }) => kind),
    ).not.toContain("services");
  });

  it("offers background services once the roster has an entry", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        hasBackgroundServices: true,
      }).map(({ kind }) => kind),
    ).toEqual(["terminal", "services", "browser", "explorer", "sidechat"]);
  });

  it("offers the simulator only when the server can host one", () => {
    // Off macOS there is nothing the user could do from this machine to make
    // simulators work, so the entry is hidden rather than shown disabled.
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        hasDeviceSupport: true,
      }).map(({ kind }) => kind),
    ).toEqual(["terminal", "browser", "explorer", "sidechat", "device"]);

    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        hasDeviceSupport: false,
      }).map(({ kind }) => kind),
    ).not.toContain("device");
  });

  it("omits the simulator when support is unknown, so the entry cannot flicker in", () => {
    expect(
      resolveRightDockLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
      }).map(({ kind }) => kind),
    ).not.toContain("device");
  });
});
