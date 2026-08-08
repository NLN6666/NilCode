// FILE: rightDockPaneMeta.tsx
// Purpose: Shared semantic metadata (icon + label) for right-dock pane kinds.
// Layer: Chat right-dock UI primitives
// Exports: per-kind meta map, ordered add-menu kinds, and pane label/icon resolvers.

import type { ReactNode } from "react";

import type { Messages } from "~/i18n/locales/en";
import type { LucideIcon } from "~/lib/icons";
import {
  DiffIcon,
  FileIcon,
  FoldersIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  GlobeIcon,
  InfoIcon,
  MessageCircleIcon,
  ServerIcon,
  TerminalIcon,
} from "~/lib/icons";
import { type RightDockPane, type RightDockPaneKind } from "~/rightDockStore.logic";
import { CHAT_SURFACE_CHIP_ICON_CLASS_NAME, SurfaceChipIcon } from "./chatHeaderControls";
import { FileEntryIcon } from "./FileEntryIcon";

export interface RightDockPaneMeta {
  label: string;
  Icon: LucideIcon;
}

/** Pane labels for the active locale; the glyphs below stay locale-free. */
export type RightDockPaneLabels = Messages["chat"]["panes"]["kinds"];

export interface RightDockLauncherItem extends RightDockPaneMeta {
  kind: RightDockPaneKind;
}

const RIGHT_DOCK_PANE_ICONS: Record<RightDockPaneKind, LucideIcon> = {
  browser: GlobeIcon,
  diff: DiffIcon,
  explorer: FoldersIcon,
  file: FileIcon,
  terminal: TerminalIcon,
  sidechat: MessageCircleIcon,
  git: GitCommitIcon,
  pullRequest: GitPullRequestIcon,
  services: ServerIcon,
};

// Always resolve pane meta through this helper instead of indexing the map
// directly, so an unknown kind degrades gracefully rather than throwing. An
// unrecognized kind (e.g. stale persisted state) falls back to a neutral label
// and glyph; persisted dock state is sanitized on rehydrate, so this is only a
// defensive guard to keep a single bad pane from crashing render.
export function getRightDockPaneMeta(
  kind: RightDockPaneKind,
  labels: RightDockPaneLabels,
): RightDockPaneMeta {
  return {
    label: labels[kind] ?? labels.fallback,
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
  "git",
];

/** Launcher names for the active locale; kinds absent here reuse their tab label. */
export type RightDockLauncherLabels = Messages["chat"]["panes"]["launchers"];

/**
 * The one list of pane kinds a user can open, for both entry points.
 *
 * This drives the empty-dock launcher buttons AND the "+" add menu on a populated
 * dock (SingleChatSurface passes the result through as `addMenuKinds`). A kind left
 * out of `RIGHT_DOCK_LAUNCHER_ORDER` is therefore unreachable from the UI entirely,
 * not merely demoted to the menu — which is how the services pane shipped with no
 * way to open it at all. See findings.md #17.
 */
export function resolveRightDockLauncherItems(input: {
  hasWorkspace: boolean;
  hasGitRepository: boolean;
  hasReview: boolean;
  /**
   * Whether the daemon roster has any entry at all — including services that have
   * already exited. Exited entries keep the launcher visible on purpose: a service
   * that just crashed is exactly when its log matters most, and gating on "still
   * alive" would retract the entry at that moment.
   */
  hasBackgroundServices: boolean;
  labels: RightDockPaneLabels;
  launcherLabels: RightDockLauncherLabels;
}): readonly RightDockLauncherItem[] {
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
    const meta = getRightDockPaneMeta(kind, input.labels);
    return [
      {
        kind,
        Icon: meta.Icon,
        label:
          (input.launcherLabels as Partial<Record<RightDockPaneKind, string>>)[kind] ?? meta.label,
      },
    ];
  });
}

// Resolves a tab label, preferring caller-provided per-pane overrides (e.g. the
// embedded sidechat thread title) before falling back to the kind label.
export function resolveRightDockPaneLabel(
  pane: RightDockPane,
  labels: RightDockPaneLabels,
  overrides?: Record<string, string | undefined>,
): string {
  return overrides?.[pane.id] ?? getRightDockPaneMeta(pane.kind, labels).label;
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
