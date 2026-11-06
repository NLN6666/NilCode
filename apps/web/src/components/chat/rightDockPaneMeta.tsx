// FILE: rightDockPaneMeta.tsx
// Purpose: Shared semantic metadata (icon + label) for right-dock pane kinds.
// Layer: Chat right-dock UI primitives
// Exports: per-kind meta map, launcher items, and pane label/icon resolvers.

import type { ReactNode } from "react";
import { t } from "~/i18n";

import { resolveSubagentPresentationForThread } from "~/lib/subagentPresentation";
import { basenameOfPath } from "~/file-icons";
import type { LucideIcon } from "~/lib/icons";
import {
  BotIcon,
  DeviceMobileIcon,
  DiffIcon,
  FileIcon,
  FoldersIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  GlobeIcon,
  InfoIcon,
  ServerIcon,
  SidechatIcon,
  TerminalIcon,
} from "~/lib/icons";
import { type RightDockPane, type RightDockPaneKind } from "~/rightDockStore.logic";
import { CHAT_SURFACE_CHIP_ICON_CLASS_NAME, SurfaceChipIcon } from "./chatHeaderControls";
import { FileEntryIcon } from "./FileEntryIcon";
import { pullRequestPaneTabLabel } from "../pullRequest/pullRequestDetail.logic";

export interface RightDockPaneMeta {
  label: string;
  Icon: LucideIcon;
}

export interface RightDockLauncherItem extends RightDockPaneMeta {
  kind: RightDockPaneKind;
}

const RIGHT_DOCK_PANE_ICONS: Record<RightDockPaneKind, LucideIcon> = {
  browser: GlobeIcon,
  // The contracts stay platform-neutral ("device") so Android emulators can plug
  // in later, but the only backend today is the iOS Simulator, so that is what
  // the label says.
  device: DeviceMobileIcon,
  diff: DiffIcon,
  explorer: FoldersIcon,
  file: FileIcon,
  terminal: TerminalIcon,
  sidechat: SidechatIcon,
  git: GitCommitIcon,
  pullRequest: GitPullRequestIcon,
  services: ServerIcon,
  subagents: BotIcon,
};

const RIGHT_DOCK_PANE_LABEL_KEYS: Record<RightDockPaneKind, string> = {
  browser: "computer:browser",
  device: "computer:iOSSimulator",
  diff: "workspace:toolCallDetails_diffSection",
  explorer: "chat:explorer",
  file: "chat:file",
  terminal: "workspace:viewportPane_terminal",
  sidechat: "chat:sideChats",
  git: "chat:git",
  pullRequest: "git:general_environmentPullRequest",
  services: "desktop:services",
  subagents: "chat:subagents",
};

// Always resolve pane meta through this helper instead of indexing the map
// directly, so an unknown kind degrades gracefully rather than throwing.
export function getRightDockPaneMeta(
  kind: RightDockPaneKind,
  translate: typeof t = t,
): RightDockPaneMeta {
  return {
    label: translate(RIGHT_DOCK_PANE_LABEL_KEYS[kind] ?? "common:panel"),
    Icon: RIGHT_DOCK_PANE_ICONS[kind] ?? InfoIcon,
  };
}

// Empty-dock launchers prioritize the everyday workspace tools. Review only
// appears when the selected diff scope contains changes, Git is gated by
// repository discovery, Explorer needs a concrete workspace, and Services only
// appears once the machine actually has a background service to show. Context-only
// file and pull-request panes continue to open from their owning surfaces.
const RIGHT_DOCK_LAUNCHER_ORDER: readonly RightDockPaneKind[] = [
  "diff",
  "terminal",
  "services",
  "browser",
  "explorer",
  "sidechat",
  "device",
  "git",
];

