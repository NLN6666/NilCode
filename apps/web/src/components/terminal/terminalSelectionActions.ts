// FILE: terminalSelectionActions.ts
// Purpose: Keep pure selection-action positioning helpers separate from the browser-heavy drawer.
// Layer: Chat terminal workspace helpers

import type { ContextMenuItem } from "@synara/contracts";

const MULTI_CLICK_SELECTION_ACTION_DELAY_MS = 260;

export function resolveTerminalSelectionContextMenuItems(
  hasComposerTarget: boolean,
  addToChatLabel: string,
): readonly ContextMenuItem<"add-to-chat">[] {
  return hasComposerTarget ? [{ id: "add-to-chat", label: addToChatLabel }] : [];
}

export interface TerminalSelectionCellAnchor {
  /** Bounding rect of the `.xterm-screen` element, in viewport coordinates. */
  readonly screenRect: { left: number; top: number; width: number; height: number };
  readonly cols: number;
  readonly rows: number;
  /** Column just past the last selected cell, as xterm reports it. */
  readonly endColumn: number;
  /** Selection end row, already converted to a viewport-relative row. */
  readonly endRow: number;
}

/**
 * Translate an xterm cell selection into the viewport rect its end sits at.
 *
 * The terminal draws through the WebGL renderer, so its glyphs are canvas pixels
 * rather than DOM text and `window.getSelection()` never describes the selection.
 * Cell coordinates from `Terminal.getSelectionPosition()` are the only faithful
 * source; deriving pixels from them keeps the action anchored to what the user
 * actually highlighted.
 *
 * Returns null when the selection is not currently on screen or the terminal has
 * not been laid out yet, so callers can fall back to the pointer position.
 */
export function resolveTerminalSelectionAnchorRect(
  anchor: TerminalSelectionCellAnchor,
): { right: number; bottom: number } | null {
  const { screenRect, cols, rows, endColumn, endRow } = anchor;
  if (cols <= 0 || rows <= 0 || screenRect.width <= 0 || screenRect.height <= 0) {
    return null;
  }
  if (!Number.isFinite(endColumn) || !Number.isFinite(endRow)) {
    return null;
  }
  // A selection scrolled above or below the viewport has no on-screen anchor.
  if (endRow < 0 || endRow >= rows) {
    return null;
  }
  const cellWidth = screenRect.width / cols;
  const cellHeight = screenRect.height / rows;
  const clampedColumn = Math.max(0, Math.min(endColumn, cols));
  return {
    right: screenRect.left + clampedColumn * cellWidth,
    bottom: screenRect.top + (endRow + 1) * cellHeight,
  };
}

export function resolveTerminalSelectionActionPosition(options: {
  bounds: { left: number; top: number; width: number; height: number };
  selectionRect: { right: number; bottom: number } | null;
  pointer: { x: number; y: number } | null;
  viewport?: { width: number; height: number } | null;
}): { x: number; y: number } {
  const { bounds, selectionRect, pointer, viewport } = options;
  const viewportWidth =
    viewport?.width ??
    (typeof window === "undefined" ? bounds.left + bounds.width + 8 : window.innerWidth);
  const viewportHeight =
    viewport?.height ??
    (typeof window === "undefined" ? bounds.top + bounds.height + 8 : window.innerHeight);
  const drawerLeft = Math.round(bounds.left);
  const drawerTop = Math.round(bounds.top);
  const drawerRight = Math.round(bounds.left + bounds.width);
  const drawerBottom = Math.round(bounds.top + bounds.height);
  const preferredX =
    selectionRect !== null
      ? Math.round(selectionRect.right)
      : pointer === null
        ? Math.round(bounds.left + bounds.width - 140)
        : Math.max(drawerLeft, Math.min(Math.round(pointer.x), drawerRight));
  const preferredY =
    selectionRect !== null
      ? Math.round(selectionRect.bottom + 4)
      : pointer === null
        ? Math.round(bounds.top + 12)
        : Math.max(drawerTop, Math.min(Math.round(pointer.y), drawerBottom));
  return {
    x: Math.max(8, Math.min(preferredX, Math.max(viewportWidth - 8, 8))),
    y: Math.max(8, Math.min(preferredY, Math.max(viewportHeight - 8, 8))),
  };
}

export function terminalSelectionActionDelayForClickCount(clickCount: number): number {
  return clickCount >= 2 ? MULTI_CLICK_SELECTION_ACTION_DELAY_MS : 0;
}

export function shouldHandleTerminalSelectionMouseUp(
  selectionGestureActive: boolean,
  button: number,
): boolean {
  return selectionGestureActive && button === 0;
}
