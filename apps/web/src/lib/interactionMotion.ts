// FILE: interactionMotion.ts
// Purpose: Shared low-cost pointer press feedback for buttons and icon controls.
// Layer: Web UI motion primitive

/**
 * Immediate press feedback stays on compositor-friendly transform plus paint-only
 * color/opacity properties. Keep layout and filter properties out of this list so
 * Windows Electron's software compositor does not turn a click into a page-wide
 * layout/raster animation.
 */
export const INTERACTIVE_PRESS_MOTION_CLASS_NAME =
  "transition-[transform,color,background-color,border-color,opacity] duration-100 ease-out active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none";
