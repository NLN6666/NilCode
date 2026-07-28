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
  TerminalIcon,
} from "~/lib/icons";
import {
  RIGHT_DOCK_PANE_KINDS,
  type RightDockPane,
  type RightDockPaneKind,
} from "~/rightDockStore.logic";
import { CHAT_SURFACE_CHIP_ICON_CLASS_NAME, SurfaceChipIcon } from "./chatHeaderControls";
import { FileEntryIcon } from "./FileEntryIcon";

export interface RightDockPaneMeta {
  label: string;
  Icon: LucideIcon;
}

/** Pane labels for the active locale; the glyphs below stay locale-free. */
export type RightDockPaneLabels = Messages["chat"]["panes"]["kinds"];

const RIGHT_DOCK_PANE_ICONS: Record<RightDockPaneKind, LucideIcon> = {
  browser: GlobeIcon,
  diff: DiffIcon,
  explorer: FoldersIcon,
  file: FileIcon,
  terminal: TerminalIcon,
  sidechat: MessageCircleIcon,
  git: GitCommitIcon,
  pullRequest: GitPullRequestIcon,
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

// Add-menu / quick triggers follow the canonical kind order from the single
// source of truth, so they stay in sync as kinds are added or removed. The
// "file" kind is intentionally excluded: single-file preview tabs are opened by
// clicking a file reference in chat, while the add menu offers the richer
// "explorer" pane (file tree + search + viewer) in its place.
export const RIGHT_DOCK_ADD_MENU_KINDS: readonly RightDockPaneKind[] = RIGHT_DOCK_PANE_KINDS.filter(
  (kind) => kind !== "file" && kind !== "pullRequest",
);

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
