// FILE: browserTerminalSplit.logic.ts
// Purpose: Pure sizing math for the vertical split that stacks the service terminal under the
//          browser preview inside one dock pane.
// Layer: Chat right-dock UI state helpers
// Exports: sizing constants, height clamp, and the drag-to-resize transition.
//
// Kept separate from the component so the clamp rules are unit-testable and so the drag
// handler stays a one-line call instead of inline arithmetic.

/** Terminal never shrinks below one readable row block plus its tab strip. */
export const BROWSER_TERMINAL_MIN_HEIGHT = 120;

/** The preview above it keeps at least this much, so the page never becomes a sliver. */
export const BROWSER_TERMINAL_MIN_PREVIEW_HEIGHT = 160;

/** Used until the pane has been measured, and whenever the stored height is unusable. */
export const BROWSER_TERMINAL_DEFAULT_HEIGHT = 220;

/**
 * Fit `desiredHeight` into `containerHeight` while honoring both minimums.
 *
 * When the pane is too short to satisfy both, neither minimum can win outright, so the
 * split falls back to an even divide — the terminal gets half rather than pinning itself
 * to its minimum and squeezing the preview to nothing.
 */
export function clampBrowserTerminalHeight(input: {
  desiredHeight: number;
  containerHeight: number;
}): number {
  const { desiredHeight, containerHeight } = input;
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return Math.max(BROWSER_TERMINAL_MIN_HEIGHT, Math.round(desiredHeight));
  }

  const maxHeight = containerHeight - BROWSER_TERMINAL_MIN_PREVIEW_HEIGHT;
  if (maxHeight < BROWSER_TERMINAL_MIN_HEIGHT) {
    return Math.round(containerHeight / 2);
  }

  const requested = Number.isFinite(desiredHeight)
    ? desiredHeight
    : BROWSER_TERMINAL_DEFAULT_HEIGHT;
  return Math.round(Math.min(Math.max(requested, BROWSER_TERMINAL_MIN_HEIGHT), maxHeight));
}

/**
 * Height the terminal should take after a drag. The handle sits on top of the terminal,
 * so dragging up (a smaller clientY) grows it.
 */
export function browserTerminalHeightFromDrag(input: {
  startHeight: number;
  startPointerY: number;
  pointerY: number;
  containerHeight: number;
}): number {
  return clampBrowserTerminalHeight({
    desiredHeight: input.startHeight + (input.startPointerY - input.pointerY),
    containerHeight: input.containerHeight,
  });
}
