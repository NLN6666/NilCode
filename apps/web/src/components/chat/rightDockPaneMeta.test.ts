import { describe, expect, it } from "vitest";

import type { ThreadId } from "@synara/contracts";
import { type RightDockPane } from "~/rightDockStore.logic";
import {
  buildRightDockPaneLabelOverrides,
  getRightDockPaneMeta,
  resolveRightDockPaneLabel,
  resolveRightDockLauncherItems,
} from "./rightDockPaneMeta";

const translate = (key: string) => key;

const resolveLauncherItems = (input: Parameters<typeof resolveRightDockLauncherItems>[0]) =>
  resolveRightDockLauncherItems(input, translate);

function makePane(
  input: Partial<RightDockPane> & Pick<RightDockPane, "id" | "kind">,
): RightDockPane {
  return {
    threadId: null,
    diffTurnId: null,
    diffFilePath: null,
    filePath: null,
    pullRequestProjectId: null,
    pullRequestRepository: null,
    pullRequestNumber: null,
    pullRequestInitialTab: null,
    ...input,
  };
}

describe("getRightDockPaneMeta", () => {
  it("falls back to a neutral label for a kind the catalog does not know", () => {
    // Stale persisted dock state can name a kind that no longer exists.
    expect(getRightDockPaneMeta("legacy-pane" as never, translate).label).toBe("common:panel");
  });

  it("gives the platform-neutral device kind its user-facing iOS label", () => {
    expect(getRightDockPaneMeta("device", translate).label).toBe("computer:iOSSimulator");
  });
});

describe("resolveRightDockLauncherItems", () => {
  const LAUNCHER_INPUT = {
    hasBackgroundServices: false,
  };

  it("offers the non-Git tools for a chat without a repository", () => {
    expect(
      resolveLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
      }).map(({ kind, label }) => [kind, label]),
    ).toEqual([
      ["terminal", "workspace:viewportPane_terminal"],
      ["browser", "computer:browser"],
      ["explorer", "workspace:toolCallDetails_filesSection"],
      ["sidechat", "chat:sideChats"],
    ]);
  });

  it("adds review and source control only for Git repositories", () => {
    expect(
      resolveLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: true,
        hasReview: true,
      }).map(({ kind }) => kind),
    ).toEqual(["diff", "terminal", "browser", "explorer", "sidechat", "git"]);
  });

  it("hides workspace-backed tools while no workspace is ready", () => {
    expect(
      resolveLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: false,
        hasGitRepository: false,
        hasReview: false,
      }).map(({ kind }) => kind),
    ).toEqual(["terminal", "browser", "sidechat"]);
  });

  it("hides review for a clean Git repository", () => {
    expect(
      resolveLauncherItems({
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
      resolveLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        hasBackgroundServices: false,
      }).map(({ kind }) => kind),
    ).not.toContain("services");
  });

  it("offers background services once the roster has an entry", () => {
    const items = resolveLauncherItems({
      ...LAUNCHER_INPUT,
      hasWorkspace: true,
      hasGitRepository: false,
      hasReview: false,
      hasBackgroundServices: true,
    });

    expect(items.map(({ kind }) => kind)).toEqual([
      "terminal",
      "services",
      "browser",
      "explorer",
      "sidechat",
    ]);
    expect(items.find(({ kind }) => kind === "services")?.label).toBe("chat:backgroundServices");
  });

  it("offers the simulator only when the server can host one", () => {
    // Off macOS there is nothing the user could do from this machine to make
    // simulators work, so the entry is hidden rather than shown disabled.
    expect(
      resolveLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        hasDeviceSupport: true,
      }).map(({ kind }) => kind),
    ).toEqual(["terminal", "browser", "explorer", "sidechat", "device"]);

    expect(
      resolveLauncherItems({
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
      resolveLauncherItems({
        ...LAUNCHER_INPUT,
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
      }).map(({ kind }) => kind),
    ).not.toContain("device");
  });
});

describe("buildRightDockPaneLabelOverrides", () => {
  it("uses the embedded sidechat thread title for its hidden-header tab", () => {
    const pane = makePane({
      id: "sidechat:thread-child",
      kind: "sidechat",
      threadId: "thread-child" as ThreadId,
    });

    const overrides = buildRightDockPaneLabelOverrides(
      [pane],
      [{ id: "thread-child", title: "Investigate the parser" }],
    );

    expect(resolveRightDockPaneLabel(pane, overrides, translate)).toBe("Investigate the parser");
  });

  it("keeps the generic sidechat label until the child thread is hydrated", () => {
    const pane = makePane({
      id: "sidechat:thread-child",
      kind: "sidechat",
      threadId: "thread-child" as ThreadId,
    });

    const overrides = buildRightDockPaneLabelOverrides([pane], []);

    expect(overrides).toBeUndefined();
    expect(resolveRightDockPaneLabel(pane, overrides, translate)).toBe("chat:sideChats");
  });
});