const RIGHT_DOCK_LAUNCHER_LABEL_KEYS: Partial<Record<RightDockPaneKind, string>> = {
  diff: "chat:review",
  explorer: "workspace:toolCallDetails_filesSection",
  sidechat: "chat:sideChats",
  git: "git:gitPanel_title",
  services: "chat:backgroundServices",
};

export function resolveRightDockLauncherItems(
  input: {
    hasWorkspace: boolean;
    hasGitRepository: boolean;
    hasReview: boolean;
    hasBackgroundServices: boolean;
    /**
     * Simulators need a macOS server with Xcode. Off macOS the entry is hidden
     * outright rather than shown disabled: there is nothing the user could do
     * from this machine to make it work.
     */
    hasDeviceSupport?: boolean;
  },
  translate: typeof t = t,
): readonly RightDockLauncherItem[] {
  return RIGHT_DOCK_LAUNCHER_ORDER.flatMap((kind) => {
    if (kind === "diff" && !input.hasReview) {
      return [];
    }
    if (kind === "git" && !input.hasGitRepository) {
      return [];
    }
    if (kind === "explorer" && !input.hasWorkspace) {
      return [];
    }
    if (kind === "services" && !input.hasBackgroundServices) {
      return [];
    }
    if (kind === "device" && input.hasDeviceSupport !== true) {
      return [];
    }
    const meta = getRightDockPaneMeta(kind, translate);
    const launcherLabel = RIGHT_DOCK_LAUNCHER_LABEL_KEYS[kind];
    return [
      {
        kind,
        Icon: meta.Icon,
        label: launcherLabel ? translate(launcherLabel) : meta.label,
      },
    ];
  });
}

// Resolves a tab label, preferring caller-provided per-pane overrides (e.g. the
// embedded sidechat thread title) before falling back to the kind label.
export function resolveRightDockPaneLabel(
  pane: RightDockPane,
  overrides?: Record<string, string | undefined>,
  translate: typeof t = t,
): string {
  return overrides?.[pane.id] ?? getRightDockPaneMeta(pane.kind, translate).label;
}

export function buildRightDockPaneLabelOverrides(
  panes: readonly RightDockPane[],
  threadSummaries: readonly (Parameters<
    typeof resolveSubagentPresentationForThread
  >[0]["thread"] & { title: string })[],
): Record<string, string | undefined> | undefined {
  const summaryByThreadId = new Map(threadSummaries.map((thread) => [thread.id, thread] as const));
  const overrides: Record<string, string | undefined> = {};

  for (const pane of panes) {
    if (pane.kind === "file" && pane.filePath) {
      overrides[pane.id] = basenameOfPath(pane.filePath);
    } else if (pane.kind === "pullRequest" && pane.pullRequestNumber !== null) {
      overrides[pane.id] = pullRequestPaneTabLabel(pane.pullRequestNumber);
    } else if (pane.kind === "sidechat" && pane.threadId) {
      const thread = summaryByThreadId.get(pane.threadId);
      const presentation = thread?.parentThreadId
        ? resolveSubagentPresentationForThread({ thread })
        : null;
      const title = presentation?.fullLabel || thread?.title.trim();
      if (title) {
        overrides[pane.id] = title;
      }
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

// Resolves a tab glyph: file panes show the per-file-type icon (matching the
// pane header and explorer rows), every other pane uses its kind icon. The file
// glyph inherits the tab's muted foreground color (colorMode="inherit") instead
// of its extension color, so dock tabs read like the changed-file rows rather
// than carrying a loud per-type tint.
export function resolveRightDockPaneIcon(pane: RightDockPane): ReactNode {
  if (pane.kind === "file" && pane.filePath) {
    return (
      <FileEntryIcon
        pathValue={pane.filePath}
        kind="file"
        colorMode="inherit"
        className={CHAT_SURFACE_CHIP_ICON_CLASS_NAME}
      />
    );
  }
  return <SurfaceChipIcon icon={RIGHT_DOCK_PANE_ICONS[pane.kind] ?? InfoIcon} />;
}
